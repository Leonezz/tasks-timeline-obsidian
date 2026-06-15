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
	secretIdFromSelector,
	secretSelectorKey,
} from "./secretStorage";
import type { SecretSelector } from "./secretStorage";
import pluginStyles from "./styles.css?inline";

const SECRET_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

function secretSelectorFromField(context: SecretFieldContext): SecretSelector {
	const basePath =
		context.scope === "ai"
			? ["aiConfig", "providers", context.provider, "apiKey"]
			: ["voiceConfig", "providers", context.provider, "apiKey"];
	return { path: basePath };
}

function isValidSecretId(value: string): boolean {
	return SECRET_ID_PATTERN.test(value);
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
	const defaultSecretId = secretIdFromSelector(selector);
	const selectedSecret =
		plugin.settings.secretSelectors[selectorKey] ?? defaultSecretId;
	const [secretIds, setSecretIds] = useState<string[]>([]);
	const [customSecretId, setCustomSecretId] = useState("");
	const [secretDraft, setSecretDraft] = useState("");
	const [statusText, setStatusText] = useState("");
	const [errorText, setErrorText] = useState("");
	const [hasStoredValue, setHasStoredValue] = useState(false);

	const refreshSecretState = useCallback(() => {
		const ids = plugin.app.secretStorage.listSecrets();
		const secret = plugin.app.secretStorage.getSecret(selectedSecret);
		setSecretIds(uniqueSorted([defaultSecretId, selectedSecret, ...ids]));
		setHasStoredValue(secret !== null && secret.length > 0);
	}, [defaultSecretId, plugin.app.secretStorage, selectedSecret]);

	useEffect(() => {
		refreshSecretState();
	}, [refreshSecretState]);

	const updateSelectedSecret = useCallback(
		(secretId: string) => {
			if (!isValidSecretId(secretId)) {
				setErrorText(
					"Secret names can use lowercase letters, numbers, and dashes.",
				);
				return;
			}

			setErrorText("");
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
			setStatusText("Secret selector updated.");
		},
		[context, plugin, selector, selectorKey],
	);

	const handleUseCustomSecret = () => {
		const nextSecretId = customSecretId.trim();
		updateSelectedSecret(nextSecretId);
		if (isValidSecretId(nextSecretId)) {
			setCustomSecretId("");
		}
	};

	const handleSaveSecret = () => {
		if (!isValidSecretId(selectedSecret)) {
			setErrorText("Choose a valid secret selector first.");
			return;
		}
		if (secretDraft.length === 0) {
			setErrorText("Paste a key value before saving.");
			return;
		}

		plugin.app.secretStorage.setSecret(selectedSecret, secretDraft);
		setSecretDraft("");
		setErrorText("");
		setStatusText("Secret value saved.");
		context.onChange(secretDraft);
		refreshSecretState();
	};

	const options = uniqueSorted([
		defaultSecretId,
		selectedSecret,
		...secretIds,
	]);
	const selectedLabel =
		selectedSecret === defaultSecretId
			? `${selectedSecret} (default)`
			: selectedSecret;

	return (
		<div className="tasks-timeline-secret-field-stack">
			<style>{pluginStyles}</style>
			<div className="tasks-timeline-secret-field">
				<div className="tasks-timeline-secret-field__header">
					<div className="tasks-timeline-secret-field__identity">
						<p className="tasks-timeline-secret-field__eyebrow">
							Obsidian key storage
						</p>
						<p className="tasks-timeline-secret-field__name">
							{selectedLabel}
						</p>
						<p className="tasks-timeline-secret-field__hint">
							{hasStoredValue
								? "A value is stored for this selector."
								: "No value is stored for this selector yet."}
						</p>
					</div>
					<span
						className={[
							"tasks-timeline-secret-field__status",
							hasStoredValue
								? "tasks-timeline-secret-field__status--stored"
								: "tasks-timeline-secret-field__status--empty",
						].join(" ")}
					>
						{hasStoredValue ? "Stored" : "Empty"}
					</span>
				</div>

				<label
					htmlFor={context.id}
					className="tasks-timeline-secret-field__label"
				>
					Selector
				</label>
				<select
					id={context.id}
					value={selectedSecret}
					onChange={(event) =>
						updateSelectedSecret(event.currentTarget.value)
					}
					className="tasks-timeline-secret-field__control"
				>
					{options.map((secretId) => (
						<option key={secretId} value={secretId}>
							{secretId === defaultSecretId
								? `${secretId} (default)`
								: secretId}
						</option>
					))}
				</select>

				<div className="tasks-timeline-secret-field__row">
					<input
						type="text"
						value={customSecretId}
						onChange={(event) =>
							setCustomSecretId(event.currentTarget.value)
						}
						placeholder="custom-secret-name"
						className="tasks-timeline-secret-field__control tasks-timeline-secret-field__control--mono"
					/>
					<button
						type="button"
						onClick={handleUseCustomSecret}
						disabled={!customSecretId.trim()}
						className="tasks-timeline-secret-field__button tasks-timeline-secret-field__button--secondary"
					>
						Use
					</button>
				</div>

				<div className="tasks-timeline-secret-field__row">
					<input
						type="password"
						value={secretDraft}
						onChange={(event) =>
							setSecretDraft(event.currentTarget.value)
						}
						placeholder="Paste a new key value..."
						autoComplete="off"
						className="tasks-timeline-secret-field__control"
					/>
					<button
						type="button"
						onClick={handleSaveSecret}
						disabled={secretDraft.length === 0}
						className="tasks-timeline-secret-field__button tasks-timeline-secret-field__button--primary"
					>
						Save value
					</button>
				</div>

				{(errorText || statusText) && (
					<p
						className={[
							"tasks-timeline-secret-field__message",
							errorText
								? "tasks-timeline-secret-field__message--error"
								: "",
						].join(" ")}
					>
						{errorText || statusText}
					</p>
				)}
			</div>
			{context.description && (
				<p className="tasks-timeline-secret-field__description">
					{context.description}
				</p>
			)}
		</div>
	);
}
