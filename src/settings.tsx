import { App, PluginSettingTab, Setting } from "obsidian";
import TasksTimelineObsidianPlugin from "./main";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React from "react";
import {
	AppSettings,
	FilterState,
	SettingsPage,
	SortDirection,
	SortField,
	SortState,
} from "@tasks-timeline/components";
import { unmountReactRoot } from "./view";
import { extractAndStoreSecrets } from "./secretStorage";

export interface TasksTimelinePluginSettings {
	appSetting: AppSettings;
	systemInDarkMode: boolean;
	_settingsVersion?: number;
	mcpServer: {
		enabled: boolean;
		port: number;
	};
}

export const CURRENT_SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: TasksTimelinePluginSettings = {
	appSetting: {
		theme: "system",
		dateFormat: "MM, DD",
		showCompleted: true,
		showProgressBar: true,
		soundEnabled: true,
		fontSize: "base",
		useRelativeDates: true,
		groupingStrategy: ["dueAt"],
		aiConfig: {
			enabled: true,
			defaultMode: true,
			activeProvider: "gemini",
			systemPrompt: "",
			providers: {
				gemini: {
					apiKey: "",
					baseUrl: "",
					model: "",
				},
				anthropic: {
					apiKey: "",
					baseUrl: "",
					model: "",
				},
				openai: {
					apiKey: "",
					baseUrl: "",
					model: "",
				},
				"openai-compatible": {
					apiKey: "",
					baseUrl: "",
					model: "",
				},
			},
		},
		voiceConfig: {
			enabled: true,
			activeProvider: "browser",
			language: "en-US",
			providers: {
				browser: {},
				openai: {
					apiKey: "",
					baseUrl: "",
					model: "",
				},
				gemini: {
					apiKey: "",
					model: "",
				},
			},
		},
		defaultFocusMode: true,
		totalTokenUsage: 0,
		defaultCategory: "",
		filters: {
			tags: [],
			categories: [],
			priorities: [],
			statuses: [],
			enableScript: false,
			script: "",
		},
		sort: {
			script: "",
			direction: "asc",
			field: "createdAt",
		},
	},
	systemInDarkMode: false,
	_settingsVersion: CURRENT_SETTINGS_VERSION,
	mcpServer: {
		enabled: false,
		port: 27182,
	},
};

export class TasksTimelineSettingTab extends PluginSettingTab {
	plugin: TasksTimelineObsidianPlugin;
	private root: ReactRoot | undefined;

	constructor(app: App, plugin: TasksTimelineObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.root = unmountReactRoot(this.root);
	}

	display(): void {
		const { containerEl } = this;
		const container = containerEl;
		container.empty();

		const args = {
			isOpen: true,
			onClose: () => {},
			settings: this.plugin.settings.appSetting,
			onUpdateSettings: (s: AppSettings) => {
				const cleaned = extractAndStoreSecrets(this.app, s);
				this.plugin.settings.appSetting = cleaned;
				void this.plugin.saveSettings();
			},
			filters: {
				tags: [],
				categories: [],
				priorities: [],
				statuses: [],
				enableScript: false,
				script: "",
			},
			onFilterChange: (s: FilterState) => {},
			sort: {
				field: "createdAt" as SortField,
				direction: "asc" as SortDirection,
				script: "",
			},
			onSortChange: (s: SortState) => {},
			availableCategories: [],
			availableTags: [],
		};

		// --- MCP server settings (native Obsidian UI) ---
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(containerEl).setName("MCP server").setHeading();

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Enable MCP server")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Start a local MCP server so AI agents can read and write tasks.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.mcpServer.enabled)
					.onChange(async (value) => {
						this.plugin.settings.mcpServer.enabled = value;
						await this.plugin.saveSettings();
						await this.plugin.restartMcpServer();
					}),
			);

		new Setting(containerEl)
			.setName("Port")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Port number for the MCP server (1024\u201365535). Requires restart.",
			)
			.addText((text) =>
				text
					.setPlaceholder("27182")
					.setValue(String(this.plugin.settings.mcpServer.port))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port >= 1024 && port <= 65535) {
							this.plugin.settings.mcpServer.port = port;
							await this.plugin.saveSettings();
						}
					}),
			);

		const tagSettings = new Setting(containerEl);
		this.root = createRoot(tagSettings.settingEl);
		this.root.render(
			<React.StrictMode>
				<SettingsPage
					{...args}
					onClose={undefined}
					inSeperatePage
					inDarkMode={this.plugin.settings.systemInDarkMode}
				/>
			</React.StrictMode>,
		);
	}
}
