/**
 * Logica pura del sistema di migrazioni: scoperta, ordinamento, checksum e
 * calcolo delle migrazioni ancora da applicare.
 *
 * Separata dall'esecuzione (database/migrate.js) per essere testabile senza
 * database. Fase 0 del refactor: prima di aggiungere le tabelle del nuovo
 * motore serve un modo riproducibile di versionare lo schema, che oggi manca
 * (difetto D14 del design doc: colonne aggiunte a mano in produzione e mai
 * finite in schema.sql).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILENAME_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/;

/**
 * @param {string} filename
 * @returns {{version:number, name:string, filename:string}|null} null se il
 *   nome non rispetta la convenzione NNN_nome_snake_case.sql
 */
function parseMigrationFilename(filename) {
	const match = FILENAME_PATTERN.exec(filename);
	if (!match) return null;
	return {
		version: parseInt(match[1], 10),
		name: match[2],
		filename,
	};
}

/**
 * @param {string} sql
 * @returns {string} checksum sha256, per accorgersi che una migrazione gia'
 *   applicata e' stata modificata dopo il fatto
 */
function checksum(sql) {
	return crypto.createHash('sha256').update(sql, 'utf-8').digest('hex');
}

/**
 * Carica e ordina le migrazioni presenti su disco.
 *
 * L'ordinamento e' NUMERICO, non lessicografico: con l'ordinamento di stringhe
 * la 10 verrebbe prima della 2.
 *
 * @param {string} dir
 * @param {object} [deps] - iniettabili per i test
 * @returns {Array<{version:number, name:string, filename:string, sql:string, checksum:string}>}
 * @throws {Error} se due migrazioni condividono lo stesso numero di versione
 */
function loadMigrations(dir, deps = {}) {
	const {
		readdir = (d) => fs.readdirSync(d),
		readFile = (p) => fs.readFileSync(p, 'utf-8'),
		join = path.join,
	} = deps;

	const migrations = readdir(dir)
		.map(parseMigrationFilename)
		.filter(Boolean)
		.map((migration) => {
			const sql = readFile(join(dir, migration.filename));
			return { ...migration, sql, checksum: checksum(sql) };
		})
		.sort((a, b) => a.version - b.version);

	const seen = new Map();
	for (const migration of migrations) {
		if (seen.has(migration.version)) {
			throw new Error(
				`Numero di migrazione duplicato ${migration.version}: ` +
				`${seen.get(migration.version)} e ${migration.filename}`
			);
		}
		seen.set(migration.version, migration.filename);
	}

	return migrations;
}

/**
 * Confronta le migrazioni su disco con quelle registrate a database.
 *
 * @param {Array} migrations - uscita di loadMigrations
 * @param {Array<{version:number, checksum:string}>} applied - righe di schema_migrations
 * @returns {{pending:Array, modified:Array, missing:Array}}
 *   pending: da applicare, in ordine
 *   modified: gia' applicate ma con contenuto cambiato dopo il fatto
 *   missing: registrate a db ma non piu' presenti su disco
 */
function selectPending(migrations, applied) {
	const appliedByVersion = new Map((applied || []).map((row) => [Number(row.version), row]));
	const onDiskVersions = new Set(migrations.map((m) => m.version));

	const pending = [];
	const modified = [];

	for (const migration of migrations) {
		const appliedRow = appliedByVersion.get(migration.version);
		if (!appliedRow) {
			pending.push(migration);
		} else if (appliedRow.checksum && appliedRow.checksum !== migration.checksum) {
			modified.push(migration);
		}
	}

	const missing = (applied || [])
		.filter((row) => !onDiskVersions.has(Number(row.version)))
		.map((row) => Number(row.version))
		.sort((a, b) => a - b);

	return { pending, modified, missing };
}

module.exports = {
	parseMigrationFilename,
	checksum,
	loadMigrations,
	selectPending,
	FILENAME_PATTERN,
};
