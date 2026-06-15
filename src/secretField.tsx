import { SecretComponent } from "obsidian";
import React, { useEffect, useMemo, useRef } from "react";
import type { SecretFieldContext } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "./main";
import {
	readSelectedSecret,
	secretIdFromSelector,
	secretSelectorKey,
} from "./secretStorage";
import type { SecretSelector } from "./secretStorage";

function secretSelectorFromField(context: SecretFieldContext): SecretSelector {
	const basePath =
		context.scope === "ai"
			? ["aiConfig", "providers", context.provider, "apiKey"]
			: ["voiceConfig", "providers", context.provider, "apiKey"];
	return { path: basePath };
}

export function ObsidianSecretField({
	context,
	plugin,
}: {
	context: SecretFieldContext;
	plugin: TasksTimelineObsidianPlugin;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const selector = useMemo(() => secretSelectorFromField(context), [context]);
	const selectorKey = secretSelectorKey(selector);
	const selectedSecret =
		plugin.settings.secretSelectors[selectorKey] ??
		secretIdFromSelector(selector);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		container.replaceChildren();
		const component = new SecretComponent(plugin.app, container);
		component.setValue(selectedSecret);
		component.onChange((value) => {
			plugin.settings.secretSelectors = {
				...plugin.settings.secretSelectors,
				[selectorKey]: value,
			};
			context.onChange(
				readSelectedSecret(
					plugin.app,
					selector,
					plugin.settings.secretSelectors,
				) ?? "",
			);
		});

		return () => {
			const unload = (component as { unload?: unknown }).unload;
			if (typeof unload === "function") {
				unload.call(component);
			}
		};
	}, [context, plugin, selectedSecret, selector, selectorKey]);

	return (
		<div className="space-y-1">
			<div
				id={context.id}
				ref={containerRef}
				className="tasks-timeline-secret-selector rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
			/>
			{context.description && (
				<p className="text-[10px] text-slate-400">
					{context.description}
				</p>
			)}
		</div>
	);
}
