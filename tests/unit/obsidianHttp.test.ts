/**
 * @jest-environment node
 */
// Node provides the fetch Request and Response classes that jsdom lacks;
// Obsidian's renderer has them too.
import type { App } from "obsidian";
import {
	createObsidianVoiceRuntime,
	obsidianFetch,
} from "../../src/obsidianHttp";
import * as obsidian from "../mocks/obsidian";

jest.mock("../../src/obsidianDom", () => ({
	getActiveWindow: () => "active window",
}));

const encode = (text: string) => new TextEncoder().encode(text).buffer;

function respondWith(
	response: Partial<obsidian.RequestUrlResponse> & { status: number },
) {
	return jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: undefined,
		text: "",
		...response,
	});
}

describe("obsidianFetch", () => {
	afterEach(() => jest.restoreAllMocks());

	it("sends the request through requestUrl and returns a fetch Response", async () => {
		const requestUrl = respondWith({
			status: 200,
			headers: { "content-type": "application/json" },
			arrayBuffer: encode('{"ok":true}'),
		});

		const response = await obsidianFetch("https://api.example.com/v1/models", {
			headers: { authorization: "Bearer key" },
		});

		expect(response).toBeInstanceOf(Response);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(requestUrl).toHaveBeenCalledWith({
			url: "https://api.example.com/v1/models",
			method: "GET",
			headers: { authorization: "Bearer key" },
			body: undefined,
			throw: false,
		});
	});

	it("passes a request body on unchanged", async () => {
		const requestUrl = respondWith({ status: 200 });
		const body = JSON.stringify({ model: "m", messages: [] });

		await obsidianFetch(new URL("https://api.example.com/v1/chat"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});

		const param = requestUrl.mock.calls[0]![0] as obsidian.RequestUrlParam;
		expect(param).toMatchObject({
			method: "POST",
			headers: { "content-type": "application/json" },
			throw: false,
		});
		expect(new TextDecoder().decode(param.body as ArrayBuffer)).toBe(body);
	});

	it("returns error statuses as responses instead of throwing", async () => {
		respondWith({ status: 401, arrayBuffer: encode("bad key") });

		const response = await obsidianFetch("https://api.example.com/v1/chat");

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("bad key");
	});

	it.each([204, 205, 304])(
		"returns a %i response without a body",
		async (status) => {
			respondWith({ status, arrayBuffer: new ArrayBuffer(0) });

			const response = await obsidianFetch("https://api.example.com/v1");

			expect(response.status).toBe(status);
			expect(response.body).toBeNull();
		},
	);

	it("rejects with the error requestUrl throws", async () => {
		jest.spyOn(obsidian, "requestUrl").mockRejectedValue(
			new Error("net::ERR_NAME_NOT_RESOLVED"),
		);

		await expect(
			obsidianFetch("https://api.example.com/v1"),
		).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
	});

	it("rejects an aborted request without sending it", async () => {
		const requestUrl = respondWith({ status: 200 });
		const controller = new AbortController();
		controller.abort();

		await expect(
			obsidianFetch("https://api.example.com/v1", {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it("rejects a request aborted while it was in flight", async () => {
		const controller = new AbortController();
		jest.spyOn(obsidian, "requestUrl").mockImplementation(async () => {
			controller.abort();
			return {
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: undefined,
				text: "",
			};
		});

		await expect(
			obsidianFetch("https://api.example.com/v1", {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("createObsidianVoiceRuntime", () => {
	afterEach(() => jest.restoreAllMocks());

	it("declares browser speech unsupported and uses the active window", () => {
		const runtime = createObsidianVoiceRuntime(
			new obsidian.App() as unknown as App,
		);

		expect(runtime.browserSpeechSupported).toBe(false);
		expect(runtime.win).toBe("active window");
	});

	it("sends transcription requests through requestUrl", async () => {
		const requestUrl = respondWith({ status: 200, text: '{"text":"hi"}' });
		const runtime = createObsidianVoiceRuntime(
			new obsidian.App() as unknown as App,
		);

		const response = await runtime.request!({
			url: "https://api.openai.com/v1/audio/transcriptions",
			method: "POST",
			headers: { authorization: "Bearer key" },
			contentType: "multipart/form-data; boundary=x",
			body: "--x--",
		});

		expect(response).toEqual({ status: 200, text: '{"text":"hi"}' });
		expect(requestUrl).toHaveBeenCalledWith({
			url: "https://api.openai.com/v1/audio/transcriptions",
			method: "POST",
			headers: { authorization: "Bearer key" },
			contentType: "multipart/form-data; boundary=x",
			body: "--x--",
			throw: false,
		});
	});
});
