import { describe, expect, it, vi, beforeEach } from "vitest";

// readCache/writeCache resolve through paths.cache to the developer's real
// cache directory, and fetchWithTimeout would reach the network. Both are
// mocked so this test touches neither.
const mocks = vi.hoisted(() => ({
	readCache: vi.fn(),
	writeCache: vi.fn(),
	fetchWithTimeout: vi.fn(),
}));

vi.mock("../../lib/cache.js", () => ({
	readCache: mocks.readCache,
	writeCache: mocks.writeCache,
}));
vi.mock("../../lib/fetch.js", () => ({ fetchWithTimeout: mocks.fetchWithTimeout }));

const { getProtocolNames } = await import("./protocols.js");

const chain = { fibrousNetwork: "base" } as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.readCache.mockReturnValue(null);
});

describe("getProtocolNames", () => {
	it("maps protocol ids to display names", async () => {
		mocks.fetchWithTimeout.mockResolvedValue({
			ok: true,
			json: async () => [
				{ protocol: 1, display_name: "Uniswap V3" },
				{ protocol: 4, display_name: "Aerodrome" },
			],
		});

		const names = await getProtocolNames(chain);

		expect(names.get(1)).toBe("Uniswap V3");
		expect(names.get(4)).toBe("Aerodrome");
	});

	// This lookup is decoration. A quote that failed because a name could not
	// be fetched would be a swap the user cannot make for a cosmetic reason.
	it("returns an empty map when the endpoint fails, rather than throwing", async () => {
		mocks.fetchWithTimeout.mockResolvedValue({ ok: false, status: 503 });

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});

	it("returns an empty map when the fetch itself rejects", async () => {
		mocks.fetchWithTimeout.mockRejectedValue(new Error("offline"));

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});

	// A timeout is the case that matters most: this call runs in parallel with
	// the route fetch, so a hanging endpoint would hold the quote open.
	it("returns an empty map when the request aborts", async () => {
		mocks.fetchWithTimeout.mockRejectedValue(
			Object.assign(new Error("aborted"), { name: "AbortError" })
		);

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});

	it("serves a cached list without fetching", async () => {
		mocks.readCache.mockReturnValue([{ protocol: 9, display_name: "Cached DEX" }]);

		const names = await getProtocolNames(chain);

		expect(names.get(9)).toBe("Cached DEX");
		expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
	});

	// readCache returns whatever JSON was on disk. A corrupt entry must not
	// reject — the cached path is inside the try for exactly this reason.
	it("returns an empty map when the cached entry is not an array", async () => {
		mocks.readCache.mockReturnValue({ not: "an array" });

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});
});
