/**
 * Web globals missing from jest-environment-jsdom.
 *
 * Jest resolves `@tasks-timeline/components` to its UMD bundle, which eagerly
 * loads the AI SDK (eventsource-parser needs `TransformStream`; `TextEncoder`
 * is used at module load). jsdom does not provide these,
 * so take them from Node.
 */
import { TransformStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";

const g = globalThis as Record<string, unknown>;
if (!g.TransformStream) g.TransformStream = TransformStream;
if (!g.TextEncoder) g.TextEncoder = TextEncoder;
if (!g.TextDecoder) g.TextDecoder = TextDecoder;
