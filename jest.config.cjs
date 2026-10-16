module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	roots: ['<rootDir>/src', '<rootDir>/tests'],
	testMatch: [
		'**/__tests__/**/*.+(ts|tsx|js)',
		'**/?(*.)+(spec|test).+(ts|tsx|js)'
	],
	transform: {
		'^.+\\.(ts|tsx)$': ['ts-jest', {
			tsconfig: {
				// Match the app build: src .tsx files rely on the automatic runtime.
				jsx: 'react-jsx',
				esModuleInterop: true,
				allowSyntheticDefaultImports: true,
			}
		}]
	},
	moduleNameMapper: {
		// Anchored so ./obsidianAdapter and ./obsidianDom resolve to their sources.
		'^obsidian$': '<rootDir>/tests/mocks/obsidian.ts',
		'\\.css(\\?inline)?$': '<rootDir>/tests/mocks/styleMock.ts',
	},
	setupFiles: ['<rootDir>/tests/polyfills.ts'],
	setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
	collectCoverageFrom: [
		'src/**/*.{ts,tsx}',
		'!src/**/*.d.ts',
		'!src/main.ts',
	],
	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'html'],
	testTimeout: 10000,
	verbose: true,
};
