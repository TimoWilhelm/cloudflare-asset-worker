export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// API endpoint - demonstrates basic functionality
		if (url.pathname === '/api/hello') {
			return new Response(
				JSON.stringify({
					message: 'Hello from server code!',
					environment: env.ENVIRONMENT || 'not set',
					timestamp: new Date().toISOString(),
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		// Config endpoint - demonstrates environment variable usage
		if (url.pathname === '/api/config') {
			return new Response(
				JSON.stringify({
					appName: env.APP_NAME || 'Fullstack App',
					environment: env.ENVIRONMENT || 'development',
					apiUrl: env.API_URL || 'not configured',
					timestamp: new Date().toISOString(),
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		// Let assets handle other requests
		return new Response('Not found', { status: 404 });
	},
};
