import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), authImportCommand: vi.fn() }));

vi.mock("inquirer", () => ({ default: { prompt: mocks.prompt } }));
vi.mock("./import.js", () => ({ authImportCommand: mocks.authImportCommand }));

const { routeChoice, authSetupCommand } = await import("./setup.js");

describe("routeChoice", () => {
	it("routes a wallet the user already has to WalletConnect", () => {
		expect(routeChoice("1")).toBe("connect");
	});

	it("routes an unattended wallet to Privy", () => {
		expect(routeChoice("2")).toBe("privy");
	});

	it("routes a private key to import", () => {
		expect(routeChoice("3")).toBe("import");
	});

	// The combination the research found unavailable. It gets an explanation
	// rather than a path, which is the honest answer.
	it("routes the unavailable combination to an explanation", () => {
		expect(routeChoice("?")).toBe("explain");
	});

	it("treats anything else as the explanation too, rather than guessing", () => {
		expect(routeChoice("")).toBe("explain");
		expect(routeChoice("4")).toBe("explain");
	});
});

/**
 * The hint reads "This path has no limits until you set some" and names a
 * `fibx policy set` command. After a failed or aborted import the user is not
 * on that path at all, so the advice is about a wallet that does not exist —
 * and, worse, it reads as confirmation that the import worked.
 */
describe("the imported-key hint", () => {
	const originalIsTty = process.stdout.isTTY;
	const originalStdinIsTty = process.stdin.isTTY;

	function captureStdout(): string[] {
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		});
		return lines;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		process.stdout.isTTY = true;
		process.stdin.isTTY = true;
		process.exitCode = undefined;
		mocks.prompt.mockResolvedValue({ choice: "3" });
	});

	afterEach(() => {
		process.stdout.isTTY = originalIsTty;
		process.stdin.isTTY = originalStdinIsTty;
		process.exitCode = undefined;
		vi.restoreAllMocks();
	});

	it("prints after an import that succeeded", async () => {
		mocks.authImportCommand.mockResolvedValue(undefined);
		const logged = captureStdout();

		await authSetupCommand({ json: false });

		expect(logged.join("\n")).toContain("fibx policy set");
	});

	// authImportCommand catches its own errors and reports them by setting
	// exitCode rather than throwing, so that is the only signal there is.
	it("stays quiet after an import that failed", async () => {
		mocks.authImportCommand.mockImplementation(async () => {
			process.exitCode = 1;
		});
		const logged = captureStdout();

		await authSetupCommand({ json: false });

		expect(logged.join("\n")).not.toContain("fibx policy set");
		expect(process.exitCode).toBe(1);
	});
});

/**
 * `auth setup` asks a question, and a question needs something on the other
 * end that can answer it. A terminal on stdout is not that thing:
 * `foo | fibx auth setup` renders the list to a TTY and then blocks on a pipe
 * forever.
 */
describe("the terminal guard", () => {
	const originalIsTty = process.stdout.isTTY;
	const originalStdinIsTty = process.stdin.isTTY;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.stdout.isTTY = originalIsTty;
		process.stdin.isTTY = originalStdinIsTty;
		process.exitCode = undefined;
		vi.restoreAllMocks();
	});

	function captureStderr(): string[] {
		const lines: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		});
		return lines;
	}

	it("refuses with no terminal at all, naming the three direct commands", async () => {
		process.stdout.isTTY = false;
		process.stdin.isTTY = false;
		const errors = captureStderr();

		await authSetupCommand({ json: false });

		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(errors.join("\n")).toContain("fibx auth connect");
		expect(errors.join("\n")).toContain("fibx auth import");
		expect(process.exitCode).toBe(1);
	});

	it("refuses when stdout is a terminal but stdin is not", async () => {
		process.stdout.isTTY = true;
		process.stdin.isTTY = false;
		captureStderr();

		await authSetupCommand({ json: false });

		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});
});
