import type TasksTimelineObsidianPlugin from "../../src/main";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { ObsidianMcpServer } from "../../src/mcpServer";
import { App } from "../mocks/obsidian";

// The HTTP transport needs fetch globals jsdom lacks; no session is opened here.
jest.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
	StreamableHTTPServerTransport: class {},
}));

describe("ObsidianMcpServer", () => {
	it("stops watching the vault when it stops", async () => {
		const app = new App();
		const plugin = {
			app,
			settings: { ...DEFAULT_SETTINGS },
		} as unknown as TasksTimelineObsidianPlugin;

		const server = new ObsidianMcpServer(plugin);
		expect(app.vault._listenerCount()).toBeGreaterThan(0);
		expect(app.metadataCache._listenerCount()).toBeGreaterThan(0);

		await server.stop();

		expect(app.vault._listenerCount()).toBe(0);
		expect(app.metadataCache._listenerCount()).toBe(0);
	});
});
