import { createPublicClient, createWalletClient, http, toHex } from "viem";
import type { PrivyClient } from "@privy-io/node";

import type { Session } from "../auth/session.js";
import type { ChainConfig } from "./constants.js";

export function getPublicClient(chain: ChainConfig) {
	return createPublicClient({
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}

function toPrivyViemAccount(privy: PrivyClient, walletId: string, address: string) {
	return {
		address: address as `0x${string}`,
		type: "local" as const,
		source: "privy" as const,
		publicKey: address as `0x${string}`,
		async signTransaction(transaction: Record<string, unknown>) {
			const { chainId, ...txParams } = transaction;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const privyTx: any = {
				chain_id: toHex(chainId as number),
				to: txParams.to,
				data: txParams.data,
				value: txParams.value ? toHex(txParams.value as bigint) : undefined,
				nonce: txParams.nonce ? toHex(txParams.nonce as number) : undefined,
				gas_limit: txParams.gas ? toHex(txParams.gas as bigint) : undefined,
				max_fee_per_gas: txParams.maxFeePerGas
					? toHex(txParams.maxFeePerGas as bigint)
					: undefined,
				max_priority_fee_per_gas: txParams.maxPriorityFeePerGas
					? toHex(txParams.maxPriorityFeePerGas as bigint)
					: undefined,
				type: txParams.type === "eip1559" ? 2 : txParams.type === "legacy" ? 0 : undefined,
			};

			Object.keys(privyTx).forEach((key) => {
				const k = key as keyof typeof privyTx;
				if (privyTx[k] === undefined) delete privyTx[k];
			});

			const rpcInput = {
				params: { transaction: privyTx },
				method: "eth_signTransaction",
			};

			const response = await privy.wallets().ethereum().signTransaction(walletId, rpcInput);
			return response.signed_transaction as `0x${string}`;
		},

		async signMessage({
			message,
		}: {
			message: { raw: string | Uint8Array } | string | Uint8Array;
		}) {
			let messageContent: string | Uint8Array;
			if (typeof message === "object" && "raw" in message) {
				messageContent = message.raw;
			} else {
				messageContent = message as string | Uint8Array;
			}

			const rpcInput = {
				message: messageContent,
			};

			const response = await privy.wallets().ethereum().signMessage(walletId, rpcInput);
			return response.signature as `0x${string}`;
		},

		async signTypedData(typedData: Record<string, unknown>) {
			const rpcInput = {
				params: {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					typed_data: typedData as any,
				},
			};

			const response = await privy.wallets().ethereum().signTypedData(walletId, rpcInput);
			return response.signature as `0x${string}`;
		},
	};
}

export function getWalletClient(privy: PrivyClient, session: Session, chain: ChainConfig) {
	const account = toPrivyViemAccount(privy, session.walletId, session.walletAddress);

	return createWalletClient({
		account,
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}
