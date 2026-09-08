import { describe, it, expect } from 'vitest';
import browserPath from '../utils/browserPath.js';

const { resolveLocalExecutablePath, CANDIDATES } = browserPath;

const never = () => false;
const always = () => true;

describe('resolveLocalExecutablePath', () => {
	it('onora PUPPETEER_EXECUTABLE_PATH senza verificarlo su disco', () => {
		const resolved = resolveLocalExecutablePath({
			platform: 'linux',
			env: { PUPPETEER_EXECUTABLE_PATH: '/custom/chrome' },
			exists: never,
		});
		expect(resolved).toBe('/custom/chrome');
	});

	it('accetta anche CHROME_PATH e CHROMIUM_PATH', () => {
		expect(resolveLocalExecutablePath({ platform: 'linux', env: { CHROME_PATH: '/a/chrome' }, exists: never }))
			.toBe('/a/chrome');
		expect(resolveLocalExecutablePath({ platform: 'linux', env: { CHROMIUM_PATH: '/b/chromium' }, exists: never }))
			.toBe('/b/chromium');
	});

	it('da\' la precedenza a PUPPETEER_EXECUTABLE_PATH su CHROME_PATH', () => {
		const resolved = resolveLocalExecutablePath({
			platform: 'linux',
			env: { CHROME_PATH: '/b/chrome', PUPPETEER_EXECUTABLE_PATH: '/a/chrome' },
			exists: never,
		});
		expect(resolved).toBe('/a/chrome');
	});

	it('ignora una variabile d\'ambiente vuota o di soli spazi', () => {
		const resolved = resolveLocalExecutablePath({
			platform: 'linux',
			env: { PUPPETEER_EXECUTABLE_PATH: '   ' },
			exists: (p) => p === '/usr/bin/chromium',
		});
		expect(resolved).toBe('/usr/bin/chromium');
	});

	it('trova il primo candidato esistente su linux', () => {
		const resolved = resolveLocalExecutablePath({
			platform: 'linux',
			env: {},
			exists: (p) => p === '/usr/bin/chromium-browser',
		});
		expect(resolved).toBe('/usr/bin/chromium-browser');
	});

	it('rispetta l\'ordine di preferenza quando esistono piu\' candidati', () => {
		const resolved = resolveLocalExecutablePath({ platform: 'linux', env: {}, exists: always });
		expect(resolved).toBe(CANDIDATES.linux[0]);
	});

	it('trova Chrome su macOS', () => {
		const resolved = resolveLocalExecutablePath({
			platform: 'darwin',
			env: {},
			exists: (p) => p.includes('Google Chrome.app'),
		});
		expect(resolved).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
	});

	it('trova Chrome su Windows', () => {
		const resolved = resolveLocalExecutablePath({ platform: 'win32', env: {}, exists: always });
		expect(resolved).toBe(CANDIDATES.win32[0]);
	});

	it('restituisce undefined quando nessun candidato esiste, lasciando risolvere a puppeteer', () => {
		expect(resolveLocalExecutablePath({ platform: 'linux', env: {}, exists: never })).toBeUndefined();
	});

	it('restituisce undefined su una piattaforma sconosciuta', () => {
		expect(resolveLocalExecutablePath({ platform: 'freebsd', env: {}, exists: always })).toBeUndefined();
	});
});
