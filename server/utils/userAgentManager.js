/**
 * User-Agent Manager
 * Provides a pool of realistic User-Agent strings and rotates them for each request.
 */

// Pool of realistic User-Agent strings from various browsers and operating systems
const USER_AGENTS = [
	// Chrome on Windows
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

	// Chrome on Mac
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

	// Firefox on Windows
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',

	// Firefox on Mac
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0',

	// Safari on Mac
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',

	// Edge on Windows
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
];

// Store-specific User-Agent preferences (some stores work better with specific browsers)
const STORE_PREFERENCES = {
	'amazon': ['Chrome', 'Edge'],
	'ebay': ['Chrome', 'Firefox'],
	'aliexpress': ['Chrome'],
};

class UserAgentManager {
	constructor() {
		this.userAgents = [...USER_AGENTS];
		this.lastUsedIndex = -1;
	}

	/**
	 * Get a random User-Agent string
	 * @returns {string} User-Agent string
	 */
	getRandomUserAgent() {
		const index = Math.floor(Math.random() * this.userAgents.length);
		this.lastUsedIndex = index;
		return this.userAgents[index];
	}

	/**
	 * Get a User-Agent optimized for a specific store
	 * @param {string} url - The URL being scraped
	 * @returns {string} User-Agent string
	 */
	getUserAgentForUrl(url) {
		try {
			const hostname = new URL(url).hostname.toLowerCase();

			// Find store preference
			for (const [store, browsers] of Object.entries(STORE_PREFERENCES)) {
				if (hostname.includes(store)) {
					// Filter User-Agents that match the preferred browsers
					const preferredUAs = this.userAgents.filter(ua =>
						browsers.some(browser => ua.includes(browser))
					);

					if (preferredUAs.length > 0) {
						const index = Math.floor(Math.random() * preferredUAs.length);
						return preferredUAs[index];
					}
				}
			}
		} catch (e) {
			// Invalid URL, use random
		}

		// Default to random
		return this.getRandomUserAgent();
	}

	/**
	 * Get a User-Agent different from the last used one
	 * Useful for retry scenarios
	 * @returns {string} User-Agent string
	 */
	getNextUserAgent() {
		let index;
		do {
			index = Math.floor(Math.random() * this.userAgents.length);
		} while (index === this.lastUsedIndex && this.userAgents.length > 1);

		this.lastUsedIndex = index;
		return this.userAgents[index];
	}

	/**
	 * Get all available User-Agents
	 * @returns {string[]} Array of User-Agent strings
	 */
	getAllUserAgents() {
		return [...this.userAgents];
	}

	/**
	 * Add a custom User-Agent to the pool
	 * @param {string} userAgent - User-Agent string to add
	 */
	addUserAgent(userAgent) {
		if (userAgent && !this.userAgents.includes(userAgent)) {
			this.userAgents.push(userAgent);
		}
	}
}

// Singleton instance
const userAgentManager = new UserAgentManager();

module.exports = {
	UserAgentManager,
	userAgentManager,
	USER_AGENTS,
};
