import * as base64 from '@stablelib/base64';

/** Encode bytes as URL-safe base64 (no padding, +/ replaced with -_). */
function base64UrlEncode(data: Uint8Array): string {
	return base64.encode(data).replaceAll('+', '-').replaceAll('/', '_').replaceAll(/=+$/g, '');
}

/** Decode a URL-safe base64 string back to bytes. */
function base64UrlDecode(string_: string): Uint8Array {
	// Restore standard base64 characters and padding
	const padded = string_.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice(0, (4 - (string_.length % 4)) % 4);
	return base64.decode(padded);
}

/**
 * Generates a signed JWT token for upload sessions.
 *
 * @param payload - The JWT payload data to encode
 * @param secret - The HMAC-SHA256 secret for signing
 * @returns The signed JWT token string with 1-hour expiration
 */
export async function generateJWT(payload: object, secret: string): Promise<string> {
	// Simple JWT-like token using base64 encoding
	// In production, use proper JWT signing with crypto.subtle
	const header = { alg: 'HS256', typ: 'JWT' };
	const data = {
		...payload,
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
	};

	const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
	const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(data)));

	// Create signature using HMAC-SHA256
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${encodedHeader}.${encodedPayload}`));

	const encodedSignature = base64UrlEncode(new Uint8Array(signature));
	return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verifies and decodes a JWT token.
 *
 * @param token - The JWT token string to verify
 * @param secret - The HMAC-SHA256 secret for verification
 * @returns The decoded payload if valid and not expired, or null if invalid
 */
export async function verifyJWT<T = unknown>(token: string, secret: string): Promise<T | undefined> {
	try {
		const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
		if (!encodedHeader || !encodedPayload || !encodedSignature) {
			return undefined;
		}

		// Verify signature
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);

		const signatureBytes = base64UrlDecode(encodedSignature);
		const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(`${encodedHeader}.${encodedPayload}`));

		if (!isValid) {
			return undefined;
		}

		// Decode payload
		const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));

		// Check expiration
		if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
			return undefined;
		}

		return payload;
	} catch {
		return undefined;
	}
}
