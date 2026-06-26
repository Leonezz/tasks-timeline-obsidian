import { UserConfig, defineConfig, type Plugin } from "vite";
import path from "path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const builtins = [
	...new Set(
		builtinModules.flatMap((name) =>
			name.startsWith("node:") ? [name] : [name, `node:${name}`],
		),
	),
];

function replaceOnce(code: string, from: string, to: string): string {
	const firstIndex = code.indexOf(from);
	if (firstIndex === -1) {
		throw new Error(
			`@tasks-timeline/components patch target not found: ${from}`,
		);
	}
	if (code.indexOf(from, firstIndex + from.length) !== -1) {
		throw new Error(
			`@tasks-timeline/components patch target is ambiguous: ${from}`,
		);
	}
	return code.replace(from, to);
}

function patchTasksTimelineComponentsForObsidian(): Plugin {
	return {
		name: "patch-tasks-timeline-components-for-obsidian",
		enforce: "pre",
		transform(code, id) {
			const normalizedId = id.replace(/\\/g, "/");
			if (
				!normalizedId.includes(
					"@tasks-timeline/components/dist/index.js",
				)
			) {
				return null;
			}

			const patched = replaceOnce(
				code,
				"onAICommand: BI,",
				`onAICommand: async ($) => {
            await Wt($, { sessionId: null });
          },`,
			);
			return { code: patched, map: null };
		},
	};
}

export default defineConfig(async ({ mode }) => {
	const { resolve } = path;
	const prod = mode === "production";

	return {
		plugins: [patchTasksTimelineComponentsForObsidian()],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		build: {
			lib: {
				entry: resolve(__dirname, "src/main.ts"),
				name: "main",
				fileName: () => "main.js",
				formats: ["cjs"],
			},
			minify: prod,
			sourcemap: prod ? false : "inline",
			cssCodeSplit: false,
			emptyOutDir: prod,
			outDir: prod
				? "./dist"
				: "ExampleVault/.obsidian/plugins/tasks-timeline/",
			rollupOptions: {
				input: {
					main: resolve(__dirname, "src/main.ts"),
				},
				output: {
					entryFileNames: "main.js",
					assetFileNames: "styles.css",
					inlineDynamicImports: true,
				},
				external: [
					"obsidian",
					"electron",
					"@codemirror/autocomplete",
					"@codemirror/collab",
					"@codemirror/commands",
					"@codemirror/language",
					"@codemirror/lint",
					"@codemirror/search",
					"@codemirror/state",
					"@codemirror/view",
					"@lezer/common",
					"@lezer/highlight",
					"@lezer/lr",
					...builtins,
				],
			},
		},
	} as UserConfig;
});
