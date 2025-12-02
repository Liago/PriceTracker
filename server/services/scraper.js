const puppeteer = require('puppeteer-core');

async function scrapeProduct(url) {
	try {
		let browser;

		// Check if running on Netlify/Lambda
		const isProduction = process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.NETLIFY;

		if (isProduction) {
			// Production: Use @sparticuz/chromium
			const chromium = require('@sparticuz/chromium');

			// Enhanced args for Lambda environment
			const lambdaArgs = [
				...chromium.args,
				'--single-process',
				'--disable-dev-shm-usage',
				'--no-zygote',
			];

			browser = await puppeteer.launch({
				args: lambdaArgs,
				defaultViewport: chromium.defaultViewport,
				executablePath: await chromium.executablePath(),
				headless: chromium.headless,
				ignoreHTTPSErrors: true,
			});
		} else {
			// Local Development: Use local Chrome
			// Try to find Chrome on macOS
			const localExecutablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

			browser = await puppeteer.launch({
				channel: 'chrome',
				executablePath: localExecutablePath,
				headless: 'new',
				args: ['--no-sandbox', '--disable-setuid-sandbox']
			});
		}

		const page = await browser.newPage();

		// Set user agent to avoid being blocked
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); // Reduced timeout for serverless

		const data = await page.evaluate((url) => {
			const getMeta = (name) => {
				const element = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
				return element ? element.content : null;
			};

			const isAmazon = url.includes('amazon.');
			let store = new URL(url).hostname.replace('www.', '');

			// 1. Title extraction
			let title = getMeta('og:title') || document.title;
			if (isAmazon) {
				const titleElement = document.querySelector('#productTitle');
				if (titleElement) {
					title = titleElement.textContent.trim();
				} else {
					title = title.replace(/\s*:\s*Amazon\.(it|com|co\.uk|de|fr|es).*$/i, '');
				}
			}

			// 2. Image extraction
			let image = getMeta('og:image');
			if (isAmazon && !image) {
				const imgElement = document.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront');
				if (imgElement) {
					image = imgElement.src || imgElement.getAttribute('data-old-hires') || imgElement.getAttribute('data-a-dynamic-image');
					if (image && image.startsWith('{')) {
						try {
							const imgData = JSON.parse(image);
							image = Object.keys(imgData)[0];
						} catch (e) {
							image = null;
						}
					}
				}
			}

			// 3. Description extraction
			let description = getMeta('og:description');
			let details = {};

			if (isAmazon) {
				// Get feature bullets for Amazon
				const bullets = Array.from(document.querySelectorAll('#feature-bullets li span.a-list-item'))
					.map(el => el.textContent.trim())
					.filter(text => text.length > 0);

				if (bullets.length > 0) {
					details.features = bullets;
					// Use first few bullets as description if meta description is poor
					if (!description || description.length < 50) {
						description = bullets.slice(0, 3).join('\n');
					}
				}
			}

			// 4. Price extraction
			let price = getMeta('product:price:amount') || getMeta('og:price:amount');
			let currency = getMeta('product:price:currency') || getMeta('og:price:currency') || 'EUR';

			if (isAmazon && !price) {
				const priceSelectors = [
					'.a-price .a-offscreen',
					'#priceblock_ourprice',
					'#priceblock_dealprice',
					'.a-price-whole',
					'#corePrice_feature_div .a-price .a-offscreen'
				];

				for (const selector of priceSelectors) {
					const priceElement = document.querySelector(selector);
					if (priceElement) {
						price = priceElement.textContent.trim();
						break;
					}
				}
			}

			if (!price) {
				const priceRegex = /[\$€£]\s*\d+([.,]\d{2,3})?|\d+([.,]\d{2,3})?\s*[\$€£]/;
				const elements = document.body.innerText.match(priceRegex);
				if (elements) {
					price = elements[0];
				}
			}

			// 5. JSON-LD Fallback (Structured Data)
			if (!title || !image || !price) {
				const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
				for (const script of jsonLdScripts) {
					try {
						const json = JSON.parse(script.innerText);
						const product = Array.isArray(json) ? json.find(i => i['@type'] === 'Product') : (json['@type'] === 'Product' ? json : null);

						if (product) {
							if (!title) title = product.name;
							if (!image) image = Array.isArray(product.image) ? product.image[0] : product.image;
							if (!description) description = product.description;

							if (!price && product.offers) {
								const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
								price = offer.price;
								currency = offer.priceCurrency || currency;
							}
						}
					} catch (e) {
						// Ignore JSON parse errors
					}
				}
			}

			return { title, image, description, price, currency, store, details };
		}, url);

		await browser.close();
		return data;
	} catch (error) {
		console.error('Scraping error:', error);
		throw error;
	}
}

module.exports = { scrapeProduct };
