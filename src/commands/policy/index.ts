import type { Command } from "commander";
import chalk from "chalk";
import { CHAIN_NAMES } from "../../services/chain/constants.js";
import { clearPolicy, loadPolicy, policyPath, savePolicy } from "../../services/policy/store.js";
import type { Policy } from "../../services/policy/types.js";
import { formatError, success, warn } from "../../lib/format.js";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function assertChain(chain: string): void {
	if (!(CHAIN_NAMES as readonly string[]).includes(chain)) {
		throw new Error(`Unknown chain: ${chain}. Known: ${CHAIN_NAMES.join(", ")}.`);
	}
}

/**
 * Applies one rule to a policy and returns the result. Pure, and validating —
 * storing a value the evaluator will not honour is worse than storing nothing,
 * because the user believes they have a limit they do not have.
 */
export function applyRule(policy: Policy, rule: string, value: string): Policy {
	const next: Policy = { ...policy };

	if (rule === "expiry") {
		if (Number.isNaN(new Date(value).getTime())) {
			throw new Error(`"${value}" is not a date. Use YYYY-MM-DD.`);
		}
		next.expiry = value;
		return next;
	}

	if (rule === "allowedChains") {
		const chains = value
			.split(",")
			.map((c) => c.trim())
			.filter(Boolean);
		chains.forEach(assertChain);
		next.allowedChains = chains;
		return next;
	}

	const [chain, chainRule] = rule.split(".");
	if (!chain || !chainRule) {
		throw new Error(
			`Unknown rule: ${rule}. Try <chain>.maxValue, <chain>.allowedDestinations, allowedChains or expiry.`
		);
	}
	assertChain(chain);

	if (chainRule === "maxValue") {
		if (!/^\d+(\.\d+)?$/.test(value)) {
			throw new Error(
				`"${value}" is not a number. Give an amount in native units, e.g. 0.05.`
			);
		}
		next.maxValue = { ...next.maxValue, [chain]: value };
		return next;
	}

	if (chainRule === "allowedDestinations") {
		const addresses = value
			.split(",")
			.map((a) => a.trim())
			.filter(Boolean);
		for (const address of addresses) {
			if (!ADDRESS.test(address)) {
				throw new Error(`"${address}" is not an address.`);
			}
		}
		next.allowedDestinations = { ...next.allowedDestinations, [chain]: addresses };
		return next;
	}

	throw new Error(`Unknown rule: ${chainRule}. Try maxValue or allowedDestinations.`);
}

function show(): void {
	const policy = loadPolicy();

	if (policy === "unreadable") {
		console.log(warn(`Policy at ${policyPath()} cannot be read, so nothing will be signed.`));
		console.log(chalk.gray("Fix the file, or remove it with `fibx policy clear`."));
		return;
	}

	if (!policy || Object.keys(policy).length === 0) {
		console.log(warn("No signing policy set — nothing limits what this wallet will sign."));
		console.log(
			chalk.gray(
				"On the imported-key path this is the only bound there would be.\n" +
					"Set one with, for example: fibx policy set base.maxValue 0.05"
			)
		);
		return;
	}

	console.log();
	if (policy.expiry) console.log(`  expiry              ${policy.expiry}`);
	if (policy.allowedChains)
		console.log(`  allowedChains       ${policy.allowedChains.join(", ")}`);
	for (const [chain, cap] of Object.entries(policy.maxValue ?? {})) {
		console.log(`  ${chain}.maxValue${" ".repeat(Math.max(1, 10 - chain.length))}${cap}`);
	}
	for (const [chain, list] of Object.entries(policy.allowedDestinations ?? {})) {
		console.log(`  ${chain}.allowedDestinations`);
		for (const address of list) console.log(`    ${address}`);
	}
	console.log();
}

export function registerPolicyCommands(program: Command) {
	const policyCmd = program
		.command("policy")
		.description("Read and change the local signing policy");

	policyCmd.command("show").description("Print the active signing policy").action(show);

	policyCmd
		.command("set")
		.description("Set one rule")
		.argument(
			"<rule>",
			"expiry, allowedChains, <chain>.maxValue or <chain>.allowedDestinations"
		)
		.argument("<value>", "The value; comma-separated for lists")
		.addHelpText(
			"after",
			"\nExamples:\n" +
				"  $ fibx policy set base.maxValue 0.05\n" +
				"  $ fibx policy set allowedChains base,monad\n" +
				"  $ fibx policy set expiry 2026-12-31"
		)
		.action((rule: string, value: string) => {
			const current = loadPolicy();
			if (current === "unreadable") {
				console.error(
					formatError(
						new Error(
							`Policy at ${policyPath()} cannot be read. Fix it, or run \`fibx policy clear\` to start over.`
						)
					)
				);
				process.exitCode = 1;
				return;
			}

			try {
				savePolicy(applyRule(current ?? {}, rule, value));
				console.log(success(`Set ${rule} to ${value}`));
			} catch (error) {
				console.error(formatError(error));
				process.exitCode = 1;
			}
		});

	policyCmd
		.command("clear")
		.description("Remove one rule, or the whole policy")
		.argument("[rule]", "The rule to remove; omit to remove everything")
		.action((rule?: string) => {
			if (!rule) {
				clearPolicy();
				console.log(success("Signing policy removed — nothing limits signing now."));
				return;
			}

			const current = loadPolicy();
			if (!current || current === "unreadable") {
				console.log(warn("No readable policy to change."));
				return;
			}

			const next = { ...current } as Record<string, unknown>;
			const [chain, chainRule] = rule.split(".");
			if (chainRule && chain) {
				const group = next[chainRule] as Record<string, unknown> | undefined;
				if (group) delete group[chain];
			} else {
				delete next[rule];
			}

			savePolicy(next as Policy);
			console.log(success(`Removed ${rule}`));
		});
}
