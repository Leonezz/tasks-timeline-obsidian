import '@testing-library/jest-dom';

// Setup global test environment
// Setup global test environment
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
global.console = {
	...console,
	// Suppress console.log in tests unless needed
	log: jest.fn(),
	debug: jest.fn(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
};

// Suites that run in Node (`@jest-environment node`) have no DOM.
if (typeof window !== 'undefined') {
	installDomHelpers();
}

function installDomHelpers() {
	// Obsidian's global HTMLElement helpers used by views and setting tabs
	HTMLElement.prototype.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
	HTMLElement.prototype.addClass = function (
		this: HTMLElement,
		...classes: string[]
	) {
		this.classList.add(...classes);
	};
	HTMLElement.prototype.createDiv = function (
		this: HTMLElement,
		o?: DomElementInfo | string,
	) {
		const div = document.createElement('div');
		const cls = typeof o === 'string' ? o : o?.cls;
		if (cls) div.className = Array.isArray(cls) ? cls.join(' ') : cls;
		this.appendChild(div);
		return div;
	};

	// Mock window.matchMedia for React components that use media queries
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		value: jest.fn().mockImplementation(query => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: jest.fn(),
			removeListener: jest.fn(),
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			dispatchEvent: jest.fn(),
		})),
	});
}
