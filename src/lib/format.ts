import chalk from "chalk";
import ora, { type Ora } from "ora";
import { FibxError } from "./errors.js";

export interface OutputOptions {
	json: boolean;
}

export interface GlobalOptions extends OutputOptions {
	chain?: string;
}

export function outputResult(data: unknown, opts: OutputOptions): void {
	if (opts.json) {
		process.stdout.write(JSON.stringify(data, null, 2) + "\n");
	} else if (typeof data === "object" && data !== null) {
		formatTable(data as Record<string, unknown>);
	} else {
		console.log(data);
	}
}

export function outputError(error: unknown, opts: OutputOptions): void {
	if (error instanceof FibxError) {
		if (opts.json) {
			process.stdout.write(JSON.stringify(error.toJSON(), null, 2) + "\n");
		} else {
			console.error(chalk.red(`✗ [${error.code}] ${error.message}`));
		}
	} else {
		const msg = error instanceof Error ? error.message : String(error);
		if (opts.json) {
			process.stdout.write(JSON.stringify({ error: true, message: msg }, null, 2) + "\n");
		} else {
			console.error(chalk.red(`✗ ${msg}`));
		}
	}
	process.exitCode = 1;
}

export async function withSpinner<T>(
	label: string,
	fn: (spinner: Ora) => Promise<T>,
	opts: OutputOptions
): Promise<T> {
	if (opts.json) return fn(ora({ isSilent: true }));

	const spinner = ora(label).start();
	try {
		const result = await fn(spinner);
		spinner.succeed();
		return result;
	} catch (error) {
		spinner.fail();
		throw error;
	}
}

function formatTable(data: Record<string, unknown>): void {
	const maxKeyLen = Math.max(...Object.keys(data).map((k) => k.length));

	for (const [key, value] of Object.entries(data)) {
		console.log(`  ${chalk.dim(key.padEnd(maxKeyLen))}  ${formatValue(value)}`);
	}
}

function formatValue(value: unknown): string {
	if (typeof value === "boolean") return value ? chalk.green("✓") : chalk.red("✗");
	if (typeof value === "number") return chalk.cyan(value.toString());

	if (typeof value === "string") {
		if (/^0x[a-fA-F0-9]{40}$/.test(value)) return chalk.yellow(value);
		return chalk.white(value);
	}

	if (typeof value === "object" && value !== null) return chalk.dim(JSON.stringify(value));
	return String(value);
}
