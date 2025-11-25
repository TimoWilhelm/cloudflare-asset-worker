export function handlePosts(request, env) {
	const url = new URL(request.url);

	// GET /api/posts
	if (request.method === 'GET' && url.pathname === '/api/posts') {
		return new Response(
			JSON.stringify({
				posts: [
					{ id: 1, title: 'First Post', author: 'Alice' },
					{ id: 2, title: 'Second Post', author: 'Bob' },
				],
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	// GET /api/posts/:id
	if (request.method === 'GET' && url.pathname.match(/^\/api\/posts\/\d+$/)) {
		const id = url.pathname.split('/').pop();
		return new Response(
			JSON.stringify({
				post: {
					id: parseInt(id),
					title: 'Post ' + id,
					content: 'Content for post ' + id,
					author: 'Author ' + id,
				},
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
