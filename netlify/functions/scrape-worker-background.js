/**
 * Lotto di controlli prezzo in background (fino a 15 minuti su Netlify).
 * Lo avvia, firmato, la function schedulata `worker`.
 */
const { createWorker, BACKGROUND } = require('./worker');
const { readSignedEvent } = require('../../server/services/importDispatch');

const run = createWorker(BACKGROUND);

module.exports.handler = async event => {
	if (!readSignedEvent(event, { requireId: false })) return { statusCode: 401 };
	const result = await run();
	return { statusCode: result.statusCode === 500 ? 500 : 200 };
};
