import { handleUsers } from './handlers/users.js';
import { handlePosts } from './handlers/posts.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// Route to different handlers
		if (url.pathname.startsWith('/api/users')) {
			return handleUsers(request, env);
		}

		if (url.pathname.startsWith('/api/posts')) {
			return handlePosts(request, env);
		}

		// Health check endpoint
		if (url.pathname === '/health') {
			return new Response(
				JSON.stringify({
					status: 'ok',
					environment: env.ENVIRONMENT,
					timestamp: new Date().toISOString(),
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	},
};
