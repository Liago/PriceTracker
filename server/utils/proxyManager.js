/**
 * Proxy Manager
 * Handles proxy rotation for scraping requests.
 * Proxies are optional and configured via environment variables.
 */

class ProxyManager {
	constructor(proxyList = []) {
		this.proxies = this.parseProxies(proxyList);
		this.currentIndex = 0;
		this.failedProxies = new Set();
	}

	/**
	 * Parse proxy list from string or array
	 * Supports formats: 
	 * - "host:port"
	 * - "host:port:username:password"
	 * - "protocol://host:port"
	 * @param {string|string[]} proxyList 
	 * @returns {Object[]} Parsed proxy objects
	 */
	parseProxies(proxyList) {
		if (!proxyList) return [];

		const list = typeof proxyList === 'string'
			? proxyList.split(',').map(p => p.trim()).filter(Boolean)
			: proxyList;

		return list.map(proxy => {
			// Handle URL format: protocol://user:pass@host:port
			if (proxy.includes('://')) {
				try {
					const url = new URL(proxy);
					return {
						server: `${url.protocol}//${url.hostname}:${url.port || 80}`,
						username: url.username || undefined,
						password: url.password || undefined,
					};
				} catch (e) {
					console.warn(`Invalid proxy URL: ${proxy}`);
					return null;
				}
			}

			// Handle simple format: host:port or host:port:user:pass
			const parts = proxy.split(':');
			if (parts.length >= 2) {
				const obj = {
					server: `http://${parts[0]}:${parts[1]}`,
				};
				if (parts.length >= 4) {
					obj.username = parts[2];
					obj.password = parts[3];
				}
				return obj;
			}

			return null;
		}).filter(Boolean);
	}

	/**
	 * Check if proxies are available
	 * @returns {boolean}
	 */
	hasProxies() {
		return this.proxies.length > 0;
	}

	/**
	 * Get the next proxy in rotation
	 * Skips failed proxies
	 * @returns {Object|null} Proxy config or null if none available
	 */
	getNextProxy() {
		if (!this.hasProxies()) return null;

		const availableProxies = this.proxies.filter(
			(_, index) => !this.failedProxies.has(index)
		);

		if (availableProxies.length === 0) {
			// Reset failed proxies if all have failed
			console.log('[ProxyManager] All proxies failed, resetting...');
			this.failedProxies.clear();
			return this.proxies[0];
		}

		this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

		// Skip failed proxies
		while (this.failedProxies.has(this.currentIndex)) {
			this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
		}

		return this.proxies[this.currentIndex];
	}

	/**
	 * Get a random proxy
	 * @returns {Object|null} Proxy config or null if none available
	 */
	getRandomProxy() {
		if (!this.hasProxies()) return null;

		const availableIndexes = this.proxies
			.map((_, index) => index)
			.filter(index => !this.failedProxies.has(index));

		if (availableIndexes.length === 0) {
			this.failedProxies.clear();
			return this.proxies[Math.floor(Math.random() * this.proxies.length)];
		}

		const randomIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
		this.currentIndex = randomIndex;
		return this.proxies[randomIndex];
	}

	/**
	 * Mark current proxy as failed
	 */
	markCurrentAsFailed() {
		if (this.currentIndex >= 0) {
			this.failedProxies.add(this.currentIndex);
			console.log(`[ProxyManager] Marked proxy ${this.currentIndex} as failed. Failed: ${this.failedProxies.size}/${this.proxies.length}`);
		}
	}

	/**
	 * Get Puppeteer-compatible proxy args
	 * @param {Object} proxy - Proxy object
	 * @returns {string[]} Args array for Puppeteer
	 */
	getProxyArgs(proxy) {
		if (!proxy) return [];
		return [`--proxy-server=${proxy.server}`];
	}

	/**
	 * Authenticate proxy on a page (if needed)
	 * @param {Page} page - Puppeteer page
	 * @param {Object} proxy - Proxy object
	 */
	async authenticateProxy(page, proxy) {
		if (proxy && proxy.username && proxy.password) {
			await page.authenticate({
				username: proxy.username,
				password: proxy.password,
			});
		}
	}

	/**
	 * Get proxy stats
	 * @returns {Object}
	 */
	getStats() {
		return {
			total: this.proxies.length,
			failed: this.failedProxies.size,
			available: this.proxies.length - this.failedProxies.size,
		};
	}
}

// Factory function to create from environment
function createProxyManagerFromEnv() {
	const proxyList = process.env.PROXY_LIST || '';
	return new ProxyManager(proxyList);
}

module.exports = {
	ProxyManager,
	createProxyManagerFromEnv,
};
