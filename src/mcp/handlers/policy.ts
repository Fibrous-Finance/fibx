import { loadPolicy, policyPath } from "../../services/policy/store.js";
import { isEmptyPolicy } from "../../commands/policy/index.js";
import { jsonResult } from "./utils.js";

/**
 * Reads the signing policy without changing it.
 *
 * The three states are the point. "unreadable" means a file is there and
 * cannot be trusted, which refuses every transaction — reporting it as
 * "absent" would tell the caller that nothing is blocking them when in fact
 * everything is.
 */
export async function handleGetPolicy() {
	const policy = loadPolicy();
	const path = policyPath();

	if (policy === "unreadable") {
		return jsonResult({
			state: "unreadable",
			path,
			message:
				"The policy file cannot be read, so nothing will be signed until it is fixed or removed.",
		});
	}

	if (!policy || isEmptyPolicy(policy)) {
		return jsonResult({
			state: "absent",
			path,
			message: "No signing policy is set — nothing limits what this wallet will sign.",
		});
	}

	return jsonResult({ state: "active", rules: policy, path });
}
