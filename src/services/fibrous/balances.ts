import type { ChainConfig } from "../chain/constants.js";
import { FIBROUS_GRAPH_URL } from "../../lib/config.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

interface TokenInput {
	address: string;
	decimal: number;
}

interface BalanceRequest {
	tokenAddresses: TokenInput[];
	walletAddress: string;
}

export interface BalanceResponse {
	token: TokenInput;
	balance: string;
}

export async function getBalances(
	tokens: { address: string; decimals: number }[],
	walletAddress: string,
	chain: ChainConfig
): Promise<BalanceResponse[]> {
	try {
		const payload: BalanceRequest = {
			tokenAddresses: tokens.map((t) => ({ address: t.address, decimal: t.decimals })),
			walletAddress,
		};

		const res = await fetch(`${FIBROUS_GRAPH_URL}/${chain.fibrousNetwork}/balances`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status} ${res.statusText}`);
		}

		const data = (await res.json()) as BalanceResponse[];
		return data;
	} catch (error) {
		throw new FibxError(
			ErrorCode.FIBROUS_ERROR,
			`Failed to fetch balances: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
