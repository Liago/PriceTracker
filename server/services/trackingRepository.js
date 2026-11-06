/** All price writes are transactional RPCs. Never downgrade a database error to success. */
function requireResult({ data, error }, action) {
	if (error) throw new Error(`${action}: ${error.message}`);
	return data;
}
function createTrackingRepository(client) {
	return {
		async getReference(product) {
			let offer = null;
			if (product.primary_offer_id) offer = requireResult(await client.from('product_offers').select('*').eq('id', product.primary_offer_id).eq('product_id', product.id).maybeSingle(), 'Lettura offerta');
			let query = client.from('price_observations').select('price, observed_at').eq('product_id', product.id).eq('accepted', true).not('price', 'is', null);
			if (offer) query = query.eq('offer_id', offer.id);
			const rows = requireResult(await query.order('observed_at', { ascending: false }).limit(5), 'Lettura storico');
			// Le ultime letture, accettate o no: servono a riconoscere un cambio
			// di prezzo vero, che si ripete identico da un controllo all'altro.
			let latest = client.from('price_observations').select('price, currency, accepted, reject_reason, observed_at').eq('product_id', product.id);
			if (offer) latest = latest.eq('offer_id', offer.id);
			const recent = requireResult(await latest.order('observed_at', { ascending: false }).limit(3), 'Lettura ultime osservazioni');
			return { offer, history: (rows || []).map(row => ({ price: Number(row.price), observedAt: row.observed_at })),
				recent: (recent || []).map(row => ({ price: row.price == null ? null : Number(row.price), currency: row.currency ?? null,
					accepted: Boolean(row.accepted), rejectReason: row.reject_reason ?? null, observedAt: row.observed_at })) };
		},
		async createProduct({ product, descriptor, observation }) {
			return requireResult(await client.rpc('create_tracked_product', { p_product: product, p_offer: descriptor, p_observation: observation }), 'Creazione prodotto');
		},
		async commitCheck({ product, descriptor, observation, patch, run }) {
			return requireResult(await client.rpc('apply_price_check', { p_product_id: product.id,
				p_expected_checked_at: product.last_checked_at ?? null,
				p_offer: descriptor, p_observation: observation, p_patch: patch, p_run: run }), 'Salvataggio controllo');
		},
	};
}
module.exports = { createTrackingRepository, requireResult };
