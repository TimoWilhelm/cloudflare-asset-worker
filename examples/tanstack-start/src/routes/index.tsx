import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

const getServerData = createServerFn({ method: 'GET' }).handler(async () => {
	return {
		message: 'Hello from the server!',
		timestamp: new Date().toISOString(),
		platform: 'Cloudflare Workers',
	};
});

export const Route = createFileRoute('/')({
	component: Home,
	loader: async () => await getServerData(),
});

function Home() {
	const data = Route.useLoaderData();

	return (
		<div className="page">
			<h1>🚀 TanStack Start + Cloudflare Asset Worker</h1>
			<p>This example demonstrates deploying a TanStack Start application using the cf-deploy CLI.</p>

			<div className="card">
				<h2>Server-Side Data</h2>
				<p>
					<strong>Message:</strong> {data.message}
				</p>
				<p>
					<strong>Platform:</strong> {data.platform}
				</p>
				<p>
					<strong>Server Time:</strong> {data.timestamp}
				</p>
			</div>

			<div className="features">
				<h2>Features</h2>
				<ul>
					<li>✅ Full SSR with TanStack Start</li>
					<li>✅ File-based routing with TanStack Router</li>
					<li>✅ Server functions for data loading</li>
					<li>✅ Deployed via cf-deploy CLI</li>
					<li>✅ Running on Cloudflare Workers</li>
				</ul>
			</div>
		</div>
	);
}
