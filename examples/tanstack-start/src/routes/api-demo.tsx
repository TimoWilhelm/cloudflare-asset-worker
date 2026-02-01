import { createFileRoute, useRouter } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useState } from 'react';

const fetchData = createServerFn().handler(async () => {
	// Simulate an API call
	const response = {
		id: Math.floor(Math.random() * 1000),
		title: 'Server-Generated Data',
		body: 'This data was generated on the server at ' + new Date().toISOString(),
		source: 'Cloudflare Worker',
	};
	return response;
});

export const Route = createFileRoute('/api-demo')({
	component: ApiDemo,
	loader: async () => await fetchData(),
});

function ApiDemo() {
	const router = useRouter();
	const initialData = Route.useLoaderData();
	const [data, setData] = useState(initialData);
	const [loading, setLoading] = useState(false);

	const handleRefresh = async () => {
		setLoading(true);
		try {
			const newData = await fetchData();
			setData(newData);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="page">
			<h1>API Demo</h1>
			<p>This demonstrates TanStack Start server functions running on Cloudflare Workers.</p>

			<div className="card">
				<h2>Server Response</h2>
				<pre>{JSON.stringify(data, null, 2)}</pre>
				<button onClick={handleRefresh} disabled={loading} className="button">
					{loading ? 'Loading...' : 'Refresh Data'}
				</button>
			</div>

			<div className="card">
				<h2>How It Works</h2>
				<p>
					The <code>createServerFn</code> function defines server-side code that runs on Cloudflare Workers. When you click "Refresh Data",
					the server function executes on the edge and returns fresh data.
				</p>
			</div>
		</div>
	);
}
