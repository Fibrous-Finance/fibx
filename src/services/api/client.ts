import { ErrorCode, FibxError } from "../../lib/errors.js";

const DEFAULT_API_URL = "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

function getBaseUrl(): string {
	return process.env.FIBX_API_URL ?? DEFAULT_API_URL;
}

interface ApiOptions {
	token?: string;
	timeoutMs?: number;
}

async function request<T>(
	path: string,
	body: Record<string, unknown>,
	options?: ApiOptions
): Promise<T> {
	const url = `${getBaseUrl()}${path}`;
	const timeout = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (options?.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		if (!res.ok) {
			const errorBody = await res
				.json()
				.catch(() => ({ error: { message: res.statusText } }));
			const msg =
				(errorBody as { error?: { message?: string } })?.error?.message ??
				`API error (${res.status})`;
			throw new FibxError(ErrorCode.PRIVY_ERROR, msg);
		}

		return (await res.json()) as T;
	} catch (error) {
		if (error instanceof FibxError) throw error;

		if (error instanceof DOMException && error.name === "AbortError") {
			throw new FibxError(
				ErrorCode.PRIVY_ERROR,
				`Request to ${path} timed out after ${timeout / 1000}s. Is fibx-server running?`
			);
		}

		throw new FibxError(
			ErrorCode.PRIVY_ERROR,
			`Failed to connect to fibx-server at ${getBaseUrl()}. Is the server running?`
		);
	} finally {
		clearTimeout(timer);
	}
}

export async function apiLogin(email: string): Promise<{ success: boolean; message: string }> {
	return request("/auth/login", { email });
}

export interface VerifyResponse {
	userId: string;
	walletId: string;
	walletAddress: string;
	token: string;
	isExisting: boolean;
}

export async function apiVerify(email: string, code: string): Promise<VerifyResponse> {
	return request("/auth/verify", { email, code });
}

export async function apiFindWallet(
	email: string,
	token: string
): Promise<{ wallet: { id: string; address: string } | null }> {
	return request("/wallet/find", { email }, { token });
}

export async function apiCreateWallet(
	token: string,
	userId?: string
): Promise<{ wallet: { id: string; address: string } }> {
	return request("/wallet/create", { userId }, { token });
}

export async function apiSignTransaction(
	walletId: string,
	transaction: Record<string, unknown>,
	token: string
): Promise<{ signedTransaction: string }> {
	return request("/sign/transaction", { walletId, transaction }, { token });
}

export async function apiSignMessage(
	walletId: string,
	message: string | Record<string, unknown>,
	token: string
): Promise<{ signature: string }> {
	return request("/sign/message", { walletId, message }, { token });
}

export async function apiSignTypedData(
	walletId: string,
	typedData: Record<string, unknown>,
	token: string
): Promise<{ signature: string }> {
	return request("/sign/typed-data", { walletId, typedData }, { token });
}
