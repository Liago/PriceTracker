require('dotenv').config({ path: '../.env' });
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const url = 'https://www.rework-labs.com/products/apple-mac-studio-m1-max-10-core-cpu-24-core-gpu-ram-32gb-ricondizionato';

async function fetchHtml() {
	console.log('Fetching HTML for Rework Labs...');

	const localExecutablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	const browser = await puppeteer.launch({
		item: 'chrome',
		executablePath: localExecutablePath,
		headless: 'new',
		args: ['--no-sandbox', '--disable-setuid-sandbox']
	});

	try {
		const page = await browser.newPage();
		await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

		const content = await page.content();
		const outputPath = path.join(__dirname, 'rework-labs.html');
		fs.writeFileSync(outputPath, content);
		console.log(`HTML saved to ${outputPath}`);

	} catch (error) {
		console.error('Error:', error);
	} finally {
		await browser.close();
	}
}

fetchHtml();
