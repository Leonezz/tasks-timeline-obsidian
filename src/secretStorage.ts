import type { AppSettings } from "@tasks-timeline/components";
import type { App } from "obsidian";

export interface SecretSelector {
	readonly path: readonly string[];
}

const SECRET_ID_PREFIX = "tasks-timeline-secret";

const LEGACY_SECRET_ID_MIGRATIONS = new Map<string, string[]>([
	[
		"aiConfig.providers.gemini.apiKey",
		["tasks-timeline-ai-gemini-apikey"],
	],
	[
		"aiConfig.providers.anthropic.apiKey",
		["tasks-timeline-ai-anthropic-apikey"],
	],
	[
		"aiConfig.providers.openai.apiKey",
		["tasks-timeline-ai-openai-apikey"],
	],
	[
		"aiConfig.providers.openai-compatible.apiKey",
		["tasks-timeline-ai-openai-compatible-apikey"],
	],
	[
		"voiceConfig.providers.openai.apiKey",
		["tasks-timeline-voice-openai-apikey"],
	],
	[
		"voiceConfig.providers.gemini.apiKey",
		["tasks-timeline-voice-gemini-apikey"],
	],
]);

export const MCP_AUTH_TOKEN_SECRET_SELECTOR: SecretSelector = {
	path: ["mcpServer", "authToken"],
};

function normalizeSecretSegment(segment: string): string {
	return segment
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function secretIdFromSelector(selector: SecretSelector): string {
	const path = selector.path.map(normalizeSecretSegment).filter(Boolean);
	return [SECRET_ID_PREFIX, ...path].join("-");
}

export function readSecret(app: App, selector: SecretSelector): string | null {
	return app.secretStorage.getSecret(secretIdFromSelector(selector));
}

export function writeSecret(
	app: App,
	selector: SecretSelector,
	secret: string,
): void {
	app.secretStorage.setSecret(secretIdFromSelector(selector), secret);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value)
	);
}

function emitSecretSelectorsFromValue(
	value: unknown,
	path: readonly string[],
): SecretSelector[] {
	if (!isRecord(value)) {
		return [];
	}

	const selectors: SecretSelector[] = [];
	for (const [key, child] of Object.entries(value)) {
		const childPath = [...path, key];
		if (key === "apiKey" && typeof child === "string") {
			selectors.push({ path: childPath });
			continue;
		}
		selectors.push(...emitSecretSelectorsFromValue(child, childPath));
	}
	return selectors;
}

export function emitSecretSelectors(settings: AppSettings): SecretSelector[] {
	return emitSecretSelectorsFromValue(settings, []);
}

function readSettingValue(
	settings: AppSettings,
	selector: SecretSelector,
): string {
	let cursor: unknown = settings;
	for (const segment of selector.path) {
		if (!isRecord(cursor)) {
			return "";
		}
		cursor = cursor[segment];
	}
	return typeof cursor === "string" ? cursor : "";
}

function writeSettingValue<T>(
	value: T,
	selector: SecretSelector,
	secret: string,
): T {
	const writeAtPath = (cursor: unknown, index: number): unknown => {
		if (index === selector.path.length) {
			return secret;
		}

		if (!isRecord(cursor)) {
			return cursor;
		}

		const segment = selector.path[index];
		return {
			...cursor,
			[segment]: writeAtPath(cursor[segment], index + 1),
		};
	};

	return writeAtPath(value, 0) as T;
}

function legacySecretIds(selector: SecretSelector): string[] {
	return LEGACY_SECRET_ID_MIGRATIONS.get(selector.path.join(".")) ?? [];
}

function migrateLegacySecrets(app: App, settings: AppSettings): void {
	for (const selector of emitSecretSelectors(settings)) {
		if (readSecret(app, selector) !== null) {
			continue;
		}

		for (const legacyId of legacySecretIds(selector)) {
			const legacySecret = app.secretStorage.getSecret(legacyId);
			if (legacySecret) {
				writeSecret(app, selector, legacySecret);
				break;
			}
		}
	}
}

/**
 * Reads API keys from SecretStorage and populates them into a new settings object.
 */
export function resolveSecrets(app: App, settings: AppSettings): AppSettings {
	let result = { ...settings };

	for (const selector of emitSecretSelectors(settings)) {
		const secret = readSecret(app, selector);
		if (secret) {
			result = writeSettingValue(result, selector, secret);
		}
	}

	return result;
}

/**
 * Extracts API keys from settings, stores them in SecretStorage, and returns
 * settings with those key fields cleared to "".
 */
export function extractAndStoreSecrets(
	app: App,
	settings: AppSettings,
	options: { clearMissingSecrets?: boolean } = {},
): AppSettings {
	const { clearMissingSecrets = true } = options;
	let result = { ...settings };

	for (const selector of emitSecretSelectors(settings)) {
		const key = readSettingValue(settings, selector);
		if (key || clearMissingSecrets) {
			writeSecret(app, selector, key);
		}
		result = writeSettingValue(result, selector, "");
	}

	return result;
}

/**
 * One-time migration: if plaintext API keys or legacy provider-pattern secret
 * IDs exist, move them to selector-derived SecretStorage entries.
 */
export function migrateExistingKeysToSecretStorage(
	app: App,
	settings: AppSettings,
): AppSettings {
	migrateLegacySecrets(app, settings);
	return extractAndStoreSecrets(app, settings, {
		clearMissingSecrets: false,
	});
}
