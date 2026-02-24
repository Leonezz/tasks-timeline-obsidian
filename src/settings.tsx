import { App, PluginSettingTab, Setting } from "obsidian";
import TasksTimelineObsidianPlugin from "./main";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React, { useCallback, useEffect, useState } from "react";
import {
	AppSettings,
	cn,
	CustomSettingsTab,
	SettingsPage,
} from "@tasks-timeline/components";
import { unmountReactRoot } from "./view";
import { extractAndStoreSecrets, resolveSecrets } from "./secretStorage";
import type { StatsData } from "./mcpStats";
import type { SessionSummary } from "./mcpServer";

export interface TasksTimelinePluginSettings {
	appSetting: AppSettings;
	systemInDarkMode: boolean;
	_settingsVersion?: number;
	mcpServer: {
		enabled: boolean;
		port: number;
		authEnabled: boolean;
		blacklist: string;
		subscriptionsEnabled: boolean;
	};
}

export const CURRENT_SETTINGS_VERSION = 3;

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
		authEnabled: true,
		blacklist: "",
		subscriptionsEnabled: false,
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

function ToggleSwitch({
	enabled,
	onToggle,
}: {
	enabled: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			onClick={onToggle}
			className={cn(
				"relative w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400",
				enabled ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-700",
			)}
		>
			<span
				className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm block transition-transform"
				style={{
					transform: enabled ? "translateX(16px)" : "translateX(0)",
				}}
			/>
		</button>
	);
}

function McpServerSettings({
	enabled: initialEnabled,
	port: initialPort,
	authEnabled: initialAuthEnabled,
	blacklist: initialBlacklist,
	subscriptionsEnabled: initialSubscriptionsEnabled,
	onToggle,
	onPortChange,
	onAuthToggle,
	onBlacklistChange,
	onSubscriptionsToggle,
	getAuthToken,
	regenerateToken,
	getStats,
	getSessionSummaries,
}: {
	enabled: boolean;
	port: number;
	authEnabled: boolean;
	blacklist: string;
	subscriptionsEnabled: boolean;
	onToggle: (value: boolean) => Promise<void>;
	onPortChange: (port: number) => Promise<void>;
	onAuthToggle: (value: boolean) => Promise<void>;
	onBlacklistChange: (value: string) => Promise<void>;
	onSubscriptionsToggle: (value: boolean) => Promise<void>;
	getAuthToken: () => Promise<string>;
	regenerateToken: () => Promise<string>;
	getStats: () => StatsData;
	getSessionSummaries: () => SessionSummary[];
}) {
	const [enabled, setEnabled] = useState(initialEnabled);
	const [port, setPort] = useState(String(initialPort));
	const [portError, setPortError] = useState("");
	const [authEnabled, setAuthEnabled] = useState(initialAuthEnabled);
	const [token, setToken] = useState("");
	const [tokenCopied, setTokenCopied] = useState(false);
	const [blacklist, setBlacklist] = useState(initialBlacklist);
	const [subscriptionsEnabled, setSubscriptionsEnabled] = useState(
		initialSubscriptionsEnabled,
	);
	const [stats, setStats] = useState<StatsData>({});
	const [sessions, setSessions] = useState<SessionSummary[]>([]);

	// Load token on mount
	useEffect(() => {
		void getAuthToken().then(setToken);
	}, [getAuthToken]);

	// Refresh stats periodically
	useEffect(() => {
		const refresh = () => {
			setStats(getStats());
			setSessions(getSessionSummaries());
		};
		refresh();
		const interval = setInterval(refresh, 5000);
		return () => clearInterval(interval);
	}, [getStats, getSessionSummaries]);

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

	const handleAuthToggle = () => {
		const next = !authEnabled;
		setAuthEnabled(next);
		void onAuthToggle(next);
	};

	const handleCopyToken = useCallback(async () => {
		await navigator.clipboard.writeText(token);
		setTokenCopied(true);
		setTimeout(() => setTokenCopied(false), 2000);
	}, [token]);

	const handleRegenerateToken = useCallback(async () => {
		const newToken = await regenerateToken();
		setToken(newToken);
	}, [regenerateToken]);

	const handleBlacklistChange = (
		e: React.ChangeEvent<HTMLTextAreaElement>,
	) => {
		const value = e.target.value;
		setBlacklist(value);
		void onBlacklistChange(value);
	};

	const handleSubscriptionsToggle = () => {
		const next = !subscriptionsEnabled;
		setSubscriptionsEnabled(next);
		void onSubscriptionsToggle(next);
	};

	const statEntries = Object.entries(stats);

	return (
		<div className="p-6 space-y-8">
			{/* Server enable/port */}
			<section>
				<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
					MCP Server
				</h3>

				<div className="space-y-4">
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
						<ToggleSwitch
							enabled={enabled}
							onToggle={handleToggle}
						/>
					</div>

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
							Range: 1024-65535. Toggle off and on to apply
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

			{/* Authentication */}
			<section>
				<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
					Authentication
				</h3>
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div className="flex flex-col">
							<span className="text-sm font-medium text-slate-700">
								Require Bearer Token
							</span>
							<span className="text-xs text-slate-400">
								Clients must include an Authorization header
							</span>
						</div>
						<ToggleSwitch
							enabled={authEnabled}
							onToggle={handleAuthToggle}
						/>
					</div>

					{authEnabled && (
						<div className="pt-2 border-t border-slate-100 dark:border-slate-800">
							<label className="text-xs font-medium text-slate-500 block mb-2">
								Auth Token
							</label>
							<div className="flex items-center gap-2">
								<input
									type="text"
									value={token}
									readOnly
									className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono"
								/>
								<button
									onClick={() => void handleCopyToken()}
									className="px-3 py-2 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
								>
									{tokenCopied ? "Copied!" : "Copy"}
								</button>
								<button
									onClick={() => void handleRegenerateToken()}
									className="px-3 py-2 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
								>
									Regenerate
								</button>
							</div>
							<p className="text-[10px] text-slate-400 mt-1 pl-1">
								Use as: Authorization: Bearer &lt;token&gt;
							</p>
						</div>
					)}
				</div>
			</section>

			{/* Security blacklist */}
			<section>
				<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
					Security Blacklist
				</h3>
				<div className="space-y-2">
					<textarea
						value={blacklist}
						onChange={handleBlacklistChange}
						placeholder={
							"path:Private/\ntag:#secret\ntag:#confidential"
						}
						rows={4}
						className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-mono resize-y"
					/>
					<p className="text-[10px] text-slate-400 pl-1">
						One rule per line. Use <code>path:Folder/</code> to
						block files, <code>tag:#name</code> to block tagged
						tasks.
					</p>
				</div>
			</section>

			{/* Resource subscriptions */}
			<section>
				<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
					Resource Subscriptions
				</h3>
				<div className="flex items-center justify-between">
					<div className="flex flex-col">
						<span className="text-sm font-medium text-slate-700">
							Enable Subscriptions
						</span>
						<span className="text-xs text-slate-400">
							Notify connected clients when vault content changes
						</span>
					</div>
					<ToggleSwitch
						enabled={subscriptionsEnabled}
						onToggle={handleSubscriptionsToggle}
					/>
				</div>
			</section>

			{/* Stats display */}
			{statEntries.length > 0 && (
				<section>
					<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
						Tool Usage Stats
					</h3>
					<div className="space-y-1">
						{statEntries.map(([tool, s]) => (
							<div
								key={tool}
								className="flex items-center justify-between text-xs px-2 py-1 rounded bg-slate-50 dark:bg-slate-800"
							>
								<span className="font-mono text-slate-600 dark:text-slate-300">
									{tool}
								</span>
								<span className="text-slate-400">
									{s.total} calls ({s.successful} ok,{" "}
									{s.failed} fail)
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			{/* Active sessions */}
			{sessions.length > 0 && (
				<section>
					<h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
						Active Sessions
					</h3>
					<div className="space-y-2">
						{sessions.map((s) => (
							<div
								key={s.sessionId}
								className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs space-y-1"
							>
								<div className="flex justify-between">
									<span className="font-mono text-slate-600 dark:text-slate-300">
										...{s.sessionId}
									</span>
									<span className="text-slate-400">
										{s.clientName} {s.clientVersion}
									</span>
								</div>
								<div className="text-slate-400">
									{Math.floor(s.durationSeconds / 60)}m active
									| {s.toolCalls.total} calls (
									{s.toolCalls.successful} ok,{" "}
									{s.toolCalls.failed} fail)
								</div>
							</div>
						))}
					</div>
				</section>
			)}
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

		// Collect available categories and tags from the vault's metadata cache
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const availableCategories = markdownFiles.map((f) => f.path).sort();

		const tagSet = new Set<string>();
		for (const file of markdownFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.tags) {
				for (const t of cache.tags) {
					tagSet.add(t.tag);
				}
			}
			if (cache?.frontmatter) {
				const fm = cache.frontmatter;
				if (typeof fm["tag"] === "string") {
					tagSet.add(
						fm["tag"].startsWith("#") ? fm["tag"] : "#" + fm["tag"],
					);
				}
				if (Array.isArray(fm["tags"])) {
					for (const t of fm["tags"] as string[]) {
						tagSet.add(t.startsWith("#") ? t : "#" + t);
					}
				}
			}
		}
		const availableTags = [...tagSet].sort();

		const mcpTab: CustomSettingsTab = {
			id: "mcp-server",
			label: "MCP Server",
			icon: "Plug",
			content: (
				<McpServerSettings
					enabled={this.plugin.settings.mcpServer.enabled}
					port={this.plugin.settings.mcpServer.port}
					authEnabled={
						this.plugin.settings.mcpServer.authEnabled ?? true
					}
					blacklist={this.plugin.settings.mcpServer.blacklist ?? ""}
					subscriptionsEnabled={
						this.plugin.settings.mcpServer.subscriptionsEnabled ??
						false
					}
					onToggle={async (value) => {
						this.plugin.settings.mcpServer.enabled = value;
						await this.plugin.saveSettings();
						await this.plugin.restartMcpServer();
					}}
					onPortChange={async (port) => {
						this.plugin.settings.mcpServer.port = port;
						await this.plugin.saveSettings();
					}}
					onAuthToggle={async (value) => {
						this.plugin.settings.mcpServer.authEnabled = value;
						await this.plugin.saveSettings();
					}}
					onBlacklistChange={async (value) => {
						this.plugin.settings.mcpServer.blacklist = value;
						await this.plugin.saveSettings();
						this.plugin.updateSecurityBlacklist(value);
					}}
					onSubscriptionsToggle={async (value) => {
						this.plugin.settings.mcpServer.subscriptionsEnabled =
							value;
						await this.plugin.saveSettings();
						await this.plugin.restartMcpServer();
					}}
					getAuthToken={() => this.plugin.getAuthToken()}
					regenerateToken={() => this.plugin.regenerateAuthToken()}
					getStats={() => this.plugin.getMcpStats()}
					getSessionSummaries={() =>
						this.plugin.getMcpSessionSummaries()
					}
				/>
			),
		};

		const tagSettings = new Setting(containerEl);
		this.root = createRoot(tagSettings.settingEl);
		this.root.render(
			<React.StrictMode>
				<SettingsPageWrapper
					initialSettings={resolveSecrets(
						this.app,
						this.plugin.settings.appSetting,
					)}
					onPersistSettings={(s) => {
						const cleaned = extractAndStoreSecrets(this.app, s);
						this.plugin.settings.appSetting = cleaned;
						void this.plugin.saveSettings();
						this.plugin.bus.emit("settings:changed", {});
					}}
					availableCategories={availableCategories}
					availableTags={availableTags}
					inDarkMode={this.plugin.settings.systemInDarkMode}
					customTabs={[mcpTab]}
				/>
			</React.StrictMode>,
		);
	}
}
