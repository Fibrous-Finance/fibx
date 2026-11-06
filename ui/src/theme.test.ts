import { describe, expect, it } from "vitest";
import { isDark } from "./theme.js";

describe("isDark", () => {
	// A chat app's theme can differ from the OS's; the app follows the chat.
	it("follows a dark host on a light OS", () => {
		expect(isDark("dark", false)).toBe(true);
	});

	it("follows a light host on a dark OS", () => {
		expect(isDark("light", true)).toBe(false);
	});

	it("falls back to the OS when the host sends no theme", () => {
		expect(isDark(undefined, true)).toBe(true);
		expect(isDark(undefined, false)).toBe(false);
	});
});
