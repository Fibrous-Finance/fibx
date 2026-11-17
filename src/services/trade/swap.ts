import { maxUint256, type Address, type Hash } from "viem";
import { requireSession } from "../auth/session.js";
import { getPublicClient, getWalletClient } from "../chain/client.js";
import { getChainConfig, type ChainConfig } from "../chain/constants.js";
import {
	encodeApprove,
	encodeDeposit,
	encodeWithdraw,
	getAllowance,
	waitForAllowance,
} from "../chain/erc20.js";
import { resolveToken, type Token } from "../fibrous/tokens.js";
import { encodeSwapCalldata, getRouteAndCallData } from "../fibrous/route.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { formatAmount, parseAmount } from "../../lib/parseAmount.js";
import { validateAmount, validateSlippage } from "../../lib/validation.js";

/**
 * The one swap flow behind `fibx trade` and the `swap_tokens` tool.
 *
 * The two surfaces used to carry a copy each, and the copies drifted: only one
 * refused a swap from a token to itself, only one bounded slippage, only one
 * estimated gas for a simulated wrap. A surface now parses its input, listens
 * to progress if it draws any, and formats the outcome — nothing else.
 */

export interface SwapRequest {
	amount: string;
	from: string;
	to: string;
	chain: string;
	/** Percent. Bounded here, not only in the tool schema: callers reach this directly. */
	slippage?: number;
	simulate?: boolean;
	/** Approve maxUint256 instead of the exact amount. The CLI's `--approve-max` only. */
	approveMax?: boolean;
	/** Also price the gas estimate (gas × gas price) as a fee in wei. */
	quoteFee?: boolean;
	onProgress?: (event: SwapProgress) => void;
}

export type SwapProgress =
	| { stage: "resolving"; chain: ChainConfig }
	| { stage: "wrapping" | "unwrapping"; tokenIn: Token; tokenOut: Token }
	| { stage: "routing" }
	| { stage: "routed"; tokenIn: Token; tokenOut: Token; amountOut: string; slippage: number }
	| { stage: "approving" }
	| { stage: "approval-sent"; hash: Hash }
	| { stage: "approved" }
	| { stage: "swapping"; tokenIn: Token; tokenOut: Token };

export type SwapOperation = "wrap" | "unwrap" | "swap";

interface SwapCommon {
	operation: SwapOperation;
	chain: ChainConfig;
	tokenIn: Token;
	tokenOut: Token;
	/** As the caller wrote it. */
	amountIn: string;
	/** Human units; the route's expected output for a swap, the input for a wrap. */
	amountOut: string;
	/** The contract the transaction goes to: the router, or the wrapped native token. */
	router: Address;
}

export interface SwapSimulation extends SwapCommon {
	simulated: true;
	/** True when the router lacks allowance; no gas estimate is possible then. */
	requiresApproval: boolean;
	/** Gas units, when an estimate was possible. */
	gas?: bigint;
	/** gas × gas price in wei, when `quoteFee` was set and an estimate was possible. */
	feeWei?: bigint;
}

export interface SwapBroadcast extends SwapCommon {
	simulated: false;
	hash: Hash;
	explorer?: string;
}

export type SwapOutcome = SwapSimulation | SwapBroadcast;

/** A failed eth_estimateGas, worded the way the CLI always worded it. */
export class SwapSimulationError extends Error {
	constructor(cause: unknown) {
		super(`Simulation failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
			cause,
		});
		this.name = "SwapSimulationError";
	}
}

function sameTokenError(): FibxError {
	return new FibxError(
		ErrorCode.VALIDATION_ERROR,
		"Source and destination tokens cannot be the same."
	);
}

function explorerFor(chain: ChainConfig, hash: Hash): string | undefined {
	const base = chain.viemChain.blockExplorers?.default.url;
	return base ? `${base}/tx/${hash}` : undefined;
}

export async function executeSwap(req: SwapRequest): Promise<SwapOutcome> {
	const { amount, simulate = false, onProgress } = req;

	validateAmount(amount);
	const slippage = validateSlippage(req.slippage ?? DEFAULT_SLIPPAGE);
	// The cheap check first, before a session or an RPC is touched; the
	// resolved-address check below catches the same token by two names.
	if (req.from.toLowerCase() === req.to.toLowerCase()) throw sameTokenError();

	const chain = getChainConfig(req.chain);
	const session = requireSession();
	const walletClient = await getWalletClient(session, chain);
	const publicClient = getPublicClient(chain);
	const wallet = session.walletAddress as Address;

	onProgress?.({ stage: "resolving", chain });
	const [tokenIn, tokenOut] = await Promise.all([
		resolveToken(req.from, chain),
		resolveToken(req.to, chain),
	]);
	if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) throw sameTokenError();

	const amountBaseUnits = parseAmount(amount, tokenIn.decimals);
	const is = (token: Token, address: string) =>
		token.address.toLowerCase() === address.toLowerCase();
	const isNativeInput = is(tokenIn, chain.nativeTokenAddress);
	const isNativeOutput = is(tokenOut, chain.nativeTokenAddress);
	const isWrappedInput = is(tokenIn, chain.wrappedNativeAddress);
	const isWrappedOutput = is(tokenOut, chain.wrappedNativeAddress);

	const estimate = async (tx: { to: Address; data: `0x${string}`; value: bigint }) => {
		let gas: bigint;
		try {
			gas = await publicClient.estimateGas({ account: wallet, ...tx });
		} catch (error) {
			throw new SwapSimulationError(error);
		}
		const feeWei = req.quoteFee ? gas * (await publicClient.getGasPrice()) : undefined;
		return { gas, feeWei };
	};

	// Wrap and unwrap go straight to the wrapped-native contract; the router
	// would only add a hop.
	if ((isNativeInput && isWrappedOutput) || (isWrappedInput && isNativeOutput)) {
		const operation: SwapOperation = isNativeInput ? "wrap" : "unwrap";
		const router = chain.wrappedNativeAddress as Address;
		const tx =
			operation === "wrap"
				? { to: router, data: encodeDeposit(), value: amountBaseUnits }
				: { to: router, data: encodeWithdraw(amountBaseUnits), value: 0n };
		const common = { operation, chain, tokenIn, tokenOut, amountIn: amount, router };

		if (simulate) {
			const { gas, feeWei } = await estimate(tx);
			return {
				...common,
				amountOut: amount,
				simulated: true,
				requiresApproval: false,
				gas,
				feeWei,
			};
		}

		onProgress?.({
			stage: operation === "wrap" ? "wrapping" : "unwrapping",
			tokenIn,
			tokenOut,
		});
		const hash = await walletClient.sendTransaction(tx);
		return {
			...common,
			amountOut: amount,
			simulated: false,
			hash,
			explorer: explorerFor(chain, hash),
		};
	}

	onProgress?.({ stage: "routing" });
	const routeData = await getRouteAndCallData(
		{
			amount: amountBaseUnits.toString(),
			tokenInAddress: tokenIn.address,
			tokenOutAddress: tokenOut.address,
			slippage,
			destination: wallet,
		},
		chain
	);

	const amountOut = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);
	const router = routeData.router_address as Address;
	const common = {
		operation: "swap" as const,
		chain,
		tokenIn,
		tokenOut,
		amountIn: amount,
		amountOut,
		router,
	};
	onProgress?.({ stage: "routed", tokenIn, tokenOut, amountOut, slippage });

	let requiresApproval = false;
	if (!isNativeInput) {
		const currentAllowance = await getAllowance(
			publicClient,
			tokenIn.address as Address,
			wallet,
			router
		);
		requiresApproval = currentAllowance < amountBaseUnits;

		if (requiresApproval && !simulate) {
			onProgress?.({ stage: "approving" });
			const amountToApprove = req.approveMax ? maxUint256 : amountBaseUnits;
			const approveTxHash = await walletClient.sendTransaction({
				to: tokenIn.address as Address,
				data: encodeApprove(router, amountToApprove),
				value: 0n,
			});

			onProgress?.({ stage: "approval-sent", hash: approveTxHash });
			await publicClient.waitForTransactionReceipt({
				hash: approveTxHash,
				confirmations: 1,
			});
			await waitForAllowance(
				publicClient,
				tokenIn.address as Address,
				wallet,
				router,
				amountToApprove
			);
			onProgress?.({ stage: "approved" });
		}
	}

	onProgress?.({ stage: "swapping", tokenIn, tokenOut });
	const tx = {
		to: router,
		data: encodeSwapCalldata(routeData.calldata, chain),
		value: isNativeInput ? amountBaseUnits : 0n,
	};

	// Without allowance, an eth_estimateGas call for the swap would normally
	// revert. A dry run must not broadcast an approval just to make that
	// estimate possible, so report the prerequisite without inventing a fee.
	if (simulate && requiresApproval) {
		return { ...common, simulated: true, requiresApproval: true };
	}

	const { gas, feeWei } = await estimate(tx);
	if (simulate) {
		return { ...common, simulated: true, requiresApproval: false, gas, feeWei };
	}

	const hash = await walletClient.sendTransaction(tx);
	return { ...common, simulated: false, hash, explorer: explorerFor(chain, hash) };
}
