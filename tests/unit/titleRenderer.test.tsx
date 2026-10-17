import { render } from "@testing-library/react";
import type { App } from "obsidian";
import { createRenderTitle } from "../../src/titleRenderer";
import * as obsidian from "../mocks/obsidian";

describe("createRenderTitle", () => {
	const renderTitle = createRenderTitle(new obsidian.App() as unknown as App);

	it.each([
		["plain text", "A long title that should be cut off with an ellipsis"],
		["text around a link", "Read [[Some note]] before the meeting"],
	])(
		"lets the timeline truncate a title with %s on one line",
		(_kind, title) => {
			const { container } = render(<span>{renderTitle(title)}</span>);

			// The title button truncates with white-space: nowrap; nothing
			// inside may switch wrapping back on.
			expect(container.querySelector(".whitespace-pre-wrap")).toBeNull();
			expect(container.textContent).not.toBe("");
		},
	);
});
