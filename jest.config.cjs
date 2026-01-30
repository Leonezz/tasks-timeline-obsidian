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
				jsx: 'react',
				esModuleInterop: true,
				allowSyntheticDefaultImports: true,
			}
		}]
	},
	moduleNameMapper: {
		'obsidian': '<rootDir>/tests/mocks/obsidian.ts',
		'\\.css$': '<rootDir>/tests/mocks/styleMock.ts',
	},
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
