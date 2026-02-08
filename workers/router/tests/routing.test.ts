import { matchesGlobPatterns, shouldRunWorkerFirst, extractProjectId, rewriteRequestUrl } from '../src/routing';

describe('routing utilities', () => {
	describe('matchesGlobPatterns', () => {
		describe('basic matching', () => {
			it('matches exact paths', () => {
				expect(matchesGlobPatterns('/api/users', ['/api/users'])).toBe(true);
				expect(matchesGlobPatterns('/api/users', ['/api/posts'])).toBe(false);
			});

			it('matches wildcard patterns', () => {
				// Note: /api/* matches /api/users.ext but not /api/users (no extension)
				// Use /api/** for recursive matching
				expect(matchesGlobPatterns('/api/users.json', ['/api/*'])).toBe(true);
				expect(matchesGlobPatterns('/api/users/123', ['/api/*'])).toBe(false);
				expect(matchesGlobPatterns('/api/users/123', ['/api/**'])).toBe(true);
				expect(matchesGlobPatterns('/api/users', ['/api/**'])).toBe(true);
			});

			it('matches multiple patterns (OR logic)', () => {
				const patterns = ['/api/*', '/admin/**', '/auth/login'];

				expect(matchesGlobPatterns('/api/users', patterns)).toBe(true);
				expect(matchesGlobPatterns('/admin/dashboard', patterns)).toBe(true);
				expect(matchesGlobPatterns('/admin/users/edit', patterns)).toBe(true);
				expect(matchesGlobPatterns('/auth/login', patterns)).toBe(true);
				expect(matchesGlobPatterns('/public/index.html', patterns)).toBe(false);
			});

			it('matches file extensions', () => {
				const patterns = ['**/*.html', '**/*.css'];

				expect(matchesGlobPatterns('/index.html', patterns)).toBe(true);
				expect(matchesGlobPatterns('/style.css', patterns)).toBe(true);
				expect(matchesGlobPatterns('/script.js', patterns)).toBe(false);
			});

			it('handles empty pattern array', () => {
				expect(matchesGlobPatterns('/any/path', [])).toBe(false);
			});

			it('handles complex glob patterns', () => {
				expect(matchesGlobPatterns('/api/v1/users', ['/api/*/users'])).toBe(true);
				expect(matchesGlobPatterns('/api/v2/posts', ['/api/*/users'])).toBe(false);
				expect(matchesGlobPatterns('/images/logo.png', ['/**/*.png'])).toBe(true);
			});
		});

		describe('negative patterns', () => {
			it('excludes paths matching negative patterns', () => {
				// Only negative pattern - should always return false (no positive match)
				expect(matchesGlobPatterns('/api/internal', ['!/api/internal'])).toBe(false);
				expect(matchesGlobPatterns('/api/public', ['!/api/internal'])).toBe(false);
			});

			it('negative patterns have precedence over positive patterns', () => {
				// Match everything under /api except /api/internal
				const patterns = ['/api/**', '!/api/internal/**'];

				expect(matchesGlobPatterns('/api/users', patterns)).toBe(true);
				expect(matchesGlobPatterns('/api/posts', patterns)).toBe(true);
				expect(matchesGlobPatterns('/api/internal/secret', patterns)).toBe(false);
				expect(matchesGlobPatterns('/api/internal/admin', patterns)).toBe(false);
			});

			it('order of patterns does not matter', () => {
				// Same patterns in different order should produce same results
				const patterns1 = ['/api/**', '!/api/internal/**'];
				const patterns2 = ['!/api/internal/**', '/api/**'];

				expect(matchesGlobPatterns('/api/users', patterns1)).toBe(true);
				expect(matchesGlobPatterns('/api/users', patterns2)).toBe(true);

				expect(matchesGlobPatterns('/api/internal/secret', patterns1)).toBe(false);
				expect(matchesGlobPatterns('/api/internal/secret', patterns2)).toBe(false);
			});

			it('handles multiple negative patterns', () => {
				const patterns = ['/api/**', '!/api/internal/**', '!/api/admin/**'];

				expect(matchesGlobPatterns('/api/users', patterns)).toBe(true);
				expect(matchesGlobPatterns('/api/posts', patterns)).toBe(true);
				expect(matchesGlobPatterns('/api/internal/secret', patterns)).toBe(false);
				expect(matchesGlobPatterns('/api/admin/dashboard', patterns)).toBe(false);
			});

			it('handles file extension exclusions', () => {
				const patterns = ['/**/*', '!/**/*.map', '!/**/*.ts'];

				expect(matchesGlobPatterns('/script.js', patterns)).toBe(true);
				expect(matchesGlobPatterns('/style.css', patterns)).toBe(true);
				expect(matchesGlobPatterns('/script.js.map', patterns)).toBe(false);
				expect(matchesGlobPatterns('/component.ts', patterns)).toBe(false);
			});

			it('works with exact path exclusions', () => {
				const patterns = ['/api/**', '!/api/health'];

				expect(matchesGlobPatterns('/api/users', patterns)).toBe(true);
				expect(matchesGlobPatterns('/api/health', patterns)).toBe(false);
			});
		});

		describe('edge cases', () => {
			it('returns false when only negative patterns exist', () => {
				// No positive patterns means nothing can match
				expect(matchesGlobPatterns('/anything', ['!/excluded'])).toBe(false);
				expect(matchesGlobPatterns('/excluded', ['!/excluded'])).toBe(false);
			});

			it('handles patterns with no matches', () => {
				expect(matchesGlobPatterns('/unrelated/path', ['/api/**', '!/api/internal/**'])).toBe(false);
			});
		});
	});

	describe('shouldRunWorkerFirst', () => {
		it('returns false when config is undefined', () => {
			expect(shouldRunWorkerFirst(undefined, '/any/path')).toBe(false);
		});

		it('returns false when config is false', () => {
			expect(shouldRunWorkerFirst(false, '/any/path')).toBe(false);
		});

		it('returns true when config is true', () => {
			expect(shouldRunWorkerFirst(true, '/any/path')).toBe(true);
			expect(shouldRunWorkerFirst(true, '/another/path')).toBe(true);
		});

		it('checks patterns when config is string array', () => {
			const config = ['/api/*', '/admin/**'];

			expect(shouldRunWorkerFirst(config, '/api/users')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/admin/dashboard')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/public/index.html')).toBe(false);
		});

		it('handles empty array config', () => {
			expect(shouldRunWorkerFirst([], '/any/path')).toBe(false);
		});

		it('works with complex patterns', () => {
			const config = ['/**/*.html', '/api/**', '/auth/login'];

			expect(shouldRunWorkerFirst(config, '/index.html')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/about.html')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/pages/about.html')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/api/v1/users')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/api/v2/posts/123')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/auth/login')).toBe(true);
			expect(shouldRunWorkerFirst(config, '/static/style.css')).toBe(false);
		});
	});

	describe('extractProjectId', () => {
		describe('path-based routing', () => {
			it('extracts project ID from path', () => {
				const url = new URL('https://example.com/__project/my-project/');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('my-project');
				expect(result.isPathBased).toBe(true);
			});

			it('extracts project ID from path with nested route', () => {
				const url = new URL('https://example.com/__project/my-project/some/nested/path');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('my-project');
				expect(result.isPathBased).toBe(true);
			});

			it('handles project IDs with special characters', () => {
				const url = new URL('https://example.com/__project/project-123_abc/');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('project-123_abc');
				expect(result.isPathBased).toBe(true);
			});

			it('returns null for incomplete path', () => {
				const url = new URL('https://example.com/__project/');
				const result = extractProjectId(url);

				expect(result.projectId).toBeUndefined();
				expect(result.isPathBased).toBe(true);
			});
		});

		describe('subdomain-based routing', () => {
			it('extracts project ID from subdomain', () => {
				const url = new URL('https://my-project.example.com/');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('my-project');
				expect(result.isPathBased).toBe(false);
			});

			it('extracts project ID from subdomain with path', () => {
				const url = new URL('https://my-project.example.com/some/path');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('my-project');
				expect(result.isPathBased).toBe(false);
			});

			it('ignores www subdomain', () => {
				const url = new URL('https://www.example.com/');
				const result = extractProjectId(url);

				expect(result.projectId).toBeUndefined();
				expect(result.isPathBased).toBe(false);
			});

			it('handles localhost without subdomain', () => {
				const url = new URL('http://localhost:3000/');
				const result = extractProjectId(url);

				expect(result.projectId).toBeUndefined();
				expect(result.isPathBased).toBe(false);
			});

			it('handles nested subdomains', () => {
				const url = new URL('https://project.sub.example.com/');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('project');
				expect(result.isPathBased).toBe(false);
			});
		});

		describe('priority', () => {
			it('prefers path-based over subdomain', () => {
				const url = new URL('https://subdomain.example.com/__project/path-project/');
				const result = extractProjectId(url);

				expect(result.projectId).toBe('path-project');
				expect(result.isPathBased).toBe(true);
			});
		});

		describe('edge cases', () => {
			it('handles single domain (treats as subdomain)', () => {
				const url = new URL('https://example.com/');
				const result = extractProjectId(url);

				// example.com has 'example' as the first part, which gets treated as subdomain
				// In a real scenario, you'd configure the domain properly with a base domain
				expect(result.projectId).toBe('example');
				expect(result.isPathBased).toBe(false);
			});

			it('handles .localhost subdomains', () => {
				const url = new URL('http://myproject.localhost:3000/');
				const result = extractProjectId(url);

				expect(result.projectId).toBeUndefined();
				expect(result.isPathBased).toBe(false);
			});

			it('handles IP addresses', () => {
				const url = new URL('http://192.168.1.1/');
				const result = extractProjectId(url);

				// IP addresses should not be treated as subdomain routing
				expect(result.projectId).toBeUndefined();
				expect(result.isPathBased).toBe(false);
			});
		});
	});

	describe('rewriteRequestUrl', () => {
		it('strips path-based project prefix', () => {
			const request = new Request('https://example.com/__project/my-project/index.html');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			expect(new URL(rewritten.url).pathname).toBe('/index.html');
		});

		it('strips prefix from nested paths', () => {
			const request = new Request('https://example.com/__project/my-project/api/users/123');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			expect(new URL(rewritten.url).pathname).toBe('/api/users/123');
		});

		it('defaults to root when path equals prefix', () => {
			const request = new Request('https://example.com/__project/my-project');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			expect(new URL(rewritten.url).pathname).toBe('/');
		});

		it('defaults to root when path equals prefix with trailing slash', () => {
			const request = new Request('https://example.com/__project/my-project/');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			expect(new URL(rewritten.url).pathname).toBe('/');
		});

		it('preserves query string', () => {
			const request = new Request('https://example.com/__project/my-project/search?q=test&limit=10');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			const url = new URL(rewritten.url);
			expect(url.pathname).toBe('/search');
			expect(url.searchParams.get('q')).toBe('test');
			expect(url.searchParams.get('limit')).toBe('10');
		});

		it('preserves hash', () => {
			const request = new Request('https://example.com/__project/my-project/page#section');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			const url = new URL(rewritten.url);
			expect(url.pathname).toBe('/page');
			expect(url.hash).toBe('#section');
		});

		it('preserves request method', () => {
			const request = new Request('https://example.com/__project/my-project/api', {
				method: 'POST',
			});
			const rewritten = rewriteRequestUrl(request, 'my-project');

			expect(rewritten.method).toBe('POST');
		});

		it('preserves request headers', () => {
			const request = new Request('https://example.com/__project/my-project/api', {
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer token123',
				},
			});
			const rewritten = rewriteRequestUrl(request, 'my-project');

			expect(rewritten.headers.get('Content-Type')).toBe('application/json');
			expect(rewritten.headers.get('Authorization')).toBe('Bearer token123');
		});

		it('handles request without matching prefix', () => {
			const request = new Request('https://example.com/other/path');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			// Should remain unchanged if prefix doesn't match
			expect(new URL(rewritten.url).pathname).toBe('/other/path');
		});

		it('handles different project IDs', () => {
			const request = new Request('https://example.com/__project/project-a/path');
			const rewritten = rewriteRequestUrl(request, 'project-b');

			// Should not strip if project ID doesn't match
			expect(new URL(rewritten.url).pathname).toBe('/__project/project-a/path');
		});

		it('preserves domain and protocol', () => {
			const request = new Request('https://example.com:8080/__project/my-project/path');
			const rewritten = rewriteRequestUrl(request, 'my-project');

			const url = new URL(rewritten.url);
			expect(url.protocol).toBe('https:');
			expect(url.hostname).toBe('example.com');
			expect(url.port).toBe('8080');
		});
	});
});
