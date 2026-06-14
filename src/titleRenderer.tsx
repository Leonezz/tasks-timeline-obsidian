import { App } from "obsidian";
import React from "react";
import { getActiveWindow } from "./obsidianDom";

type TitleSegment =
	| { type: "text"; content: string }
	| { type: "markdown-link"; text: string; url: string }
	| { type: "wikilink"; page: string; display?: string }
	| { type: "bare-url"; url: string };

const linkBaseStyle: React.CSSProperties = {
	cursor: "pointer",
	textDecoration: "underline",
	textUnderlineOffset: "2px",
};

const externalLinkStyle: React.CSSProperties = {
	...linkBaseStyle,
	color: "var(--link-external-color, #705dcf)",
};

const internalLinkStyle: React.CSSProperties = {
	...linkBaseStyle,
	color: "var(--link-color, #7f6df2)",
	textDecoration: "none",
};

/**
 * Combined regex matching link types in priority order (left-to-right):
 * 1. Markdown links: [text](url)
 * 2. Wikilinks: [[page]] or [[page|display]]
 * 3. Bare URLs: https://... or http://...
 *
 * Group mapping:
 *   [1] = markdown link text
 *   [2] = markdown link url
 *   [3] = wikilink page
 *   [4] = wikilink display (optional)
 *   [5] = bare url
 */
const LINK_REGEX =
	/\[([^\]]*)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(https?:\/\/[^\s<>[\]]+)/g;

export function parseTitleSegments(title: string): TitleSegment[] {
	const segments: TitleSegment[] = [];
	let lastIndex = 0;

	const regex = new RegExp(LINK_REGEX.source, "g");
	let match: RegExpExecArray | null;

	while ((match = regex.exec(title)) !== null) {
		if (match.index > lastIndex) {
			segments.push({
				type: "text",
				content: title.slice(lastIndex, match.index),
			});
		}

		if (match[1] !== undefined && match[2] !== undefined) {
			segments.push({
				type: "markdown-link",
				text: match[1],
				url: match[2],
			});
		} else if (match[3] !== undefined) {
			segments.push({
				type: "wikilink",
				page: match[3],
				display: match[4],
			});
		} else if (match[5] !== undefined) {
			segments.push({ type: "bare-url", url: match[5] });
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < title.length) {
		segments.push({ type: "text", content: title.slice(lastIndex) });
	}

	return segments;
}

export function createRenderTitle(
	app: App
): (title: string) => React.ReactNode {
	const handleExternalLink = (e: React.MouseEvent, url: string) => {
		e.preventDefault();
		e.stopPropagation();
		getActiveWindow(app).open(url, "_blank", "noopener");
	};

	const handleInternalLink = (e: React.MouseEvent, page: string) => {
		e.preventDefault();
		e.stopPropagation();
		void app.workspace.openLinkText(page, "", "tab");
	};

	return (title: string): React.ReactNode => {
		const segments = parseTitleSegments(title);

		if (segments.length === 1 && segments[0].type === "text") {
			return title;
		}

		return segments.map(
			(seg: TitleSegment, i: number): React.ReactNode => {
				switch (seg.type) {
					case "text":
						return (
							<span key={i}>{seg.content}</span>
						);
					case "markdown-link":
						return (
							<a
								key={i}
								style={externalLinkStyle}
								href={seg.url}
								onClick={(e) =>
									handleExternalLink(e, seg.url)
								}
								aria-label={`Open ${seg.text} in browser`}
							>
								{seg.text}
							</a>
						);
					case "wikilink":
						return (
							<a
								key={i}
								style={internalLinkStyle}
								data-href={seg.page}
								onClick={(e) =>
									handleInternalLink(e, seg.page)
								}
								aria-label={`Open ${seg.display ?? seg.page} in new tab`}
							>
								{seg.display ?? seg.page}
							</a>
						);
					case "bare-url":
						return (
							<a
								key={i}
								style={externalLinkStyle}
								href={seg.url}
								onClick={(e) =>
									handleExternalLink(e, seg.url)
								}
								aria-label={`Open ${seg.url} in browser`}
							>
								{seg.url}
							</a>
						);
				}
			}
		);
	};
}
