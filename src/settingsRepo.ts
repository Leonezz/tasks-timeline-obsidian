import { AppSettings, SettingsRepository } from "@tasks-timeline/components";
import TasksTimelineObsidianPlugin from "main";

export class ObsidianSettingRepo implements SettingsRepository {
	private plugin: TasksTimelineObsidianPlugin;
	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;
	}
	name: string = "Obsidian Settings";
	loadSettings(): Promise<AppSettings | null> {
		return new Promise((rsv, rej) => {
			this.plugin
				.loadSettings()
				.then(() => {
					rsv(this.plugin.settings.appSetting);
				})
				.catch((e) => rej(e));
		});
	}
	saveSettings(settings: AppSettings): Promise<void> {
		this.plugin.settings.appSetting = settings;
		return this.plugin.saveSettings();
	}
}
