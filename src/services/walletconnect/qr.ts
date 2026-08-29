import QRCode from "qrcode";
import { ErrorCode, FibxError } from "../../lib/errors.js";

function requirePayload(text: string): void {
	if (!text) {
		throw new FibxError(
			ErrorCode.VALIDATION_ERROR,
			"Cannot render a QR code for an empty payload"
		);
	}
}

/** Block-character QR for a terminal. */
export async function renderQrTerminal(text: string): Promise<string> {
	requirePayload(text);
	return QRCode.toString(text, { type: "terminal", small: true });
}

/**
 * PNG data URI, for hosts that render HTML rather than text. The MCP Apps CSP
 * permits `img-src 'self' data:`, so this displays inside the sandbox without
 * any external request.
 */
export async function renderQrDataUri(text: string): Promise<string> {
	requirePayload(text);
	return QRCode.toDataURL(text, { margin: 1 });
}
