import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { z } from "zod";
import { paths } from "../../lib/config.js";

const configSchema = z.object({
	rpcUrls: z.record(z.string(), z.string()).default({}), // chainName -> url
});

export type Config = z.infer<typeof configSchema>;

function getConfigPath(): string {
	return join(paths.config, "config.json");
}

let cachedConfig: Config | null = null;
let lastMtime = 0;

function updateMtime(): void {
	try {
		const filePath = getConfigPath();
		if (existsSync(filePath)) {
			lastMtime = statSync(filePath).mtimeMs;
		}
	} catch {
		// Ignore
	}
}

export class ConfigService {
	private static instance: ConfigService;

	private constructor() {}

	public static getInstance(): ConfigService {
		if (!ConfigService.instance) {
			ConfigService.instance = new ConfigService();
		}
		return ConfigService.instance;
	}

	private refreshIfChanged(): void {
		try {
			const filePath = getConfigPath();
			if (!existsSync(filePath)) return;
			const mtime = statSync(filePath).mtimeMs;
			if (mtime > lastMtime) {
				cachedConfig = null; // Force reload on next load()
				lastMtime = mtime;
			}
		} catch {
			// File may have been deleted between check and stat
		}
	}

	public load(): Config {
		this.refreshIfChanged();
		if (cachedConfig) return cachedConfig;

		const filePath = getConfigPath();
		try {
			if (!existsSync(filePath)) {
				return { rpcUrls: {} };
			}
			const raw = readFileSync(filePath, "utf-8");
			const result = configSchema.safeParse(JSON.parse(raw));
			if (result.success) {
				cachedConfig = result.data;
				updateMtime();
				return result.data;
			}
		} catch {
			// noop
		}
		return { rpcUrls: {} };
	}

	public save(config: Config): void {
		const filePath = getConfigPath();
		try {
			mkdirSync(dirname(filePath), { recursive: true });
			configSchema.parse(config);
			writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
			cachedConfig = config;
			updateMtime();
		} catch (error) {
			console.error("Failed to save config:", error);
		}
	}

	public getRpcUrl(chain: string): string | undefined {
		const config = this.load();
		return config.rpcUrls[chain];
	}

	public setRpcUrl(chain: string, url: string): void {
		const config = this.load();
		config.rpcUrls[chain] = url;
		this.save(config);
	}

	public resetRpcUrl(chain: string): void {
		const config = this.load();
		delete config.rpcUrls[chain];
		this.save(config);
	}

	public resetAll(): void {
		this.save({ rpcUrls: {} });
	}

	public getConfig(): Config {
		return this.load();
	}
}

export const configService = ConfigService.getInstance();
