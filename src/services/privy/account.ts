import { toHex } from "viem";
import { apiSignTransaction, apiSignMessage, apiSignTypedData } from "../api/client.js";

/**
 * Creates a Viem-compatible account adapter that signs via fibx-server backend.
 * Used for Privy server wallet sessions.
 */
export function toPrivyViemAccount(token: string, walletId: string, address: string) {
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

			const result = await apiSignTransaction(walletId, privyTx, token);
			return result.signedTransaction as `0x${string}`;
		},

		async signMessage({
			message,
		}: {
			message: { raw: string | Uint8Array } | string | Uint8Array;
		}) {
			let messageContent: string;
			if (typeof message === "object" && "raw" in message) {
				messageContent =
					typeof message.raw === "string"
						? message.raw
						: Buffer.from(message.raw).toString("hex");
			} else if (message instanceof Uint8Array) {
				messageContent = Buffer.from(message).toString("hex");
			} else {
				messageContent = message as string;
			}

			const result = await apiSignMessage(walletId, messageContent, token);
			return result.signature as `0x${string}`;
		},

		async signTypedData(typedData: Record<string, unknown>) {
			const result = await apiSignTypedData(walletId, typedData, token);
			return result.signature as `0x${string}`;
		},
	};
}
