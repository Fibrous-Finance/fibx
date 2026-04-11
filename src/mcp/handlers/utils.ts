export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(data: unknown) {
	return textResult(JSON.stringify(data, null, 2));
}

export function simulationResult(
	sim: { success: boolean; estimatedGas?: string; feeNative?: string },
	extras?: Record<string, unknown>
) {
	return jsonResult({
		success: sim.success,
		mode: "SIMULATION (no TX sent)",
		...extras,
		...(sim.estimatedGas ? { estimatedGas: sim.estimatedGas } : {}),
		...(sim.feeNative ? { feeNative: sim.feeNative } : {}),
	});
}
