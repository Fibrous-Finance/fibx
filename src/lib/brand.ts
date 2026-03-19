// Single source of truth for CLI brand palette.
// Used by index.ts (banner) and lib/format.ts (output formatting).

export const BLUE = "#11B2BA"; // fibx teal    — primary accent
export const MINT = "#0FD9A2"; // fibx green   — success / USD values
export const SLATE = "#94a3b8"; // slate-400    — table even rows

// ASCII logo row colors (teal → green gradient)
export const LOGO_ROW_COLORS = [
	"#11B2BA",
	"#10B9B4",
	"#0FC1AE",
	"#0EC9A8",
	"#0FD1A5",
	"#0FD9A2",
] as const;
