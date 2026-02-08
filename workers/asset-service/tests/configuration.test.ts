import { describe, expect, it } from 'vitest';

import { normalizeConfiguration, MAX_STATIC_REDIRECTS, MAX_DYNAMIC_REDIRECTS } from '../src/configuration';

describe('Configuration Validation', () => {
	describe('redirect limits', () => {
		it('should accept configurations within static redirect limits', () => {
			const config = {
				redirects: {
					static: Object.fromEntries(
						Array.from({ length: MAX_STATIC_REDIRECTS }, (_, index) => [`/path${index}`, { status: 301, to: `/new${index}` }]),
					),
					dynamic: {},
				},
			};

			expect(() => normalizeConfiguration(config)).not.toThrow();
		});

		it('should reject configurations exceeding static redirect limits', () => {
			const config = {
				redirects: {
					static: Object.fromEntries(
						Array.from({ length: MAX_STATIC_REDIRECTS + 1 }, (_, index) => [`/path${index}`, { status: 301, to: `/new${index}` }]),
					),
					dynamic: {},
				},
			};

			expect(() => normalizeConfiguration(config)).toThrow(
				`Too many static redirects: ${MAX_STATIC_REDIRECTS + 1}. Maximum allowed is ${MAX_STATIC_REDIRECTS}.`,
			);
		});

		it('should accept configurations within dynamic redirect limits', () => {
			const config = {
				redirects: {
					static: {},
					dynamic: Object.fromEntries(
						Array.from({ length: MAX_DYNAMIC_REDIRECTS }, (_, index) => [`/path${index}/*`, { status: 301, to: `/new${index}/:splat` }]),
					),
				},
			};

			expect(() => normalizeConfiguration(config)).not.toThrow();
		});

		it('should reject configurations exceeding dynamic redirect limits', () => {
			const config = {
				redirects: {
					static: {},
					dynamic: Object.fromEntries(
						Array.from({ length: MAX_DYNAMIC_REDIRECTS + 1 }, (_, index) => [
							`/path${index}/*`,
							{ status: 301, to: `/new${index}/:splat` },
						]),
					),
				},
			};

			expect(() => normalizeConfiguration(config)).toThrow(
				`Too many dynamic redirects: ${MAX_DYNAMIC_REDIRECTS + 1}. Maximum allowed is ${MAX_DYNAMIC_REDIRECTS}.`,
			);
		});

		it('should validate both static and dynamic limits independently', () => {
			const config = {
				redirects: {
					static: Object.fromEntries(
						Array.from({ length: MAX_STATIC_REDIRECTS }, (_, index) => [`/path${index}`, { status: 301, to: `/new${index}` }]),
					),
					dynamic: Object.fromEntries(
						Array.from({ length: MAX_DYNAMIC_REDIRECTS }, (_, index) => [`/dyn${index}/*`, { status: 301, to: `/new${index}/:splat` }]),
					),
				},
			};

			expect(() => normalizeConfiguration(config)).not.toThrow();
		});

		it('should allow empty redirect configuration', () => {
			const config = {
				redirects: {
					static: {},
					dynamic: {},
				},
			};

			expect(() => normalizeConfiguration(config)).not.toThrow();
		});

		it('should allow missing redirect configuration', () => {
			expect(() => normalizeConfiguration({})).not.toThrow();
			expect(() => normalizeConfiguration()).not.toThrow();
		});
	});
});
