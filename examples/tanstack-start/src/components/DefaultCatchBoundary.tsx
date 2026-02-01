import { ErrorComponent, Link, rootRouteId, useMatch, useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
	const router = useRouter();
	const isRoot = useMatch({
		strict: false,
		select: (state) => state.id === rootRouteId,
	});

	console.error('DefaultCatchBoundary Error:', error);

	return (
		<div className="error-container">
			<ErrorComponent error={error} />
			<div className="error-actions">
				<button onClick={() => router.invalidate()} className="button">
					Try Again
				</button>
				{isRoot ? (
					<Link to="/" className="button">
						Home
					</Link>
				) : (
					<button onClick={() => window.history.back()} className="button">
						Go Back
					</button>
				)}
			</div>
		</div>
	);
}
