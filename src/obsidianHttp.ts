import { App, requestUrl } from "obsidian";
import type { VoiceRuntime } from "@tasks-timeline/components";
import { getActiveWindow } from "./obsidianDom";

/**
 * The voice runtime for the timeline and the settings tab: transcription
 * requests go through `requestUrl`, and browser speech recognition is
 * declared unsupported. Obsidian's Electron exposes the Web Speech API
 * without a speech service, so it always fails with a `network` error; the
 * library then disables the Browser provider and says to choose OpenAI or
 * Gemini instead.
 */
export function createObsidianVoiceRuntime(app: App): VoiceRuntime {
	return {
		win: getActiveWindow(app),
		browserSpeechSupported: false,
		request: async (request) => {
			const response = await requestUrl({
				url: request.url,
				method: request.method,
				headers: request.headers,
				contentType: request.contentType,
				body: request.body,
				throw: false,
			});
			return {
				status: response.status,
				text: response.text,
			};
		},
	};
}
