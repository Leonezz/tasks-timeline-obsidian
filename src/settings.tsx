import { App, PluginSettingTab, Setting } from "obsidian";
import TasksTimelineObsidianPlugin from "./main";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React, { useState } from "react";
import {
	AppSettings,
	cn,
	CustomSettingsTab,
	SettingsPage,
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

/**
 * Wrapper that holds AppSettings in React state so the SettingsPage
 * re-renders when onUpdateSettings is called.  Without this, the
 * Obsidian PluginSettingTab passes a static reference that never
 * triggers a React re-render.
 */
function SettingsPageWrapper({
	initialSettings,
	onPersistSettings,
	availableCategories,
	availableTags,
	inDarkMode,
	customTabs,
}: {
	initialSettings: AppSettings;
	onPersistSettings: (s: AppSettings) => void;
	availableCategories: string[];
	availableTags: string[];
	inDarkMode: boolean;
	customTabs: CustomSettingsTab[];
}) {
	const [settings, setSettings] = useState(initialSettings);

	const handleUpdateSettings = (s: AppSettings) => {
		setSettings(s);
		onPersistSettings(s);
	};

	return (
		<SettingsPage
			settings={settings}
			onUpdateSettings={handleUpdateSettings}
			availableCategories={availableCategories}
			availableTags={availableTags}
			onClose={undefined}
			inSeperatePage
			inDarkMode={inDarkMode}
			customTabs={customTabs}
		/>
	);
}

function McpServerSettings({
	enabled: initialEnabled,
	port: initialPort,
	onToggle,
	onPortChange,
}: {
	enabled: boolean;
	port: number;
	onToggle: (value: boolean) => Promise<void>;
	onPortChange: (port: number) => Promise<void>;
}) {
	const [enabled, setEnabled] = useState(initialEnabled);
	const [port, setPort] = useState(String(initialPort));
	const [portError, setPortError] = useState("");

	const handleToggle = () => {
		const next = !enabled;
		setEnabled(next);
		void onToggle(next);
	};

	const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setPort(value);

		const parsed = parseInt(value, 10);
		if (isNaN(parsed) || parsed < 1024 || parsed > 65535) {
			setPortError("Port must be between 1024 and 65535");
			return;
		}

		setPortError("");
		void onPortChange(parsed);
	};

	return (
		<div className="p-6 space-y-8">
			<section>
				<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
					MCP Server
				</h3>

				<div className="space-y-4">
					{/* Enable toggle */}
					<div className="flex items-center justify-between">
						<div className="flex flex-col">
							<span className="text-sm font-medium text-slate-700">
								Enable MCP Server
							</span>
							<span className="text-xs text-slate-400">
								Start a local server so AI agents can read and
								write tasks
							</span>
						</div>
						<button
							onClick={handleToggle}
							className={cn(
								"relative w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400",
								enabled
									? "bg-blue-500"
									: "bg-slate-200 dark:bg-slate-700",
							)}
						>
							<span
								className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm block transition-transform"
								style={{
									transform: enabled
										? "translateX(16px)"
										: "translateX(0)",
								}}
							/>
						</button>
					</div>

					{/* Port */}
					<div className="pt-2 border-t border-slate-100 dark:border-slate-800">
						<label className="text-xs font-medium text-slate-500 block mb-2">
							Port
						</label>
						<input
							type="number"
							value={port}
							onChange={handlePortChange}
							placeholder="27182"
							min={1024}
							max={65535}
							className="w-28 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500"
						/>
						<p className="text-[10px] text-slate-400 mt-1 pl-1">
							Range: 1024–65535. Toggle off and on to apply
							changes.
						</p>
						{portError && (
							<p className="text-[10px] text-red-500 mt-1 pl-1">
								{portError}
							</p>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}

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

		const mcpTab: CustomSettingsTab = {
			id: "mcp-server",
			label: "MCP Server",
			icon: "Plug",
			content: (
				<McpServerSettings
					enabled={this.plugin.settings.mcpServer.enabled}
					port={this.plugin.settings.mcpServer.port}
					onToggle={async (value) => {
						this.plugin.settings.mcpServer.enabled = value;
						await this.plugin.saveSettings();
						await this.plugin.restartMcpServer();
					}}
					onPortChange={async (port) => {
						this.plugin.settings.mcpServer.port = port;
						await this.plugin.saveSettings();
					}}
				/>
			),
		};

		const tagSettings = new Setting(containerEl);
		this.root = createRoot(tagSettings.settingEl);
		this.root.render(
			<React.StrictMode>
				<SettingsPageWrapper
					initialSettings={this.plugin.settings.appSetting}
					onPersistSettings={(s) => {
						const cleaned = extractAndStoreSecrets(this.app, s);
						this.plugin.settings.appSetting = cleaned;
						void this.plugin.saveSettings();
					}}
					availableCategories={[]}
					availableTags={[]}
					inDarkMode={this.plugin.settings.systemInDarkMode}
					customTabs={[mcpTab]}
				/>
			</React.StrictMode>,
		);
	}
}
