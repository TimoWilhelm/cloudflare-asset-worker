#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import fs from 'fs/promises';
import { loadConfig, scanAssets, loadServerCode, formatSize } from '../lib/utils.js';
import { ApiClient } from '../lib/api-client.js';

const program = new Command();

program.name('cf-deploy').description('CLI tool for deploying applications to Cloudflare Multi-Project Platform').version('0.1.0');

/**
 * Deploy command
 */
program
	.command('deploy')
	.description('Deploy an application based on configuration file')
	.option('-c, --config <path>', 'Path to configuration file', 'deploy.config.json')
	.option('--create-project', 'Create a new project instead of using existing ID')
	.option('--project-id <id>', 'Override project ID from config')
	.option('--api-token <token>', 'API token for authentication (or use CF_API_TOKEN env var)')
	.option('--orchestrator-url <url>', 'Orchestrator URL (or use CF_ORCHESTRATOR_URL env var)', 'http://127.0.0.1:8787')
	.option('--dry-run', 'Show what would be deployed without actually deploying')
	.action(async (options) => {
		try {
			console.log('🚀 Cloudflare Asset Worker Deployment\n');

			// Load configuration
			console.log(`📄 Loading configuration from: ${options.config}`);
			const config = await loadConfig(options.config);
			const configDir = path.dirname(path.resolve(options.config));

			// Get API token and orchestrator URL
			const apiToken = options.apiToken || process.env.CF_API_TOKEN;
			const orchestratorUrl = options.orchestratorUrl || process.env.CF_ORCHESTRATOR_URL || 'http://127.0.0.1:8787';

			if (!apiToken) {
				throw new Error('API token is required. Set CF_API_TOKEN environment variable or use --api-token flag.');
			}

			const client = new ApiClient(orchestratorUrl, apiToken);

			// Determine project ID
			let projectId = options.projectId || config.projectId;

			if (options.createProject || !projectId) {
				console.log(`\n📦 Creating new project: ${config.projectName}`);
				const project = await client.createProject(config.projectName);
				projectId = project.id;
				console.log(`  ✓ Project created: ${projectId}`);
			} else {
				console.log(`\n📦 Using existing project: ${projectId}`);
				try {
					const project = await client.getProject(projectId);
					console.log(`  ✓ Project found: ${project.name}`);
				} catch (error) {
					console.error(`  ⚠️  Warning: Could not verify project exists`);
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
				console.log(`\n📁 Scanning assets from: ${config.assets.directory}`);
				const assetsDir = path.resolve(configDir, config.assets.directory);
				deployment.assets = await scanAssets(assetsDir, config.assets.patterns || ['**/*'], config.assets.ignore || []);
				console.log(`  ✓ Found ${deployment.assets.length} assets`);

				// Calculate total size
				const totalSize = deployment.assets.reduce((sum, asset) => {
					return sum + Buffer.from(asset.content, 'base64').length;
				}, 0);
				console.log(`  📊 Total size: ${formatSize(totalSize)}`);
			}

			// Load server code if configured
			if (config.serverCode) {
				console.log(`\n⚙️  Loading server code from: ${config.serverCode.modulesDirectory}`);
				const serverDir = path.resolve(configDir, config.serverCode.modulesDirectory);
				deployment.serverCode = await loadServerCode(serverDir, config.serverCode.entrypoint, config.serverCode.compatibilityDate);
				console.log(`  ✓ Loaded ${Object.keys(deployment.serverCode.modules).length} modules`);
				console.log(`  📌 Entrypoint: ${deployment.serverCode.entrypoint}`);
			}

			// Dry run - show what would be deployed
			if (options.dryRun) {
				console.log('\n🔍 Dry run - would deploy:\n');
				console.log(`Project: ${config.projectName} (${projectId})`);
				console.log(`Assets: ${deployment.assets.length} files`);
				if (deployment.serverCode) {
					console.log(`Server modules: ${Object.keys(deployment.serverCode.modules).length}`);
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
			console.log('\n✅ Deployment complete!\n');
			console.log(`📊 Deployment Summary:`);
			console.log(`  - Project: ${config.projectName} (${projectId})`);
			console.log(`  - Assets deployed: ${result.deployedAssets || deployment.assets.length}`);
			if (result.newAssets !== undefined) {
				console.log(`  - New assets: ${result.newAssets}`);
				console.log(`  - Cached assets: ${result.skippedAssets}`);
			}
			if (result.deployedServerCodeModules) {
				console.log(`  - Server modules: ${result.deployedServerCodeModules}`);
			}

			// Show access URLs
			console.log(`\n🌐 Access your application:`);
			const subdomainTemplate = client.getSubdomainRoutingDomain();
			if (subdomainTemplate) {
				console.log(`  Subdomain:  ${subdomainTemplate.replace('<projectId>', projectId)} (configure worker route)`);
				console.log(`  Path-based: ${client.getProjectUrl(projectId)}`);
			} else {
				console.log(`  ${client.getProjectUrl(projectId)}`);
			}
		} catch (error) {
			console.error('\n❌ Deployment failed:', error.message);
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
	.option('--orchestrator-url <url>', 'Orchestrator URL (or use CF_ORCHESTRATOR_URL env var)', 'http://127.0.0.1:8787')
	.action(async (options) => {
		try {
			// Get API token and orchestrator URL
			const apiToken = options.apiToken || process.env.CF_API_TOKEN;
			const orchestratorUrl = options.orchestratorUrl || process.env.CF_ORCHESTRATOR_URL || 'http://127.0.0.1:8787';

			if (!apiToken) {
				throw new Error('API token is required. Set CF_API_TOKEN environment variable or use --api-token flag.');
			}

			const client = new ApiClient(orchestratorUrl, apiToken);
			const projects = await client.listProjects();

			console.log('\n📋 Projects:\n');
			const subdomainTemplate = client.getSubdomainRoutingDomain();
			projects.forEach((project) => {
				console.log(`  • ${project.name} (${project.id})`);
				console.log(`    Assets: ${project.assetsCount || 0}, Server: ${project.hasServerCode ? 'Yes' : 'No'}`);
				if (subdomainTemplate) {
					console.log(`    Subdomain:  ${subdomainTemplate.replace('<projectId>', project.id)}`);
					console.log(`    Path-based: ${client.getProjectUrl(project.id)}`);
				} else {
					console.log(`    URL: ${client.getProjectUrl(project.id)}`);
				}
				console.log('');
			});

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
			} catch (error) {
				// File doesn't exist, continue
			}

			// Create example config
			const exampleConfig = {
				projectName: 'My Application',
				projectId: null,
				assets: {
					directory: './dist',
					patterns: ['**/*'],
					ignore: ['**/*.map', '**/.DS_Store'],
				},
				serverCode: {
					entrypoint: 'index.js',
					modulesDirectory: './server',
					compatibilityDate: '2025-11-09',
				},
				config: {
					html_handling: 'auto-trailing-slash',
					not_found_handling: 'single-page-application',
					redirects: {
						staticRules: {},
						rules: {},
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

			await fs.writeFile(options.output, JSON.stringify(exampleConfig, null, 2));
			console.log(`\n\u2705 Created configuration file: ${options.output}`);
			console.log('\n\ud83d\udcdd Next steps:');
			console.log('  1. Edit the configuration file with your project details');
			console.log('  2. Set your CF_API_TOKEN environment variable');
			console.log('  3. Run: cf-deploy deploy --create-project');
		} catch (error) {
			console.error('\n❌ Failed to create config:', error.message);
			process.exit(1);
		}
	});

program.parse();
