#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { ApiClient } from '../lib/api-client.js';
import { createLogger } from '../lib/logger.js';
import { loadConfig, scanAssets, loadServerCode, formatSize } from '../lib/utilities.js';

const program = new Command();

program.name('cf-deploy').description('CLI tool for deploying applications to Cloudflare Multi-Project Platform').version('0.1.0');

/**
 * Deploy command
 */
program
	.command('deploy')
	.description('Deploy an application based on configuration file (creates a new immutable project each time)')
	.option('-c, --config <path>', 'Path to configuration file', 'deploy.config.json')
	.option('--api-token <token>', 'API token for authentication (or use CF_API_TOKEN env var)')
	.option('--router-url <url>', 'Router URL (or use CF_ROUTER_URL env var)', 'http://127.0.0.1:8787')
	.option('--dry-run', 'Show what would be deployed without actually deploying')
	.action(async (options) => {
		const log = createLogger();
		try {
			log.log('🚀 Cloudflare Asset Worker Deployment');
			log.log('');

			// Load configuration
			log.log(`📄 Loading configuration from: ${options.config}`);
			const config = await loadConfig(options.config);
			const configDirectory = path.dirname(path.resolve(options.config));

			// Get API token and router URL
			const apiToken = options.apiToken || process.env.CF_API_TOKEN;
			const routerUrl = options.routerUrl || process.env.CF_ROUTER_URL || 'http://127.0.0.1:8787';

			if (!apiToken) {
				throw new Error('API token is required. Set CF_API_TOKEN environment variable or use --api-token flag.');
			}

			const client = new ApiClient(routerUrl, apiToken);

			// Create a new project for each deployment (immutable deployment model)
			let projectId;
			log.log('');
			log.log(`📦 Creating new project: ${config.projectName}`);
			await log.indent(async (log) => {
				const project = await client.createProject(config.projectName);
				projectId = project.id;
				log.log(`✓ Project created: ${projectId}`);
			});

			// Validate redirect limits
			if (config.config?.redirects) {
				const MAX_STATIC_REDIRECTS = 2000;
				const MAX_DYNAMIC_REDIRECTS = 100;

				if (config.config.redirects.static) {
					const staticCount = Object.keys(config.config.redirects.static).length;
					if (staticCount > MAX_STATIC_REDIRECTS) {
						console.error(`\n❌ Error: Too many static redirects (${staticCount}). Maximum allowed is ${MAX_STATIC_REDIRECTS}.`);
						process.exit(1);
					}
				}

				if (config.config.redirects.dynamic) {
					const dynamicCount = Object.keys(config.config.redirects.dynamic).length;
					if (dynamicCount > MAX_DYNAMIC_REDIRECTS) {
						console.error(`\n❌ Error: Too many dynamic redirects (${dynamicCount}). Maximum allowed is ${MAX_DYNAMIC_REDIRECTS}.`);
						process.exit(1);
					}
				}
			}

			// Validate environment variables limit
			if (config.env) {
				const MAX_ENV_VARS = 64;
				const MAX_ENV_VAR_SIZE = 5 * 1000; // 5 KB

				const environmentVariableCount = Object.keys(config.env).length;
				if (environmentVariableCount > MAX_ENV_VARS) {
					console.error(`\n❌ Error: Too many environment variables (${environmentVariableCount}). Maximum allowed is ${MAX_ENV_VARS}.`);
					process.exit(1);
				}

				// Validate individual environment variable sizes
				for (const [key, value] of Object.entries(config.env)) {
					const valueSize = Buffer.byteLength(String(value), 'utf8');
					if (valueSize > MAX_ENV_VAR_SIZE) {
						console.error(
							`\n❌ Error: Environment variable '${key}' is too large (${valueSize} bytes). Maximum allowed is ${MAX_ENV_VAR_SIZE} bytes (5 KB).`,
						);
						process.exit(1);
					}
				}
			}

			// Prepare deployment
			const deployment = {
				projectName: config.projectName,
				assets: [],
				config: config.config,
				run_worker_first: config.run_worker_first,
				env: config.env,
			};

			// Load assets if configured
			if (config.assets) {
				log.log('');
				log.log(`📁 Scanning assets from: ${config.assets.directory}`);
				await log.indent(async (log) => {
					const assetsDirectory = path.resolve(configDirectory, config.assets.directory);
					deployment.assets = await scanAssets(assetsDirectory, config.assets.patterns || ['**/*'], config.assets.ignore || []);
					log.log(`✓ Found ${deployment.assets.length} assets`);

					// Validate asset count limit
					const MAX_ASSETS = 20_000;
					if (deployment.assets.length > MAX_ASSETS) {
						log.log('');
						log.error(`❌ Error: Too many assets (${deployment.assets.length}). Maximum allowed is ${MAX_ASSETS}.`);
						process.exit(1);
					}

					// Calculate total size
					const totalSize = deployment.assets.reduce((sum, asset) => {
						return sum + Buffer.from(asset.content, 'base64').length;
					}, 0);
					log.log(`📊 Total size: ${formatSize(totalSize)}`);
				});
			}

			// Load server code if configured
			if (config.server) {
				log.log('');
				log.log(`⚙️  Loading server code from: ${config.server.modulesDirectory}`);
				await log.indent(async (log) => {
					const serverDirectory = path.resolve(configDirectory, config.server.modulesDirectory);
					deployment.server = await loadServerCode(serverDirectory, config.server.entrypoint, config.server.compatibilityDate);
					log.log(`✓ Loaded ${Object.keys(deployment.server.modules).length} modules`);
					log.log(`📌 Entrypoint: ${deployment.server.entrypoint}`);

					// List each module with its type
					log.log('');
					log.log(`📦 Modules:`);
					await log.indent(async (log) => {
						for (const [moduleName, moduleInfo] of Object.entries(deployment.server.modules)) {
							const typeLabel = moduleInfo.type || 'unknown';
							const isEntry = moduleName === deployment.server.entrypoint ? ' (entrypoint)' : '';
							log.log(`• ${moduleName} [${typeLabel}]${isEntry}`);
						}
					});
				});
			}

			// Dry run - show what would be deployed
			if (options.dryRun) {
				console.log('\n🔍 Dry run - would deploy:\n');
				console.log(`Project: ${config.projectName} (${projectId})`);
				console.log(`Assets: ${deployment.assets.length} files`);
				if (deployment.server) {
					console.log(`Server modules: ${Object.keys(deployment.server.modules).length}`);
				}
				if (deployment.env) {
					console.log(`Environment variables: ${Object.keys(deployment.env).length}`);
				}
				console.log('\n✓ Dry run complete (nothing deployed)');
				return;
			}

			// Deploy
			const result = await client.deployApplication(projectId, deployment);

			// Show results
			log.log('');
			log.log('✅ Deployment complete!');
			log.log('');
			log.log(`📊 Deployment Summary:`);
			log.indent((log) => {
				log.log(`- Project: ${config.projectName} (${projectId})`);
				log.log(`- Assets deployed: ${result.deployedAssets || Math.max(deployment.assets.length, 0)}`);
				if (result.newAssets !== undefined) {
					log.log(`- New assets: ${result.newAssets}`);
					log.log(`- Cached assets: ${result.skippedAssets}`);
				}
				if (result.deployedServerModules) {
					log.log(`- Server modules: ${result.deployedServerModules}`);
				}
			});

			// Show access URLs
			log.log('');
			log.log(`🌐 Access your application:`);
			log.indent((log) => {
				const subdomainTemplate = client.getSubdomainRoutingDomain();
				if (subdomainTemplate) {
					log.log(`Subdomain:  ${subdomainTemplate.replace('<projectId>', projectId)}`);
					log.log(`Path-based: ${client.getProjectUrl(projectId)}`);
				} else {
					log.log(client.getProjectUrl(projectId));
				}
			});
		} catch (error) {
			log.log('');
			log.error('❌ Deployment failed: ' + error.message);
			process.exit(1);
		}
	});

/**
 * List projects command
 */
program
	.command('list')
	.description('List all projects')
	.option('--api-token <token>', 'API token for authentication (or use CF_API_TOKEN env var)')
	.option('--router-url <url>', 'Router URL (or use CF_ROUTER_URL env var)', 'http://127.0.0.1:8787')
	.action(async (options) => {
		try {
			// Get API token and router URL
			const apiToken = options.apiToken || process.env.CF_API_TOKEN;
			const routerUrl = options.routerUrl || process.env.CF_ROUTER_URL || 'http://127.0.0.1:8787';

			if (!apiToken) {
				throw new Error('API token is required. Set CF_API_TOKEN environment variable or use --api-token flag.');
			}

			const client = new ApiClient(routerUrl, apiToken);
			const projects = await client.listProjects();

			console.log('\n📋 Projects:\n');
			const subdomainTemplate = client.getSubdomainRoutingDomain();
			for (const project of projects) {
				console.log(`  • ${project.name} (${project.id})`);
				console.log(`    Assets: ${project.assetsCount || 0}, Server: ${project.hasServer ? 'Yes' : 'No'}`);
				if (subdomainTemplate) {
					console.log(`    Subdomain:  ${subdomainTemplate.replace('<projectId>', project.id)}`);
					console.log(`    Path-based: ${client.getProjectUrl(project.id)}`);
				} else {
					console.log(`    URL: ${client.getProjectUrl(project.id)}`);
				}
				console.log('');
			}

			console.log(`Total: ${projects.length} project(s)`);
		} catch (error) {
			console.error('\n❌ Failed to list projects:', error.message);
			process.exit(1);
		}
	});

/**
 * Init command - create example config
 */
program
	.command('init')
	.description('Initialize a new deploy configuration file')
	.option('-o, --output <path>', 'Output path for config file', 'deploy.config.json')
	.action(async (options) => {
		try {
			// Check if file already exists
			try {
				await fs.access(options.output);
				console.error(`\n❌ File already exists: ${options.output}`);
				console.log('   Use a different path with --output or remove the existing file.');
				process.exit(1);
			} catch {
				// File doesn't exist, continue
			}

			// Create example config
			const exampleConfig = {
				projectName: 'My Application',
				assets: {
					directory: './dist',
					patterns: ['**/*'],
					ignore: ['**/*.map', '**/.DS_Store'],
				},
				server: {
					entrypoint: 'index.js',
					modulesDirectory: './server',
					compatibilityDate: '2025-11-09',
				},
				config: {
					html_handling: 'auto-trailing-slash',
					not_found_handling: 'single-page-application',
					redirects: {
						static: {},
						dynamic: {},
					},
					headers: {
						rules: {},
					},
				},
				run_worker_first: ['/api/*'],
				env: {
					ENVIRONMENT: 'production',
					API_URL: 'https://api.example.com',
				},
			};

			await fs.writeFile(options.output, JSON.stringify(exampleConfig, undefined, 2));
			console.log(`\n\u2705 Created configuration file: ${options.output}`);
			console.log('\n\uD83D\uDCDD Next steps:');
			console.log('  1. Edit the configuration file with your project details');
			console.log('  2. Set your CF_API_TOKEN environment variable');
			console.log('  3. Run: cf-deploy deploy');
		} catch (error) {
			console.error('\n❌ Failed to create config:', error.message);
			process.exit(1);
		}
	});

program.parse();
