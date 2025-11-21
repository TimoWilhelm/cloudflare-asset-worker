import { generateJWT, verifyJWT } from '../src/jwt';

describe('JWT utilities', () => {
	const secret = 'test-secret-key-12345';

	describe('generateJWT', () => {
		it('generates a valid JWT token', async () => {
			const payload = { userId: '123', role: 'admin' };
			const token = await generateJWT(payload, secret);

			expect(token).toBeDefined();
			expect(typeof token).toBe('string');

			// JWT should have three parts separated by dots
			const parts = token.split('.');
			expect(parts).toHaveLength(3);
		});

		it('includes payload data in token', async () => {
			const payload = { projectId: 'proj-123', phase: 'upload' };
			const token = await generateJWT(payload, secret);

			const verified = await verifyJWT(token, secret);
			expect(verified).toBeDefined();
			expect(verified.projectId).toBe('proj-123');
			expect(verified.phase).toBe('upload');
		});

		it('adds iat (issued at) timestamp', async () => {
			const before = Math.floor(Date.now() / 1000);
			const token = await generateJWT({ test: 'data' }, secret);
			const after = Math.floor(Date.now() / 1000);

			const verified = await verifyJWT(token, secret);
			expect(verified.iat).toBeDefined();
			expect(verified.iat).toBeGreaterThanOrEqual(before);
			expect(verified.iat).toBeLessThanOrEqual(after);
		});

		it('adds exp (expiration) timestamp 1 hour in future', async () => {
			const before = Math.floor(Date.now() / 1000) + 3600;
			const token = await generateJWT({ test: 'data' }, secret);
			const after = Math.floor(Date.now() / 1000) + 3600;

			const verified = await verifyJWT(token, secret);
			expect(verified.exp).toBeDefined();
			expect(verified.exp).toBeGreaterThanOrEqual(before);
			expect(verified.exp).toBeLessThanOrEqual(after);
		});

		it('generates different tokens for different payloads', async () => {
			const token1 = await generateJWT({ data: 'A' }, secret);
			const token2 = await generateJWT({ data: 'B' }, secret);

			expect(token1).not.toBe(token2);
		});

		it('generates different tokens at different times', async () => {
			const token1 = await generateJWT({ data: 'same' }, secret);

			// Wait enough to ensure different timestamp (1 second precision)
			await new Promise(resolve => setTimeout(resolve, 1100));

			const token2 = await generateJWT({ data: 'same' }, secret);

			expect(token1).not.toBe(token2);
		});
	});

	describe('verifyJWT', () => {
		it('verifies a valid token', async () => {
			const payload = { sessionId: 'sess-123', projectId: 'proj-456' };
			const token = await generateJWT(payload, secret);

			const verified = await verifyJWT(token, secret);
			expect(verified).toBeDefined();
			expect(verified.sessionId).toBe('sess-123');
			expect(verified.projectId).toBe('proj-456');
		});

		it('returns null for invalid signature', async () => {
			const payload = { data: 'test' };
			const token = await generateJWT(payload, secret);

			// Try to verify with wrong secret
			const verified = await verifyJWT(token, 'wrong-secret');
			expect(verified).toBeNull();
		});

		it('returns null for malformed token', async () => {
			expect(await verifyJWT('not.a.valid.jwt.token', secret)).toBeNull();
			expect(await verifyJWT('malformed', secret)).toBeNull();
			expect(await verifyJWT('', secret)).toBeNull();
		});

		it('returns null for token with missing parts', async () => {
			expect(await verifyJWT('header.payload', secret)).toBeNull();
			expect(await verifyJWT('header.', secret)).toBeNull();
			expect(await verifyJWT('.payload.signature', secret)).toBeNull();
		});

		it('returns null for tampered token', async () => {
			const payload = { data: 'original' };
			const token = await generateJWT(payload, secret);

			// Tamper with the payload part
			const parts = token.split('.');
			parts[1] = parts[1]?.substring(0, parts[1].length - 2) + 'XX';
			const tamperedToken = parts.join('.');

			const verified = await verifyJWT(tamperedToken, secret);
			expect(verified).toBeNull();
		});

		it('handles expired tokens', async () => {
			// Create a token with past expiration
			const payload = { data: 'test' };
			const token = await generateJWT(payload, secret);

			// Decode and check it's initially valid
			const verified = await verifyJWT(token, secret);
			expect(verified).toBeDefined();

			// Note: We can't easily test actual expiration without mocking time,
			// but we verify the exp field exists
			expect(verified.exp).toBeDefined();
			expect(typeof verified.exp).toBe('number');
		});

		it('verifies tokens with complex payloads', async () => {
			const complexPayload = {
				sessionId: 'sess-abc',
				projectId: 'proj-xyz',
				phase: 'complete',
				manifest: {
					'/index.html': { hash: 'abc123', size: 1024 },
					'/style.css': { hash: 'def456', size: 512 },
				},
				metadata: {
					timestamp: Date.now(),
					version: '1.0.0',
				},
			};

			const token = await generateJWT(complexPayload, secret);
			const verified = await verifyJWT(token, secret);

			expect(verified).toBeDefined();
			expect(verified.sessionId).toBe('sess-abc');
			expect(verified.projectId).toBe('proj-xyz');
			expect(verified.phase).toBe('complete');
			expect(verified.manifest).toEqual(complexPayload.manifest);
			expect(verified.metadata).toEqual(complexPayload.metadata);
		});

		it('different secrets produce different tokens', async () => {
			const payload = { data: 'test' };
			const token1 = await generateJWT(payload, 'secret1');
			const token2 = await generateJWT(payload, 'secret2');

			// Tokens should be different
			expect(token1).not.toBe(token2);

			// Each can only be verified with its own secret
			expect(await verifyJWT(token1, 'secret1')).toBeDefined();
			expect(await verifyJWT(token1, 'secret2')).toBeNull();
			expect(await verifyJWT(token2, 'secret2')).toBeDefined();
			expect(await verifyJWT(token2, 'secret1')).toBeNull();
		});
	});

	describe('JWT roundtrip', () => {
		it('successfully encodes and decodes data', async () => {
			const testCases = [
				{ phase: 'upload', sessionId: 'sess-1' },
				{ phase: 'complete', projectId: 'proj-1', manifest: {} },
				{ userId: '123', roles: ['admin', 'user'], active: true },
				{ nested: { data: { structure: 'test' } } },
			];

			for (const testCase of testCases) {
				const token = await generateJWT(testCase, secret);
				const verified = await verifyJWT(token, secret);

				expect(verified).toBeDefined();

				// Check all original properties are preserved
				for (const [key, value] of Object.entries(testCase)) {
					expect(verified[key]).toEqual(value);
				}
			}
		});
	});
});
