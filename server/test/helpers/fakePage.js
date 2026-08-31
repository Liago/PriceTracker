import { JSDOM } from 'jsdom';

/**
 * Pagina finta compatibile con la parte di API Puppeteer che gli scraper usano.
 *
 * Serve a eseguire il corpo di page.evaluate() contro un DOM jsdom costruito da
 * una fixture HTML salvata su disco, cosi' da testare gli scraper senza rete e
 * senza browser. E' l'embrione dell'harness a fixture descritto in
 * docs/SCRAPE_ENGINE_REFACTOR.md (fase 0).
 *
 * Limite noto: jsdom non implementa innerText. Lo esponiamo come alias di
 * textContent affinche' il codice che lo usa non riceva undefined; il codice
 * nuovo dovrebbe comunque preferire textContent, che si comporta allo stesso
 * modo nei due ambienti.
 */
export class FakePage {
	constructor(html, { url = 'https://example.com/prodotto' } = {}) {
		this.dom = new JSDOM(html, { url });
		this.window = this.dom.window;
		this.document = this.window.document;

		const proto = this.window.HTMLElement.prototype;
		if (!Object.getOwnPropertyDescriptor(proto, 'innerText')) {
			Object.defineProperty(proto, 'innerText', {
				get() { return this.textContent; },
				configurable: true,
			});
		}
	}

	/**
	 * Esegue fn con i globali del DOM della fixture, come farebbe il browser.
	 * I globali vengono ripristinati anche in caso di eccezione.
	 */
	async evaluate(fn, ...args) {
		const globals = {
			document: this.document,
			window: this.window,
			getComputedStyle: this.window.getComputedStyle.bind(this.window),
			Node: this.window.Node,
			Element: this.window.Element,
			HTMLElement: this.window.HTMLElement,
		};
		const saved = new Map();
		for (const [key, value] of Object.entries(globals)) {
			saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
			Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
		}
		try {
			return await fn(...args);
		} finally {
			for (const [key, descriptor] of saved) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else delete globalThis[key];
			}
		}
	}

	async title() {
		return this.document.title;
	}

	close() {
		this.window.close();
	}
}

export default FakePage;
