import type {
	AIProvider,
	AppSettings,
	FilterRule,
} from "@tasks-timeline/components";

/**
 * Checks if a value is a plain object (not null, not array, not Date, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/**
 * Recursively deep-merges `saved` into `defaults`.
 * - Plain objects are merged recursively (saved values override defaults, missing keys filled from defaults)
 * - Arrays and primitives from `saved` override `defaults` entirely
 * - Keys present in `saved` but not in `defaults` are preserved
 */
export function deepMergeSettings<T>(defaults: T, saved: Partial<T>): T {
	if (!isPlainObject(defaults) || !isPlainObject(saved)) {
		return (saved ?? defaults) as T;
	}

	const result: Record<string, unknown> = {};

	// Start with all keys from defaults
	for (const key of Object.keys(defaults)) {
		const defaultVal: unknown = (defaults as Record<string, unknown>)[key];
		const savedVal: unknown = (saved as Record<string, unknown>)[key];

		if (savedVal === undefined) {
			result[key] = defaultVal;
		} else if (isPlainObject(defaultVal) && isPlainObject(savedVal)) {
			result[key] = deepMergeSettings(defaultVal, savedVal);
		} else {
			result[key] = savedVal;
		}
	}

	// Preserve keys that exist in saved but not in defaults
	for (const key of Object.keys(saved)) {
		if (!(key in defaults)) {
			result[key] = (saved as Record<string, unknown>)[key];
		}
	}

	return result as T;
}

/**
 * Shape of v1 settings that had flat voice fields instead of voiceConfig.
 */
interface V1AppSettings {
	enableVoiceInput?: boolean;
	voiceProvider?: string;
}

/**
 * Migrates v1 flat voice fields to the v2 voiceConfig structure.
 * Also ensures the "openai-compatible" AI provider exists.
 * Removes stale flat fields after migration.
 */
export function migrateV1ToV2(appSetting: AppSettings): AppSettings {
	const raw = appSetting as AppSettings & V1AppSettings;
	let result = { ...raw };

	// Migrate flat voice fields → voiceConfig
	if (
		("enableVoiceInput" in raw || "voiceProvider" in raw) &&
		!("voiceConfig" in raw && raw.voiceConfig)
	) {
		result = {
			...result,
			voiceConfig: {
				enabled: raw.enableVoiceInput ?? true,
				activeProvider:
					(raw.voiceProvider as "browser" | "openai" | "gemini") ??
					"browser",
				language: "en-US",
				providers: {
					browser: {},
					openai: { apiKey: "", baseUrl: "", model: "" },
					gemini: { apiKey: "", model: "" },
				},
			},
		};
	}

	// Remove stale flat fields
	const cleaned = result as Record<string, unknown>;
	delete cleaned["enableVoiceInput"];
	delete cleaned["voiceProvider"];

	// Ensure "openai-compatible" provider exists in aiConfig
	if (result.aiConfig?.providers) {
		const compatKey: AIProvider = "openai-compatible";
		if (!(compatKey in result.aiConfig.providers)) {
			const updatedProviders = Object.assign(
				{},
				result.aiConfig.providers,
				{ [compatKey]: { apiKey: "", baseUrl: "", model: "" } },
			) as AppSettings["aiConfig"]["providers"];
			result = {
				...result,
				aiConfig: {
					...result.aiConfig,
					providers: updatedProviders,
				},
			};
		}
	}

	return result;
}

/**
 * Converts old flat-array filter fields (string[]) to the new FilterRule shape
 * ({ include, exclude }). Idempotent — already-migrated settings pass through unchanged.
 */
export function migrateFiltersToFilterRule(
	appSetting: AppSettings,
): AppSettings {
	const filters = appSetting.filters;
	if (!filters) return appSetting;

	const toRule = <T>(value: unknown): FilterRule<T> | undefined => {
		if (Array.isArray(value)) {
			return { include: value as T[], exclude: [] };
		}
		return undefined;
	};

	const tags = toRule<string>(filters.tags);
	const categories = toRule<string>(filters.categories);
	const priorities = toRule(filters.priorities);
	const statuses = toRule(filters.statuses);

	if (!tags && !categories && !priorities && !statuses) {
		return appSetting;
	}

	return {
		...appSetting,
		filters: {
			...filters,
			...(tags && { tags }),
			...(categories && { categories }),
			...(priorities && { priorities }),
			...(statuses && { statuses }),
		},
	};
}

/**
 * Orchestrates settings migration: run shape migrations first (so flat fields
 * get converted to their structured equivalents), then deep-merge with defaults
 * to fill any missing keys. Idempotent — safe to call on already-migrated settings.
 */
export function migrateSettings(
	raw: Partial<AppSettings> | undefined,
	defaults: AppSettings,
): AppSettings {
	if (!raw) {
		return { ...defaults };
	}

	// Migrate shape first so flat fields become structured before merging
	let migrated = migrateV1ToV2(raw as AppSettings);
	migrated = migrateFiltersToFilterRule(migrated);
	return deepMergeSettings(defaults, migrated as Partial<AppSettings>);
}
