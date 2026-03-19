import { createSpinner, formatError } from "./format.js";

type Spinner = ReturnType<typeof createSpinner>;

/**
 * Wraps the standard CLI spinner + try/catch + process.exitCode pattern.
 * Use for simple commands with a single spinner lifecycle.
 * Multi-step spinner commands should keep their manual pattern.
 */
export async function runCommand<T>(
	spinnerText: string,
	successText: string,
	failText: string,
	fn: (spinner: Spinner) => Promise<T>,
	render: (data: T) => void
): Promise<void> {
	const spinner = createSpinner(spinnerText).start();
	try {
		const result = await fn(spinner);
		spinner.succeed(successText);
		render(result);
	} catch (error) {
		spinner.fail(failText);
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
