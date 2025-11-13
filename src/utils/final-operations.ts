import { InternalServerErrorResponse } from "../lib/responses";

export function handleError(err: unknown) {
	try {
		const response = new InternalServerErrorResponse(err as Error);
		return response;
	} catch (e) {
		console.error("Error handling error", e);
		return new InternalServerErrorResponse(e as Error);
	}
}

