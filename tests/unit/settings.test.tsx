import { act } from "@testing-library/react";
import type { AppSettings, VoiceRuntime } from "@tasks-timeline/components";
import type { App as ObsidianApp } from "obsidian";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { DEFAULT_SETTINGS, TasksTimelineSettingTab } from "../../src/settings";
import * as obsidian from "../mocks/obsidian";

interface McpTabProps {
	onToggle: (value: boolean) => Promise<void>;
	onPortChange: (port: number) => Promise<void>;
	onBlacklistChange: (value: string) => Promise<void>;
}

interface CapturedSettingsPageProps {
	settings: AppSettings;
	voiceRuntime?: VoiceRuntime;
	onUpdateSettings: (settings: AppSettings) => void;
	customTabs: { content: { props: McpTabProps } }[];
}

let mockPageProps: CapturedSettingsPageProps | undefined;
let mockPageShouldThrow = false;
let mockMountedPages = 0;

jest.mock("@tasks-timeline/components", () => {
	const { useEffect } = jest.requireActual<typeof import("react")>("react");
	return {
		...jest.requireActual("@tasks-timeline/components"),
		SettingsPage: (props: CapturedSettingsPageProps) => {
			if (mockPageShouldThrow) {
				throw new Error("settings page crashed");
			}
			mockPageProps = props;
			useEffect(() => {
				mockMountedPages++;
				return () => {
					mockMountedPages--;
				};
			}, []);
			return null;
		},
	};
});

jest.mock("../../src/obsidianDom", () => ({
	getActiveWindow: () => window,
	getActiveDocument: () => document,
}));

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function withTheme(theme: AppSettings["theme"]): AppSettings {
	return { ...DEFAULT_SETTINGS.appSetting, theme };
}

function createTab(saveSettings: jest.Mock<Promise<void>, []>) {
	const app = new obsidian.App();
	const plugin = {
		app,
		settings: {
			...DEFAULT_SETTINGS,
			appSetting: withTheme("light"),
			mcpServer: { ...DEFAULT_SETTINGS.mcpServer },
		},
		saveSettings,
		updateSecurityBlacklist: jest.fn(),
		restartMcpServer: jest.fn<Promise<void>, []>().mockResolvedValue(),
		bus: { on: () => () => undefined, emit: jest.fn() },
	} as unknown as TasksTimelineObsidianPlugin;
	const tab = new TasksTimelineSettingTab(
		app as unknown as ObsidianApp,
		plugin,
	);
	return { tab, plugin };
}

async function updateSettings(settings: AppSettings) {
	await act(async () => {
		mockPageProps!.onUpdateSettings(settings);
		await flushPromises();
	});
}

describe("TasksTimelineSettingTab", () => {
	let noticeSpy: jest.SpyInstance;
	const afterTestCleanups: (() => void)[] = [];

	beforeEach(() => {
		mockPageProps = undefined;
		mockPageShouldThrow = false;
		mockMountedPages = 0;
		noticeSpy = jest
			.spyOn(obsidian, "Notice")
			.mockImplementation(
				(message: string) => ({ message }) as obsidian.Notice,
			);
	});

	afterEach(() => {
		noticeSpy.mockRestore();
		afterTestCleanups.splice(0).forEach((cleanup) => cleanup());
	});

	it("shows one notice per failure streak and logs every failure", async () => {
		const saveSettings = jest
			.fn<Promise<void>, []>()
			.mockRejectedValue(new Error("disk full"));
		const { tab } = createTab(saveSettings);
		act(() => tab.display());
		const errorSpy = jest.spyOn(console, "error").mockClear();

		await updateSettings(withTheme("dark"));
		await updateSettings(withTheme("coffee"));

		expect(noticeSpy).toHaveBeenCalledTimes(1);
		expect(noticeSpy).toHaveBeenCalledWith(
			"Failed to save settings: disk full",
		);
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to save settings:",
			expect.any(Error),
		);
		expect(
			errorSpy.mock.calls.filter(
				([message]) => message === "Failed to save settings:",
			),
		).toHaveLength(2);

		saveSettings.mockResolvedValueOnce(undefined);
		await updateSettings(withTheme("midnight"));
		await updateSettings(withTheme("light"));

		expect(noticeSpy).toHaveBeenCalledTimes(2);
		act(() => tab.hide());
	});

	it("gives the AI page the timeline's voice runtime", () => {
		const { tab } = createTab(jest.fn<Promise<void>, []>().mockResolvedValue());
		act(() => tab.display());

		// The Browser voice provider is shown as unavailable.
		expect(mockPageProps?.voiceRuntime?.browserSpeechSupported).toBe(false);
		act(() => tab.hide());
	});

	describe("MCP server settings", () => {
		const mcpTab = () => mockPageProps!.customTabs[0]!.content.props;
		const failingSave = () =>
			jest.fn<Promise<void>, []>().mockRejectedValue(new Error("disk full"));

		it("applies a blacklist to the running server even when saving fails", async () => {
			const { tab, plugin } = createTab(failingSave());
			act(() => tab.display());

			await act(() => mcpTab().onBlacklistChange("tag:#private"));

			expect(plugin.updateSecurityBlacklist).toHaveBeenCalledWith(
				"tag:#private",
			);
			expect(noticeSpy).toHaveBeenCalledWith(
				"Failed to save settings: disk full",
			);
			act(() => tab.hide());
		});

		it("reports a failed save of a server setting", async () => {
			const { tab, plugin } = createTab(failingSave());
			act(() => tab.display());

			await act(() => mcpTab().onPortChange(28000));

			expect(plugin.settings.mcpServer.port).toBe(28000);
			expect(noticeSpy).toHaveBeenCalledWith(
				"Failed to save settings: disk full",
			);
			act(() => tab.hide());
		});

		it("restarts the server when saving fails, and reports a failed restart", async () => {
			const { tab, plugin } = createTab(failingSave());
			jest.mocked(plugin.restartMcpServer).mockRejectedValue(
				new Error("port in use"),
			);
			act(() => tab.display());

			await act(() => mcpTab().onToggle(true));

			expect(plugin.restartMcpServer).toHaveBeenCalled();
			expect(noticeSpy).toHaveBeenCalledWith(
				"Failed to save settings: disk full",
			);
			expect(noticeSpy).toHaveBeenCalledWith(
				"Failed to restart the agent server: port in use",
			);
			act(() => tab.hide());
		});
	});

	it("keeps saved settings when Try Again remounts after a crash", async () => {
		// The crash is expected; stop jsdom from reporting it as uncaught.
		const ignoreCrash = (event: ErrorEvent) => event.preventDefault();
		window.addEventListener("error", ignoreCrash);
		afterTestCleanups.push(() =>
			window.removeEventListener("error", ignoreCrash),
		);
		const saveSettings = jest.fn<Promise<void>, []>().mockResolvedValue();
		const { tab, plugin } = createTab(saveSettings);
		act(() => tab.display());

		mockPageShouldThrow = true;
		await updateSettings(withTheme("dark"));
		expect(plugin.settings.appSetting.theme).toBe("dark");

		const shadowRoot = tab.containerEl.querySelector(
			".tasks-timeline-settings-host",
		)?.shadowRoot;
		expect(shadowRoot?.textContent).toContain("settings page crashed");

		mockPageShouldThrow = false;
		const tryAgain = shadowRoot?.querySelector("button");
		expect(tryAgain?.textContent).toBe("Try Again");
		act(() => tryAgain?.click());

		expect(mockPageProps?.settings.theme).toBe("dark");
		act(() => tab.hide());
	});

	it("unmounts the previous page when display() runs again without hide()", () => {
		const saveSettings = jest.fn<Promise<void>, []>().mockResolvedValue();
		const { tab } = createTab(saveSettings);

		act(() => tab.display());
		act(() => tab.display());

		expect(mockMountedPages).toBe(1);
		act(() => tab.hide());
		expect(mockMountedPages).toBe(0);
	});
});
