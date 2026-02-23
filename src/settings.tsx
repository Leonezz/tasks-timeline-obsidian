import { App, PluginSettingTab, Setting } from "obsidian";
import TasksTimelineObsidianPlugin from "./main";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React, { useCallback, useState } from "react";
import {
	AppSettings,
	CustomSettingsTab,
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

	const handleToggle = useCallback(async () => {
		const next = !enabled;
		setEnabled(next);
		await onToggle(next);
	}, [enabled, onToggle]);

	const handlePortChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value;
			setPort(value);

			const parsed = parseInt(value, 10);
			if (isNaN(parsed) || parsed < 1024 || parsed > 65535) {
				setPortError("Port must be between 1024 and 65535");
				return;
			}

			setPortError("");
			void onPortChange(parsed);
		},
		[onPortChange],
	);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<div>
					<div style={{ fontWeight: 500 }}>Enable MCP server</div>
					<div style={{ fontSize: "0.85em", opacity: 0.7 }}>
						Start a local MCP server so AI agents can read and write
						tasks.
					</div>
				</div>
				<button
					onClick={() => void handleToggle()}
					style={{
						padding: "4px 12px",
						borderRadius: "4px",
						border: "1px solid var(--background-modifier-border)",
						background: enabled
							? "var(--interactive-accent)"
							: "var(--background-secondary)",
						color: enabled
							? "var(--text-on-accent)"
							: "var(--text-normal)",
						cursor: "pointer",
					}}
				>
					{enabled ? "On" : "Off"}
				</button>
			</div>

			<div>
				<div style={{ fontWeight: 500, marginBottom: "4px" }}>Port</div>
				<div
					style={{
						fontSize: "0.85em",
						opacity: 0.7,
						marginBottom: "8px",
					}}
				>
					Port number for the MCP server. Toggle off and on to apply
					changes.
				</div>
				<input
					type="number"
					value={port}
					onChange={handlePortChange}
					placeholder="27182"
					min={1024}
					max={65535}
					style={{
						width: "120px",
						padding: "4px 8px",
						borderRadius: "4px",
						border: "1px solid var(--background-modifier-border)",
						background: "var(--background-secondary)",
						color: "var(--text-normal)",
					}}
				/>
				{portError && (
					<div
						style={{
							color: "var(--text-error)",
							fontSize: "0.85em",
							marginTop: "4px",
						}}
					>
						{portError}
					</div>
				)}
			</div>
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
				<SettingsPage
					{...args}
					onClose={undefined}
					inSeperatePage
					inDarkMode={this.plugin.settings.systemInDarkMode}
					customTabs={[mcpTab]}
				/>
			</React.StrictMode>,
		);
	}
}
