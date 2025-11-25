export function handleUsers(request, env) {
	const url = new URL(request.url);

	// GET /api/users
	if (request.method === 'GET' && url.pathname === '/api/users') {
		return new Response(
			JSON.stringify({
				users: [
					{ id: 1, name: 'Alice' },
					{ id: 2, name: 'Bob' },
					{ id: 3, name: 'Charlie' },
				],
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	// GET /api/users/:id
	if (request.method === 'GET' && url.pathname.match(/^\/api\/users\/\d+$/)) {
		const id = url.pathname.split('/').pop();
		return new Response(
			JSON.stringify({
				user: { id: parseInt(id), name: 'User ' + id },
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	return new Response(JSON.stringify({ error: 'Method not allowed' }), {
		status: 405,
		headers: { 'Content-Type': 'application/json' },
	});
}
