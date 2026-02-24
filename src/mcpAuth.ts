import crypto from "node:crypto";
import type { App } from "obsidian";
import { hasSecretStorage } from "./secretStorage";

const SECRET_KEY = "tasks-timeline-mcp-auth-token";

/**
 * Manages bearer-token authentication for the MCP server.
 *
 * - Stores the token in Obsidian's SecretStorage.
 * - Auto-generates a 32-char hex token on first access.
 * - Uses timing-safe comparison to prevent timing attacks.
 */
export class McpAuthManager {
	private app: App;
	private cachedToken: string | null = null;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Returns the current auth token, generating one if none exists.
	 */
	async getToken(): Promise<string> {
		if (this.cachedToken) {
			return this.cachedToken;
		}

		if (hasSecretStorage(this.app)) {
			const stored = this.app.secretStorage.getSecret(SECRET_KEY);
			if (stored) {
				this.cachedToken = stored;
				return stored;
			}
		}

		// Generate a new token
		const token = crypto.randomBytes(16).toString("hex");
		await this.storeToken(token);
		return token;
	}

	/**
	 * Regenerates the auth token. Returns the new token.
	 */
	async regenerateToken(): Promise<string> {
		const token = crypto.randomBytes(16).toString("hex");
		await this.storeToken(token);
		return token;
	}

	/**
	 * Validates a provided token against the stored token.
	 * Uses timing-safe comparison to prevent timing attacks.
	 */
	async validateToken(provided: string): Promise<boolean> {
		const expected = await this.getToken();

		if (provided.length !== expected.length) {
			return false;
		}

		try {
			const a = Buffer.from(provided, "utf8");
			const b = Buffer.from(expected, "utf8");
			return crypto.timingSafeEqual(a, b);
		} catch {
			return false;
		}
	}

	private async storeToken(token: string): Promise<void> {
		this.cachedToken = token;
		if (hasSecretStorage(this.app)) {
			this.app.secretStorage.setSecret(SECRET_KEY, token);
		}
	}
}
