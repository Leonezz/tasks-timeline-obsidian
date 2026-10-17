import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(__dirname, "../../src/styles.css"), "utf8");

describe("the plugin's styles", () => {
	it("take every color from the library's theme tokens", () => {
		// Hard-coded colors don't follow the theme (and slate-400 text is
		// about 2.5:1 on light backgrounds).
		expect(css.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
		expect(css).toMatch(/hsl\(var\(--muted-foreground\)\)/);
	});

	it("style no theme on its own (coffee is a light theme)", () => {
		expect(css).not.toMatch(/data-theme/);
	});
});
