import type { AIProvider, AppSettings, VoiceProvider } from "@tasks-timeline/components";
import type { App } from "obsidian";

/**
 * Feature detection: returns true if Obsidian supports SecretStorage (>= 1.11.4).
 */
export function hasSecretStorage(app: App): boolean {
	return (
		"secretStorage" in app &&
		app.secretStorage != null &&
		typeof app.secretStorage.getSecret === "function"
	);
}

function aiSecretId(provider: AIProvider): string {
	return `tasks-timeline-ai-${provider}-apikey`;
}

function voiceSecretId(provider: VoiceProvider): string {
	return `tasks-timeline-voice-${provider}-apikey`;
}

/**
 * Reads API keys from SecretStorage and populates them into the settings object.
 * Returns a new settings object with keys filled in.
 * If SecretStorage is unavailable, returns settings as-is.
 */
export function resolveSecrets(app: App, settings: AppSettings): AppSettings {
	if (!hasSecretStorage(app)) {
		return settings;
	}

	const ss = app.secretStorage;
	let result = { ...settings };

	// Resolve AI provider keys
	if (result.aiConfig?.providers) {
		const updatedProviders = { ...result.aiConfig.providers };
		for (const provider of Object.keys(updatedProviders) as AIProvider[]) {
			const secret = ss.getSecret(aiSecretId(provider));
			if (secret) {
				updatedProviders[provider] = {
					...updatedProviders[provider],
					apiKey: secret,
				};
			}
		}
		result = {
			...result,
			aiConfig: { ...result.aiConfig, providers: updatedProviders },
		};
	}

	// Resolve voice provider keys
	if (result.voiceConfig?.providers) {
		const voiceProviders = { ...result.voiceConfig.providers };
		const openaiVoiceSecret = ss.getSecret(voiceSecretId("openai"));
		if (openaiVoiceSecret) {
			voiceProviders.openai = {
				...voiceProviders.openai,
				apiKey: openaiVoiceSecret,
			};
		}
		const geminiVoiceSecret = ss.getSecret(voiceSecretId("gemini"));
		if (geminiVoiceSecret) {
			voiceProviders.gemini = {
				...voiceProviders.gemini,
				apiKey: geminiVoiceSecret,
			};
		}
		result = {
			...result,
			voiceConfig: { ...result.voiceConfig, providers: voiceProviders },
		};
	}

	return result;
}

/**
 * Extracts non-empty API keys from settings, stores them in SecretStorage,
 * and returns settings with those keys cleared to "".
 * If SecretStorage is unavailable, returns settings as-is.
 */
export function extractAndStoreSecrets(
	app: App,
	settings: AppSettings
): AppSettings {
	if (!hasSecretStorage(app)) {
		return settings;
	}

	const ss = app.secretStorage;
	let result = { ...settings };

	// Extract AI provider keys
	if (result.aiConfig?.providers) {
		const updatedProviders = { ...result.aiConfig.providers };
		for (const provider of Object.keys(updatedProviders) as AIProvider[]) {
			const key = updatedProviders[provider]?.apiKey;
			if (key) {
				ss.setSecret(aiSecretId(provider), key);
				updatedProviders[provider] = {
					...updatedProviders[provider],
					apiKey: "",
				};
			}
		}
		result = {
			...result,
			aiConfig: { ...result.aiConfig, providers: updatedProviders },
		};
	}

	// Extract voice provider keys
	if (result.voiceConfig?.providers) {
		const voiceProviders = { ...result.voiceConfig.providers };
		if (voiceProviders.openai?.apiKey) {
			ss.setSecret(voiceSecretId("openai"), voiceProviders.openai.apiKey);
			voiceProviders.openai = {
				...voiceProviders.openai,
				apiKey: "",
			};
		}
		if (voiceProviders.gemini?.apiKey) {
			ss.setSecret(voiceSecretId("gemini"), voiceProviders.gemini.apiKey);
			voiceProviders.gemini = {
				...voiceProviders.gemini,
				apiKey: "",
			};
		}
		result = {
			...result,
			voiceConfig: { ...result.voiceConfig, providers: voiceProviders },
		};
	}

	return result;
}

/**
 * One-time migration: if plaintext API keys exist in settings, move them to SecretStorage.
 * Returns settings with keys cleared.
 */
export function migrateExistingKeysToSecretStorage(
	app: App,
	settings: AppSettings
): AppSettings {
	return extractAndStoreSecrets(app, settings);
}
