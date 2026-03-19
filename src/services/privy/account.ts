import { toHex, type Address } from "viem";
import { toAccount } from "viem/accounts";
import { apiSignTransaction, apiSignMessage, apiSignTypedData } from "../api/client.js";

/**
 * Creates a Viem-compatible account adapter that signs via fibx-server backend.
 * Uses viem's toAccount() for type-safe Account creation.
 */
export function toPrivyViemAccount(token: string, walletId: string, address: string) {
	return toAccount({
		address: address as Address,
		async signTransaction(transaction: Record<string, unknown>) {
			const { chainId, ...txParams } = transaction;

			const privyTx: Record<string, string | number | undefined> = {
				chain_id: toHex(chainId as number),
				to: txParams.to as string | undefined,
				data: txParams.data as string | undefined,
				value: txParams.value != null ? toHex(txParams.value as bigint) : undefined,
				nonce: txParams.nonce != null ? toHex(txParams.nonce as number) : undefined,
				gas_limit: txParams.gas != null ? toHex(txParams.gas as bigint) : undefined,
				max_fee_per_gas:
					txParams.maxFeePerGas != null
						? toHex(txParams.maxFeePerGas as bigint)
						: undefined,
				max_priority_fee_per_gas:
					txParams.maxPriorityFeePerGas != null
						? toHex(txParams.maxPriorityFeePerGas as bigint)
						: undefined,
				type:
					txParams.type === "eip1559"
						? 2
						: txParams.type === "eip2930"
							? 1
							: txParams.type === "legacy"
								? 0
								: txParams.type === "eip4844"
									? 4
									: undefined,
			};

			// Strip undefined values before sending to Privy API
			const cleanTx = Object.fromEntries(
				Object.entries(privyTx).filter(([, v]) => v !== undefined)
			);

			const result = await apiSignTransaction(walletId, cleanTx, token);
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
	});
}
