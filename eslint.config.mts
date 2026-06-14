import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	{
		// Jest and Node globals for test files
		files: ['tests/**/*.ts', 'tests/**/*.tsx'],
		languageOptions: {
			globals: {
				...globals.jest,
				...globals.node,
			},
		},
		rules: {
			// Relax rules for test files
			'no-console': 'off', // Console is useful for test debugging
			'import/no-nodejs-modules': 'off', // Test files can use Node modules (fs, path, etc.)
			'obsidianmd/hardcoded-config-path': 'off', // Test utilities don't need Vault#configDir
			'@typescript-eslint/no-unsafe-assignment': 'off', // Test mocks may have any types
			'@typescript-eslint/no-unsafe-member-access': 'off', // Test mocks may have any types
			'@typescript-eslint/no-explicit-any': 'off', // Test helpers may use any for flexibility
			'@typescript-eslint/restrict-template-expressions': 'off', // Test error messages can be flexible
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Node.js globals for MCP server files — must come AFTER obsidianmd.configs.recommended
		// to override the import/no-nodejs-modules rule for files that use Node.js built-ins
		files: ['src/mcp*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'import/no-nodejs-modules': 'off',
		},
	},
	globalIgnores([
		".agents/**",
		".claude/**",
		".codex/**",
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"ExampleVault/**",
		"obsidian-plugin-dev-skill/**",
		"package.json",
		"vite.config.ts",
		"tests/**",
		"jest.config.cjs"
	]),
);
