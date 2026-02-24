import { AppSettings, SettingsRepository } from "@tasks-timeline/components";
import TasksTimelineObsidianPlugin from "main";

export class ObsidianSettingRepo implements SettingsRepository {
	private plugin: TasksTimelineObsidianPlugin;
	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;
	}
	name: string = "Obsidian Settings";
	loadSettings(): Promise<AppSettings | null> {
		// In-memory settings always have secrets resolved
		return Promise.resolve({ ...this.plugin.settings.appSetting });
	}
	saveSettings(settings: AppSettings): Promise<void> {
		// Keep keys in memory; saveSettings() strips them for disk
		this.plugin.settings.appSetting = settings;
		return this.plugin.saveSettings();
	}
}
