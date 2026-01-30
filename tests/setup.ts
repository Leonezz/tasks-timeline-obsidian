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
