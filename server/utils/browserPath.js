/**
 * Risoluzione dell'eseguibile Chrome/Chromium per lo sviluppo locale.
 *
 * Sostituisce il path macOS hardcoded in services/scraper.js (difetto D13 del
 * design doc), che su Linux e in CI faceva fallire il lancio del browser: in
 * puppeteer-core executablePath ha la precedenza su channel, quindi il
 * fallback `channel: 'chrome'` non entrava mai in gioco.
 *
 * Le dipendenze di sistema sono iniettabili per rendere la funzione testabile.
 */

const fs = require('fs');

// Candidati per piattaforma, in ordine di preferenza.
const CANDIDATES = Object.freeze({
	darwin: [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
	],
	linux: [
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/snap/bin/chromium',
		'/opt/pw-browsers/chromium',
	],
	win32: [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	],
});

// Variabili d'ambiente onorate, in ordine di precedenza.
const ENV_OVERRIDES = Object.freeze([
	'PUPPETEER_EXECUTABLE_PATH',
	'CHROME_PATH',
	'CHROMIUM_PATH',
]);

/**
 * @param {object} [deps]
 * @param {string} [deps.platform] - process.platform
 * @param {object} [deps.env] - process.env
 * @param {(path: string) => boolean} [deps.exists] - test di esistenza del file
 * @returns {string|undefined} il path da usare, oppure undefined per lasciare
 *   che puppeteer risolva da solo tramite `channel`
 */
function resolveLocalExecutablePath(deps = {}) {
	const {
		platform = process.platform,
		env = process.env,
		exists = (p) => fs.existsSync(p),
	} = deps;

	// Un override esplicito vince sempre e non viene verificato su disco: se
	// l'utente lo imposta, un errore di lancio e' piu' utile di un fallback
	// silenzioso su un browser diverso da quello che voleva.
	for (const name of ENV_OVERRIDES) {
		const value = env[name];
		if (value && value.trim()) return value.trim();
	}

	for (const candidate of CANDIDATES[platform] || []) {
		if (exists(candidate)) return candidate;
	}

	return undefined;
}

module.exports = {
	resolveLocalExecutablePath,
	CANDIDATES,
	ENV_OVERRIDES,
};
