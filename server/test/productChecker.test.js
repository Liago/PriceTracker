import { describe, it, expect, vi } from 'vitest';
import checkerModule from '../services/productChecker.js';

const { checkProduct, confidenceOf, CONFIDENCE } = checkerModule;

/** Repository finto che registra tutto cio' che viene scritto. */
function fakeRepo({ history = [] } = {}) {
	const written = {
		observations: [], productPatches: [], offerPatches: [],
		priceHistory: [], notifications: [], offers: [],
	};

	return {
		written,
		async ensureOffer(product, descriptor) {
			const offer = { id: 'offer-1', offer_key: descriptor.offerKey, product_id: product.id };
			written.offers.push({ product, descriptor });
			return offer;
		},
		async getRecentObservations() { return history; },
		async insertObservation(row) { written.observations.push(row); },
		async updateProduct(id, patch) { written.productPatches.push({ id, patch }); },
		async updateOffer(id, patch) { written.offerPatches.push({ id, patch }); },
		async insertPriceHistory(row) { written.priceHistory.push(row); },
		async notifyPriceDrop(payload) { written.notifications.push(payload); },
	};
}

const product = (overrides = {}) => ({
	id: 'p1',
	name: 'iPhone 15',
	url: 'https://www.mediaworld.it/product/iphone',
	current_price: 729,
	currency: 'EUR',
	target_price: null,
	consecutive_failures: 0,
	...overrides,
});

/** Scrape finto che concorda con la pipeline (shadow match). */
const scrapeOk = (price, extra = {}) => async () => ({
	price, currency: 'EUR', available: true,
	shadow: { agreement: 'match' },
	...extra,
});

const storico = (...prices) => prices.map((price, index) => ({
	price, observedAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
}));

describe('confidenceOf', () => {
	it('l\'accordo fra scraper e pipeline vale piu\' dello scraper da solo', () => {
		// Due implementazioni indipendenti che concordano sono un'evidenza
		// vera, e vengono usate come tale finche' la pipeline e' in shadow.
		expect(confidenceOf({ shadow: { agreement: 'match' } }).confidence).toBe(CONFIDENCE.AGREEMENT);
		expect(confidenceOf({}).confidence).toBe(CONFIDENCE.LEGACY_ONLY);
	});

	it('il disaccordo abbassa la confidenza sotto la soglia di accettazione', () => {
		const { confidence } = confidenceOf({ shadow: { agreement: 'mismatch' } });
		expect(confidence).toBe(CONFIDENCE.DISAGREEMENT);
		expect(confidence).toBeLessThan(0.6);
	});
});

describe('checkProduct - prezzo accettato', () => {
	it('scrive il prezzo e aggiorna la salute', async () => {
		const repo = fakeRepo({ history: storico(729, 730, 728) });
		const out = await checkProduct({ product: product(), scrape: scrapeOk('699,00 €'), repo });

		expect(out.accepted).toBe(true);
		expect(out.price).toBe(699);
		expect(repo.written.productPatches[0].patch.current_price).toBe(699);
		expect(repo.written.productPatches[0].patch.tracking_health).toBe('healthy');
	});

	it('registra un\'osservazione accettata', async () => {
		const repo = fakeRepo({ history: storico(729) });
		await checkProduct({ product: product(), scrape: scrapeOk('699,00 €'), repo });

		const obs = repo.written.observations[0];
		expect(obs.accepted).toBe(true);
		expect(obs.price).toBe(699);
		expect(obs.reject_reason).toBeNull();
	});

	it('scrive nella storia solo se il prezzo e\' cambiato', async () => {
		const invariato = fakeRepo({ history: storico(729) });
		await checkProduct({ product: product(), scrape: scrapeOk('729,00 €'), repo: invariato });
		expect(invariato.written.priceHistory).toHaveLength(0);
		// ma l'osservazione c'e' comunque: e' la differenza fra "stabile" e "rotto"
		expect(invariato.written.observations).toHaveLength(1);

		const cambiato = fakeRepo({ history: storico(729) });
		await checkProduct({ product: product(), scrape: scrapeOk('699,00 €'), repo: cambiato });
		expect(cambiato.written.priceHistory).toHaveLength(1);
	});

	it('notifica quando il prezzo scende sotto la soglia', async () => {
		const repo = fakeRepo({ history: storico(729) });
		const out = await checkProduct({
			product: product({ target_price: 700 }), scrape: scrapeOk('699,00 €'), repo,
		});

		expect(out.notified).toBe(true);
		expect(repo.written.notifications[0].newPrice).toBe(699);
	});

	it('non notifica due volte se il prezzo era gia\' sotto la soglia', async () => {
		const repo = fakeRepo({ history: storico(650) });
		const out = await checkProduct({
			product: product({ current_price: 650, target_price: 700 }), scrape: scrapeOk('649,00 €'), repo,
		});

		expect(out.priceChanged).toBe(true);
		expect(out.notified).toBe(false);
	});
});

describe('checkProduct - la regola d\'oro: un fallimento non scrive mai un prezzo', () => {
	it('un prezzo implausibile non tocca current_price', async () => {
		// Il caso reale: lo scraper aggancia il costo di spedizione.
		const repo = fakeRepo({ history: storico(729, 730, 728) });
		const out = await checkProduct({
			product: product(), scrape: scrapeOk('4,99 €'), repo,
		});

		expect(out.accepted).toBe(false);
		expect(repo.written.productPatches[0].patch.current_price).toBeUndefined();
		expect(repo.written.priceHistory).toHaveLength(0);
	});

	it('ma lo registra come osservazione respinta, con il motivo', async () => {
		const repo = fakeRepo({ history: storico(729, 730, 728) });
		await checkProduct({ product: product(), scrape: scrapeOk('4,99 €'), repo });

		const obs = repo.written.observations[0];
		expect(obs.accepted).toBe(false);
		expect(obs.price).toBe(4.99);
		expect(obs.reject_reason).toContain('variazione_implausibile');
	});

	it('un errore di scrape produce comunque un\'osservazione', async () => {
		// Oggi un'eccezione fa continue e non lascia traccia.
		const repo = fakeRepo();
		const out = await checkProduct({
			product: product(),
			scrape: async () => { throw new Error('net::ERR_TIMED_OUT'); },
			repo,
		});

		expect(out.scrapeError).toContain('ERR_TIMED_OUT');
		expect(repo.written.observations).toHaveLength(1);
		expect(repo.written.observations[0].accepted).toBe(false);
		expect(repo.written.productPatches[0].patch.current_price).toBeUndefined();
	});

	it('un prezzo illeggibile non azzera il prezzo buono', async () => {
		const repo = fakeRepo({ history: storico(729) });
		const out = await checkProduct({
			product: product(), scrape: async () => ({ price: 'Non disponibile', available: false }), repo,
		});

		expect(out.price).toBeNull();
		expect(repo.written.productPatches[0].patch.current_price).toBeUndefined();
	});

	it('il disaccordo fra scraper e pipeline manda in quarantena', async () => {
		const repo = fakeRepo({ history: storico(729) });
		const out = await checkProduct({
			product: product(),
			scrape: async () => ({ price: '699,00 €', currency: 'EUR', shadow: { agreement: 'mismatch' } }),
			repo,
		});

		expect(out.accepted).toBe(false);
		expect(out.reasons).toContain('confidenza_insufficiente');
	});
});

describe('checkProduct - salute del tracking', () => {
	it('un fallimento isolato e\' degraded', async () => {
		const repo = fakeRepo();
		const out = await checkProduct({
			product: product(), scrape: async () => { throw new Error('boom'); }, repo,
		});

		expect(out.health).toBe('degraded');
		expect(repo.written.productPatches[0].patch.consecutive_failures).toBe(1);
	});

	it('il terzo fallimento consecutivo e\' broken', async () => {
		const repo = fakeRepo();
		const out = await checkProduct({
			product: product({ consecutive_failures: 2 }),
			scrape: async () => { throw new Error('boom'); }, repo,
		});

		expect(out.health).toBe('broken');
	});

	it('un successo azzera i fallimenti', async () => {
		const repo = fakeRepo({ history: storico(729) });
		await checkProduct({
			product: product({ consecutive_failures: 4 }), scrape: scrapeOk('729,00 €'), repo,
		});

		expect(repo.written.productPatches[0].patch.consecutive_failures).toBe(0);
		expect(repo.written.productPatches[0].patch.tracking_health).toBe('healthy');
	});

	it('un cambio di identita\' e\' degraded e non scrive il prezzo', async () => {
		const repo = fakeRepo({ history: storico(729) });
		const out = await checkProduct({
			product: product({ gtin: '0194253000000' }),
			scrape: scrapeOk('199,00 €', { gtin: '9999999999999' }),
			repo,
		});

		expect(out.reasons).toContain('identita_cambiata');
		expect(out.health).toBe('degraded');
		expect(repo.written.productPatches[0].patch.current_price).toBeUndefined();
	});
});

describe('checkProduct - offerte', () => {
	it('crea l\'offerta default per una pagina senza varianti', async () => {
		const repo = fakeRepo({ history: [] });
		const out = await checkProduct({ product: product(), scrape: scrapeOk('729,00 €'), repo });

		expect(out.offerKey).toBe('default');
	});

	it('distingue le offerte per venditore e condizione', async () => {
		const repo = fakeRepo({ history: [] });
		const out = await checkProduct({
			product: product(),
			scrape: scrapeOk('379,00 €', { details: { seller: 'Back Market', condition: 'ottimo' } }),
			repo,
		});

		expect(out.offerKey).not.toBe('default');
	});

	it('aggiorna l\'offerta solo su prezzo accettato', async () => {
		const respinto = fakeRepo({ history: storico(729, 730, 728) });
		await checkProduct({ product: product(), scrape: scrapeOk('4,99 €'), repo: respinto });
		expect(respinto.written.offerPatches).toHaveLength(0);

		const accettato = fakeRepo({ history: storico(729) });
		await checkProduct({ product: product(), scrape: scrapeOk('699,00 €'), repo: accettato });
		expect(accettato.written.offerPatches).toHaveLength(1);
	});
});
