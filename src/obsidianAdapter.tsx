import { TasksTimelineApp } from "@tasks-timeline/components";
import { useMount } from "ahooks";
import { Events } from "eventbus";
import TasksTimelineObsidianPlugin from "main";
import { useEffect, useState } from "react";
import { ObsidianSettingRepo } from "./settingsRepo";
import { ObsidianTasksRepo } from "./tasksRepo";

interface ObsidianAdaptorProps {
	plugin: TasksTimelineObsidianPlugin;
}

export const ObsidianAdaptor = ({ plugin }: ObsidianAdaptorProps) => {
	useMount(() => {
		console.log("ObsidianAdaptor remount");
	});
	const [isDarkMode, setIsDarkMode] = useState(
		plugin.settings.systemInDarkMode
	);
	useEffect(() => {
		return plugin.bus.on(
			"system:themeChange",
			({ isDarkMode }: Events["system:themeChange"]) => {
				setIsDarkMode(isDarkMode);
				console.log("is dark: ", isDarkMode);
			}
		);
	}, [setIsDarkMode]);
	return (
		<TasksTimelineApp
			settingsRepository={new ObsidianSettingRepo(plugin)}
			taskRepository={new ObsidianTasksRepo(plugin)}
			systemInDarkMode={isDarkMode}
			onItemClick={(item) => {
				console.log("item clicked: ", item);
			}}
		/>
	);
};
