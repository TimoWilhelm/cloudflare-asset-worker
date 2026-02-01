/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { HeadContent, Link, Scripts, createRootRoute, Outlet } from '@tanstack/react-router';
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary';
import { NotFound } from '~/components/NotFound';
import appCss from '~/styles/app.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'TanStack Start - Cloudflare Asset Worker Example' },
			{ name: 'description', content: 'TanStack Start deployed with cf-deploy CLI' },
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			{ rel: 'icon', href: '/favicon.ico' },
		],
	}),
	errorComponent: DefaultCatchBoundary,
	notFoundComponent: () => <NotFound />,
	component: RootComponent,
});

function RootComponent() {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<div className="nav">
					<Link to="/" activeProps={{ className: 'active' }}>
						Home
					</Link>
					<Link to="/about" activeProps={{ className: 'active' }}>
						About
					</Link>
					<Link to="/api-demo" activeProps={{ className: 'active' }}>
						API Demo
					</Link>
				</div>
				<main className="content">
					<Outlet />
				</main>
				<Scripts />
			</body>
		</html>
	);
}
