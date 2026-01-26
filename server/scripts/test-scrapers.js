require('dotenv').config({ path: '../.env' }); // Load env vars if needed
const { scrapeProduct } = require('../services/scraper');

const urls = [
	'https://www.rework-labs.com/products/apple-mac-studio-m1-max-10-core-cpu-24-core-gpu-ram-32gb-ricondizionato',
	'https://www.smartgeneration.it/prodotto/apple-macbook-pro-14-pollici-2023-m2-pro-cpu-10-core-gpu-16-core-ricondizionato-grigio-siderale/16gb_512gb-ssd_qwerty-italiano_ottimo/',
	'https://www.juice.it/macbook-pro-16-m2-pro-16gb-ram-cpu-12-core-2023-ricondizionato-eccellente-mnw83-en-rst.html',
	'https://www.refurbed.it/p/apple-macbook-pro-2021-m1-14/64134c/'
];

async function test() {
	console.log('Starting Scraper Test...\n');

	for (const url of urls) {
		console.log(`Testing: ${url}`);
		try {
			const start = Date.now();
			const data = await scrapeProduct(url);
			const duration = (Date.now() - start) / 1000;

			console.log('✅ Success (' + duration.toFixed(2) + 's)');
			console.log('   Store:', data.store);
			console.log('   Title:', data.title ? (data.title.substring(0, 50) + '...') : 'NULL');
			console.log('   Price:', data.price);
			console.log('   Currency:', data.currency);
			console.log('   Available:', data.available);
			console.log('-----------------------------------');
		} catch (error) {
			console.error('❌ Failed:', error.message);
			console.log('-----------------------------------');
		}
	}
}

test();
