import { AppSettings, SettingsRepository } from "@tasks-timeline/components";
import TasksTimelineObsidianPlugin from "main";
import { resolveSecrets, extractAndStoreSecrets } from "./secretStorage";

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
					const settings = resolveSecrets(
						this.plugin.app,
						this.plugin.settings.appSetting
					);
					rsv(settings);
				})
				.catch((e) => {
					if (e instanceof Error) rej(e);
					else rej(new Error(String(e)));
				});
		});
	}
	saveSettings(settings: AppSettings): Promise<void> {
		const cleaned = extractAndStoreSecrets(this.plugin.app, settings);
		this.plugin.settings.appSetting = cleaned;
		return this.plugin.saveSettings();
	}
}
