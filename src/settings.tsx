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

export interface TasksTimelinePluginSettings {
	appSetting: AppSettings;
	systemInDarkMode: boolean;
}

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
			},
		},

		enableVoiceInput: true,
		voiceProvider: "browser",
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
};

export class TasksTimelineSettingTab extends PluginSettingTab {
	plugin: TasksTimelineObsidianPlugin;
	private root: ReactRoot | undefined;

	constructor(app: App, plugin: TasksTimelineObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const container = containerEl;
		container.empty();

		const args = {
			isOpen: true,
			onClose: () => {},
			settings: this.plugin.settings.appSetting,
			onUpdateSettings: (s: AppSettings) => {},
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

		// Stop observing in onunload()
		// themeObserver.disconnect();

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
			</React.StrictMode>
		);
	}
}
