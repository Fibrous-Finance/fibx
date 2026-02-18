export enum ErrorCode {
	NOT_AUTHENTICATED = "NOT_AUTHENTICATED",
	INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
	TOKEN_NOT_SUPPORTED = "TOKEN_NOT_SUPPORTED",
	ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND",
	RPC_ERROR = "RPC_ERROR",
	INVALID_ADDRESS = "INVALID_ADDRESS",
	INVALID_AMOUNT = "INVALID_AMOUNT",
	PRIVY_ERROR = "PRIVY_ERROR",
	FIBROUS_ERROR = "FIBROUS_ERROR",
	VALIDATION_ERROR = "VALIDATION_ERROR",
	SESSION_ERROR = "SESSION_ERROR",
	UNSUPPORTED_CHAIN = "UNSUPPORTED_CHAIN",
	WALLET_ERROR = "WALLET_ERROR",
}

export class FibxError extends Error {
	public readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "FibxError";
		this.code = code;
	}

	toJSON() {
		return {
			error: true,
			code: this.code,
			message: this.message,
		};
	}
}
