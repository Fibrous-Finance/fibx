import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	createPairing: vi.fn(),
	renderQrDataUri: vi.fn().mockResolvedValue("data:image/png;base64,AAA"),
	saveSession: vi.fn(),
}));
vi.mock("../../services/walletconnect/connect.js", () => ({ createPairing: mocks.createPairing }));
vi.mock("../../services/walletconnect/qr.js", () => ({ renderQrDataUri: mocks.renderQrDataUri }));
// The whole module is replaced for this file, so every binding auth.ts imports
// from it must be present here even when this test never calls it.
vi.mock("../../services/auth/session.js", () => ({
	saveSession: mocks.saveSession,
	loadSession: vi.fn().mockReturnValue(null),
	requireSession: vi.fn(),
	clearSession: vi.fn(),
	getPrivateKey: vi.fn(),
}));

const { handleConnectWallet, handleGetConnectStatus } = await import("./auth.js");

beforeEach(() => vi.clearAllMocks());

describe("connect_wallet", () => {
	it("returns immediately with a uri, a qr and a pairing id", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: () => new Promise(() => {}), // never settles during this test
		});

		const result = await handleConnectWallet();
		expect(result.uri).toBe("wc:abc@2");
		expect(result.qrDataUri.startsWith("data:image/png;base64,")).toBe(true);
		expect(typeof result.pairingId).toBe("string");
	});
});

describe("get_connect_status", () => {
	it("reports pending while the wallet has not answered", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: () => new Promise(() => {}),
		});
		const { pairingId } = await handleConnectWallet();

		expect((await handleGetConnectStatus({ pairingId })).status).toBe("pending");
	});

	it("reports connected and saves the session once approved", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: async () => ({
				topic: "t1",
				address: "0x1111111111111111111111111111111111111111",
			}),
		});
		const { pairingId } = await handleConnectWallet();

		await new Promise((r) => setTimeout(r, 0)); // let the approval microtask land

		const status = await handleGetConnectStatus({ pairingId });
		expect(status.status).toBe("connected");
		expect(status.address).toBe("0x1111111111111111111111111111111111111111");
		expect(mocks.saveSession).toHaveBeenCalledWith(
			expect.objectContaining({ type: "walletconnect", wcTopic: "t1" })
		);
	});

	it("reports rejection instead of hanging", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: async () => {
				throw new Error("User rejected.");
			},
		});
		const { pairingId } = await handleConnectWallet();

		await new Promise((r) => setTimeout(r, 0));

		const status = await handleGetConnectStatus({ pairingId });
		expect(status.status).toBe("failed");
		expect(status.error).toMatch(/rejected/i);
	});

	it("reports an unknown pairing id", async () => {
		expect((await handleGetConnectStatus({ pairingId: "nope" })).status).toBe("unknown");
	});
});
