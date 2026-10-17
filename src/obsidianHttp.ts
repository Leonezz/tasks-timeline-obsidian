import { App, requestUrl } from "obsidian";
import type { VoiceRuntime } from "@tasks-timeline/components";
import { getActiveWindow } from "./obsidianDom";

/** Statuses whose fetch Response must be built without a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function headerRecord(headers: Headers): Record<string, string> {
	const record: Record<string, string> = {};
	headers.forEach((value, key) => {
		record[key] = value;
	});
	return record;
}

/**
 * A `fetch` for the library's AI providers (`aiFetch`), sent through
 * Obsidian's `requestUrl` so provider requests and Test Connection are not
 * blocked by browser CORS.
 *
 * Returns a real fetch `Response`, as the library requires. Error statuses
 * are returned as responses, like `fetch` does, and network errors reject.
 * `requestUrl` can't be cancelled and doesn't stream: an aborted request
 * rejects with the abort reason (before it is sent, or once it returns), and
 * the whole response arrives at once.
 */
export const obsidianFetch: typeof fetch = async (input, init) => {
	const request = new Request(input, init);
	request.signal.throwIfAborted();
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: headerRecord(request.headers),
		body: hasBody ? await request.arrayBuffer() : undefined,
		throw: false,
	});
	request.signal.throwIfAborted();
	return new Response(
		NULL_BODY_STATUSES.has(response.status) ? null : response.arrayBuffer,
		{ status: response.status, headers: response.headers },
	);
};

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
