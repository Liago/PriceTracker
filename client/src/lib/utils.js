export function parsePrice(priceStr, currency) {
	if (!priceStr) return 0;

	// Remove all characters except digits, dots, and commas
	let clean = priceStr.replace(/[^0-9.,]/g, '');

	// If currency is EUR, assume European format (1.234,56)
	// If the string has a comma, treat it as decimal separator
	if (currency === 'EUR') {
		// Remove thousand separators (dots)
		clean = clean.replace(/\./g, '');
		// Replace decimal separator (comma) with dot
		clean = clean.replace(',', '.');
	} else {
		// Default/USD: Assume US format (1,234.56)
		// Remove thousand separators (commas)
		clean = clean.replace(/,/g, '');
	}

	return parseFloat(clean) || 0;
}
