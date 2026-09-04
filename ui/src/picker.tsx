import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError } from "./errors.js";
import { filterTokens, orderTokens } from "./tokens.js";
import type { TokenInfo, TokenList } from "./types.js";

// One fetch per chain for the widget's life; the list does not change while a
// card is open, and the picker opens more than once. Scoped per `App` (a
// WeakMap, not a bare module-level Map) so it tracks one host session rather
// than leaking across unrelated `App` instances — e.g. separate tests in the
// same file, each with their own fake app.
const caches = new WeakMap<App, Map<string, TokenInfo[]>>();
function cacheFor(app: App): Map<string, TokenInfo[]> {
	let c = caches.get(app);
	if (!c) {
		c = new Map();
		caches.set(app, c);
	}
	return c;
}

export function TokenPicker({
	app,
	chain,
	exclude,
	onPick,
	onClose,
}: {
	app: App;
	chain: string;
	exclude?: string;
	onPick: (t: TokenInfo) => void;
	onClose: () => void;
}) {
	const cache = cacheFor(app);
	const [all, setAll] = useState<TokenInfo[] | null>(cache.get(chain) ?? null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	useEffect(() => {
		if (cache.has(chain)) {
			setAll(cache.get(chain)!);
			return;
		}
		callJson<TokenList>(app, "list_tokens", { chain })
			.then((r) => {
				if (!alive.current) return;
				const ordered = orderTokens(r.tokens, chain);
				cache.set(chain, ordered);
				setAll(ordered);
			})
			.catch((e) => {
				if (!alive.current) return;
				setError(explainError(e, {}).title);
			});
	}, [app, chain]);

	const shown = all
		? filterTokens(all, query).filter((t) => t.symbol.toUpperCase() !== exclude?.toUpperCase())
		: [];

	return (
		<div class="picker" role="dialog" aria-label="Choose a token">
			<div class="row">
				<input
					type="search"
					class="mono"
					placeholder="Search by symbol or name"
					value={query}
					onInput={(e) => setQuery(e.currentTarget.value)}
					autoFocus
				/>
				<button class="ghost" onClick={onClose} aria-label="Close">
					×
				</button>
			</div>
			{error && <p class="error">{error}</p>}
			{!all && !error && <p class="muted">loading tokens…</p>}
			{all && shown.length === 0 && <p class="muted">No token matches "{query}".</p>}
			<ul class="token-list">
				{shown.map((t) => (
					<li key={t.address}>
						<button class="token-row" data-token={t.symbol} onClick={() => onPick(t)}>
							<span class="mono">{t.symbol}</span>
							<span class="muted">{t.name}</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
