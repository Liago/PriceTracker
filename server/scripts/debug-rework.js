require('dotenv').config({ path: '../.env' });
const { scrapeProduct } = require('../services/scraper');

const url = 'https://www.rework-labs.com/products/apple-mac-studio-m1-max-10-core-cpu-24-core-gpu-ram-32gb-ricondizionato';

async function debug() {
	console.log('Starting Scraper Debug for Rework Labs...');
	console.log(`URL: ${url}`);

	try {
		const start = Date.now();
		const data = await scrapeProduct(url);
		const duration = (Date.now() - start) / 1000;

		console.log(`✅ Success in ${duration.toFixed(2)}s`);
		console.log('Data:', JSON.stringify(data, null, 2));
	} catch (error) {
		console.error('❌ Failed:', error);
		if (error.cause) console.error('Cause:', error.cause);
	}
}

debug();
