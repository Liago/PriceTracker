/**
 * Lettura e interpretazione di robots.txt.
 *
 * Aprire il motore a qualunque dominio comporta una responsabilita' che la
 * whitelist mascherava: si visitano siti di cui non si sa nulla. Rispettare
 * robots e' il minimo del buon vicinato, ed e' anche il meccanismo con cui un
 * gestore puo' chiedere di non essere letto senza dover scrivere a nessuno.
 */

const DEFAULT_USER_AGENT = 'PriceTrackerBot';

/**
 * Interpreta un robots.txt.
 *
 * Implementa la parte dello standard che conta per noi: gruppi User-agent,
 * Allow, Disallow, con la regola del match piu' lungo. Non implementa
 * Crawl-delay come vincolo (lo esponiamo, ma il rate limiting e' gestito
 * altrove) ne' le sitemap.
 *
 * @param {string} text
 * @returns {{groups: Map<string, {allow: Array<string>, disallow: Array<string>, crawlDelay: number|null}>}}
 */
function parseRobots(text) {
	const groups = new Map();
	if (!text || typeof text !== 'string') return { groups };

	let current = [];
	let expectingAgents = false;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, '').trim();
		if (line === '') continue;

		const separator = line.indexOf(':');
		if (separator === -1) continue;

		const field = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();

		if (field === 'user-agent') {
			// Piu' User-agent consecutivi condividono lo stesso gruppo di regole.
			if (!expectingAgents) current = [];
			expectingAgents = true;
			const agent = value.toLowerCase();
			current.push(agent);
			if (!groups.has(agent)) groups.set(agent, { allow: [], disallow: [], crawlDelay: null });
			continue;
		}

		expectingAgents = false;
		if (current.length === 0) continue;

		for (const agent of current) {
			const group = groups.get(agent);
			if (field === 'disallow') group.disallow.push(value);
			else if (field === 'allow') group.allow.push(value);
			else if (field === 'crawl-delay') {
				const delay = parseFloat(value);
				if (Number.isFinite(delay)) group.crawlDelay = delay;
			}
		}
	}

	return { groups };
}

/** Un pattern di robots corrisponde a un percorso? Supporta * e $. */
function matchesPattern(pattern, pathname) {
	if (pattern === '') return false; // "Disallow:" vuoto significa: nulla e' vietato

	// L'ancora di fine va riconosciuta PRIMA dell'escape: dopo, il "$" sarebbe
	// gia' diventato "\$" e non verrebbe piu' riconosciuto come ancora.
	const anchoredAtEnd = pattern.endsWith('$');
	const body = anchoredAtEnd ? pattern.slice(0, -1) : pattern;

	const escaped = body
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*');

	const anchored = anchoredAtEnd ? `^${escaped}$` : `^${escaped}`;

	try {
		return new RegExp(anchored).test(pathname);
	} catch (e) {
		return false;
	}
}

/**
 * Il nostro agente puo' visitare questo percorso?
 *
 * Regola dello standard: vince la direttiva con il pattern piu' lungo; a
 * parita' di lunghezza vince Allow.
 *
 * @param {object} parsed - uscita di parseRobots
 * @param {string} pathname
 * @param {string} [userAgent]
 * @returns {{allowed: boolean, rule: string|null, crawlDelay: number|null}}
 */
function isAllowed(parsed, pathname, userAgent = DEFAULT_USER_AGENT) {
	const groups = parsed?.groups;
	if (!groups || groups.size === 0) return { allowed: true, rule: null, crawlDelay: null };

	const agent = userAgent.toLowerCase();
	// Il gruppo specifico ha la precedenza su quello generico.
	const group = groups.get(agent)
		|| [...groups.entries()].find(([name]) => name !== '*' && agent.includes(name))?.[1]
		|| groups.get('*');

	if (!group) return { allowed: true, rule: null, crawlDelay: null };

	let best = { allowed: true, rule: null, length: -1 };

	for (const pattern of group.disallow) {
		if (matchesPattern(pattern, pathname) && pattern.length > best.length) {
			best = { allowed: false, rule: `Disallow: ${pattern}`, length: pattern.length };
		}
	}
	for (const pattern of group.allow) {
		if (matchesPattern(pattern, pathname) && pattern.length >= best.length) {
			best = { allowed: true, rule: `Allow: ${pattern}`, length: pattern.length };
		}
	}

	return { allowed: best.allowed, rule: best.rule, crawlDelay: group.crawlDelay };
}

/**
 * Scarica e interpreta il robots.txt di un dominio.
 *
 * In caso di errore di rete si consente: un robots irraggiungibile non e' un
 * divieto, ed e' cosi' che lo interpretano i crawler seri.
 *
 * @param {string} origin - es. "https://shop.it"
 * @param {object} [deps]
 * @returns {Promise<{allowedFor: function, fetchedAt: string, status: number|null}>}
 */
async function fetchRobots(origin, deps = {}) {
	const { fetchImpl = fetch, timeoutMs = 5000, userAgent = DEFAULT_USER_AGENT } = deps;

	let text = '';
	let status = null;

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetchImpl(`${origin.replace(/\/$/, '')}/robots.txt`, {
			signal: controller.signal,
			headers: { 'User-Agent': userAgent },
		});
		clearTimeout(timer);
		status = response.status;
		// 4xx significa "nessuna regola", non "vietato".
		if (response.ok) text = await response.text();
	} catch (e) {
		// Irraggiungibile: si consente.
	}

	const parsed = parseRobots(text);

	return {
		status,
		fetchedAt: new Date().toISOString(),
		allowedFor: (pathname, agent = userAgent) => isAllowed(parsed, pathname, agent),
	};
}

module.exports = { parseRobots, isAllowed, matchesPattern, fetchRobots, DEFAULT_USER_AGENT };
