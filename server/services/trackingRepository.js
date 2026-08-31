/**
 * Persistenza del controllo prezzi su Supabase.
 *
 * Sta separato da productChecker perche' la decisione - se un prezzo entra
 * nella storia - dev'essere verificabile senza database, mentre la scrittura
 * no. Questo modulo e' il solo punto che conosce la forma delle tabelle.
 */

const { sendPriceDropNotification } = require('./emailService');

/**
 * @param {object} client - client Supabase con privilegi service_role
 * @returns {object} repository
 */
function createTrackingRepository(client) {
	return {
		/**
		 * Trova o crea l'offerta corrispondente al descrittore.
		 *
		 * Anche una pagina senza varianti ha un'offerta ('default'): e' l'ancora
		 * a cui appartiene la serie storica.
		 */
		async ensureOffer(product, descriptor) {
			const { data: existing, error: readError } = await client
				.from('product_offers')
				.select('*')
				.eq('product_id', product.id)
				.eq('offer_key', descriptor.offerKey)
				.maybeSingle();

			if (!readError && existing) return existing;

			const { data, error } = await client
				.from('product_offers')
				.insert({
					product_id: product.id,
					offer_key: descriptor.offerKey,
					variant: descriptor.variant || {},
					seller: descriptor.seller,
					condition: descriptor.condition,
					gtin: descriptor.gtin,
					sku: descriptor.sku,
					url: descriptor.url || product.url,
					// La prima offerta di un prodotto ne diventa la primaria.
					is_primary: !product.primary_offer_id,
				})
				.select()
				.single();

			if (error) {
				// Corsa fra due controlli sullo stesso prodotto: rileggo.
				const { data: retried } = await client
					.from('product_offers')
					.select('*')
					.eq('product_id', product.id)
					.eq('offer_key', descriptor.offerKey)
					.maybeSingle();
				if (retried) return retried;
				throw new Error(`Creazione offerta fallita: ${error.message}`);
			}

			if (!product.primary_offer_id) {
				await client.from('products').update({ primary_offer_id: data.id }).eq('id', product.id);
			}

			return data;
		},

		/**
		 * Le ultime osservazioni ACCETTATE dell'offerta, dalla piu' recente.
		 * Sono l'insieme su cui si calcola la mediana di riferimento: includere
		 * quelle respinte significherebbe far pesare gli errori gia' rilevati.
		 */
		async getRecentObservations(offerId, limit = 5) {
			const { data, error } = await client
				.from('price_observations')
				.select('price, observed_at')
				.eq('offer_id', offerId)
				.eq('accepted', true)
				.not('price', 'is', null)
				.order('observed_at', { ascending: false })
				.limit(limit);

			if (error || !data) return [];
			return data.map((row) => ({ price: Number(row.price), observedAt: row.observed_at }));
		},

		async insertObservation(row) {
			const { error } = await client.from('price_observations').insert(row);
			if (error) console.error('[Tracking] Scrittura osservazione fallita:', error.message);
		},

		async updateProduct(id, patch) {
			const { error } = await client.from('products').update(patch).eq('id', id);
			if (error) console.error(`[Tracking] Aggiornamento prodotto ${id} fallito:`, error.message);
		},

		async updateOffer(id, patch) {
			const { error } = await client.from('product_offers').update(patch).eq('id', id);
			if (error) console.error(`[Tracking] Aggiornamento offerta ${id} fallito:`, error.message);
		},

		async insertPriceHistory(row) {
			const { error } = await client.from('price_history').insert(row);
			if (error) console.error('[Tracking] Scrittura storico fallita:', error.message);
		},

		async notifyPriceDrop({ product, oldPrice, newPrice }) {
			const { error } = await client.from('notifications').insert({
				user_id: product.user_id,
				product_id: product.id,
				type: 'price_drop',
				old_price: oldPrice,
				new_price: newPrice,
			});
			if (error) console.error('[Tracking] Creazione notifica fallita:', error.message);

			try {
				const { data, error: userError } = await client.auth.admin.getUserById(product.user_id);
				if (userError || !data?.user?.email) {
					console.error('[Tracking] Email utente non recuperabile:', userError?.message);
					return;
				}
				await sendPriceDropNotification(data.user.email, product, oldPrice, newPrice);
			} catch (emailError) {
				console.error('[Tracking] Invio email fallito:', emailError.message);
			}
		},
	};
}

module.exports = { createTrackingRepository };
