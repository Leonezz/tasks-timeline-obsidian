import type { App } from "obsidian";
import { createObsidianVoiceRuntime } from "../../src/obsidianHttp";
import * as obsidian from "../mocks/obsidian";

jest.mock("../../src/obsidianDom", () => ({
	getActiveWindow: () => "active window",
}));

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
