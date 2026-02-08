// HTTP Response classes
export class OkResponse extends Response {
	static readonly status = 200;
	constructor(body?: BodyInit | null, init?: ResponseInit) {
		super(body, { ...init, status: OkResponse.status });
	}
}

export class FoundResponse extends Response {
	static readonly status = 302;
	constructor(location: string, init?: ResponseInit) {
		super(undefined, {
			...init,
			status: FoundResponse.status,
			headers: { ...init?.headers, Location: location },
		});
	}
}

export class SeeOtherResponse extends Response {
	static readonly status = 303;
	constructor(location: string, init?: ResponseInit) {
		super(undefined, {
			...init,
			status: SeeOtherResponse.status,
			headers: { ...init?.headers, Location: location },
		});
	}
}

export class NotModifiedResponse extends Response {
	static readonly status = 304;
	constructor(body?: BodyInit | null, init?: ResponseInit) {
		super(body, { ...init, status: NotModifiedResponse.status });
	}
}

export class TemporaryRedirectResponse extends Response {
	static readonly status = 307;
	constructor(location: string, init?: ResponseInit) {
		super(undefined, {
			...init,
			status: TemporaryRedirectResponse.status,
			headers: { ...init?.headers, Location: location },
		});
	}
}

export class PermanentRedirectResponse extends Response {
	static readonly status = 308;
	constructor(location: string, init?: ResponseInit) {
		super(undefined, {
			...init,
			status: PermanentRedirectResponse.status,
			headers: { ...init?.headers, Location: location },
		});
	}
}

export class MovedPermanentlyResponse extends Response {
	static readonly status = 301;
	constructor(location: string, init?: ResponseInit) {
		super(undefined, {
			...init,
			status: MovedPermanentlyResponse.status,
			headers: { ...init?.headers, Location: location },
		});
	}
}

export class NotFoundResponse extends Response {
	static readonly status = 404;
	constructor(body?: BodyInit | null, init?: ResponseInit) {
		super(body, { ...init, status: NotFoundResponse.status });
	}
}

export class MethodNotAllowedResponse extends Response {
	static readonly status = 405;
	constructor(init?: ResponseInit) {
		super(undefined, { ...init, status: MethodNotAllowedResponse.status });
	}
}

export class InternalServerErrorResponse extends Response {
	static readonly status = 500;
	constructor(error?: unknown, init?: ResponseInit) {
		const body = error instanceof Error ? `Internal Server Error: ${error.message}` : 'Internal Server Error';
		super(body, { ...init, status: InternalServerErrorResponse.status });
	}
}

export class NoIntentResponse extends Response {
	static readonly status = 404;
	constructor(init?: ResponseInit) {
		super(undefined, { ...init, status: NoIntentResponse.status });
	}
}
