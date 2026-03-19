import chalk from "chalk";
import { AaveService } from "../../services/defi/aave.js";
import { getChainConfig, type ChainConfig } from "../../services/chain/constants.js";
import { resolveToken, type Token } from "../../services/fibrous/tokens.js";
import type { Address } from "viem";
import {
	HEALTH_FACTOR_WARNING_THRESHOLD,
	HEALTH_FACTOR_CRITICAL_THRESHOLD,
} from "../../services/defi/constants.js";
import {
	createSpinner,
	outputResult,
	formatResult,
	formatError,
} from "../../lib/format.js";
import { MINT } from "../../lib/brand.js";

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
	const spinner = createSpinner("Initializing Aave service...").start();

	try {
		const chainConfig = getChainConfig("base");

		const aave = new AaveService(chainConfig);

		try {
			await attemptSessionLogin(aave, chainConfig);
		} catch {
			// No session = read-only
		}

		const userAddress = aave.getAccountAddress();
		if (!userAddress) {
			if (action === "status") {
				spinner.fail("No wallet connected. Run `fibx auth login` or `fibx auth import`.");
			} else {
				spinner.fail("No active session found. Please login or import a private key.");
			}
			process.exitCode = 1;
			return;
		}

		if (action === "status") {
			await handleStatus(aave, userAddress, opts, spinner);
			return;
		}

		if (!isValidAction(action)) {
			spinner.fail(`Unknown action: ${action}`);
			console.log(chalk.gray("Available actions: status, supply, borrow, repay, withdraw"));
			process.exitCode = 1;
			return;
		}

		if (!tokenSymbol) {
			spinner.fail(`Token is required for action: ${action}`);
			process.exitCode = 1;
			return;
		}
		if (!amount) {
			spinner.fail(`Amount is required for action: ${action}`);
			process.exitCode = 1;
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
					spinner,
					opts
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
		spinner.fail("Aave operation failed");
		console.error(formatError(error));
		process.exitCode = 1;
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
			aave.setWalletClient(walletClient);
		}
	} catch {
		// No session
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
	spinner: ReturnType<typeof createSpinner>,
	opts: GlobalOptions
) {
	spinner.text = "Signaling Aave Borrow...";
	const tx = await aave.borrow(token.address as Address, amount);
	spinner.succeed("Borrow confirmed");

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
	spinner: ReturnType<typeof createSpinner>,
	opts: GlobalOptions
) {
	const txHash = await aave.repayWithAutoWrap(token.address as Address, amount, (status) => {
		spinner.text = status;
	});

	spinner.succeed("Repay confirmed");

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
