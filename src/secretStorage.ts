import type { AppSettings } from "@tasks-timeline/components";
import type { App } from "obsidian";

export interface SecretSelector {
	readonly path: readonly string[];
}

export type SecretSelectorMap = Record<string, string>;

const SECRET_ID_MAX_LENGTH = 64;
const SECRET_ID_PATTERN = /^[a-z0-9-]+$/;

export const MCP_AUTH_TOKEN_SECRET_ID = "tasks-timeline-mcp-auth-token";

export function secretSelectorKey(selector: SecretSelector): string {
	return selector.path.join(".");
}

export function readSecretById(app: App, secretId: string): string | null {
	return isValidSecretId(secretId) ? app.secretStorage.getSecret(secretId) : null;
}

export function writeSecretById(
	app: App,
	secretId: string,
	secret: string,
): void {
	if (isValidSecretId(secretId)) {
		app.secretStorage.setSecret(secretId, secret);
	}
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
): string | null {
	const selected = secretSelectors[secretSelectorKey(selector)];
	return selected && isValidSecretId(selected) ? selected : null;
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
		if (isValidSecretId(value)) {
			normalized[key] = value;
		}
	}

	return normalized;
}

export function normalizeSecretSelectors(
	app: App,
	settings: AppSettings,
	secretSelectors?: SecretSelectorMap,
): SecretSelectorMap {
	return {
		...extractSelectorsFromSettings(app, settings),
		...normalizeSavedSecretSelectors(settings, secretSelectors),
	};
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
		const secretName = getSelectedSecretName(selector, secretSelectors);
		if (secretName && (key || clearMissingSecrets)) {
			writeSelectedSecret(app, selector, secretSelectors, key);
		}
		result = writeSettingValue(
			result,
			selector,
			secretName ?? "",
		);
	}

	return result;
}
