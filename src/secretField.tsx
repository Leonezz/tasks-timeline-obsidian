import React, {
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { SecretFieldContext } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "./main";
import {
	readSelectedSecret,
	secretSelectorKey,
} from "./secretStorage";
import type { SecretSelector } from "./secretStorage";
import pluginStyles from "./styles.css?inline";

function secretSelectorFromField(context: SecretFieldContext): SecretSelector {
	const basePath =
		context.scope === "ai"
			? ["aiConfig", "providers", context.provider, "apiKey"]
			: ["voiceConfig", "providers", context.provider, "apiKey"];
	return { path: basePath };
}

function uniqueSorted(values: readonly string[]): string[] {
	return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
		a.localeCompare(b),
	);
}

export function ObsidianSecretField({
	context,
	plugin,
}: {
	context: SecretFieldContext;
	plugin: TasksTimelineObsidianPlugin;
}) {
	const selector = useMemo(() => secretSelectorFromField(context), [context]);
	const selectorKey = secretSelectorKey(selector);
	const selectedSecret = plugin.settings.secretSelectors[selectorKey] ?? "";
	const [secretIds, setSecretIds] = useState<string[]>([]);
	const [hasStoredValue, setHasStoredValue] = useState(false);

	const refreshSecretState = useCallback(() => {
		const ids = plugin.app.secretStorage.listSecrets();
		const secret = selectedSecret
			? plugin.app.secretStorage.getSecret(selectedSecret)
			: null;
		setSecretIds(uniqueSorted([selectedSecret, ...ids]));
		setHasStoredValue(secret !== null && secret.length > 0);
	}, [plugin.app.secretStorage, selectedSecret]);

	useEffect(() => {
		refreshSecretState();
	}, [refreshSecretState]);

	const updateSelectedSecret = useCallback(
		(secretId: string) => {
			if (!secretId) {
				const nextSelectors = { ...plugin.settings.secretSelectors };
				delete nextSelectors[selectorKey];
				plugin.settings.secretSelectors = nextSelectors;
				context.onChange("");
				return;
			}

			plugin.settings.secretSelectors = {
				...plugin.settings.secretSelectors,
				[selectorKey]: secretId,
			};
			context.onChange(
				readSelectedSecret(
					plugin.app,
					selector,
					plugin.settings.secretSelectors,
				) ?? "",
			);
		},
		[context, plugin, selector, selectorKey],
	);

	const hintText = selectedSecret
		? hasStoredValue
			? "Stored in Obsidian key storage."
			: "Selected key has no stored value."
		: "Choose an existing key from Obsidian key storage.";

	return (
		<div className="tasks-timeline-secret-field-stack">
			<style>{pluginStyles}</style>
			<div className="tasks-timeline-secret-select">
				<label
					htmlFor={context.id}
					className="tasks-timeline-secret-select__label"
				>
					Stored key
				</label>
				<select
					id={context.id}
					value={selectedSecret}
					onChange={(event) =>
						updateSelectedSecret(event.currentTarget.value)
					}
					className="tasks-timeline-secret-select__control"
				>
					<option value="">Choose a stored key...</option>
					{secretIds.map((secretId) => (
						<option key={secretId} value={secretId}>
							{secretId}
						</option>
					))}
				</select>
				<p className="tasks-timeline-secret-select__hint">{hintText}</p>
			</div>
			{context.description && (
				<p className="tasks-timeline-secret-select__description">
					{context.description}
				</p>
			)}
		</div>
	);
}
