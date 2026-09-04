export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(data: unknown) {
	return textResult(JSON.stringify(data, null, 2));
}

/**
 * Read the JSON a handler wrote with jsonResult. open_fibx composes the
 * existing handlers rather than re-implementing them, and they all answer in
 * this one envelope.
 */
export function unwrapJson<T>(result: { content: { type: string; text: string }[] }): T {
	const text = result.content.find((c) => c.type === "text")?.text;
	if (text === undefined) throw new Error("handler result carried no text block");
	return JSON.parse(text) as T;
}
