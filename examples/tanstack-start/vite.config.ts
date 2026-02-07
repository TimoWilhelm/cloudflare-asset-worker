import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';

export default defineConfig({
	server: {
		port: 3000,
	},
	environments: {
		ssr: {
			build: {
				rollupOptions: {
					preserveEntrySignatures: 'strict', // https://github.com/cloudflare/workers-sdk/issues/10213
					output: {
						entryFileNames: 'index.js',
						// inlineDynamicImports: true, // bundle to single file
					},
				},
			},
			resolve: {
				noExternal: true,
			},
		},
	},
	plugins: [
		tsConfigPaths({
			projects: ['./tsconfig.json'],
		}),
		cloudflare({ viteEnvironment: { name: 'ssr' } }),
		tanstackStart(),
		viteReact(),
	],
});
