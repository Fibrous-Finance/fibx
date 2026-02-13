import { FIBROUS_BASE_URL } from "../../lib/config.js";
import type { ChainConfig } from "../chain/constants.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

interface HealthResponse {
	status: number;
	message: string;
	meta?: {
		apiVersion: string;
		timestamp: string;
	};
}

export async function checkHealth(chain: ChainConfig): Promise<HealthResponse> {
	try {
		const url = `${FIBROUS_BASE_URL}/${chain.fibrousNetwork}/v2/healthcheck`;
		const res = await fetch(url);

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}

		return (await res.json()) as HealthResponse;
	} catch (error) {
		throw new FibxError(
			ErrorCode.FIBROUS_ERROR,
			`Fibrous health check failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
