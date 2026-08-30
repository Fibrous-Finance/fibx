import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
	prompt: vi.fn(),
	authImportCommand: vi.fn(),
	loadSession: vi.fn(),
}));

vi.mock("inquirer", () => ({
	default: {
		prompt: mocks.prompt,
		// SIGNING_PROMPT builds one at module load, so the mock has to carry it.
		Separator: class {
			readonly separator = "\u2500\u2500";
		},
	},
}));
vi.mock("./import.js", () => ({ authImportCommand: mocks.authImportCommand }));
// Never let the intro line read the developer's real session file.
vi.mock("../../services/auth/session.js", () => ({ loadSession: mocks.loadSession }));

const { routeChoice, authSetupCommand, SIGNING_PROMPT } = await import("./setup.js");

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

	it("routes the cancel choice to leaving everything alone", () => {
		expect(routeChoice("cancel")).toBe("cancel");
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

/**
 * `auth setup` shipped with `type: "list"`, which inquirer 13 no longer
 * registers — it renamed that prompt to `select`. An unregistered type does not
 * throw: it renders a prompt with no choices, accepts a keypress, and returns a
 * value matching none of them, so the command silently fell through to the
 * explanation whatever the user pressed. Every test passed, because the only
 * one that existed covered `routeChoice`, which is pure and was never wrong.
 */
describe("the prompt's shape", () => {
	it("uses a prompt type inquirer actually registers", async () => {
		const actual = (await vi.importActual("inquirer")) as {
			default: { prompt: { prompts: Record<string, unknown> } };
		};
		const registered = Object.keys(actual.default.prompt.prompts);

		expect(registered).toContain(SIGNING_PROMPT.type);
	});

	it("offers every route the router knows, and no dead ones", () => {
		// Separators carry no value; everything else must route somewhere real.
		const values = SIGNING_PROMPT.choices
			.map((choice) => (choice as { value?: string }).value)
			.filter((value) => value !== undefined);

		expect(values).toEqual(["1", "2", "3", "?", "cancel"]);
		expect(new Set(values.map(routeChoice))).toEqual(
			new Set(["connect", "privy", "import", "explain", "cancel"])
		);
	});
});
