import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({
	component: About,
});

function About() {
	return (
		<div className="page">
			<h1>About</h1>
			<p>
				This is a TanStack Start application deployed using the <strong>cf-deploy CLI</strong> instead of the standard{' '}
				<code>wrangler deploy</code> workflow.
			</p>

			<div className="card">
				<h2>How It Works</h2>
				<ol>
					<li>
						<strong>Build:</strong> Run <code>npm run build</code> to generate the TanStack Start output
					</li>
					<li>
						<strong>Assets:</strong> Static files are output to <code>.output/client/</code>
					</li>
					<li>
						<strong>Server:</strong> SSR worker is output to <code>.output/server/</code>
					</li>
					<li>
						<strong>Deploy:</strong> Run <code>npm run deploy</code> to deploy via cf-deploy
					</li>
				</ol>
			</div>

			<div className="card">
				<h2>Benefits</h2>
				<ul>
					<li>Multi-project hosting on a single Cloudflare Worker</li>
					<li>Content-addressed storage with automatic deduplication</li>
					<li>Central management API for all projects</li>
					<li>Fast deployments with efficient upload batching</li>
				</ul>
			</div>
		</div>
	);
}
