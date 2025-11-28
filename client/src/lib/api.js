const API_URL = 'http://localhost:3000/api';

export async function scrapeProduct(url) {
	const response = await fetch(`${API_URL}/scrape`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ url }),
	});

	if (!response.ok) {
		throw new Error('Failed to scrape product');
	}

	return response.json();
}
