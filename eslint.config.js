import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
	{ ignores: ['dist', 'workers/**/.wrangler', 'workers/**/worker-configuration.d.ts', 'examples'] },

	js.configs.recommended,

	tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			ecmaVersion: 2022,
			globals: globals.worker,
			parserOptions: {
				projectService: {
					allowDefaultProject: ['workers/shared/*.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},

		rules: {
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
		},
	},

	{
		files: ['cli/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			globals: {
				...globals.node,
			},
		},
	},

	unicorn.configs.recommended,
	{
		rules: {
			'unicorn/prevent-abbreviations': [
				'error',
				{
					allowList: {
						// eTag is the standard HTTP Entity Tag name, not an abbreviation
						eTag: true,
						eTags: true,
						eTagResult: true,
						// Allow common filenames
						'environment.d.ts': true,
					},
				},
			],
		},
	},

	importX.flatConfigs.recommended,
	{
		settings: {
			'import-x/resolver-next': [
				createTypeScriptImportResolver({
					alwaysTryTypes: true,
					bun: true,
					project: import.meta.dirname,
				}),
			],
		},
		rules: {
			'import-x/order': [
				'error',
				{
					groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
					'newlines-between': 'always',
					alphabetize: {
						order: 'asc',
						caseInsensitive: true,
					},
				},
			],
			'import-x/no-unresolved': [
				'error',
				{
					ignore: ['cloudflare:*'],
				},
			],
		},
	},

	{
		plugins: {
			'unused-imports': unusedImports,
		},
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{
					vars: 'all',
					varsIgnorePattern: '^_',
					args: 'after-used',
					argsIgnorePattern: '^_',
				},
			],
		},
	},

	// Analytics files need null (Cloudflare Analytics Engine API requires it)
	{
		files: ['**/analytics.ts'],
		rules: {
			'unicorn/no-null': 'off',
		},
	},

	// Test files: relax strict typing rules for mocking and test helpers
	{
		files: ['**/*.test.ts', '**/tests/**/*.ts'],
		rules: {
			'unicorn/consistent-function-scoping': 'off',
		},
	},

	eslintConfigPrettier,
);
