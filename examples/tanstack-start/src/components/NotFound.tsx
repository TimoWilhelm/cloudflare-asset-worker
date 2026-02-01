import { Link } from '@tanstack/react-router';

export function NotFound() {
	return (
		<div className="not-found">
			<h1>404 - Not Found</h1>
			<p>The page you are looking for does not exist.</p>
			<div className="not-found-actions">
				<button onClick={() => window.history.back()} className="button">
					Go Back
				</button>
				<Link to="/" className="button">
					Home
				</Link>
			</div>
		</div>
	);
}
