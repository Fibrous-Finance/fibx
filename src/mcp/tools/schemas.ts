import { z } from "zod";
import { CHAIN_NAMES } from "../../services/chain/constants.js";

/** Shared `chain` argument schema for every MCP tool that targets a network. */
export const ChainEnum = z.enum(CHAIN_NAMES);
