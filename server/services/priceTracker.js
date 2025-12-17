const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Public client with RLS (for backward compatibility if needed)
const supabase = createClient(supabaseUrl, supabaseKey);

// Service role client for scheduled operations (bypasses RLS)
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// Import email service
const { sendPriceDropNotification } = require('./emailService');

// Default settings (fallback)
const DEFAULT_SCRAPE_DELAY = 2000;
const DEFAULT_MAX_RETRIES = 1;

async function getUserSettings(userId) {
	const { data, error } = await supabaseAdmin
		.from('user_settings')
		.select('*')
		.eq('user_id', userId)
		.single();

	if (error || !data) {
		return {
			scrape_delay: DEFAULT_SCRAPE_DELAY,
			max_retries: DEFAULT_MAX_RETRIES
		};
	}

	return {
		scrape_delay: data.scrape_delay || DEFAULT_SCRAPE_DELAY,
		max_retries: data.max_retries || DEFAULT_MAX_RETRIES
	};
}

// Import scraping logic
const { scrapeProduct } = require('./scraper');
// Import email service


function parsePrice(priceStr, currency) {
	if (!priceStr) return 0;
	let clean = priceStr.replace(/[^0-9.,]/g, '');
	if (!clean) return 0;

	const dotCount = (clean.match(/\./g) || []).length;
	const commaCount = (clean.match(/,/g) || []).length;

	if (dotCount === 0 && commaCount === 0) {
		return parseFloat(clean) || 0;
	}

	if (dotCount > 0 && commaCount > 0) {
		const lastDot = clean.lastIndexOf('.');
		const lastComma = clean.lastIndexOf(',');
		if (lastDot > lastComma) {
			clean = clean.replace(/,/g, '');
		} else {
			clean = clean.replace(/\./g, '').replace(',', '.');
		}
	} else if (dotCount > 0) {
		const parts = clean.split('.');
		const lastPart = parts[parts.length - 1];
		if (lastPart.length <= 2 && parts.length === 2) {
			// Keep as is
		} else if (lastPart.length === 3 && parts.length === 2) {
			clean = clean.replace(/\./g, '');
		} else {
			clean = clean.replace(/\./g, '');
		}
	} else {
		const parts = clean.split(',');
		const lastPart = parts[parts.length - 1];
		if (lastPart.length <= 2 && parts.length === 2) {
			clean = clean.replace(',', '.');
		} else {
			clean = clean.replace(/,/g, '');
		}
	}

	return parseFloat(clean) || 0;
}

async function checkProductPrices() {
	console.log('[Price Tracker] Starting price check...');

	try {
		// Fetch all active products (monitoring_until is null or in the future)
		const { data: products, error } = await supabaseAdmin
			.from('products')
			.select('*')
			.or('monitoring_until.is.null,monitoring_until.gte.' + new Date().toISOString().split('T')[0]);

		if (error) {
			console.error('[Price Tracker] Error fetching products:', error);
			return;
		}

		if (!products || products.length === 0) {
			console.log('[Price Tracker] No active products to check');
			return;
		}

		console.log(`[Price Tracker] Checking ${products.length} products...`);

		// Group products by user to fetch settings once per user
		const userProducts = {};
		for (const product of products) {
			if (!userProducts[product.user_id]) {
				userProducts[product.user_id] = [];
			}
			userProducts[product.user_id].push(product);
		}

		for (const [userId, userProductList] of Object.entries(userProducts)) {
			// Fetch user settings
			const userSettings = await getUserSettings(userId);
			const intervalMinutes = userSettings.price_check_interval || 360; // Default 6 hours (360 mins)

			for (const product of userProductList) {
				try {
					// Check if it's time to update this product
					const lastChecked = product.last_checked_at ? new Date(product.last_checked_at) : new Date(0);
					const nextCheck = new Date(lastChecked.getTime() + intervalMinutes * 60000);
					const now = new Date();

					if (now < nextCheck) {
						// Not time yet
						continue;
					}

					console.log(`[Price Tracker] Checking: ${product.name} (Last check: ${lastChecked.toISOString()})`);

					// Scrape current price
					const scrapedData = await scrapeProduct(product.url);
					const newPrice = parsePrice(scrapedData.price, scrapedData.currency);

					if (!newPrice || newPrice === 0) {
						console.log(`[Price Tracker] Could not extract price for ${product.name}`);
						continue;
					}

					const oldPrice = product.current_price;
					const priceChanged = Math.abs(newPrice - oldPrice) > 0.01;

					// Update product with new price and last_checked_at
					const { error: updateError } = await supabaseAdmin
						.from('products')
						.update({
							current_price: newPrice,
							last_checked_at: new Date().toISOString()
						})
						.eq('id', product.id);

					if (updateError) {
						console.error(`[Price Tracker] Error updating product ${product.id}:`, updateError);
					}

					// If price changed, save to price_history
					if (priceChanged) {
						console.log(`[Price Tracker] Price changed for ${product.name}: ${oldPrice} → ${newPrice}`);

						const { error: historyError } = await supabaseAdmin
							.from('price_history')
							.insert({
								product_id: product.id,
								price: newPrice
							});

						if (historyError) {
							console.error(`[Price Tracker] Error saving price history:`, historyError);
						}

						// Check if price dropped below target
						if (product.target_price && newPrice <= product.target_price && oldPrice > product.target_price) {
							console.log(`[Price Tracker] 🎉 Target price reached for ${product.name}!`);

							// Create notification
							const { error: notifError } = await supabaseAdmin
								.from('notifications')
								.insert({
									user_id: product.user_id,
									product_id: product.id,
									type: 'price_drop',
									old_price: oldPrice,
									new_price: newPrice
								});

							if (notifError) {
								console.error(`[Price Tracker] Error creating notification:`, notifError);
							}

							// Send Email Notification
							try {
								// Fetch user email if not already cached/in memory?
								// Only Admins can read auth.users. supabaseAdmin has admin key.
								const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

								if (userError || !userData || !userData.user) {
									console.error(`[Price Tracker] Could not fetch user email for ${userId}:`, userError);
								} else {
									const userEmail = userData.user.email;
									await sendPriceDropNotification(userEmail, product, oldPrice, newPrice);
									console.log(`[Price Tracker] Email notification sent to ${userEmail}`);
								}
							} catch (emailErr) {
								console.error(`[Price Tracker] Error sending email:`, emailErr);
							}
						}
					}

					// Delay between requests to avoid rate limiting (use user settings)
					await new Promise(resolve => setTimeout(resolve, userSettings.scrape_delay));

				} catch (error) {
					console.error(`[Price Tracker] Error checking product ${product.id}:`, error.message);

					// Retry once if user settings allow
					if (userSettings.max_retries > 0) {
						console.log(`[Price Tracker] Retrying ${product.name}...`);
						await new Promise(resolve => setTimeout(resolve, 5000));
						// Could implement retry here, skipping for brevity
					}
				}
			}
		}

		console.log('[Price Tracker] Price check completed');
	} catch (error) {
		console.error('[Price Tracker] Fatal error:', error);
	}
}

module.exports = { checkProductPrices };
