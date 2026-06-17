import { LinkCache, SectionCache } from "obsidian";

/** Get the "title" for a file, by stripping other parts of the path as well as the extension. */
export function getFileTitle(path: string): string {
	if (path.includes("/")) path = path.substring(path.lastIndexOf("/") + 1);
	if (path.endsWith(".md")) path = path.substring(0, path.length - 3);
	return path;
}

const HEADER_TOKEN_REGEX = /^[\p{Letter}\p{Number}_-]$/u;
const EMOJI_LIKE_REGEX = /^\p{Extended_Pictographic}$/u;

/**
 * Normalizes the text in a header to be something that is actually linkable to. This mimics
 * how Obsidian does it's normalization, collapsing repeated spaces and stripping out control characters.
 */
export function normalizeHeaderForLink(header: string): string {
	let normalized = "";
	for (const char of header) {
		if (HEADER_TOKEN_REGEX.test(char) || EMOJI_LIKE_REGEX.test(char)) {
			normalized += char;
		} else {
			normalized += " ";
		}
	}
	return normalized.split(/\s+/).join(" ").trim();
}
/** The Obsidian 'link', used for uniquely describing a file, header, or block. */
export class Link {
	/** The file path this link points to. */
	public path: string;
	/** The display name associated with the link. */
	public display?: string;
	/** The block ID or header this link points to within a file, if relevant. */
	public subpath?: string;
	/** Is this link an embedded link (!)? */
	public embed: boolean;
	/** The type of this link, which determines what 'subpath' refers to, if anything. */
	public type: "file" | "header" | "block";

	public withListCache(id?: string, _itemText?: string) {
		return new Link({
			path: this.path,
			display: this.display,
			subpath: id,
			embed: this.embed,
			type: "block",
		});
	}

	public static withLinkCache(cache: LinkCache) {
		return Link.file(cache.link, false, cache.displayText);
	}

	public withSectionCache(cache: SectionCache, text: string) {
		switch (cache.type) {
			case "heading":
				return this.withHeader(text);
			case "list":
				return this.withListCache(cache.id, text);
			case "block":
				return new Link({
					path: this.path,
					display: this.display,
					subpath: cache.id,
					embed: this.embed,
					type: "block",
				});
			default:
				return this.toFile();
		}
	}

	/** Create a link to a specific file. */
	public static file(path: string, embed = false, display?: string) {
		return new Link({
			path,
			embed,
			display,
			subpath: undefined,
			type: "file",
		});
	}

	public static infer(linkpath: string, embed = false, display?: string) {
		if (linkpath.includes("#^")) {
			const split = linkpath.split("#^");
			return Link.block(split[0]!, split[1]!, embed, display);
		} else if (linkpath.includes("#")) {
			const split = linkpath.split("#");
			return Link.header(split[0]!, split[1]!, embed, display);
		} else return Link.file(linkpath, embed, display);
	}

	/** Create a link to a specific file and header in that file. */
	public static header(
		path: string,
		header: string,
		embed?: boolean,
		display?: string
	) {
		// Headers need to be normalized to alpha-numeric & with extra spacing removed.
		return new Link({
			path,
			embed,
			display,
			subpath: normalizeHeaderForLink(header),
			type: "header",
		});
	}

	/** Create a link to a specific file and block in that file. */
	public static block(
		path: string,
		blockId: string,
		embed?: boolean,
		display?: string
	) {
		return new Link({
			path,
			embed,
			display,
			subpath: blockId,
			type: "block",
		});
	}

	public static fromObject(object: Record<string, unknown>) {
		return new Link(object);
	}

	private constructor(fields: Partial<Link>) {
		Object.assign(this, fields);
	}

	/** Checks for link equality (i.e., that the links are pointing to the same exact location). */
	public equals(other: Link): boolean {
		if (other == undefined || other == null) return false;

		return (
			this.path == other.path &&
			this.type == other.type &&
			this.subpath == other.subpath
		);
	}

	/** Convert this link to it's markdown representation. */
	public toString(): string {
		return this.markdown();
	}

	/** Convert this link to a raw object which is serialization-friendly. */
	public toObject(): Record<string, unknown> {
		return {
			path: this.path,
			type: this.type,
			subpath: this.subpath,
			display: this.display,
			embed: this.embed,
		};
	}

	/** Update this link with a new path. */
	public withPath(path: string) {
		return new Link(Object.assign({}, this, { path }));
	}

	/** Return a new link which points to the same location but with a new display value. */
	public withDisplay(display?: string) {
		return new Link(Object.assign({}, this, { display }));
	}

	/** Convert a file link into a link to a specific header. */
	public withHeader(header: string) {
		return Link.header(this.path, header, this.embed, this.display);
	}

	/** Convert any link into a link to its file. */
	public toFile() {
		return Link.file(this.path, this.embed, this.display);
	}

	/** Convert this link into an embedded link. */
	public toEmbed(): Link {
		if (this.embed) {
			return this;
		} else {
			const link = new Link(this);
			link.embed = true;
			return link;
		}
	}

	/** Convert this link into a non-embedded link. */
	public fromEmbed(): Link {
		if (!this.embed) {
			return this;
		} else {
			const link = new Link(this);
			link.embed = false;
			return link;
		}
	}

	/** Convert this link to markdown so it can be rendered. */
	public markdown(): string {
		let result = (this.embed ? "!" : "") + "[[" + this.obsidianLink();

		if (this.display) {
			result += "|" + this.display;
		} else {
			result += "|" + getFileTitle(this.path);
			if (this.type == "header" || this.type == "block")
				result += " > " + this.subpath;
		}

		result += "]]";
		return result;
	}

	/** Convert the inner part of the link to something that Obsidian can open / understand. */
	public obsidianLink(): string {
		const escaped = this.path.replace("|", "\\|");
		if (this.type == "header")
			return escaped + "#" + this.subpath?.replace("|", "\\|");
		if (this.type == "block")
			return escaped + "#^" + this.subpath?.replace("|", "\\|");
		else return escaped;
	}

	/** The stripped name of the file this link points to. */
	public fileName(): string {
		return getFileTitle(this.path).replace(".md", "");
	}
}
