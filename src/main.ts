import { Notice, Plugin } from "obsidian";
import {
	CURRENT_SETTINGS_VERSION,
	DEFAULT_SETTINGS,
	TasksTimelinePluginSettings as TasksTimelineObsidianPluginSettings,
	TasksTimelineSettingTab,
} from "./settings";
import { TasksTimelineObsidianView, VIEW_TYPE } from "./view";
import { Events, TypedBus } from "./eventbus";
import { migrateSettings } from "./settingsMigration";
import {
	extractAndStoreSecrets,
	migrateExistingKeysToSecretStorage,
	resolveSecrets,
} from "./secretStorage";
import { ObsidianMcpServer, type SessionSummary } from "./mcpServer";
import { McpAuthManager } from "./mcpAuth";
import { StatsTracker, type StatsData } from "./mcpStats";
import "./styles.css";
import { getActiveDocument, getActiveWindow } from "./obsidianDom";

export default class TasksTimelineObsidianPlugin extends Plugin {
	settings: TasksTimelineObsidianPluginSettings;
	themeObserver: MutationObserver | null = null;
	bus = new TypedBus<Events>();
	private mcpServer: ObsidianMcpServer | null = null;
	private authManager: McpAuthManager | null = null;
	private statsTracker: StatsTracker | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize auth manager
		this.authManager = new McpAuthManager(this.app);

		// Initialize stats tracker
		const savedData = (await this.loadData()) as Record<
			string,
			unknown
		> | null;
		const initialStats =
			(savedData?.mcpStats as StatsData | undefined) ?? {};
		this.statsTracker = new StatsTracker(initialStats, async (stats) => {
			const data =
				((await this.loadData()) as Record<string, unknown>) ?? {};
			await this.saveData({ ...data, mcpStats: stats });
		}, getActiveWindow(this.app));

		// Start MCP server if enabled
		if (this.settings.mcpServer.enabled) {
			await this.startMcpServer();
		}

		// This creates an icon in the left ribbon.
		this.addRibbonIcon("dice", "Timeline view", (evt: MouseEvent) => {
			void this.activateView();
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TasksTimelineSettingTab(this.app, this));

		this.registerView(VIEW_TYPE, (leaf) => {
			const view = new TasksTimelineObsidianView(leaf, this);
			return view;
		});
		await this.activateView();
		const activeDocument = getActiveDocument(this.app);
		const activeWindow = getActiveWindow(this.app);
		const { body } = activeDocument;
		const MutationObserverCtor = (
			activeWindow as unknown as {
				MutationObserver: typeof MutationObserver;
			}
		).MutationObserver;
		this.themeObserver = new MutationObserverCtor((mutations) => {
			mutations.forEach((mutation: MutationRecord) => {
				if (mutation.attributeName === "class") {
					const isDarkMode = body.classList.contains("theme-dark");
					console.debug(
						"Theme changed. Dark mode active:",
						isDarkMode,
					);
					this.settings.systemInDarkMode = isDarkMode;
					this.bus.emit("system:themeChange", {
						isDarkMode: isDarkMode,
					});
				}
			});
		});
		this.themeObserver.observe(body, {
			attributes: true,
			attributeFilter: ["class"],
		});
	}

	onunload() {
		// this.app.workspace.detachLeavesOfType(VIEW_TYPE);
		this.themeObserver?.disconnect();
		this.themeObserver = null;

		// Flush stats before shutdown
		if (this.statsTracker) {
			void this.statsTracker.flush();
		}

		if (this.mcpServer) {
			void this.mcpServer.stop();
			this.mcpServer = null;
		}
	}

	async loadSettings() {
		const raw = (await this.loadData()) as
			| Partial<TasksTimelineObsidianPluginSettings>
			| undefined;

		const appSetting = migrateSettings(
			raw?.appSetting,
			DEFAULT_SETTINGS.appSetting,
		);

		this.settings = {
			systemInDarkMode:
				raw?.systemInDarkMode ?? DEFAULT_SETTINGS.systemInDarkMode,
			appSetting,
			_settingsVersion: raw?._settingsVersion,
			mcpServer: {
				...DEFAULT_SETTINGS.mcpServer,
				...raw?.mcpServer,
			},
		};

		// One-time migration: move plaintext keys to SecretStorage
		if (
			this.settings._settingsVersion === undefined ||
			this.settings._settingsVersion < CURRENT_SETTINGS_VERSION
		) {
			this.settings.appSetting = migrateExistingKeysToSecretStorage(
				this.app,
				this.settings.appSetting,
			);
			this.settings._settingsVersion = CURRENT_SETTINGS_VERSION;
			await this.saveSettings();
		}

		// Always keep secrets resolved in memory
		this.settings.appSetting = resolveSecrets(
			this.app,
			this.settings.appSetting,
		);
	}

	private async startMcpServer(): Promise<void> {
		this.mcpServer = new ObsidianMcpServer(this);

		if (this.authManager) {
			this.mcpServer.setAuthManager(this.authManager);
		}
		if (this.statsTracker) {
			this.mcpServer.setStatsTracker(this.statsTracker);
		}

		try {
			await this.mcpServer.start();
		} catch (error) {
			console.error("Failed to start MCP server:", error);
			new Notice(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"MCP server failed to start. Check console for details.",
			);
		}
	}

	async restartMcpServer(): Promise<void> {
		if (this.mcpServer) {
			await this.mcpServer.stop();
			this.mcpServer = null;
		}

		if (this.settings.mcpServer.enabled) {
			await this.startMcpServer();
		}
	}

	async saveSettings() {
		// Strip secrets for disk storage, but keep them in memory
		const forDisk = {
			...this.settings,
			appSetting: extractAndStoreSecrets(
				this.app,
				this.settings.appSetting,
			),
		};
		await this.saveData(forDisk);
	}

	// --- MCP helper methods for settings UI ---

	async getAuthToken(): Promise<string> {
		if (!this.authManager) {
			this.authManager = new McpAuthManager(this.app);
		}
		return this.authManager.getToken();
	}

	async regenerateAuthToken(): Promise<string> {
		if (!this.authManager) {
			this.authManager = new McpAuthManager(this.app);
		}
		return this.authManager.regenerateToken();
	}

	getMcpStats(): StatsData {
		return this.statsTracker?.getStats() ?? {};
	}

	getMcpSessionSummaries(): SessionSummary[] {
		return this.mcpServer?.getSessionSummaries() ?? [];
	}

	updateSecurityBlacklist(blacklist: string): void {
		if (this.mcpServer) {
			this.mcpServer.getSecurityManager().updateRules(blacklist);
		}
	}

	async activateView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (leaves.length > 0) {
			this.app.workspace.setActiveLeaf(leaves[0]!, { focus: true });
			return;
		}

		// this.app.workspace.detachLeavesOfType(VIEW_TYPE);
		try {
			await this.app.workspace.getRightLeaf(false)?.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		} catch (e) {
			console.warn("activate view failed with err: ", e);
		}
	}
}
