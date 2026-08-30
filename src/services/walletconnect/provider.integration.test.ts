import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	getInternalError,
	isValidNamespacesChainId,
	isValidNamespacesRequest,
} from "@walletconnect/utils";
import { parseAbi } from "viem";
import type * as ConfigModule from "../../lib/config.js";
import type { Session } from "../auth/session.js";
import { SUPPORTED_CHAINS } from "../chain/constants.js";
import { buildOptionalNamespaces } from "./namespaces.js";

/**
 * The seam neither unit test covers.
 *
 * `chain/client.test.ts` mocks `createWalletConnectProvider` away and answers
 * viem by hand, so it proves viem's half. `provider.test.ts` mocks
 * `getSignClient`, so its stub accepts any method and proves the provider's
 * half. Nothing joined them — and the defect lived exactly there: viem asks the
 * transport for `eth_chainId` before every transaction, and the session
 * negotiates only signing methods, so `signClient.request()` rejected it
 * locally and no WalletConnect transaction could ever complete.
 *
 * So this file mocks only the relay. Real viem, real `getWalletClient`, real
 * `createWalletConnectProvider`, real `buildOptionalNamespaces` — and a
 * SignClient stub that runs the same `@walletconnect/utils` validators
 * sign-client's own `isValidRequest` runs, against the most generous approval
 * this client could ever be granted. Any future addition to the methods viem
 * emits, or removal from `METHODS`, fails here.
 */

const mocks = vi.hoisted(() => ({ getSignClient: vi.fn(), getActiveSession: vi.fn() }));
vi.mock("./client.js", () => ({ getSignClient: mocks.getSignClient }));
vi.mock("./connect.js", () => ({ getActiveSession: mocks.getActiveSession }));

/**
 * The real policy gate sits on this path — that is the point of the file, and
 * `refuses a transaction the policy blocks` below is the only end-to-end proof
 * of it. But the real gate reads the real `policy.json`, so without this the
 * suite reads the developer's own config directory and the first person to run
 * `fibx policy set base.maxValue 0` gets four failures here.
 *
 * env-paths ignores XDG_CONFIG_HOME on macOS, so an env var would not isolate
 * it; `policy/store.test.ts` mocks this module for exactly the same reason.
 * Only `paths` is replaced — every other export stays real, because this graph
 * pulls in more of the module than the policy store does.
 */
const { configDir } = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	return { configDir: mkdtempSync(joinPath(tmpdir(), "fibx-wc-integration-")) };
});

vi.mock("../../lib/config.js", async (importOriginal) => ({
	...(await importOriginal<typeof ConfigModule>()),
	paths: { config: configDir },
}));

const { getWalletClient } = await import("../chain/client.js");

const BASE = SUPPORTED_CHAINS.base!;
const MONAD = SUPPORTED_CHAINS.monad!;
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const HASH = "0x00000000000000000000000000000000000000000000000000000000000000ff";

const NEGOTIATED = buildOptionalNamespaces();

/**
 * A best-case approval: the wallet grants every chain and every method the
 * proposal asks for. A method rejected against these namespaces is rejected
 * against every real session too, because an approval is a subset of what was
 * proposed.
 */
const APPROVED = {
	eip155: {
		...NEGOTIATED.eip155,
		accounts: NEGOTIATED.eip155.chains.map((chain) => `${chain}:${ADDRESS}`),
	},
};

interface RelayRequest {
	topic: string;
	chainId: string;
	request: { method: string; params?: unknown };
}

/**
 * Mirrors @walletconnect/sign-client@2.24.0's `isValidRequest`, which runs
 * `isValidNamespacesChainId` and `isValidNamespacesRequest` against the
 * approved session namespaces and throws locally — the relay is never reached.
 */
function relayStub() {
	const relayed: RelayRequest[] = [];
	const request = vi.fn(async (args: RelayRequest) => {
		const { chainId, request: rpc } = args;
		if (!isValidNamespacesChainId(APPROVED, chainId)) {
			throw new Error(
				getInternalError("MISSING_OR_INVALID", `request() chainId: ${chainId}`).message
			);
		}
		if (!isValidNamespacesRequest(APPROVED, chainId, rpc.method)) {
			throw new Error(
				getInternalError("MISSING_OR_INVALID", `request() method: ${rpc.method}`).message
			);
		}
		relayed.push(args);
		return HASH;
	});
	return { relayed, signClient: { request } };
}

function wcSession(chain = BASE): Session {
	return {
		walletAddress: ADDRESS,
		createdAt: "2026-08-29T00:00:00.000Z",
		type: "walletconnect",
		wcTopic: `topic-${chain.id}`,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	rmSync(join(configDir, "policy.json"), { force: true });
});

afterAll(() => rmSync(configDir, { recursive: true, force: true }));

function writePolicy(policy: unknown): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "policy.json"), JSON.stringify(policy), "utf-8");
}

const AAVE_POOL_ABI = parseAbi([
	"function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
]);

describe("real viem over a namespace-validating WalletConnect session", () => {
	// swap and send both land here.
	it("completes sendTransaction, relaying only negotiated methods", async () => {
		const { relayed, signClient } = relayStub();
		mocks.getSignClient.mockResolvedValue(signClient);
		mocks.getActiveSession.mockResolvedValue({ topic: "topic-8453", namespaces: APPROVED });

		const client = await getWalletClient(wcSession(), BASE);
		const hash = await client.sendTransaction({
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
		});

		expect(hash).toBe(HASH);
		expect(relayed.map((r) => r.request.method)).toEqual(["eth_sendTransaction"]);
		expect(relayed[0]!.chainId).toBe("eip155:8453");
	});

	// AaveService's eight writes land here.
	it("completes writeContract, relaying only negotiated methods", async () => {
		const { relayed, signClient } = relayStub();
		mocks.getSignClient.mockResolvedValue(signClient);
		mocks.getActiveSession.mockResolvedValue({ topic: "topic-8453", namespaces: APPROVED });

		const client = await getWalletClient(wcSession(), BASE);
		const hash = await client.writeContract({
			address: "0x3333333333333333333333333333333333333333",
			abi: AAVE_POOL_ABI,
			functionName: "supply",
			args: ["0x4444444444444444444444444444444444444444", 1n, ADDRESS, 0],
			// The remote wallet assigns the nonce; managesOwnNonce() makes
			// AaveService pass undefined here.
			nonce: undefined,
			chain: BASE.viemChain,
			account: ADDRESS,
		});

		expect(hash).toBe(HASH);
		expect(relayed.map((r) => r.request.method)).toEqual(["eth_sendTransaction"]);
	});

	/**
	 * The standing guard. It is not enough that the two flows above happen to
	 * pass today: every method that reaches the relay must be one the session
	 * negotiated, or `signClient.request()` rejects it before the wallet sees
	 * it. Adding a method to `METHODS` without a wallet that implements it is a
	 * separate problem; sending one that is NOT in `METHODS` cannot work at all.
	 */
	it("relays nothing outside the negotiated method set", async () => {
		const { relayed, signClient } = relayStub();
		mocks.getSignClient.mockResolvedValue(signClient);
		mocks.getActiveSession.mockResolvedValue({ topic: "topic-8453", namespaces: APPROVED });

		const client = await getWalletClient(wcSession(), BASE);
		await client.sendTransaction({
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
		});

		expect(relayed.length).toBeGreaterThan(0);
		for (const { request } of relayed) {
			expect(NEGOTIATED.eip155.methods).toContain(request.method);
		}
	});

	/**
	 * The chain id must come back as the chain the request is CAIP-2 scoped to.
	 * viem compares it with the client's chain and refuses to send on a
	 * mismatch, so an answer of "whatever chain the wallet is currently on"
	 * would break every session holding more than one chain.
	 */
	it("reports the pinned chain id, not the wallet's current chain", async () => {
		const { relayed, signClient } = relayStub();
		mocks.getSignClient.mockResolvedValue(signClient);
		mocks.getActiveSession.mockResolvedValue({ topic: "topic-143", namespaces: APPROVED });

		const client = await getWalletClient(wcSession(MONAD), MONAD);
		await client.sendTransaction({
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
		});

		expect(relayed.map((r) => r.chainId)).toEqual(["eip155:143"]);
	});

	/**
	 * The end-to-end proof that the signing policy sits on the real
	 * WalletConnect path. `provider.test.ts` proves the gate is called with the
	 * right transaction; only here does the refusal travel through real viem,
	 * and only here is it visible that a blocked transaction never reaches the
	 * relay — so the wallet never asks the user to approve something FibX has
	 * already decided against.
	 */
	it("refuses a transaction the signing policy blocks, before the relay sees it", async () => {
		writePolicy({ maxValue: { base: "0" } });
		const { relayed, signClient } = relayStub();
		mocks.getSignClient.mockResolvedValue(signClient);
		mocks.getActiveSession.mockResolvedValue({ topic: "topic-8453", namespaces: APPROVED });

		const client = await getWalletClient(wcSession(), BASE);

		await expect(
			client.sendTransaction({
				to: "0x2222222222222222222222222222222222222222",
				value: 1n,
			})
		).rejects.toThrow(/exceeds the per-transaction cap/);
		expect(relayed).toEqual([]);
	});
});
