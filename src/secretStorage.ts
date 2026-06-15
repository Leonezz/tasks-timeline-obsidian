import type { AppSettings } from "@tasks-timeline/components";
import type { App } from "obsidian";

export interface SecretSelector {
	readonly path: readonly string[];
}

export type SecretSelectorMap = Record<string, string>;

const SECRET_ID_PREFIX = "tasks-timeline-secret";
const SECRET_ID_MAX_LENGTH = 64;
const SECRET_ID_HASH_LENGTH = 8;
const SECRET_ID_PATTERN = /^[a-z0-9-]+$/;

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

export function secretSelectorKey(selector: SecretSelector): string {
	return selector.path.join(".");
}

function secretSelectorHash(selector: SecretSelector): string {
	let hash = 0x811c9dc5;
	for (const char of secretSelectorKey(selector)) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36).padStart(SECRET_ID_HASH_LENGTH, "0");
}

export function secretIdFromSelector(selector: SecretSelector): string {
	const path = selector.path.map(normalizeSecretSegment).filter(Boolean);
	const id = [SECRET_ID_PREFIX, ...path].join("-");
	if (isValidSecretId(id)) {
		return id;
	}

	const hash = secretSelectorHash(selector).slice(
		0,
		SECRET_ID_HASH_LENGTH,
	);
	const prefixLength = SECRET_ID_MAX_LENGTH - hash.length - 1;
	const truncatedPrefix = id
		.slice(0, prefixLength)
		.replace(/-+$/g, "");
	return `${truncatedPrefix}-${hash}`;
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

export function readSelectedSecret(
	app: App,
	selector: SecretSelector,
	secretSelectors: SecretSelectorMap,
): string | null {
	const secretName = getSelectedSecretName(selector, secretSelectors);
	if (!secretName) {
		return null;
	}
	return app.secretStorage.getSecret(secretName);
}

function writeSelectedSecret(
	app: App,
	selector: SecretSelector,
	secretSelectors: SecretSelectorMap,
	secret: string,
): void {
	const secretName = getSelectedSecretName(selector, secretSelectors);
	if (secretName) {
		app.secretStorage.setSecret(secretName, secret);
	}
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

export function defaultSecretSelectors(
	settings: AppSettings,
): SecretSelectorMap {
	return Object.fromEntries(
		emitSecretSelectors(settings).map((selector) => [
			secretSelectorKey(selector),
			secretIdFromSelector(selector),
		]),
	);
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
	return LEGACY_SECRET_ID_MIGRATIONS.get(secretSelectorKey(selector)) ?? [];
}

function isValidSecretId(id: string): boolean {
	return (
		id.length > 0 &&
		id.length <= SECRET_ID_MAX_LENGTH &&
		SECRET_ID_PATTERN.test(id)
	);
}

function getSelectedSecretName(
	selector: SecretSelector,
	secretSelectors: SecretSelectorMap,
): string {
	const selected =
		secretSelectors[secretSelectorKey(selector)] ??
		secretIdFromSelector(selector);
	return isValidSecretId(selected) ? selected : secretIdFromSelector(selector);
}

function extractSelectorsFromSettings(
	app: App,
	settings: AppSettings,
): SecretSelectorMap {
	const selectors: SecretSelectorMap = {};

	for (const selector of emitSecretSelectors(settings)) {
		const value = readSettingValue(settings, selector);
		if (
			value &&
			isValidSecretId(value) &&
			app.secretStorage.getSecret(value) !== null
		) {
			selectors[secretSelectorKey(selector)] = value;
		}
	}

	return selectors;
}

function normalizeSavedSecretSelectors(
	settings: AppSettings,
	secretSelectors?: SecretSelectorMap,
): SecretSelectorMap {
	const selectorsByKey = new Map(
		emitSecretSelectors(settings).map((selector) => [
			secretSelectorKey(selector),
			selector,
		]),
	);
	const normalized: SecretSelectorMap = {};

	for (const [key, value] of Object.entries(secretSelectors ?? {})) {
		const selector = selectorsByKey.get(key);
		if (!selector || !value) {
			continue;
		}
		normalized[key] = isValidSecretId(value)
			? value
			: secretIdFromSelector(selector);
	}

	return normalized;
}

export function normalizeSecretSelectors(
	app: App,
	settings: AppSettings,
	secretSelectors?: SecretSelectorMap,
): SecretSelectorMap {
	return {
		...defaultSecretSelectors(settings),
		...extractSelectorsFromSettings(app, settings),
		...normalizeSavedSecretSelectors(settings, secretSelectors),
	};
}

function migrateLegacySecrets(
	app: App,
	settings: AppSettings,
	secretSelectors: SecretSelectorMap,
): void {
	for (const selector of emitSecretSelectors(settings)) {
		if (readSelectedSecret(app, selector, secretSelectors) !== null) {
			continue;
		}

		for (const legacyId of legacySecretIds(selector)) {
			const legacySecret = app.secretStorage.getSecret(legacyId);
			if (legacySecret) {
				writeSelectedSecret(app, selector, secretSelectors, legacySecret);
				break;
			}
		}
	}
}

/**
 * Reads provider secrets from Obsidian SecretStorage and populates them into a
 * new settings object for in-memory runtime use.
 */
export function resolveSecrets(
	app: App,
	settings: AppSettings,
	secretSelectors: SecretSelectorMap,
): AppSettings {
	let result = { ...settings };

	for (const selector of emitSecretSelectors(settings)) {
		const secret = readSelectedSecret(app, selector, secretSelectors);
		if (secret) {
			result = writeSettingValue(result, selector, secret);
		} else {
			result = writeSettingValue(result, selector, "");
		}
	}

	return result;
}

/**
 * Extracts runtime API keys from settings, stores them in the selected
 * SecretStorage entries, and returns settings that persist selector names.
 */
export function extractAndStoreSecrets(
	app: App,
	settings: AppSettings,
	secretSelectors: SecretSelectorMap,
	options: { clearMissingSecrets?: boolean } = {},
): AppSettings {
	const { clearMissingSecrets = true } = options;
	let result = { ...settings };

	for (const selector of emitSecretSelectors(settings)) {
		const key = readSettingValue(settings, selector);
		if (key || clearMissingSecrets) {
			writeSelectedSecret(app, selector, secretSelectors, key);
		}
		result = writeSettingValue(
			result,
			selector,
			getSelectedSecretName(selector, secretSelectors),
		);
	}

	return result;
}

/**
 * One-time migration: if plaintext API keys or legacy provider-pattern secret
 * IDs exist, move them to the selected SecretStorage entries.
 */
export function migrateExistingKeysToSecretStorage(
	app: App,
	settings: AppSettings,
	secretSelectors: SecretSelectorMap,
): AppSettings {
	migrateLegacySecrets(app, settings, secretSelectors);
	return extractAndStoreSecrets(app, settings, secretSelectors, {
		clearMissingSecrets: false,
	});
}
