/**
 * Mock implementation of Obsidian API for testing
 * This provides minimal but functional implementations of Obsidian classes
 */

export interface Pos {
	start: { line: number; col: number; offset: number };
	end: { line: number; col: number; offset: number };
}

export interface ListItemCache {
	position: Pos;
	parent: number;
	task?: string;
}

export interface SectionCache {
	type: string;
	position: Pos;
	id?: string;
}

export interface LinkCache {
	link: string;
	original: string;
	position: Pos;
	displayText?: string;
}

export interface FrontMatterCache {
	[key: string]: unknown;
	tag?: string;
	tags?: string[];
}

export interface TagCache {
	tag: string;
	position: Pos;
}

export interface CachedMetadata {
	listItems?: ListItemCache[];
	sections?: SectionCache[];
	links?: LinkCache[];
	frontmatter?: FrontMatterCache;
	tags?: TagCache[];
}

export class TFile {
	path: string;
	basename: string;
	extension: string;
	name: string;
	parent: TFolder | null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.basename = this.name.replace(/\.\w+$/, '');
		this.extension = this.name.includes('.') ? this.name.split('.').pop() || '' : '';
		this.parent = null;
	}
}

export class TFolder {
	path: string;
	name: string;
	parent: TFolder | null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.parent = null;
	}
}

export type TAbstractFile = TFile | TFolder;

export class Vault {
	private files = new Map<string, TFile>();
	private fileContents = new Map<string, string>();

	// Mock method to add files for testing
	_addFile(path: string, content: string) {
		const file = new TFile(path);
		this.files.set(path, file);
		this.fileContents.set(path, content);
	}

	getMarkdownFiles(): TFile[] {
		return Array.from(this.files.values())
			.filter(f => f.extension === 'md');
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.files.get(path) || null;
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.fileContents.get(file.path) || '';
	}

	async read(file: TFile): Promise<string> {
		return this.cachedRead(file);
	}

	async process(
		file: TFile,
		fn: (content: string) => string
	): Promise<void> {
		const content = await this.read(file);
		const newContent = fn(content);
		this.fileContents.set(file.path, newContent);
	}

	async modify(file: TFile, content: string): Promise<void> {
		this.fileContents.set(file.path, content);
	}

	async delete(file: TFile): Promise<void> {
		this.files.delete(file.path);
		this.fileContents.delete(file.path);
	}
}

export class MetadataCache {
	private cache = new Map<string, CachedMetadata>();

	// Mock method to set cache for testing
	_setCache(path: string, metadata: CachedMetadata) {
		this.cache.set(path, metadata);
	}

	getFileCache(file: TFile): CachedMetadata | null {
		return this.cache.get(file.path) || null;
	}

	getCache(path: string): CachedMetadata | null {
		return this.cache.get(path) || null;
	}
}

export class Notice {
	message: string;
	timeout?: number;

	constructor(message: string, timeout?: number) {
		this.message = message;
		this.timeout = timeout;
		// In tests, just log to console
		// eslint-disable-next-line no-console
		console.log(`[Notice] ${message}`);
	}
}

export class Plugin {
	app: App;
	manifest: PluginManifest;

	constructor() {
		this.app = new App();
		this.manifest = {
			id: 'test-plugin',
			name: 'Test Plugin',
			version: '0.0.1',
			minAppVersion: '1.11.4',
			description: 'Test plugin',
			author: 'Test',
			authorUrl: '',
			isDesktopOnly: false,
		};
	}

	async loadData(): Promise<unknown> {
		return {};
	}

	async saveData(data: unknown): Promise<void> {
		// Mock implementation
	}

	addCommand(command: Command): Command {
		return command;
	}

	addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement {
		return document.createElement('div');
	}

	registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => ItemView): void {
		// Mock implementation
	}

	registerMarkdownPostProcessor(
		processor: (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void,
		sortOrder?: number
	): void {
		// Mock implementation
	}
}

export interface Command {
	id: string;
	name: string;
	callback?: () => void;
	checkCallback?: (checking: boolean) => boolean;
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description: string;
	author: string;
	authorUrl: string;
	isDesktopOnly: boolean;
}

export class SecretStorage {
	private secrets = new Map<string, string>();

	setSecret(id: string, secret: string): void {
		this.secrets.set(id, secret);
	}

	getSecret(id: string): string | null {
		return this.secrets.get(id) ?? null;
	}

	listSecrets(): string[] {
		return Array.from(this.secrets.keys());
	}
}

export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	workspace: Workspace;
	secretStorage: SecretStorage;

	constructor() {
		this.vault = new Vault();
		this.metadataCache = new MetadataCache();
		this.workspace = new Workspace();
		this.secretStorage = new SecretStorage();
	}
}

export class Workspace {
	getLeaf(newLeaf?: boolean): WorkspaceLeaf {
		return new WorkspaceLeaf();
	}

	getLeavesOfType(viewType: string): WorkspaceLeaf[] {
		return [];
	}

	detachLeavesOfType(viewType: string): void {
		// Mock implementation
	}

	revealLeaf(leaf: WorkspaceLeaf): void {
		// Mock implementation
	}
}

export class WorkspaceLeaf {
	view: ItemView | null = null;

	async setViewState(viewState: { type: string; active?: boolean; state?: unknown }): Promise<void> {
		// Mock implementation
	}

	detach(): void {
		// Mock implementation
	}

	getViewState(): { type: string; state?: unknown } {
		return { type: 'empty' };
	}
}

export class ItemView {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		this.app = new App();
		this.leaf = leaf;
		this.containerEl = document.createElement('div');
	}

	getViewType(): string {
		return 'test-view';
	}

	getDisplayText(): string {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		return 'Test View';
	}

	async onOpen(): Promise<void> {
		// Mock implementation
	}

	async onClose(): Promise<void> {
		// Mock implementation
	}

	getIcon(): string {
		return 'document';
	}
}

export interface MarkdownPostProcessorContext {
	docId: string;
	sourcePath: string;
	frontmatter: unknown;
	addChild(child: Component): void;
	getSectionInfo(el: HTMLElement): { lineStart: number; lineEnd: number } | null;
}

export class Component {
	load(): void {
		// Mock implementation
	}

	onload(): void {
		// Mock implementation
	}

	unload(): void {
		// Mock implementation
	}

	onunload(): void {
		// Mock implementation
	}

	addChild<T extends Component>(child: T): T {
		return child;
	}

	removeChild<T extends Component>(child: T): T {
		return child;
	}

	register(cb: () => void): void {
		// Mock implementation
	}

	registerEvent(event: unknown): void {
		// Mock implementation
	}

	registerDomEvent<K extends keyof WindowEventMap>(
		el: Window | Document,
		type: K,
		callback: (this: HTMLElement, ev: WindowEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void;
	registerDomEvent<K extends keyof DocumentEventMap>(
		el: Document,
		type: K,
		callback: (this: HTMLElement, ev: DocumentEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void;
	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void;
	registerDomEvent(
		el: HTMLElement | Window | Document,
		type: string,
		callback: (this: HTMLElement, ev: Event) => void,
		options?: boolean | AddEventListenerOptions
	): void {
		// Mock implementation
	}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement('div');
	}

	display(): void {
		// Mock implementation
	}

	hide(): void {
		// Mock implementation
	}
}
