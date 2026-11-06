import type { McpUiTheme } from "@modelcontextprotocol/ext-apps";

/**
 * The host's theme wins: a chat app can be dark on a light OS, and the brand
 * kit's lockup follows the host theme. The OS preference is only the fallback
 * for a host that sends none, and the guess before the host has answered.
 */
export function isDark(hostTheme: McpUiTheme | undefined, prefersDark: boolean): boolean {
	return hostTheme === undefined ? prefersDark : hostTheme === "dark";
}
