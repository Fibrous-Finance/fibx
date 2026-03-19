// Single source of truth for CLI brand palette.
// Used by index.ts (banner) and lib/format.ts (output formatting).

export const BLUE = "#818cf8"; // indigo-400  — primary accent
export const MINT = "#34d399"; // emerald-400 — Fibrous-green / success
export const SLATE = "#94a3b8"; // slate-400   — table even rows

// ASCII logo row colors (blue → mint gradient)
export const LOGO_ROW_COLORS = [
	"#818cf8",
	"#7b9af4",
	"#6fb8ec",
	"#5bc8e4",
	"#45d4da",
	"#34d399",
] as const;
