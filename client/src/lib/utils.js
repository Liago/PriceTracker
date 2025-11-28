export function parsePrice(priceStr, currency) {
	if (!priceStr) return 0;

	// Remove all characters except digits, dots, and commas
	let clean = priceStr.replace(/[^0-9.,]/g, '');
	if (!clean) return 0;

	// Count separators
	const dotCount = (clean.match(/\./g) || []).length;
	const commaCount = (clean.match(/,/g) || []).length;

	if (dotCount === 0 && commaCount === 0) {
		// No separators, just a number
		return parseFloat(clean) || 0;
	}

	if (dotCount > 0 && commaCount > 0) {
		// Both present: the last one is the decimal separator
		const lastDot = clean.lastIndexOf('.');
		const lastComma = clean.lastIndexOf(',');

		if (lastDot > lastComma) {
			// Dot is decimal (e.g., 1,234.56)
			clean = clean.replace(/,/g, '');
		} else {
			// Comma is decimal (e.g., 1.234,56)
			clean = clean.replace(/\./g, '').replace(',', '.');
		}
	} else if (dotCount > 0) {
		// Only dots present
		const parts = clean.split('.');
		const lastPart = parts[parts.length - 1];

		if (lastPart.length <= 2 && parts.length === 2) {
			// Single dot with 1-2 digits after: decimal (e.g., 63.37)
			// Keep as is
		} else if (lastPart.length === 3 && parts.length === 2) {
			// Could be 1.000 (thousand) or 0.999 (decimal)
			// Assume thousand separator if >= 1000
			clean = clean.replace(/\./g, '');
		} else {
			// Multiple dots or 3+ digits: thousand separators
			clean = clean.replace(/\./g, '');
		}
	} else {
		// Only commas present
		const parts = clean.split(',');
		const lastPart = parts[parts.length - 1];

		if (lastPart.length <= 2 && parts.length === 2) {
			// Single comma with 1-2 digits after: decimal (e.g., 900,00)
			clean = clean.replace(',', '.');
		} else {
			// Multiple commas or 3+ digits: thousand separators
			clean = clean.replace(/,/g, '');
		}
	}

	return parseFloat(clean) || 0;
}
