/**
 * CAPTCHA Detector
 * Enhanced detection of CAPTCHA and anti-bot challenges.
 */

// Common CAPTCHA indicators in page content
const CAPTCHA_TITLE_PATTERNS = [
	'captcha',
	'security check',
	'robot',
	'challenge',
	'verify you are human',
	'are you a robot',
	'not a robot',
	'access denied',
	'please verify',
	'unusual traffic',
	'automated access',
];

const CAPTCHA_SELECTORS = [
	// Google reCAPTCHA
	'iframe[src*="recaptcha"]',
	'iframe[src*="google.com/recaptcha"]',
	'.g-recaptcha',
	'#recaptcha',

	// hCaptcha
	'iframe[src*="hcaptcha"]',
	'.h-captcha',

	// Cloudflare
	'iframe[src*="challenges.cloudflare"]',
	'#cf-wrapper',
	'.cf-browser-verification',
	'#challenge-form',
	'#challenge-running',

	// Amazon
	'form[action*="validateCaptcha"]',
	'#captchacharacters',

	// Generic
	'[class*="captcha"]',
	'[id*="captcha"]',
	'form[action*="captcha"]',

	// DataDome
	'iframe[src*="datadome"]',

	// PerimeterX
	'iframe[src*="px-captcha"]',
];

const CAPTCHA_URL_PATTERNS = [
	'/captcha',
	'/challenge',
	'/security-check',
	'/robot-check',
	'/validate',
];

class CaptchaDetector {
	constructor() {
		this.detectionLog = [];
	}

	/**
	 * Check if a CAPTCHA is present on the page
	 * @param {Page} page - Puppeteer page
	 * @returns {Promise<Object>} Detection result
	 */
	async detect(page) {
		const result = {
			detected: false,
			type: null,
			confidence: 0,
			indicators: [],
			url: page.url(),
			timestamp: new Date().toISOString(),
		};

		try {
			// Check page title
			const title = (await page.title()).toLowerCase();
			for (const pattern of CAPTCHA_TITLE_PATTERNS) {
				if (title.includes(pattern)) {
					result.indicators.push({ type: 'title', pattern, value: title });
					result.confidence += 30;
				}
			}

			// Check URL
			const url = page.url().toLowerCase();
			for (const pattern of CAPTCHA_URL_PATTERNS) {
				if (url.includes(pattern)) {
					result.indicators.push({ type: 'url', pattern, value: url });
					result.confidence += 25;
				}
			}

			// Check for CAPTCHA selectors
			const selectorResults = await page.evaluate((selectors) => {
				const found = [];
				for (const selector of selectors) {
					try {
						const elements = document.querySelectorAll(selector);
						if (elements.length > 0) {
							found.push({
								selector,
								count: elements.length,
								visible: Array.from(elements).some(el => {
									const rect = el.getBoundingClientRect();
									return rect.width > 0 && rect.height > 0;
								}),
							});
						}
					} catch (e) {
						// Invalid selector, skip
					}
				}
				return found;
			}, CAPTCHA_SELECTORS);

			for (const match of selectorResults) {
				result.indicators.push({ type: 'selector', ...match });
				result.confidence += match.visible ? 40 : 20;
			}

			// Check page content for CAPTCHA text
			const bodyText = await page.evaluate(() => {
				return document.body?.innerText?.toLowerCase()?.substring(0, 5000) || '';
			});

			const textPatterns = [
				'please complete the security check',
				'verify you are a human',
				'prove you are not a robot',
				'enable javascript and cookies',
				'checking your browser',
				'this process is automatic',
			];

			for (const pattern of textPatterns) {
				if (bodyText.includes(pattern)) {
					result.indicators.push({ type: 'text', pattern });
					result.confidence += 35;
				}
			}

			// Determine CAPTCHA type
			result.type = this.determineCaptchaType(result.indicators);

			// Set detected flag based on confidence
			result.detected = result.confidence >= 30;

			// Cap confidence at 100
			result.confidence = Math.min(100, result.confidence);

			// Log detection
			if (result.detected) {
				this.logDetection(result);
			}

		} catch (error) {
			console.error('[CaptchaDetector] Error during detection:', error.message);
			result.error = error.message;
		}

		return result;
	}

	/**
	 * Determine the type of CAPTCHA based on indicators
	 * @param {Object[]} indicators 
	 * @returns {string|null}
	 */
	determineCaptchaType(indicators) {
		const selectorIndicators = indicators
			.filter(i => i.type === 'selector')
			.map(i => i.selector);

		if (selectorIndicators.some(s => s.includes('recaptcha'))) {
			return 'reCAPTCHA';
		}
		if (selectorIndicators.some(s => s.includes('hcaptcha'))) {
			return 'hCaptcha';
		}
		if (selectorIndicators.some(s => s.includes('cloudflare') || s.includes('cf-'))) {
			return 'Cloudflare';
		}
		if (selectorIndicators.some(s => s.includes('datadome'))) {
			return 'DataDome';
		}
		if (selectorIndicators.some(s => s.includes('px-captcha'))) {
			return 'PerimeterX';
		}
		if (selectorIndicators.some(s => s.includes('validateCaptcha'))) {
			return 'Amazon CAPTCHA';
		}

		if (indicators.length > 0) {
			return 'Unknown CAPTCHA';
		}

		return null;
	}

	/**
	 * Log CAPTCHA detection for analytics
	 * @param {Object} result 
	 */
	logDetection(result) {
		const logEntry = {
			...result,
			timestamp: new Date().toISOString(),
		};

		this.detectionLog.push(logEntry);

		// Keep only last 100 entries
		if (this.detectionLog.length > 100) {
			this.detectionLog.shift();
		}

		console.warn(`[CAPTCHA DETECTED] Type: ${result.type || 'Unknown'}, Confidence: ${result.confidence}%, URL: ${result.url}`);
		if (result.indicators.length > 0) {
			console.warn(`[CAPTCHA INDICATORS] ${result.indicators.map(i => `${i.type}:${i.pattern || i.selector || ''}`).join(', ')}`);
		}
	}

	/**
	 * Get detection statistics
	 * @returns {Object}
	 */
	getStats() {
		const stats = {
			totalDetections: this.detectionLog.length,
			byType: {},
			recentDetections: this.detectionLog.slice(-10),
		};

		for (const entry of this.detectionLog) {
			const type = entry.type || 'Unknown';
			stats.byType[type] = (stats.byType[type] || 0) + 1;
		}

		return stats;
	}

	/**
	 * Clear detection log
	 */
	clearLog() {
		this.detectionLog = [];
	}
}

// Singleton instance
const captchaDetector = new CaptchaDetector();

module.exports = {
	CaptchaDetector,
	captchaDetector,
	CAPTCHA_SELECTORS,
	CAPTCHA_TITLE_PATTERNS,
};
