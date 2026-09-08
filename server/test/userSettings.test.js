import { describe, it, expect } from 'vitest';
import userSettings from '../services/userSettings.js';

const { normalizeUserSettings, DEFAULTS, MIN_PRICE_CHECK_INTERVAL_MINUTES } = userSettings;

describe('normalizeUserSettings', () => {
	it('restituisce i default quando la riga manca', () => {
		expect(normalizeUserSettings(null)).toEqual(DEFAULTS);
		expect(normalizeUserSettings(undefined)).toEqual(DEFAULTS);
		expect(normalizeUserSettings('non-una-riga')).toEqual(DEFAULTS);
	});

	it('restituisce price_check_interval, che prima veniva perso', () => {
		// Il difetto D9: getUserSettings non lo ritornava, quindi l'intervallo
		// scelto dall'utente non veniva mai applicato.
		const settings = normalizeUserSettings({ price_check_interval: 120 });
		expect(settings.priceCheckIntervalMinutes).toBe(120);
	});

	it('applica il pavimento all\'intervallo delle righe legacy', () => {
		// Righe create quando il default dello schema era 6 ("ore"): lette come
		// minuti sarebbero un check ogni 6 minuti.
		const settings = normalizeUserSettings({ price_check_interval: 6 });
		expect(settings.priceCheckIntervalMinutes).toBe(MIN_PRICE_CHECK_INTERVAL_MINUTES);
	});

	it('ricade sul default per valori non validi', () => {
		expect(normalizeUserSettings({ price_check_interval: 0 }).priceCheckIntervalMinutes)
			.toBe(DEFAULTS.priceCheckIntervalMinutes);
		expect(normalizeUserSettings({ price_check_interval: -30 }).priceCheckIntervalMinutes)
			.toBe(DEFAULTS.priceCheckIntervalMinutes);
		expect(normalizeUserSettings({ price_check_interval: 'abc' }).priceCheckIntervalMinutes)
			.toBe(DEFAULTS.priceCheckIntervalMinutes);
	});

	it('accetta valori numerici arrivati come stringa dalla UI', () => {
		const settings = normalizeUserSettings({ price_check_interval: '90', scrape_delay: '3000' });
		expect(settings.priceCheckIntervalMinutes).toBe(90);
		expect(settings.scrapeDelayMs).toBe(3000);
	});

	it('limita scrape_delay entro un intervallo ragionevole', () => {
		expect(normalizeUserSettings({ scrape_delay: 10 }).scrapeDelayMs).toBe(500);
		expect(normalizeUserSettings({ scrape_delay: 999999 }).scrapeDelayMs).toBe(60000);
		expect(normalizeUserSettings({ scrape_delay: 2500 }).scrapeDelayMs).toBe(2500);
	});

	it('tratta max_retries a zero come valore legittimo', () => {
		expect(normalizeUserSettings({ max_retries: 0 }).maxRetries).toBe(0);
		expect(normalizeUserSettings({ max_retries: 3 }).maxRetries).toBe(3);
		expect(normalizeUserSettings({ max_retries: 99 }).maxRetries).toBe(5);
		expect(normalizeUserSettings({ max_retries: -1 }).maxRetries).toBe(DEFAULTS.maxRetries);
	});

	it('conserva email_notifications, incluso false', () => {
		expect(normalizeUserSettings({ email_notifications: false }).emailNotifications).toBe(false);
		expect(normalizeUserSettings({}).emailNotifications).toBe(true);
	});
});
