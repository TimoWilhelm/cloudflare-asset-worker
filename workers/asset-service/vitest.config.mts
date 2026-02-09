import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		globalSetup: ['./scripts/regenerate-fixture.mts'],
		globals: true,
		poolOptions: {
			workers: {
				wrangler: {
					configPath: './wrangler.jsonc',
				},
			},
		},
	},
});
