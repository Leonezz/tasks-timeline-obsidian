import type { AppSettings } from "@tasks-timeline/components";
import { App } from "../mocks/obsidian";
import {
	resolveSecrets,
	extractAndStoreSecrets,
	emitSecretSelectors,
	normalizeSecretSelectors,
	secretSelectorKey,
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
	defaultFocusMode: false,
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

const selectedSecrets = {
	"aiConfig.providers.gemini.apiKey": "selected-gemini-key",
	"aiConfig.providers.anthropic.apiKey": "selected-anthropic-key",
	"aiConfig.providers.openai.apiKey": "selected-openai-key",
	"aiConfig.providers.openai-compatible.apiKey": "selected-compatible-key",
	"voiceConfig.providers.openai.apiKey": "selected-voice-openai-key",
	"voiceConfig.providers.gemini.apiKey": "selected-voice-gemini-key",
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

	it("does not create default SecretStorage IDs for emitted selectors", () => {
		const app = makeApp();
		const selectors = normalizeSecretSelectors(app as never, defaultAppSetting);

		expect(selectors).toEqual({});
		expect(app.secretStorage.listSecrets()).toEqual([]);
	});
});

describe("extractAndStoreSecrets + resolveSecrets round-trip", () => {
	it("stores keys only under host-selected secret names", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();

		const cleaned = extractAndStoreSecrets(
			app as never,
			settings,
			selectedSecrets
		);

		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe(
			selectedSecrets["aiConfig.providers.gemini.apiKey"]
		);
		expect(cleaned.aiConfig.providers.anthropic.apiKey).toBe(
			selectedSecrets["aiConfig.providers.anthropic.apiKey"]
		);
		expect(cleaned.aiConfig.providers["openai-compatible"].apiKey).toBe(
			selectedSecrets["aiConfig.providers.openai-compatible.apiKey"]
		);
		expect(cleaned.voiceConfig.providers.openai.apiKey).toBe(
			selectedSecrets["voiceConfig.providers.openai.apiKey"]
		);
		expect(cleaned.voiceConfig.providers.gemini.apiKey).toBe(
			selectedSecrets["voiceConfig.providers.gemini.apiKey"]
		);
		expect(cleaned.aiConfig.providers.openai.apiKey).toBe(
			selectedSecrets["aiConfig.providers.openai.apiKey"]
		);

		expect(
			cleaned.aiConfig.providers["openai-compatible"].baseUrl
		).toBe("https://custom.api");

		expect(
			app.secretStorage.getSecret(
				selectedSecrets["aiConfig.providers.gemini.apiKey"]
			)
		).toBe("gemini-secret");
		expect(
			app.secretStorage.getSecret(
				selectedSecrets["aiConfig.providers.openai.apiKey"]
			)
		).toBe("");

		const resolved = resolveSecrets(app as never, cleaned, selectedSecrets);
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

	it("does not write secrets when no selector was selected", () => {
		const app = makeApp();
		const settings = makeSettingsWithKeys();

		const cleaned = extractAndStoreSecrets(app as never, settings, {});

		expect(cleaned.aiConfig.providers.gemini.apiKey).toBe("");
		expect(cleaned.aiConfig.providers.anthropic.apiKey).toBe("");
		expect(cleaned.aiConfig.providers["openai-compatible"].apiKey).toBe("");
		expect(cleaned.voiceConfig.providers.openai.apiKey).toBe("");
		expect(cleaned.voiceConfig.providers.gemini.apiKey).toBe("");
		expect(app.secretStorage.listSecrets()).toEqual([]);
	});

	it("overwrites stored secrets with blanks when selected keys are cleared", () => {
		const app = makeApp();
		app.secretStorage.setSecret("selected-gemini-key", "stored-before-clear");
		const settings = makeSettingsWithKeys();
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

		extractAndStoreSecrets(app as never, cleared, {
			"aiConfig.providers.gemini.apiKey": "selected-gemini-key",
		});

		expect(app.secretStorage.getSecret("selected-gemini-key")).toBe("");
	});

	it("resolves missing selectors to blank runtime keys", () => {
		const app = makeApp();
		app.secretStorage.setSecret("selected-gemini-key", "gemini-secret");

		const resolved = resolveSecrets(app as never, defaultAppSetting, {
			"aiConfig.providers.gemini.apiKey": "selected-gemini-key",
		});

		expect(resolved.aiConfig.providers.gemini.apiKey).toBe("gemini-secret");
		expect(resolved.aiConfig.providers.anthropic.apiKey).toBe("");
	});
});

describe("normalizeSecretSelectors", () => {
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

	it("keeps explicit saved selector names without generating fallbacks", () => {
		const app = makeApp();
		app.secretStorage.setSecret(
			"tasks-timeline-ai-anthropic-apikey",
			"saved-secret"
		);

		const selectors = normalizeSecretSelectors(app as never, defaultAppSetting, {
			"aiConfig.providers.anthropic.apiKey":
				"tasks-timeline-ai-anthropic-apikey",
		});

		expect(selectors).toEqual({
			"aiConfig.providers.anthropic.apiKey":
				"tasks-timeline-ai-anthropic-apikey",
		});
		expect(
			resolveSecrets(app as never, defaultAppSetting, selectors).aiConfig
				.providers.anthropic.apiKey
		).toBe("saved-secret");
	});

	it("ignores invalid saved selector names instead of generating replacements", () => {
		const app = makeApp();
		const selectors = normalizeSecretSelectors(app as never, defaultAppSetting, {
			"aiConfig.providers.openai-compatible.apiKey":
				"tasks_timeline_secret_ai_config_providers_openai_compatible_api_key",
		});

		expect(selectors).toEqual({});
	});

	it("ignores selectors for fields that are no longer emitted", () => {
		const app = makeApp();
		const selectors = normalizeSecretSelectors(app as never, defaultAppSetting, {
			"removed.provider.apiKey": "removed-provider-key",
		});

		expect(selectors).toEqual({});
	});
});

describe("secretSelectorKey", () => {
	it("uses settings paths as stable selector keys", () => {
		const [selector] = emitSecretSelectors(defaultAppSetting);

		expect(secretSelectorKey(selector)).toBe(
			"aiConfig.providers.gemini.apiKey"
		);
	});
});
