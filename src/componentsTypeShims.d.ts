// Workarounds for broken declarations published in @tasks-timeline/components
// v0.8.0. Delete this file once the package ships self-contained .d.ts files.

// dist/components/settings/*.d.ts still import the library's internal "@/types"
// path alias. Point it at the package's public types entry so those props keep
// their real types instead of failing to resolve.
declare module "@/types" {
	export * from "@tasks-timeline/components/types";
}

// dist/index.d.ts re-exports "./index.css". A stylesheet has no JS exports.
declare module "*.css" {}
