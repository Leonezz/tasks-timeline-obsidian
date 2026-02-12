import type { AppSettings } from "@tasks-timeline/components";
import { App } from "../mocks/obsidian";
import {
	hasSecretStorage,
	resolveSecrets,
	extractAndStoreSecrets,
	migrateExistingKeysToSecretStorage,
} from "../../src/secretStorage";

const defaultAppSetting: AppSettings = {
	theme: "system",
	dateFormat: "MM, DD",
	showCompleted: true,
	showProgressBar: true,
	soundEnabled: true,
	fontSize: "base",
	useRelativeDates: true,
	groupingStrategy: ["dueAt"],
	aiConfig: {
		enabled: true,
		defaultMode: true,
		activeProvider: "gemini",
		systemPrompt: "",
		providers: {
			gemini: { apiKey: "", baseUrl: "", model: "" },
			anthropic: { apiKey: "", baseUrl: "", model: "" },
			openai: { apiKey: "", baseUrl: "", model: "" },
			"openai-compatible": { apiKey: "", baseUrl: "", model: "" },
		},
	},
	voiceConfig: {
		enabled: true,
		activeProvider: "browser",
		language: "en-US",
		providers: {
			browser: {},
			openai: { apiKey: "", baseUrl: "", model: "" },
			gemini: { apiKey: "", model: "" },
		},
	},
	defaultFocusMode: true,
	totalTokenUsage: 0,
	defaultCategory: "",
	filters: {
		tags: [],
		categories: [],
		priorities: [],
		statuses: [],
		enableScript: false,
		script: "",
	},
	sort: {
		script: "",
		direction: "asc",
		field: "createdAt",
	},
};

function makeApp(): App {
	return new App();
}

function makeSettingsWithKeys(): AppSettings {
	return {
		...defaultAppSetting,
		aiConfig: {
			...defaultAppSetting.aiConfig,
			providers: {
				gemini: { apiKey: "gemini-secret", baseUrl: "", model: "" },
				anthropic: { apiKey: "anthropic-secret", baseUrl: "", model: "" },
				openai: { apiKey: "", baseUrl: "", model: "" },
				"openai-compatible": {
					apiKey: "compat-secret",
					baseUrl: "https://custom.api",
					model: "gpt-4",
				},
			},
		},
		voiceConfig: {
			...defaultAppSetting.voiceConfig,
			providers: {
				browser: {},
				openai: {
					apiKey: "voice-openai-key",
					baseUrl: "https://voice.api",
					model: "whisper-1",
				},
				gemini: { apiKey: "voice-gemini-key", model: "gemini-voice" },
			},
		},
	};
}

describe("hasSecretStorage", () => {
	it("returns true when secretStorage exists with methods", () => {
		const app = makeApp();
		expect(hasSecretStorage(app as never)).toBe(true);
	});

	it("returns false when secretStorage is missing", () => {
		const app = makeApp();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
		delete (app as any).secretStorage;
		expect(hasSecretStorage(app as never)).toBe(false);
	});
});

describe("extractAndStoreSecrets + resolveSecrets round-trip", () => {
	it("extracts keys to SecretStorage and resolves them back", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();

		const cleaned = extractAndStoreSecrets(app as never, settings);
		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe("");
		expect(cleaned.aiConfig.providers.anthropic.apiKey).toBe("");
		expect(cleaned.aiConfig.providers["openai-compatible"].apiKey).toBe("");
		expect(cleaned.voiceConfig.providers.openai.apiKey).toBe("");
		expect(cleaned.voiceConfig.providers.gemini.apiKey).toBe("");
		expect(cleaned.aiConfig.providers.openai.apiKey).toBe("");

		// Non-key fields preserved
		expect(
			cleaned.aiConfig.providers["openai-compatible"].baseUrl
		).toBe("https://custom.api");

		const resolved = resolveSecrets(app as never, cleaned);
		expect(resolved.aiConfig.providers.gemini.apiKey).toBe("gemini-secret");
		expect(resolved.aiConfig.providers.anthropic.apiKey).toBe(
			"anthropic-secret"
		);
		expect(resolved.aiConfig.providers["openai-compatible"].apiKey).toBe(
			"compat-secret"
		);
		expect(resolved.voiceConfig.providers.openai.apiKey).toBe(
			"voice-openai-key"
		);
		expect(resolved.voiceConfig.providers.gemini.apiKey).toBe(
			"voice-gemini-key"
		);
		expect(resolved.aiConfig.providers.openai.apiKey).toBe("");
	});

	it("handles partial keys (only some providers have keys)", () => {
		const app = makeApp();
		const settings: AppSettings = {
			...defaultAppSetting,
			aiConfig: {
				...defaultAppSetting.aiConfig,
				providers: {
					gemini: { apiKey: "only-gemini", baseUrl: "", model: "" },
					anthropic: { apiKey: "", baseUrl: "", model: "" },
					openai: { apiKey: "", baseUrl: "", model: "" },
					"openai-compatible": { apiKey: "", baseUrl: "", model: "" },
				},
			},
		};

		const cleaned = extractAndStoreSecrets(app as never, settings);
		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe("");

		const resolved = resolveSecrets(app as never, cleaned);
		expect(resolved.aiConfig.providers.gemini.apiKey).toBe("only-gemini");
		expect(resolved.aiConfig.providers.anthropic.apiKey).toBe("");
	});
});

describe("no SecretStorage fallback", () => {
	it("returns settings unchanged when SecretStorage is missing", () => {
		const app = makeApp();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
		delete (app as any).secretStorage;
		const settings = makeSettingsWithKeys();

		const cleaned = extractAndStoreSecrets(app as never, settings);
		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe("gemini-secret");

		const resolved = resolveSecrets(app as never, settings);
		expect(resolved.aiConfig.providers.gemini.apiKey).toBe("gemini-secret");
	});
});

describe("migrateExistingKeysToSecretStorage", () => {
	it("is equivalent to extractAndStoreSecrets", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();

		const result = migrateExistingKeysToSecretStorage(
			app as never,
			settings
		);
		expect(result.aiConfig.providers.gemini.apiKey).toBe("");

		expect(app.secretStorage.getSecret("tasks-timeline-ai-gemini-apikey")).toBe(
			"gemini-secret"
		);
	});
});
