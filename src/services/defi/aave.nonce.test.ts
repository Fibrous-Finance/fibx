import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WalletClient } from "viem";

// NonceManager reads a pending nonce from the chain. A unit test that needs the
// network is flaky by construction, and nothing else in this suite touches it.
const mocks = vi.hoisted(() => ({
	withNonce: vi.fn(
		async (_address: string, _client: unknown, send: (nonce?: number) => Promise<unknown>) =>
			send(7)
	),
}));
vi.mock("../chain/nonceManager.js", () => ({
	NonceManager: { getInstance: () => ({ withNonce: mocks.withNonce }) },
}));

const { AaveService } = await import("./aave.js");
const { SUPPORTED_CHAINS } = await import("../chain/constants.js");

const ACCOUNT = { address: "0x1111111111111111111111111111111111111111" };

beforeEach(() => vi.clearAllMocks());

function stubWalletClient(): WalletClient {
	return {
		account: ACCOUNT,
		writeContract: vi.fn().mockResolvedValue("0xhash"),
	} as unknown as WalletClient;
}

describe("AaveService nonce ownership", () => {
	it("omits the nonce when the remote wallet assigns it", async () => {
		const client = stubWalletClient();
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(client, { managesOwnNonce: true });

		// sendWithNonce is private; exercise it the way the service does.
		const send = vi.fn().mockResolvedValue("0xhash");
		await (
			service as unknown as {
				sendWithNonce: (fn: (nonce?: number) => Promise<string>) => Promise<string>;
			}
		).sendWithNonce(send);

		expect(send).toHaveBeenCalledWith(undefined);
	});

	it("still uses the nonce manager on the other paths", async () => {
		const client = stubWalletClient();
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(client); // default: FibX broadcasts

		const send = vi.fn().mockResolvedValue("0xhash");
		await (
			service as unknown as {
				sendWithNonce: (fn: (nonce?: number) => Promise<string>) => Promise<string>;
			}
		).sendWithNonce(send);

		expect(mocks.withNonce).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith(7);
	});

	it("does not consult the nonce manager at all when the wallet owns it", async () => {
		const client = stubWalletClient();
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(client, { managesOwnNonce: true });

		await (
			service as unknown as {
				sendWithNonce: (fn: (nonce?: number) => Promise<string>) => Promise<string>;
			}
		).sendWithNonce(vi.fn().mockResolvedValue("0xhash"));

		expect(mocks.withNonce).not.toHaveBeenCalled();
	});
});
