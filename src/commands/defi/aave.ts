import chalk from "chalk";
import { AaveService } from "../../services/defi/aave.js";
import { getChainConfig, type ChainConfig } from "../../services/chain/constants.js";
import { AUTH_HINT } from "../../services/auth/session.js";
import { resolveToken, type Token } from "../../services/fibrous/tokens.js";
import type { Address } from "viem";
import {
	HEALTH_FACTOR_WARNING_THRESHOLD,
	HEALTH_FACTOR_CRITICAL_THRESHOLD,
} from "../../services/defi/constants.js";
import { createSpinner, outputResult, formatResult, outputError } from "../../lib/format.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { isUnconfirmed } from "../../services/chain/receipt.js";
import { validateAmount } from "../../lib/validation.js";
import { MINT } from "../../lib/brand.js";

interface GlobalOptions {
	json?: boolean;
	chain?: string;
	simulate?: boolean;
}

type AaveAction = "status" | "supply" | "borrow" | "repay" | "withdraw" | "markets";

export const aaveCommand = async (
	action: string,
	amount: string,
	tokenSymbol: string,
	opts: GlobalOptions
) => {
	const spinner = createSpinner("Initializing Aave service...").start();

	try {
		const chainConfig = getChainConfig("base");

		const aave = new AaveService(chainConfig);

		// Markets need no wallet, so a session that cannot produce one is not
		// fatal yet — but status and every write must report why, not claim
		// there is no session. `fibx aave supply` with a damaged key file said
		// "No active session found" while swap_tokens named the real error.
		const walletError = await attemptSessionLogin(aave, chainConfig);

		const userAddress = aave.getAccountAddress();

		if (action === "status") {
			if (!userAddress) {
				if (walletError) throw walletError;
				throw new FibxError(
					ErrorCode.NOT_AUTHENTICATED,
					`No wallet connected. ${AUTH_HINT}`
				);
			}
			await handleStatus(aave, userAddress, opts, spinner);
			return;
		}

		if (action === "markets") {
			await handleMarkets(aave, opts, spinner);
			return;
		}

		// Write operations require an active wallet session
		if (!userAddress) {
			if (walletError) throw walletError;
			throw new FibxError(ErrorCode.NOT_AUTHENTICATED, `No active session. ${AUTH_HINT}`);
		}

		if (!isValidAction(action)) {
			throw new FibxError(
				ErrorCode.VALIDATION_ERROR,
				`Unknown action: ${action}. Available actions: status, markets, supply, borrow, repay, withdraw.`
			);
		}

		if (!tokenSymbol) {
			throw new FibxError(
				ErrorCode.VALIDATION_ERROR,
				`Token is required for action: ${action}`
			);
		}
		if (!amount) {
			throw new FibxError(
				ErrorCode.VALIDATION_ERROR,
				`Amount is required for action: ${action}`
			);
		}

		const isMax = amount === "-1" || amount.toLowerCase() === "max";
		if (isMax && action !== "repay" && action !== "withdraw") {
			throw new Error("'max' is only supported for repay and withdraw.");
		}
		if (!isMax) {
			validateAmount(amount);
		}

		spinner.text = `Resolving token ${tokenSymbol}...`;
		let token = await resolveToken(tokenSymbol, chainConfig);
		const isNativeETH =
			token.address.toLowerCase() === chainConfig.nativeTokenAddress.toLowerCase();

		if (isNativeETH) {
			token = {
				...token,
				address: chainConfig.wrappedNativeAddress as Address,
				symbol: "WETH",
				name: "Wrapped Ether",
			};
		}

		if (opts.simulate) {
			const displayAmount = isMax ? "MAX" : amount;
			const displayToken = isNativeETH
				? action === "withdraw"
					? `${chainConfig.nativeSymbol} (auto-unwrapped)`
					: action === "borrow"
						? token.symbol
						: `${chainConfig.nativeSymbol} (auto-wrapped)`
				: token.symbol;

			spinner.succeed("Preview ready — no transaction sent");
			outputResult(
				{
					mode: "PREVIEW (no TX sent)",
					action: action.charAt(0).toUpperCase() + action.slice(1),
					amount: displayAmount,
					token: displayToken,
					chain: "base",
					note: "Request only; no on-chain validation, simulation, or transaction was performed",
				},
				{ json: !!opts.json }
			);
			return;
		}

		spinner.text = "Interacting with Aave Protocol...";

		switch (action) {
			case "supply":
				await handleSupply(aave, token, amount, spinner, opts);
				break;
			case "borrow":
				await handleBorrow(aave, token, amount, spinner, opts);
				break;
			case "repay":
				await handleRepay(aave, token, amount, spinner, opts);
				break;
			case "withdraw":
				await handleWithdraw(aave, token, amount, spinner, opts, isNativeETH);
				break;
		}
	} catch (error) {
		// Sent without a receipt yet may still succeed; the error carries the hash.
		if (isUnconfirmed(error)) spinner.warn("Sent, but not confirmed yet");
		else spinner.fail("Aave operation failed");
		outputError(error, { json: !!opts.json });
	}
};

function isValidAction(action: string): action is AaveAction {
	return ["status", "markets", "supply", "borrow", "repay", "withdraw"].includes(action);
}

function getExplorerLink(txHash: string): string | undefined {
	const chain = getChainConfig("base");
	const baseUrl = chain.viemChain.blockExplorers?.default.url;
	return baseUrl ? `${baseUrl}/tx/${txHash}` : undefined;
}

/** Connects the session's wallet if there is one; returns why it could not, if it failed. */
async function attemptSessionLogin(
	aave: AaveService,
	chainConfig: ChainConfig
): Promise<unknown | undefined> {
	const { loadSession } = await import("../../services/auth/session.js");
	const { getWalletClient, managesOwnNonce } = await import("../../services/chain/client.js");

	const session = loadSession();
	if (!session) return undefined;
	try {
		const walletClient = await getWalletClient(session, chainConfig);
		aave.setWalletClient(walletClient, { managesOwnNonce: managesOwnNonce(session) });
		return undefined;
	} catch (error) {
		return error;
	}
}

async function handleStatus(
	aave: AaveService,
	userAddress: Address,
	opts: GlobalOptions,
	spinner: ReturnType<typeof createSpinner>
) {
	spinner.text = `Fetching Aave V3 data for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}...`;
	const data = await aave.getUserAccountData(userAddress);
	spinner.succeed("Position loaded");

	const hf = parseFloat(data.healthFactor);
	let hfColor = chalk.green;
	if (hf < HEALTH_FACTOR_CRITICAL_THRESHOLD) hfColor = chalk.red;
	else if (hf < HEALTH_FACTOR_WARNING_THRESHOLD) hfColor = chalk.yellow;
	const hfDisplay = hf > 100 ? "Safe (>100)" : hf.toFixed(2);

	if (opts.json) {
		outputResult(data as unknown as Record<string, unknown>, { json: true });
		return;
	}

	console.log(chalk.bold.hex(MINT)("\n  Aave V3 Position (Base)\n"));
	console.log(
		formatResult({
			healthFactor: hfColor(hfDisplay),
			collateral: `$${parseFloat(data.totalCollateralUSD).toFixed(2)}`,
			debt: `$${parseFloat(data.totalDebtUSD).toFixed(2)}`,
			availableBorrow: `$${parseFloat(data.availableBorrowsUSD).toFixed(2)}`,
		})
	);
	console.log();
}

// Format large numbers compactly
const fmtNum = (s: string): string => {
	const n = parseFloat(s);
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
	return n.toFixed(2);
};

async function handleMarkets(
	aave: AaveService,
	opts: GlobalOptions,
	spinner: ReturnType<typeof createSpinner>
) {
	spinner.text = "Fetching Aave V3 markets...";
	const markets = await aave.getMarkets();
	spinner.succeed(`Found ${markets.length} active markets`);

	if (opts.json) {
		outputResult(markets as unknown as Record<string, unknown>, { json: true });
		return;
	}

	console.log(chalk.bold.hex(MINT)("\n  Aave V3 Markets on Base\n"));

	// Table header
	const header = [
		"Token".padEnd(10),
		"Supply APY".padEnd(12),
		"Borrow APY".padEnd(12),
		"Total Supply".padEnd(18),
		"Total Borrow".padEnd(18),
		"LTV".padEnd(8),
	].join("  ");
	console.log(chalk.dim(`  ${header}`));
	console.log(chalk.dim(`  ${"─".repeat(header.length)}`));

	for (const m of markets) {
		const frozen = m.isFrozen ? chalk.yellow(" ❄") : "";
		const supplyColor = chalk.green;
		const borrowVal = parseFloat(m.borrowAPY);
		const borrowColor = borrowVal > 10 ? chalk.red : borrowVal > 5 ? chalk.yellow : chalk.white;

		const row = [
			chalk.white.bold(m.symbol.padEnd(10)),
			supplyColor(m.supplyAPY.padEnd(12)),
			borrowColor(m.borrowAPY.padEnd(12)),
			chalk.dim(fmtNum(m.totalSupply).padEnd(18)),
			chalk.dim(fmtNum(m.totalBorrow).padEnd(18)),
			chalk.white(m.ltv.padEnd(8)),
		].join("  ");

		console.log(`  ${row}${frozen}`);
	}

	console.log();
}

async function handleSupply(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: ReturnType<typeof createSpinner>,
	opts: GlobalOptions
) {
	const txHash = await aave.supplyWithAutoWrap(token.address as Address, amount, (status) => {
		spinner.text = status;
	});

	spinner.succeed("Supply confirmed");

	const explorer = getExplorerLink(txHash);
	outputResult(
		{
			action: "Supply",
			amount,
			token: token.symbol,
			txHash,
			...(explorer ? { explorer } : {}),
			chain: "base",
		},
		{ json: !!opts.json }
	);
}

async function handleBorrow(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: ReturnType<typeof createSpinner>,
	opts: GlobalOptions
) {
	spinner.text = "Signaling Aave Borrow...";
	const tx = await aave.borrow(token.address as Address, amount);
	spinner.succeed("Borrow confirmed");

	const explorer = getExplorerLink(tx);
	outputResult(
		{
			action: "Borrow",
			amount,
			token: token.symbol,
			txHash: tx,
			...(explorer ? { explorer } : {}),
			chain: "base",
		},
		{ json: !!opts.json }
	);
}

async function handleRepay(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: ReturnType<typeof createSpinner>,
	opts: GlobalOptions
) {
	const txHash = await aave.repayWithAutoWrap(token.address as Address, amount, (status) => {
		spinner.text = status;
	});

	const displayAmount = amount === "-1" || amount.toLowerCase() === "max" ? "MAX" : amount;

	if (txHash === null) {
		spinner.succeed("Nothing to repay");
		outputResult(
			{
				action: "Repay",
				amount: displayAmount,
				token: token.symbol,
				status: "No transaction sent — debt was already cleared",
				chain: "base",
			},
			{ json: !!opts.json }
		);
		return;
	}

	spinner.succeed("Repay confirmed");

	const explorer = getExplorerLink(txHash);
	outputResult(
		{
			action: "Repay",
			amount: displayAmount,
			token: token.symbol,
			txHash,
			...(explorer ? { explorer } : {}),
			chain: "base",
		},
		{ json: !!opts.json }
	);
}

async function handleWithdraw(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: ReturnType<typeof createSpinner>,
	opts: GlobalOptions,
	isNativeETH: boolean = false
) {
	const txHash = await aave.withdrawWithAutoUnwrap(
		token.address as Address,
		amount,
		isNativeETH,
		(status) => {
			spinner.text = status;
		}
	);

	spinner.succeed("Withdraw confirmed");

	const explorer = getExplorerLink(txHash);
	outputResult(
		{
			action: "Withdraw",
			amount,
			token: isNativeETH ? "ETH (unwrapped)" : token.symbol,
			txHash,
			...(explorer ? { explorer } : {}),
			chain: "base",
		},
		{ json: !!opts.json }
	);
}
