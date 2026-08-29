import chalk from "chalk";
import ora from "ora";
import { BLUE, MINT, SLATE } from "./brand.js";
import { FibxError } from "./errors.js";
import { parseEvmError } from "./parse-evm-error.js";

// ── Types ────────────────────────────────────────────────────────────

export interface OutputOptions {
	json: boolean;
}

export interface GlobalOptions extends OutputOptions {
	chain?: string;
}

// ── Terminal Hyperlinks ──────────────────────────────────────────────

function hyperlink(text: string, url: string): string {
	return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// ── Semantic Colorization ────────────────────────────────────────────
// Colors values based on key name, not value type.

function colorizeValue(key: string, value: string): string {
	if (key === "explorer") return chalk.dim(hyperlink(value, value));
	if (key === "txHash") return chalk.hex(BLUE).dim(value);
	if (key === "revertReason") return chalk.red(value);
	if (key === "mode" && value.includes("SIMULATION")) return chalk.yellow(value);
	if (/fee/i.test(key) && !/usd/i.test(key)) return chalk.yellow(value);
	if (/usd/i.test(key)) return chalk.hex(MINT)(value);
	if (typeof value === "string" && /^0x[a-fA-F0-9]{40,}$/.test(value))
		return chalk.hex(BLUE).dim(value);
	return chalk.white(value);
}

function bigintReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

// ── Result Formatting ────────────────────────────────────────────────
// Key-value output with semantic coloring and dynamic label width.

export function formatResult(data: Record<string, unknown>, options?: { json?: boolean }): string {
	if (options?.json) {
		return JSON.stringify(data, bigintReplacer, 2);
	}

	const keys = Object.keys(data);
	const labelWidth = Math.max(12, ...keys.map((k) => k.length)) + 2;

	return Object.entries(data)
		.map(([key, value]) => {
			const label = chalk.dim(key.padEnd(labelWidth));
			const val =
				typeof value === "string" || typeof value === "number"
					? colorizeValue(key, String(value))
					: typeof value === "boolean"
						? value
							? chalk.green("✓")
							: chalk.red("✗")
						: chalk.dim(JSON.stringify(value, bigintReplacer));
			return `  ${label}${val}`;
		})
		.join("\n");
}

// ── Output Helpers ───────────────────────────────────────────────────

export function outputResult(data: Record<string, unknown>, opts: { json?: boolean }): void {
	console.log(formatResult(data, { json: opts.json }));
}

export function outputError(error: unknown, opts: OutputOptions): void {
	if (error instanceof FibxError) {
		if (opts.json) {
			process.stdout.write(JSON.stringify(error.toJSON(), null, 2) + "\n");
		} else {
			console.error(formatError(error));
		}
	} else {
		const msg = error instanceof Error ? error.message : String(error);
		if (opts.json) {
			process.stdout.write(JSON.stringify({ error: true, message: msg }, null, 2) + "\n");
		} else {
			console.error(formatError(error));
		}
	}
	process.exitCode = 1;
}

// ── Table Formatting ─────────────────────────────────────────────────
// Headers with separator and zebra-striped rows.

export function formatTable(headers: string[], rows: string[][]): string {
	const colWidths = headers.map((h, colIdx) =>
		Math.max(h.length, ...rows.map((r) => (r[colIdx] ?? "").length))
	);

	const headerLine =
		"  " + headers.map((h, i) => chalk.bold.white(h.padEnd(colWidths[i]))).join("  ");
	const separator = "  " + colWidths.map((w) => chalk.dim("─".repeat(w))).join("  ");

	const dataLines = rows.map((row, rowIdx) => {
		const isEven = rowIdx % 2 === 0;
		return (
			"  " +
			row
				.map((cell, colIdx) => {
					const padded = (cell ?? "").padEnd(colWidths[colIdx]);
					if (colIdx === 0) return chalk.white(padded);
					return isEven ? chalk.hex(SLATE)(padded) : chalk.dim(padded);
				})
				.join("  ")
		);
	});

	return [headerLine, separator, ...dataLines].join("\n");
}

// ── Error Formatting ─────────────────────────────────────────────────

/**
 * Finds a FibxError anywhere in an error's `cause` chain.
 *
 * On the WalletConnect path the typed error is never the top-level one: the
 * provider throws from inside viem's transport, and viem wraps what it catches
 * as TransactionExecutionError <- UnknownRpcError <- FibxError. Reading only the
 * outermost error sent those through parseEvmError, which matches no
 * WalletConnect pattern and truncates — so the chain went unnamed and the
 * instruction was cut mid-word.
 *
 * The chain comes from a dependency rather than from us, so the walk tracks what
 * it has seen: a cycle ends the loop instead of hanging.
 */
function findFibxError(error: unknown): FibxError | null {
	const seen = new Set<unknown>();
	let current: unknown = error;

	while (current && typeof current === "object" && !seen.has(current)) {
		if (current instanceof FibxError) return current;
		seen.add(current);
		current = (current as { cause?: unknown }).cause;
	}

	return null;
}

export function formatError(error: unknown): string {
	const typed = findFibxError(error);
	if (typed) {
		return chalk.red(`✖ [${typed.code}] ${typed.message}`);
	}
	return chalk.red(`✖ ${parseEvmError(error)}`);
}

// ── Message Helpers ──────────────────────────────────────────────────

export function success(msg: string): string {
	return chalk.hex(MINT).bold(`✔ ${msg}`);
}

export function warn(msg: string): string {
	return chalk.yellow(`⚠ ${msg}`);
}

// ── Spinner ──────────────────────────────────────────────────────────
// Returns ora() on TTY, NonTtySpinner on piped/CI output.

export function createSpinner(text: string) {
	if (!process.stdout.isTTY) {
		return new NonTtySpinner(text);
	}
	return ora({ text, spinner: "dots" });
}

// Minimal shim for non-TTY environments (CI, piped output).
class NonTtySpinner {
	text: string;
	constructor(initialText: string) {
		this.text = initialText;
	}
	start(): this {
		return this;
	}
	stop(): this {
		return this;
	}
	succeed(msg?: string): this {
		if (msg) console.log(success(msg));
		return this;
	}
	fail(msg?: string): this {
		if (msg) console.error(formatError(new Error(msg)));
		return this;
	}
	info(msg?: string): this {
		if (msg) console.log(chalk.hex(BLUE)(`ℹ ${msg}`));
		return this;
	}
	warn(msg?: string): this {
		if (msg) console.log(chalk.yellow(`⚠ ${msg}`));
		return this;
	}
}
