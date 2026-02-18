import ora, { type Ora } from "ora";
import chalk from "chalk";
import { AaveService } from "../../services/defi/aave.js";
import { getChainConfig, type ChainConfig } from "../../services/chain/constants.js";
import { resolveToken, type Token } from "../../services/fibrous/tokens.js";
import type { Address } from "viem";
import {
	HEALTH_FACTOR_WARNING_THRESHOLD,
	HEALTH_FACTOR_CRITICAL_THRESHOLD,
} from "../../services/defi/constants.js";
import { outputError, outputResult } from "../../lib/format.js";

interface GlobalOptions {
	json?: boolean;
	chain?: string;
}

type AaveAction = "status" | "supply" | "borrow" | "repay" | "withdraw";

export const aaveCommand = async (
	action: string,
	amount: string,
	tokenSymbol: string,
	opts: GlobalOptions
) => {
	const spinner = ora("Initializing Aave service...").start();

	try {
		// Aave V3 is currently Base-only
		const chainConfig = getChainConfig("base");

		const aave = new AaveService(chainConfig);

		try {
			await attemptSessionLogin(aave, chainConfig);
		} catch {
			// Ignore if no session; read-only mode works without it
		}

		const userAddress = aave.getAccountAddress();
		if (!userAddress) {
			if (action === "status") {
				spinner.fail("No wallet connected. Run `fibx auth login` or `fibx auth import`.");
			} else {
				spinner.fail("No active session found. Please login or import a private key.");
			}
			return;
		}

		if (action === "status") {
			await handleStatus(aave, userAddress, opts, spinner);
			return;
		}

		if (!isValidAction(action)) {
			spinner.fail(`Unknown action: ${action}`);
			console.log(chalk.gray("Available actions: status, supply, borrow, repay, withdraw"));
			return;
		}

		if (!tokenSymbol) {
			spinner.fail(`Token is required for action: ${action}`);
			return;
		}
		if (!amount) {
			spinner.fail(`Amount is required for action: ${action}`);
			return;
		}

		spinner.text = `Resolving token ${tokenSymbol}...`;
		let token = await resolveToken(tokenSymbol, chainConfig);

		if (token.address === chainConfig.nativeTokenAddress) {
			token = {
				...token,
				address: chainConfig.wrappedNativeAddress as Address,
				symbol: "WETH",
				name: "Wrapped Ether",
			};
		}

		spinner.text = "Interacting with Aave Protocol...";

		switch (action) {
			case "supply":
				await handleSupply(
					aave,
					token,
					amount,
					userAddress,
					chainConfig,
					spinner,
					opts,
					tokenSymbol.toUpperCase() === chainConfig.nativeSymbol
				);
				break;
			case "borrow":
				await handleBorrow(aave, token, amount, spinner, opts);
				break;
			case "repay":
				await handleRepay(aave, token, amount, spinner, opts);
				break;
			case "withdraw":
				await handleWithdraw(
					aave,
					token,
					amount,
					spinner,
					opts,
					tokenSymbol.toUpperCase() === chainConfig.nativeSymbol
				);
				break;
		}
	} catch (error) {
		spinner.stop();
		outputError(error, { json: !!opts.json });
	}
};

function isValidAction(action: string): action is AaveAction {
	return ["status", "supply", "borrow", "repay", "withdraw"].includes(action);
}

async function attemptSessionLogin(aave: AaveService, chainConfig: ChainConfig) {
	try {
		const { loadSession } = await import("../../services/auth/session.js");
		const { getWalletClient } = await import("../../services/chain/client.js");

		const session = loadSession();
		if (session) {
			const walletClient = getWalletClient(session, chainConfig);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			aave.setWalletClient(walletClient as any);
		}
	} catch {
		// Session load failed, ignore
	}
}

async function handleStatus(
	aave: AaveService,
	userAddress: Address,
	opts: GlobalOptions,
	spinner: Ora
) {
	spinner.text = `Fetching data for ${userAddress}...`;
	const data = await aave.getUserAccountData(userAddress);
	spinner.stop();

	if (opts.json) {
		console.log(JSON.stringify(data));
		return;
	}

	const hf = parseFloat(data.healthFactor);
	let hfColor = chalk.green;
	if (hf < HEALTH_FACTOR_CRITICAL_THRESHOLD) hfColor = chalk.red;
	else if (hf < HEALTH_FACTOR_WARNING_THRESHOLD) hfColor = chalk.yellow;

	const hfDisplay = hf > 100 ? "Safe (>100)" : hf.toFixed(2);

	console.log(chalk.bold("\nAave V3 Position (Base)"));
	console.log(chalk.gray("---------------------------"));
	outputResult(
		{
			"Health Factor": hfColor(hfDisplay),
			Collateral: `$${parseFloat(data.totalCollateralUSD).toFixed(2)}`,
			Debt: `$${parseFloat(data.totalDebtUSD).toFixed(2)}`,
			"Available Borrow": `$${parseFloat(data.availableBorrowsUSD).toFixed(2)}`,
		},
		{ json: !!opts.json }
	);
}

async function handleSupply(
	aave: AaveService,
	token: Token,
	amount: string,
	userAddress: Address,
	chainConfig: ChainConfig,
	spinner: Ora,
	opts: GlobalOptions,
	isNativeETH: boolean = false
) {
	// If native ETH, allow service to handle auto-wrap (token is already resolved to WETH address)

	const txHash = await aave.supplyWithAutoWrap(token.address as Address, amount, (status) => {
		spinner.text = status;
	});

	spinner.succeed("Supply transaction sent!");

	outputResult(
		{
			action: "Supply",
			amount,
			token: token.symbol,
			txHash,
			chain: "base",
		},
		{ json: !!opts.json }
	);
}

async function handleBorrow(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: Ora,
	opts: GlobalOptions
) {
	spinner.text = "Signaling Aave Borrow...";
	const tx = await aave.borrow(token.address as Address, amount);
	spinner.succeed("Borrow transaction sent!");

	outputResult(
		{
			action: "Borrow",
			amount,
			token: token.symbol,
			txHash: tx,
			chain: "base",
		},
		{ json: !!opts.json }
	);
}

async function handleRepay(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: Ora,
	opts: GlobalOptions
) {
	const txHash = await aave.repayWithAutoWrap(token.address as Address, amount, (status) => {
		spinner.text = status;
	});

	spinner.succeed("Repay transaction completed!");

	outputResult(
		{
			action: "Repay",
			amount: amount === "-1" || amount.toLowerCase() === "max" ? "MAX" : amount,
			token: token.symbol,
			txHash,
			chain: "base",
		},
		{ json: !!opts.json }
	);
}

async function handleWithdraw(
	aave: AaveService,
	token: Token,
	amount: string,
	spinner: Ora,
	opts: GlobalOptions,
	isNativeETH: boolean = false
) {
	// Delegate to service
	const txHash = await aave.withdrawWithAutoUnwrap(
		token.address as Address,
		amount,
		isNativeETH,
		(status) => {
			spinner.text = status;
		}
	);

	spinner.succeed("Withdraw transaction sent!");

	outputResult(
		{
			action: "Withdraw",
			amount,
			token: isNativeETH ? "ETH (unwrapped)" : token.symbol,
			txHash,
			chain: "base",
		},
		{ json: !!opts.json }
	);
}
