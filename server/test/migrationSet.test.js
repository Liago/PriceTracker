import { describe, it, expect } from 'vitest';
import migrationSet from '../database/migrationSet.js';

const { parseMigrationFilename, checksum, loadMigrations, selectPending } = migrationSet;

/** Costruisce deps finte per loadMigrations, senza toccare il filesystem. */
function fakeDir(files) {
	return {
		readdir: () => Object.keys(files),
		readFile: (p) => files[p],
		join: (_dir, filename) => filename,
	};
}

describe('parseMigrationFilename', () => {
	it('estrae versione e nome', () => {
		expect(parseMigrationFilename('001_supported_domains.sql'))
			.toEqual({ version: 1, name: 'supported_domains', filename: '001_supported_domains.sql' });
		expect(parseMigrationFilename('042_add_scrape_recipes.sql').version).toBe(42);
	});

	it('rifiuta i nomi fuori convenzione', () => {
		expect(parseMigrationFilename('schema.sql')).toBeNull();
		expect(parseMigrationFilename('001-trattini.sql')).toBeNull();
		expect(parseMigrationFilename('001_Maiuscole.sql')).toBeNull();
		expect(parseMigrationFilename('001_note.txt')).toBeNull();
		expect(parseMigrationFilename('README.md')).toBeNull();
	});
});

describe('loadMigrations', () => {
	it('ordina numericamente, non lessicograficamente', () => {
		// L'ordinamento di stringhe metterebbe "010" prima di "002".
		const deps = fakeDir({
			'010_dieci.sql': 'select 10;',
			'002_due.sql': 'select 2;',
			'001_uno.sql': 'select 1;',
		});
		const versions = loadMigrations('/mig', deps).map((m) => m.version);
		expect(versions).toEqual([1, 2, 10]);
	});

	it('ignora i file che non sono migrazioni', () => {
		const deps = fakeDir({
			'001_uno.sql': 'select 1;',
			'README.md': '# note',
			'.keep': '',
			'policies.sql': 'select 0;',
		});
		expect(loadMigrations('/mig', deps).map((m) => m.filename)).toEqual(['001_uno.sql']);
	});

	it('calcola un checksum del contenuto', () => {
		const deps = fakeDir({ '001_uno.sql': 'select 1;' });
		const [migration] = loadMigrations('/mig', deps);
		expect(migration.checksum).toBe(checksum('select 1;'));
		expect(migration.checksum).toHaveLength(64);
	});

	it('segnala i numeri di versione duplicati invece di applicarne una a caso', () => {
		const deps = fakeDir({
			'003_alfa.sql': 'select 1;',
			'003_beta.sql': 'select 2;',
		});
		expect(() => loadMigrations('/mig', deps)).toThrow(/duplicato 3/);
	});

	it('restituisce un elenco vuoto per una cartella senza migrazioni', () => {
		expect(loadMigrations('/mig', fakeDir({}))).toEqual([]);
	});
});

describe('selectPending', () => {
	const migrations = [
		{ version: 1, filename: '001_uno.sql', checksum: 'aaa' },
		{ version: 2, filename: '002_due.sql', checksum: 'bbb' },
		{ version: 3, filename: '003_tre.sql', checksum: 'ccc' },
	];

	it('su un database vuoto tutto e\' da applicare, in ordine', () => {
		const { pending } = selectPending(migrations, []);
		expect(pending.map((m) => m.version)).toEqual([1, 2, 3]);
	});

	it('salta le migrazioni gia\' applicate: rieseguire e\' un no-op', () => {
		const applied = [
			{ version: 1, checksum: 'aaa' },
			{ version: 2, checksum: 'bbb' },
			{ version: 3, checksum: 'ccc' },
		];
		const { pending, modified, missing } = selectPending(migrations, applied);
		expect(pending).toEqual([]);
		expect(modified).toEqual([]);
		expect(missing).toEqual([]);
	});

	it('applica solo il delta', () => {
		const { pending } = selectPending(migrations, [{ version: 1, checksum: 'aaa' }]);
		expect(pending.map((m) => m.version)).toEqual([2, 3]);
	});

	it('rileva una migrazione modificata dopo essere stata applicata', () => {
		const applied = [{ version: 1, checksum: 'checksum-vecchio' }];
		const { pending, modified } = selectPending(migrations, applied);
		expect(modified.map((m) => m.version)).toEqual([1]);
		expect(pending.map((m) => m.version)).toEqual([2, 3]);
	});

	it('rileva una migrazione registrata a db ma sparita dal disco', () => {
		const applied = [{ version: 1, checksum: 'aaa' }, { version: 99, checksum: 'zzz' }];
		expect(selectPending(migrations, applied).missing).toEqual([99]);
	});

	it('tratta applied null come database vuoto', () => {
		expect(selectPending(migrations, null).pending).toHaveLength(3);
	});

	it('accetta versioni arrivate come stringa dal driver', () => {
		const applied = [{ version: '1', checksum: 'aaa' }];
		expect(selectPending(migrations, applied).pending.map((m) => m.version)).toEqual([2, 3]);
	});
});
