import type { AppSettings } from "@tasks-timeline/components";
import { App } from "../mocks/obsidian";
import {
	resolveSecrets,
	extractAndStoreSecrets,
	migrateExistingKeysToSecretStorage,
	emitSecretSelectors,
	defaultSecretSelectors,
	normalizeSecretSelectors,
	secretIdFromSelector,
	secretSelectorKey,
	writeSecret,
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
	tokenUsageByModel: {},
	defaultCategory: "",
	filters: {
		tags: { include: [], exclude: [] },
		categories: { include: [], exclude: [] },
		priorities: { include: [], exclude: [] },
		statuses: { include: [], exclude: [] },
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

describe("secret selectors", () => {
	it("emits selectors for API key fields", () => {
		const selectors = emitSecretSelectors(defaultAppSetting).map((selector) =>
			selector.path.join(".")
		);

		expect(selectors).toEqual([
			"aiConfig.providers.gemini.apiKey",
			"aiConfig.providers.anthropic.apiKey",
			"aiConfig.providers.openai.apiKey",
			"aiConfig.providers.openai-compatible.apiKey",
			"voiceConfig.providers.openai.apiKey",
			"voiceConfig.providers.gemini.apiKey",
		]);
	});

	it("derives SecretStorage IDs from selectors", () => {
		const [selector] = emitSecretSelectors(defaultAppSetting);

		expect(secretIdFromSelector(selector)).toBe(
			"tasks-timeline-secret-ai-config-providers-gemini-api-key"
		);
	});

	it("keeps generated SecretStorage IDs valid for Obsidian", () => {
		const ids = emitSecretSelectors(defaultAppSetting).map((selector) =>
			secretIdFromSelector(selector)
		);

		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9-]+$/);
			expect(id.length).toBeLessThanOrEqual(64);
		}

		const openAiCompatibleId = secretIdFromSelector({
			path: ["aiConfig", "providers", "openai-compatible", "apiKey"],
		});
		expect(openAiCompatibleId).not.toBe(
			"tasks-timeline-secret-ai-config-providers-openai-compatible-api-key"
		);
	});
});

describe("extractAndStoreSecrets + resolveSecrets round-trip", () => {
	it("extracts keys to SecretStorage and resolves them back", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();
		const selectors = defaultSecretSelectors(settings);
		const selectorByPath = Object.fromEntries(
			emitSecretSelectors(settings).map((selector) => [
				secretSelectorKey(selector),
				secretIdFromSelector(selector),
			])
		);

		const cleaned = extractAndStoreSecrets(app as never, settings, selectors);
		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe(
			selectorByPath["aiConfig.providers.gemini.apiKey"]
		);
		expect(cleaned.aiConfig.providers.anthropic.apiKey).toBe(
			selectorByPath["aiConfig.providers.anthropic.apiKey"]
		);
		expect(cleaned.aiConfig.providers["openai-compatible"].apiKey).toBe(
			selectorByPath["aiConfig.providers.openai-compatible.apiKey"]
		);
		expect(cleaned.voiceConfig.providers.openai.apiKey).toBe(
			selectorByPath["voiceConfig.providers.openai.apiKey"]
		);
		expect(cleaned.voiceConfig.providers.gemini.apiKey).toBe(
			selectorByPath["voiceConfig.providers.gemini.apiKey"]
		);
		expect(cleaned.aiConfig.providers.openai.apiKey).toBe(
			selectorByPath["aiConfig.providers.openai.apiKey"]
		);

		// Non-key fields preserved
		expect(
			cleaned.aiConfig.providers["openai-compatible"].baseUrl
		).toBe("https://custom.api");

		const resolved = resolveSecrets(app as never, cleaned, selectors);
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

		const selectors = defaultSecretSelectors(settings);
		const cleaned = extractAndStoreSecrets(app as never, settings, selectors);
		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe(
			selectors["aiConfig.providers.gemini.apiKey"]
		);

		const resolved = resolveSecrets(app as never, cleaned, selectors);
		expect(resolved.aiConfig.providers.gemini.apiKey).toBe("only-gemini");
		expect(resolved.aiConfig.providers.anthropic.apiKey).toBe("");
	});

	it("overwrites stored secrets with blanks when keys are cleared", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();
		const [selector] = emitSecretSelectors(settings);
		const selectors = defaultSecretSelectors(settings);

		writeSecret(app as never, selector, "stored-before-clear");

		const cleared = {
			...settings,
			aiConfig: {
				...settings.aiConfig,
				providers: {
					...settings.aiConfig.providers,
					gemini: {
						...settings.aiConfig.providers.gemini,
						apiKey: "",
					},
				},
			},
		};

		extractAndStoreSecrets(app as never, cleared, selectors);
		expect(app.secretStorage.getSecret(secretIdFromSelector(selector))).toBe("");
	});

	it("stores keys under host-selected secret names", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();
		const selectors = {
			...defaultSecretSelectors(settings),
			"aiConfig.providers.gemini.apiKey": "shared-gemini-key",
		};

		const cleaned = extractAndStoreSecrets(app as never, settings, selectors);

		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe("shared-gemini-key");
		expect(app.secretStorage.getSecret("shared-gemini-key")).toBe(
			"gemini-secret"
		);
		expect(
			resolveSecrets(app as never, cleaned, selectors).aiConfig.providers.gemini
				.apiKey
		).toBe("gemini-secret");
	});

	it("normalizes selectors from saved settings fields", () => {
		const app = makeApp();
		app.secretStorage.setSecret("shared-openai-key", "openai-secret");
		const settings: AppSettings = {
			...defaultAppSetting,
			aiConfig: {
				...defaultAppSetting.aiConfig,
				providers: {
					...defaultAppSetting.aiConfig.providers,
					openai: {
						...defaultAppSetting.aiConfig.providers.openai,
						apiKey: "shared-openai-key",
					},
				},
			},
		};

		const selectors = normalizeSecretSelectors(app as never, settings);

		expect(selectors["aiConfig.providers.openai.apiKey"]).toBe(
			"shared-openai-key"
		);
		expect(
			resolveSecrets(app as never, settings, selectors).aiConfig.providers.openai
				.apiKey
		).toBe("openai-secret");
	});

	it("normalizes invalid saved selector names back to generated IDs", () => {
		const app = makeApp();
		const selectors = normalizeSecretSelectors(app as never, defaultAppSetting, {
			"aiConfig.providers.openai-compatible.apiKey":
				"tasks-timeline-secret-ai-config-providers-openai-compatible-api-key",
		});
		const generated = secretIdFromSelector({
			path: ["aiConfig", "providers", "openai-compatible", "apiKey"],
		});

		expect(selectors["aiConfig.providers.openai-compatible.apiKey"]).toBe(
			generated
		);
		expect(generated.length).toBeLessThanOrEqual(64);
	});
});

describe("migrateExistingKeysToSecretStorage", () => {
	it("is equivalent to extractAndStoreSecrets", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();
		const selectors = defaultSecretSelectors(settings);

		const result = migrateExistingKeysToSecretStorage(
			app as never,
			settings,
			selectors
		);
		expect(result.aiConfig.providers.gemini.apiKey).toBe(
			selectors["aiConfig.providers.gemini.apiKey"]
		);

		expect(
			app.secretStorage.getSecret(
				"tasks-timeline-secret-ai-config-providers-gemini-api-key"
			)
		).toBe(
			"gemini-secret"
		);
	});

	it("migrates legacy pattern IDs into selector IDs", () => {
		const app = makeApp();
		app.secretStorage.setSecret(
			"tasks-timeline-ai-openai-compatible-apikey",
			"legacy-compatible-secret"
		);
		const selector = {
			path: ["aiConfig", "providers", "openai-compatible", "apiKey"],
		};
		const generatedId = secretIdFromSelector(selector);

		const result = migrateExistingKeysToSecretStorage(
			app as never,
			defaultAppSetting,
			defaultSecretSelectors(defaultAppSetting)
		);

		expect(result.aiConfig.providers["openai-compatible"].apiKey).toBe(
			generatedId
		);
		expect(app.secretStorage.getSecret(generatedId)).toBe(
			"legacy-compatible-secret"
		);
	});

	it("does not clear migrated secrets when plaintext keys are missing", () => {
		const app = makeApp();
		app.secretStorage.setSecret(
			"tasks-timeline-voice-openai-apikey",
			"legacy-voice-secret"
		);

		migrateExistingKeysToSecretStorage(
			app as never,
			defaultAppSetting,
			defaultSecretSelectors(defaultAppSetting)
		);

		expect(
			app.secretStorage.getSecret(
				"tasks-timeline-secret-voice-config-providers-openai-api-key"
			)
		).toBe("legacy-voice-secret");
	});

	it("does not restore legacy secrets over an intentionally cleared selector", () => {
		const app = makeApp();
		app.secretStorage.setSecret(
			"tasks-timeline-ai-gemini-apikey",
			"legacy-gemini-secret"
		);
		app.secretStorage.setSecret(
			"tasks-timeline-secret-ai-config-providers-gemini-api-key",
			""
		);

		migrateExistingKeysToSecretStorage(
			app as never,
			defaultAppSetting,
			defaultSecretSelectors(defaultAppSetting)
		);

		expect(
			app.secretStorage.getSecret(
				"tasks-timeline-secret-ai-config-providers-gemini-api-key"
			)
		).toBe("");
	});
});
