import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	TasksTimelinePluginSettings as TasksTimelineObsidianPluginSettings,
	TasksTimelineSettingTab,
} from "./settings";
import { TasksTimelineObsidianView, VIEW_TYPE } from "./view";
import { Events, TypedBus } from "./eventbus";

export default class TasksTimelineObsidianPlugin extends Plugin {
	settings: TasksTimelineObsidianPluginSettings;
	themeObserver: MutationObserver;
	bus = new TypedBus<Events>();

	async onload() {
		await this.loadSettings();

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
					console.log("Theme changed. Dark mode active:", isDarkMode);
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
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TasksTimelineObsidianPluginSettings>
		);
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
