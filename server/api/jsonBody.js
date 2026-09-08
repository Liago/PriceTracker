/**
 * Normalizzazione del body JSON.
 *
 * Difetto emerso soltanto in staging: su Netlify ogni POST arrivava alle route
 * con `req.body` uguale a un Buffer grezzo, quindi `req.body.url` era
 * `undefined` e l'aggiunta di un prodotto veniva respinta con
 * «URL non ammesso: url_mancante» anche quando il client aveva mandato l'URL.
 * Il messaggio accusava l'utente di un errore che non aveva commesso.
 *
 * La causa e' l'incontro fra serverless-http e body-parser 2 (Express 5).
 * serverless-http non ricostruisce uno stream HTTP: fabbrica una
 * `IncomingMessage` finta con `complete: true` e stream gia' esaurito, e ci
 * attacca il body letto da Netlify come Buffer. body-parser 2 comincia il suo
 * lavoro con `onFinished.isFinished(req)`, che per una richiesta completa e non
 * piu' leggibile risponde di si': ne deduce che il body sia gia' stato parsato,
 * chiama `next()` e lascia il Buffer dov'e'. Nessuno dei due ha torto da solo;
 * il difetto sta nella combinazione.
 *
 * In sviluppo il problema e' invisibile, perche' il server Express riceve uno
 * stream vero ed `express.json()` fa il suo mestiere. E' esattamente la classe
 * di comportamenti che la checklist di staging esiste per intercettare.
 *
 * Questo middleware chiude il buco senza dipendere da chi sta sotto: se il body
 * e' gia' un oggetto non tocca nulla, se e' rimasto grezzo lo interpreta. Vive
 * qui, accanto alle route condivise, e non nella function Netlify, cosi' vale
 * per tutti i punti di montaggio e non si puo' dimenticare quando se ne
 * aggiunge uno.
 */

/** `application/json`, ma anche `application/merge-patch+json` e simili. */
const JSON_CONTENT_TYPE = /^application\/([\w.+-]+\+)?json\s*(;|$)/i;

/**
 * La richiesta dichiara un body JSON?
 * @param {object} req
 * @returns {boolean}
 */
function isJsonRequest(req) {
	const type = req.headers?.['content-type'];
	return typeof type === 'string' && JSON_CONTENT_TYPE.test(type.trim());
}

/**
 * Riporta a stringa un body grezzo, rispettando il charset dichiarato.
 *
 * Si accettano solo le codifiche `utf-*`, come fa body-parser per il JSON:
 * qualunque altra cosa non e' JSON valido secondo RFC 8259.
 *
 * @param {Buffer|string} body
 * @param {object} req
 * @returns {string|null} null se il body non e' interpretabile
 */
function decodeBody(body, req) {
	if (typeof body === 'string') return body;
	if (!Buffer.isBuffer(body)) return null;

	const match = /charset=\s*"?([\w-]+)"?/i.exec(req.headers?.['content-type'] || '');
	const charset = (match ? match[1] : 'utf-8').toLowerCase();

	if (charset === 'utf-16le' || charset === 'utf-16') return body.toString('utf16le');
	if (charset === 'utf-8' || charset === 'utf8') return body.toString('utf8');
	return null;
}

/**
 * Middleware: garantisce che `req.body` sia un oggetto quando la richiesta
 * dichiara JSON.
 *
 * @returns {function} middleware Express
 */
function jsonBody() {
	return function normalizeJsonBody(req, res, next) {
		const body = req.body;

		// Gia' parsato da express.json(): il caso normale del server Express.
		if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
			return next();
		}

		// Su una richiesta che non dichiara JSON non c'e' nulla da interpretare:
		// un upload o un form hanno un altro parser, e non tocca a noi.
		if (!isJsonRequest(req)) return next();

		// Nessun body su una richiesta che si dichiara JSON: meglio un oggetto
		// vuoto di `undefined`, cosi' le route trovano sempre la stessa forma.
		if (body === undefined || body === null) {
			req.body = {};
			return next();
		}

		const raw = decodeBody(body, req);
		if (raw === null) {
			return res.status(415).json({ error: 'Codifica del body non supportata', code: 'UNSUPPORTED_CHARSET' });
		}

		const trimmed = raw.trim();
		if (trimmed === '') {
			req.body = {};
			return next();
		}

		try {
			const parsed = JSON.parse(trimmed);
			// Un body JSON che non e' un oggetto (`"ciao"`, `42`) non ha campi da
			// leggere: le route lo tratterebbero come vuoto, ed e' cio' che e'.
			req.body = parsed !== null && typeof parsed === 'object' ? parsed : {};
		} catch (error) {
			return res.status(400).json({ error: 'Body JSON non valido', code: 'INVALID_JSON' });
		}

		return next();
	};
}

module.exports = { jsonBody, isJsonRequest, decodeBody };
