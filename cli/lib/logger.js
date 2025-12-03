/**
 * Logger with automatic indentation management using closures
 */
export class Logger {
	#indentLevel;
	#indentString;

	constructor(indentLevel = 0, indentString = '  ') {
		this.#indentLevel = indentLevel;
		this.#indentString = indentString;
	}

	/**
	 * Get the current indentation prefix
	 */
	#getIndent() {
		return this.#indentString.repeat(this.#indentLevel);
	}

	/**
	 * Log a message at the current indentation level
	 */
	log(message = '') {
		console.log(this.#getIndent() + message);
	}

	/**
	 * Log a warning message at the current indentation level
	 */
	warn(message = '') {
		console.warn(this.#getIndent() + message);
	}

	/**
	 * Log an error message at the current indentation level
	 */
	error(message = '') {
		console.error(this.#getIndent() + message);
	}

	/**
	 * Create an indented scope - all logs within the callback will be indented
	 * @param {Function} callback - Function to execute with increased indentation
	 * @returns {Promise<any>} Result of the callback
	 */
	async indent(callback) {
		const indented = this.child();
		return await Promise.resolve(callback(indented));
	}

	/**
	 * Create a child logger with increased indentation
	 */
	child() {
		return new Logger(this.#indentLevel + 1, this.#indentString);
	}
}

/**
 * Create a root logger
 */
export function createLogger() {
	return new Logger();
}
