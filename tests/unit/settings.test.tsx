import { act, render } from "@testing-library/react";
import React from "react";
import type { AppSettings, VoiceRuntime } from "@tasks-timeline/components";
import type { App as ObsidianApp } from "obsidian";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { obsidianFetch } from "../../src/obsidianHttp";
import { DEFAULT_SETTINGS, TasksTimelineSettingTab } from "../../src/settings";
import * as obsidian from "../mocks/obsidian";

interface McpTabProps {
	onToggle: (value: boolean) => Promise<void>;
	onPortChange: (port: number) => Promise<void>;
	onBlacklistChange: (value: string) => Promise<void>;
}

interface CapturedSettingsPageProps {
	customTabs: { content: { props: McpTabProps } }[];
	settings: AppSettings;
	voiceRuntime?: VoiceRuntime;
	aiFetch?: typeof fetch;
	aiProviderFactory?: unknown;
	onUpdateSettings: (settings: AppSettings) => void;
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
		getAuthToken: jest.fn<Promise<string>, []>().mockResolvedValue("token"),
		getMcpStats: () => ({
			query_tasks: { total: 2, successful: 2, failed: 0 },
		}),
		getMcpSessionSummaries: () => [
			{
				sessionId: "abc123",
				clientName: "client",
				clientVersion: "1.0",
				durationSeconds: 120,
				toolCalls: { total: 1, successful: 1, failed: 0 },
			},
		],
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

	it("gives every custom tab an icon the library can render", () => {
		const { tab } = createTab(jest.fn<Promise<void>, []>().mockResolvedValue());
		act(() => tab.display());
		const { Icon } = jest.requireActual<
			typeof import("@tasks-timeline/components")
		>("@tasks-timeline/components");
		const tabs = mockPageProps!.customTabs as unknown as {
			id: string;
			icon?: unknown;
		}[];
		expect(tabs.length).toBeGreaterThan(0);

		// SettingsPage renders a string icon through <Icon>, which throws for a
		// name outside its registry, and a component icon as the component.
		for (const { id, icon } of tabs) {
			const element =
				typeof icon === "string" ? (
					<Icon name={icon as never} />
				) : icon ? (
					React.createElement(icon as React.ElementType)
				) : null;
			expect(() => render(<>{element}</>)).not.toThrow();
			expect(id).toBeTruthy();
		}
		act(() => tab.hide());
	});

	it("gives the AI page the timeline's voice runtime and fetch", () => {
		const { tab } = createTab(jest.fn<Promise<void>, []>().mockResolvedValue());
		act(() => tab.display());

		// The Browser voice provider is shown as unavailable, and Test
		// Connection goes through requestUrl.
		expect(mockPageProps?.voiceRuntime?.browserSpeechSupported).toBe(false);
		expect(mockPageProps?.aiFetch).toBe(obsidianFetch);
		expect(mockPageProps?.aiProviderFactory).toBeUndefined();
		act(() => tab.hide());
	});

	describe("MCP server settings", () => {
		const mcpTab = () => mockPageProps!.customTabs[0]!.content.props;
		const failingSave = () =>
			jest.fn<Promise<void>, []>().mockRejectedValue(new Error("disk full"));

		it("styles the tab with the library's theme tokens", async () => {
			const { tab } = createTab(jest.fn<Promise<void>, []>().mockResolvedValue());
			act(() => tab.display());
			const { container } = render(
				mockPageProps!.customTabs[0]!.content as unknown as React.ReactElement,
			);
			await act(flushPromises);

			const classes = Array.from(container.querySelectorAll("[class]")).flatMap(
				(element) => element.className.split(/\s+/),
			);
			// `dark:` utilities follow the OS, not the theme, and invert the
			// theme's own colors twice; orange-* is not in the library's CSS.
			expect(classes.filter((name) => name.startsWith("dark:"))).toEqual([]);
			expect(classes.filter((name) => name.includes("orange-"))).toEqual([]);
			const button = (label: string) =>
				Array.from(container.querySelectorAll("button")).find(
					(element) => element.textContent === label,
				);
			expect(button("Copy")?.className).toContain(
				"bg-primary text-primary-foreground",
			);
			expect(button("Regenerate")?.className).toContain(
				"bg-destructive text-destructive-foreground",
			);
			act(() => tab.hide());
		});

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
