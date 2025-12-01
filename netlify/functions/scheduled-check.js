const { checkProductPrices } = require('../../server/services/priceTracker');

module.exports.handler = async (event, context) => {
	console.log("Running scheduled price check...");
	try {
		await checkProductPrices();
		return {
			statusCode: 200,
			body: JSON.stringify({ message: "Price check completed successfully" }),
		};
	} catch (error) {
		console.error("Error running scheduled price check:", error);
		return {
			statusCode: 500,
			body: JSON.stringify({ error: "Failed to run price check" }),
		};
	}
};
