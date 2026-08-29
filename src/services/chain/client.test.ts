import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Session } from "../auth/session.js";
import { SUPPORTED_CHAINS } from "./constants.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

const mocks = vi.hoisted(() => ({ createWalletConnectProvider: vi.fn(), assertAllowed: vi.fn() }));
vi.mock("../walletconnect/provider.js", () => ({
	createWalletConnectProvider: mocks.createWalletConnectProvider,
}));
vi.mock("../policy/enforce.js", () => ({ assertAllowed: mocks.assertAllowed }));

const { getWalletClient, managesOwnNonce } = await import("./client.js");

const BASE = SUPPORTED_CHAINS.base!;
const ADDRESS = "0x1111111111111111111111111111111111111111";

const wcSession: Session = {
	walletAddress: ADDRESS,
	createdAt: "2026-08-29T00:00:00.000Z",
	type: "walletconnect",
	wcTopic: "topic-1",
};

beforeEach(() => vi.clearAllMocks());

describe("getWalletClient — walletconnect", () => {
	it("routes transactions through the provider as eth_sendTransaction", async () => {
		// For a bare-address account viem leaves preparation to the wallet and
		// asks the transport for eth_chainId only. The rest are answered anyway
		// so a future viem that prepares more fails on the behaviour under test
		// rather than on hex parsing — and the default branch names any method
		// this hand-written stub has not anticipated.
		//
		// This stub accepts whatever it is asked, so it cannot see whether the
		// session would accept it. provider.integration.test.ts covers that.
		const sent: unknown[] = [];
		const request = vi.fn(
			async ({ method, params }: { method: string; params?: unknown[] }) => {
				switch (method) {
					case "eth_chainId":
						return "0x2105"; // 8453
					case "eth_getTransactionCount":
						return "0x5";
					case "eth_estimateGas":
						return "0x11170";
					case "eth_maxPriorityFeePerGas":
						return "0x59682f00";
					case "eth_gasPrice":
						return "0x59682f0e";
					case "eth_getBlockByNumber":
						return { baseFeePerGas: "0x7", number: "0x1", timestamp: "0x1" };
					case "eth_sendTransaction":
						sent.push(params?.[0]);
						return "0xhash";
					default:
						// Surfacing the name beats a silent null when viem's
						// preparation changes between versions.
						throw new Error(`unexpected method: ${method}`);
				}
			}
		);
		mocks.createWalletConnectProvider.mockReturnValue({ request });

		const client = await getWalletClient(wcSession, BASE);
		const hash = await client.sendTransaction({
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
			chain: BASE.viemChain,
		});

		expect(hash).toBe("0xhash");
		// A local account would have signed locally and called
		// eth_sendRawTransaction instead; this asserts the wallet was asked to
		// send, not merely to sign.
		expect(sent).toHaveLength(1);
		expect(request.mock.calls.some((c) => c[0].method === "eth_sendRawTransaction")).toBe(
			false
		);
	});

	it("builds the provider for the session topic and target chain", async () => {
		mocks.createWalletConnectProvider.mockReturnValue({ request: vi.fn() });
		await getWalletClient(wcSession, BASE);
		expect(mocks.createWalletConnectProvider).toHaveBeenCalledWith("topic-1", BASE);
	});

	it("refuses a walletconnect session with no topic", async () => {
		await expect(getWalletClient({ ...wcSession, wcTopic: undefined }, BASE)).rejects.toThrow(
			/fibx auth connect/
		);
	});
});

describe("managesOwnNonce", () => {
	it("is true only for walletconnect", () => {
		expect(managesOwnNonce(wcSession)).toBe(true);
		expect(managesOwnNonce({ ...wcSession, type: "privy" })).toBe(false);
		expect(managesOwnNonce({ ...wcSession, type: "private-key" })).toBe(false);
	});
});

describe("policy enforcement on the account paths", () => {
	const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

	// The assertion that matters is not that the evaluator said no — it is that
	// nothing was signed. A correct rule behind a gate nothing calls is worth
	// nothing.
	it("refuses to sign a transaction the policy blocks", async () => {
		mocks.assertAllowed.mockImplementation(() => {
			throw new FibxError(ErrorCode.POLICY_BLOCKED, "nope");
		});

		const client = await getWalletClient(
			{
				walletAddress: privateKeyToAccount(PRIVATE_KEY).address,
				createdAt: "2026-08-29T00:00:00.000Z",
				type: "private-key",
				privateKey: PRIVATE_KEY,
			},
			BASE
		);

		await expect(
			(client.account as LocalAccount).signTransaction({
				chainId: 8453,
				to: "0x2222222222222222222222222222222222222222",
				value: 0n,
			})
		).rejects.toMatchObject({ code: ErrorCode.POLICY_BLOCKED });
	});

	it("signs normally when the policy permits", async () => {
		mocks.assertAllowed.mockImplementation(() => {});

		const client = await getWalletClient(
			{
				walletAddress: privateKeyToAccount(PRIVATE_KEY).address,
				createdAt: "2026-08-29T00:00:00.000Z",
				type: "private-key",
				privateKey: PRIVATE_KEY,
			},
			BASE
		);

		const signed = await (client.account as LocalAccount).signTransaction({
			chainId: 8453,
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
			gas: 21000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 1n,
			nonce: 0,
			type: "eip1559",
		});

		expect(signed.startsWith("0x")).toBe(true);
	});

	it("hands the policy the chain name and the value, not raw viem fields", async () => {
		mocks.assertAllowed.mockImplementation(() => {});

		const client = await getWalletClient(
			{
				walletAddress: privateKeyToAccount(PRIVATE_KEY).address,
				createdAt: "2026-08-29T00:00:00.000Z",
				type: "private-key",
				privateKey: PRIVATE_KEY,
			},
			BASE
		);

		await (client.account as LocalAccount).signTransaction({
			chainId: 8453,
			to: "0x2222222222222222222222222222222222222222",
			value: 7n,
			gas: 21000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 1n,
			nonce: 0,
			type: "eip1559",
		});

		expect(mocks.assertAllowed).toHaveBeenCalledWith({
			chain: "base",
			to: "0x2222222222222222222222222222222222222222",
			value: 7n,
		});
	});
});
