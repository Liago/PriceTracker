/**
 * Punto di accesso unico alla normalizzazione.
 *
 * Ogni valore che entra nel database deve passare da qui: e' il modo in cui il
 * refactor evita che ricompaiano implementazioni parallele dello stesso
 * parsing (difetto D5 del design doc).
 */

const price = require('./price');
const currency = require('./currency');
const availability = require('./availability');

module.exports = {
	...price,
	...currency,
	...availability,
};
