import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCode } from "../../lib/errors.js";
import { SUPPORTED_CHAINS } from "../chain/constants.js";

const mocks = vi.hoisted(() => ({ getSignClient: vi.fn(), getActiveSession: vi.fn() }));
vi.mock("./client.js", () => ({ getSignClient: mocks.getSignClient }));
vi.mock("./connect.js", () => ({ getActiveSession: mocks.getActiveSession }));

const { createWalletConnectProvider } = await import("./provider.js");

const BASE = SUPPORTED_CHAINS.base!;
const MONAD = SUPPORTED_CHAINS.monad!;

function sessionWith(chainIds: number[]) {
	return {
		topic: "t",
		namespaces: {
			eip155: {
				accounts: chainIds.map(
					(id) => `eip155:${id}:0x0000000000000000000000000000000000000001`
				),
			},
		},
	};
}

beforeEach(() => vi.clearAllMocks());

describe("walletconnect provider", () => {
	it("forwards a transaction as eth_sendTransaction on the target chain", async () => {
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		const result = await provider.request({
			method: "eth_sendTransaction",
			params: [{ to: "0x1", value: "0x0" }],
		});

		expect(result).toBe("0xhash");
		expect(request).toHaveBeenCalledWith({
			topic: "t",
			chainId: "eip155:8453",
			request: { method: "eth_sendTransaction", params: [{ to: "0x1", value: "0x0" }] },
		});
	});

	// eth_chainId is not one of the methods the session negotiates, so
	// forwarding it would be rejected locally by signClient.request before it
	// reached the relay. The provider is pinned to one chain and answers itself.
	it("answers eth_chainId from the pinned chain without touching the relay", async () => {
		const request = vi.fn();
		mocks.getSignClient.mockResolvedValue({ request });

		await expect(
			createWalletConnectProvider("t", BASE).request({ method: "eth_chainId" })
		).resolves.toBe("0x2105");
		await expect(
			createWalletConnectProvider("t", MONAD).request({ method: "eth_chainId" })
		).resolves.toBe("0x8f");
		expect(request).not.toHaveBeenCalled();
	});

	// The wallet holds the key; asking it to sign without broadcasting is a
	// method MetaMask does not implement over WalletConnect.
	it("refuses eth_signTransaction instead of sending an unsupported request", async () => {
		mocks.getSignClient.mockResolvedValue({ request: vi.fn() });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		await expect(
			provider.request({ method: "eth_signTransaction", params: [] })
		).rejects.toMatchObject({ code: ErrorCode.WALLET_ERROR });
	});

	// A session only carries the chains the wallet approved at pairing time,
	// and signClient.request validates chainId/method against those namespaces
	// locally before anything reaches the relay. There is no request that can
	// repair a missing chain, so the wallet must never be contacted here — the
	// user is told what to do instead.
	it("fails with UNSUPPORTED_CHAIN and names the chain when the wallet has not approved it", async () => {
		const request = vi.fn();
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453])); // monad absent

		const provider = createWalletConnectProvider("t", MONAD);
		const call = provider.request({ method: "eth_sendTransaction", params: [{}] });

		await expect(call).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED_CHAIN });
		await expect(call).rejects.toThrow(/monad/i);
		await expect(call).rejects.toThrow(/fibx auth connect/i);
		expect(request).not.toHaveBeenCalled();
	});

	it("does not try to add a chain the session already has", async () => {
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453, 143]));

		const provider = createWalletConnectProvider("t", MONAD);
		await provider.request({ method: "eth_sendTransaction", params: [{}] });

		expect(request.mock.calls.map((c) => c[0].request.method)).toEqual(["eth_sendTransaction"]);
	});

	// The most common outcome of this module is the user declining in their
	// wallet; that must not escape as a raw, non-FibxError rejection. Uses
	// personal_sign, which skips the chain check, to isolate the assertion to
	// send()'s own error handling.
	it("wraps a wallet rejection of the forwarded request as WALLET_ERROR", async () => {
		const request = vi.fn().mockRejectedValue({ code: 5000, message: "User rejected." });
		mocks.getSignClient.mockResolvedValue({ request });

		const provider = createWalletConnectProvider("t", BASE);
		await expect(
			provider.request({ method: "personal_sign", params: ["0x1", "0xabc"] })
		).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
			message: expect.stringContaining("User rejected."),
		});
	});

	// A relay or socket failure throws a real Error rather than the wallet's
	// JSON-RPC error object; it should read as a transport failure, not a
	// decline, so the two are not reported identically.
	it("wraps a transport failure of the forwarded request as WALLET_ERROR", async () => {
		const request = vi.fn().mockRejectedValue(new Error("socket hang up"));
		mocks.getSignClient.mockResolvedValue({ request });

		const provider = createWalletConnectProvider("t", BASE);
		await expect(
			provider.request({ method: "personal_sign", params: ["0x1", "0xabc"] })
		).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
			message: expect.stringContaining("socket hang up"),
		});
	});
});
