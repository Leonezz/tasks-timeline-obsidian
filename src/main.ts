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
import { migrateExistingKeysToSecretStorage } from "./secretStorage";
import { ObsidianMcpServer } from "./mcpServer";

export default class TasksTimelineObsidianPlugin extends Plugin {
	settings: TasksTimelineObsidianPluginSettings;
	themeObserver: MutationObserver;
	bus = new TypedBus<Events>();
	private mcpServer: ObsidianMcpServer | null = null;

	async onload() {
		await this.loadSettings();

		// Start MCP server if enabled
		if (this.settings.mcpServer.enabled) {
			this.mcpServer = new ObsidianMcpServer(this);
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
		this.themeObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (mutation.attributeName === "class") {
					const isDarkMode =
						document.body.classList.contains("theme-dark");
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
		this.themeObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
	}

	onunload() {
		// this.app.workspace.detachLeavesOfType(VIEW_TYPE);
		this.themeObserver.disconnect();
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
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
