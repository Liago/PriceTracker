#!/usr/bin/env node
/**
 * Runner delle migrazioni.
 *
 * Uso:
 *   npm run migrate          applica le migrazioni non ancora applicate
 *   npm run migrate:status   mostra lo stato senza modificare nulla
 *
 * Richiede DATABASE_URL, la connection string Postgres del progetto Supabase
 * (Project Settings > Database > Connection string). La chiave anon e la
 * service role key non bastano: supabase-js non esegue DDL.
 *
 * Ogni migrazione gira in una transazione: se fallisce, non lascia lo schema a
 * meta'. Le migrazioni gia' applicate vengono saltate, quindi rieseguire il
 * comando e' sempre sicuro.
 */

const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const { loadMigrations, selectPending } = require('./migrationSet');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const CREATE_TABLE = `
create table if not exists public.schema_migrations (
  version     integer primary key,
  name        text not null,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);
`;

async function readApplied(client) {
	await client.query(CREATE_TABLE);
	const { rows } = await client.query(
		'select version, name, checksum from public.schema_migrations order by version'
	);
	return rows;
}

async function applyMigration(client, migration) {
	await client.query('begin');
	try {
		await client.query(migration.sql);
		await client.query(
			'insert into public.schema_migrations (version, name, checksum) values ($1, $2, $3)',
			[migration.version, migration.name, migration.checksum]
		);
		await client.query('commit');
	} catch (error) {
		await client.query('rollback');
		throw error;
	}
}

async function main() {
	const statusOnly = process.argv.includes('--status');

	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.error('DATABASE_URL non impostata.');
		console.error('E\' la connection string Postgres di Supabase (Project Settings > Database).');
		process.exit(1);
	}

	const migrations = loadMigrations(MIGRATIONS_DIR);
	if (migrations.length === 0) {
		console.log('Nessuna migrazione trovata in', MIGRATIONS_DIR);
		return;
	}

	// Supabase richiede TLS; un Postgres locale (test, CI) tipicamente no.
	const sslDisabled = process.env.DATABASE_SSL === 'disable'
		|| /(^|@|\/\/)(localhost|127\.0\.0\.1)/.test(connectionString);

	const client = new Client({
		connectionString,
		ssl: sslDisabled ? false : { rejectUnauthorized: false },
	});
	await client.connect();

	try {
		const applied = await readApplied(client);
		const { pending, modified, missing } = selectPending(migrations, applied);

		for (const migration of modified) {
			console.warn(
				`ATTENZIONE: ${migration.filename} risulta applicata ma il file e' cambiato. ` +
				'Il contenuto attuale NON verra' + ' rieseguito: serve una nuova migrazione.'
			);
		}
		for (const version of missing) {
			console.warn(`ATTENZIONE: la migrazione ${version} e' registrata a database ma non esiste su disco.`);
		}

		console.log(`${migrations.length} migrazioni su disco, ${applied.length} applicate, ${pending.length} da applicare.`);

		if (statusOnly) {
			for (const migration of pending) console.log(`  da applicare: ${migration.filename}`);
			return;
		}

		for (const migration of pending) {
			process.stdout.write(`  applico ${migration.filename} ... `);
			await applyMigration(client, migration);
			console.log('ok');
		}

		console.log(pending.length > 0 ? 'Migrazioni applicate.' : 'Schema gia\' aggiornato.');
	} finally {
		await client.end();
	}
}

if (require.main === module) {
	main().catch((error) => {
		console.error('\nMigrazione fallita:', error.message);
		process.exit(1);
	});
}

module.exports = { main, applyMigration, readApplied, MIGRATIONS_DIR };
