/**
 * Creates a mock object of type T from partial overrides.
 * Uses Object.create(null) + Object.assign to avoid type assertions.
 */
export function createMock<T>(overrides: Record<string, unknown>): T {
	return Object.assign(Object.create(null), overrides);
}
