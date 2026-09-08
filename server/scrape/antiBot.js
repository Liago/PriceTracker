/**
 * Riconoscere una pagina di sfida nell'HTML, senza browser.
 *
 * Il rilevatore che esisteva (utils/captchaDetector) lavora sul `page` di
 * Puppeteer: interroga il DOM, guarda la visibilita' degli elementi. Al tier 0
 * non c'e' nessun `page`, e senza un controllo equivalente il motore commette
 * l'errore piu' insidioso possibile: prende la pagina di sfida per la pagina
 * prodotto.
 *
 * Il sintomo e' inconfondibile una volta che lo si conosce. Una challenge di
 * Cloudflare o DataDome torna con status 200 - non 403 - e un corpo di poche
 * righe che contiene solo lo script della verifica. La pipeline la interpreta
 * senza errori e non trova nulla: zero candidati, confidenza zero. A quel
 * punto l'API dice all'utente «nessun prezzo leggibile su quella pagina»,
 * che e' falso e per giunta lo manda a cercare il problema nel posto sbagliato
 * - nell'URL che ha incollato, invece che nel sito che ci ha rifiutati.
 *
 * Distinguere i due casi non e' un dettaglio diagnostico: sono due risposte
 * diverse. «Questa pagina non ha un prezzo» e' definitivo, «non sono riuscito
 * a leggerla» chiede di riprovare in un altro modo.
 */

/** Marcatori inequivocabili, per fornitore. Cercati nell'HTML grezzo. */
const VENDOR_MARKERS = Object.freeze([
	{ type: 'Cloudflare', patterns: ['challenges.cloudflare.com', 'cf-browser-verification', '__cf_chl', 'cf_chl_opt', 'cdn-cgi/challenge-platform'] },
	{ type: 'DataDome', patterns: ['geo.captcha-delivery.com', 'datadome', 'dd_cookie_test'] },
	{ type: 'PerimeterX', patterns: ['px-captcha', 'perimeterx', '_pxhd'] },
	{ type: 'Akamai', patterns: ['_abck', 'ak_bmsc', 'akam-sw.js'] },
	{ type: 'reCAPTCHA', patterns: ['g-recaptcha', 'google.com/recaptcha'] },
	{ type: 'hCaptcha', patterns: ['h-captcha', 'hcaptcha.com'] },
	{ type: 'Imperva', patterns: ['incapsula', '_incap_ses', 'distil_r_captcha'] },
]);

/** Titoli che nessuna pagina prodotto ha mai avuto. */
const TITLE_PATTERNS = [
	'captcha', 'security check', 'are you a robot', 'verify you are human',
	'access denied', 'attention required', 'just a moment', 'checking your browser',
	'pardon our interruption', 'unusual traffic', 'accesso negato', 'verifica di sicurezza',
];

/** Frasi tipiche del corpo di una sfida. */
const BODY_PATTERNS = [
	'enable javascript and cookies to continue',
	'please enable cookies',
	'verifying you are human',
	'this process is automatic',
	'your browser will redirect',
	'ddos protection by',
];

/**
 * Sotto questa dimensione non c'e' una pagina, qualunque cosa contenga.
 *
 * La soglia e' volutamente bassa. Ci si e' arrivati sbagliandola: a 2048 byte
 * dichiarava implausibili pagine prodotto perfettamente leggibili - le fixture
 * di questo stesso progetto stanno in poco piu' di un kilobyte e producono
 * dieci candidati a testa. Una pagina compatta non e' una pagina mancante.
 *
 * Mezzo kilobyte e' invece una dimensione che nessuna scheda prodotto ha: e'
 * la taglia di una risposta di cortesia o di uno stub di sfida. E anche cosi'
 * resta un SEGNALE, non un verdetto: chi lo usa lo combina con l'assenza di
 * candidati, perche' e' la combinazione a essere concludente.
 */
const MIN_PLAUSIBLE_BYTES = 512;

/** Il titolo dell'HTML, senza costruire un DOM: qui serve solo una stringa. */
function titleOf(html) {
	const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
	return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * L'HTML e' una pagina di sfida invece della pagina richiesta?
 *
 * @param {string} html
 * @param {object} [options]
 * @param {number} [options.minBytes]
 * @returns {{detected: boolean, type: string|null, reason: string|null, indicators: Array<string>, title: string, bytes: number}}
 */
function detectInHtml(html, options = {}) {
	const { minBytes = MIN_PLAUSIBLE_BYTES } = options;
	const text = typeof html === 'string' ? html : '';
	const bytes = Buffer.byteLength(text, 'utf8');
	const title = titleOf(text);
	const lower = text.toLowerCase();
	const lowerTitle = title.toLowerCase();

	const indicators = [];
	let type = null;

	for (const vendor of VENDOR_MARKERS) {
		const hit = vendor.patterns.find((pattern) => lower.includes(pattern));
		if (hit) {
			indicators.push(`vendor:${vendor.type}:${hit}`);
			if (!type) type = vendor.type;
		}
	}

	const titleHit = TITLE_PATTERNS.find((pattern) => lowerTitle.includes(pattern));
	if (titleHit) indicators.push(`title:${titleHit}`);

	const bodyHit = BODY_PATTERNS.find((pattern) => lower.includes(pattern));
	if (bodyHit) indicators.push(`body:${bodyHit}`);

	// Un marcatore di fornitore da solo non basta: uno script di protezione puo'
	// essere presente su una pagina servita regolarmente, ed e' anzi la norma
	// sui siti che li usano. Serve che sia accompagnato da un titolo o da un
	// testo di sfida, oppure che la pagina sia troppo piccola per contenere un
	// prodotto - il caso della challenge servita al posto del contenuto.
	const hasVendor = indicators.some((i) => i.startsWith('vendor:'));
	const hasChallengeText = Boolean(titleHit || bodyHit);
	const suspiciouslySmall = bytes < minBytes;

	const detected = hasChallengeText || (hasVendor && suspiciouslySmall);

	if (detected) {
		return {
			detected: true,
			type: type || 'sconosciuto',
			reason: 'pagina_di_sfida',
			indicators,
			title,
			bytes,
		};
	}

	// Non e' una sfida riconoscibile, ma una risposta cosi' piccola non e'
	// nemmeno una pagina prodotto: e' bene dirlo con il suo nome.
	if (suspiciouslySmall) {
		return { detected: false, type: null, reason: 'pagina_troppo_piccola', indicators, title, bytes };
	}

	return { detected: false, type: null, reason: null, indicators, title, bytes };
}

module.exports = { detectInHtml, titleOf, VENDOR_MARKERS, TITLE_PATTERNS, BODY_PATTERNS, MIN_PLAUSIBLE_BYTES };
