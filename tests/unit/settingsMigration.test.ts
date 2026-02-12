import type { AppSettings } from "@tasks-timeline/components";
import {
	deepMergeSettings,
	migrateV1ToV2,
	migrateSettings,
} from "../../src/settingsMigration";

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

describe("deepMergeSettings", () => {
	it("returns defaults when saved is empty", () => {
		const result = deepMergeSettings(defaultAppSetting, {});
		expect(result).toEqual(defaultAppSetting);
	});

	it("overrides top-level primitives from saved", () => {
		const result = deepMergeSettings(defaultAppSetting, {
			theme: "dark",
			fontSize: "lg",
		});
		expect(result.theme).toBe("dark");
		expect(result.fontSize).toBe("lg");
		expect(result.showCompleted).toBe(true);
	});

	it("deep-merges nested objects", () => {
		const result = deepMergeSettings(defaultAppSetting, {
			aiConfig: {
				enabled: false,
				defaultMode: true,
				activeProvider: "openai",
				providers: {
					gemini: { apiKey: "my-key", baseUrl: "", model: "" },
					anthropic: { apiKey: "", baseUrl: "", model: "" },
					openai: { apiKey: "", baseUrl: "", model: "" },
					"openai-compatible": { apiKey: "", baseUrl: "", model: "" },
				},
			},
		});
		expect(result.aiConfig.enabled).toBe(false);
		expect(result.aiConfig.activeProvider).toBe("openai");
		expect(result.aiConfig.providers.gemini.apiKey).toBe("my-key");
		expect(result.voiceConfig).toEqual(defaultAppSetting.voiceConfig);
	});

	it("preserves saved keys not present in defaults", () => {
		const result = deepMergeSettings(
			{ a: 1 } as unknown as AppSettings,
			{ a: 2, b: 3 } as unknown as Partial<AppSettings>
		);
		expect((result as unknown as Record<string, number>)["b"]).toBe(3);
	});

	it("handles arrays by replacing entirely", () => {
		const result = deepMergeSettings(defaultAppSetting, {
			groupingStrategy: ["createdAt"],
		});
		expect(result.groupingStrategy).toEqual(["createdAt"]);
	});
});

describe("migrateV1ToV2", () => {
	it("converts flat voice fields to voiceConfig", () => {
		const v1Settings = {
			...defaultAppSetting,
			voiceConfig: undefined,
		} as unknown as AppSettings;
		const raw = v1Settings as AppSettings & {
			enableVoiceInput: boolean;
			voiceProvider: string;
		};
		raw.enableVoiceInput = false;
		raw.voiceProvider = "openai";

		const result = migrateV1ToV2(raw);

		expect(result.voiceConfig).toBeDefined();
		expect(result.voiceConfig.enabled).toBe(false);
		expect(result.voiceConfig.activeProvider).toBe("openai");
		expect("enableVoiceInput" in result).toBe(false);
		expect("voiceProvider" in result).toBe(false);
	});

	it("does not overwrite existing voiceConfig", () => {
		const settings = { ...defaultAppSetting };
		const result = migrateV1ToV2(settings);
		expect(result.voiceConfig).toEqual(defaultAppSetting.voiceConfig);
	});

	it("adds openai-compatible provider if missing", () => {
		const settings = { ...defaultAppSetting };
		const providers = { ...settings.aiConfig.providers } as Record<
			string,
			unknown
		>;
		delete providers["openai-compatible"];
		const withoutCompat = {
			...settings,
			aiConfig: {
				...settings.aiConfig,
				providers: providers as AppSettings["aiConfig"]["providers"],
			},
		};

		const result = migrateV1ToV2(withoutCompat);
		expect(result.aiConfig.providers["openai-compatible"]).toEqual({
			apiKey: "",
			baseUrl: "",
			model: "",
		});
	});

	it("is idempotent on already-migrated settings", () => {
		const first = migrateV1ToV2(defaultAppSetting);
		const second = migrateV1ToV2(first);
		expect(second).toEqual(first);
	});
});

describe("migrateSettings", () => {
	it("returns defaults for undefined raw", () => {
		const result = migrateSettings(undefined, defaultAppSetting);
		expect(result.voiceConfig).toEqual(defaultAppSetting.voiceConfig);
		expect(result.aiConfig.providers["openai-compatible"]).toBeDefined();
	});

	it("deep-merges and migrates v1 data", () => {
		const v1Raw = {
			theme: "dark" as const,
			aiConfig: {
				enabled: true,
				defaultMode: true,
				activeProvider: "gemini" as const,
				providers: {
					gemini: { apiKey: "test-key", baseUrl: "", model: "" },
					anthropic: { apiKey: "", baseUrl: "", model: "" },
					openai: { apiKey: "", baseUrl: "", model: "" },
				},
			},
			enableVoiceInput: false,
			voiceProvider: "openai",
		};

		const result = migrateSettings(
			v1Raw as unknown as Partial<AppSettings>,
			defaultAppSetting
		);

		expect(result.theme).toBe("dark");
		expect(result.aiConfig.providers.gemini.apiKey).toBe("test-key");
		expect(result.aiConfig.providers["openai-compatible"]).toBeDefined();
		expect(result.voiceConfig.enabled).toBe(false);
		expect(result.voiceConfig.activeProvider).toBe("openai");
		expect(result.showCompleted).toBe(true);
		expect(result.fontSize).toBe("base");
	});

	it("fresh install produces valid defaults", () => {
		const result = migrateSettings({}, defaultAppSetting);
		expect(result).toEqual(
			expect.objectContaining({
				theme: "system",
				showCompleted: true,
			})
		);
		expect(result.voiceConfig).toBeDefined();
		expect(result.aiConfig.providers["openai-compatible"]).toBeDefined();
	});
});
