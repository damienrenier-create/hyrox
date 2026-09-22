// Systeme visuel commun (DA « terrain clair », tokens dans globals.css). Chaines litterales completes
// pour que Tailwind les detecte. `cx` assemble des classes conditionnelles.

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-xl font-bold whitespace-nowrap transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

export const ui = {
  page: "min-h-[100dvh] bg-paper text-ink font-sans",
  container: "max-w-5xl mx-auto px-4 sm:px-6",

  card: "bg-card border border-line rounded-2xl shadow-card",
  cardPad: "bg-card border border-line rounded-2xl shadow-card p-4 sm:p-5",
  inset: "bg-paper border border-line rounded-xl",

  h1: "font-display font-extrabold tracking-tight text-2xl sm:text-3xl text-ink",
  h2: "font-display font-bold tracking-tight text-lg text-ink",
  h3: "font-display font-bold text-base text-ink",
  eyebrow: "text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3",
  muted: "text-sm text-ink-2",
  hint: "text-xs text-ink-3",

  label: "block text-xs font-semibold text-ink-2 mb-1",
  input:
    "w-full bg-card border border-line-2 rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition",
  check: "w-4 h-4 accent-brand",

  btn: `${btnBase} px-4 py-2.5 text-sm`,
  btnSm: `${btnBase} px-3 py-1.5 text-xs`,
  btnLg: `${btnBase} px-5 py-3 text-base`,

  primary: "bg-brand text-white hover:bg-brand-hover shadow-sm",
  accent: "bg-accent text-ink hover:bg-accent-hover shadow-sm",
  dark: "bg-ink text-white hover:bg-ink/85",
  sea: "bg-sea text-white hover:bg-sea-hover shadow-sm",
  success: "bg-success text-white hover:bg-success/90 shadow-sm",
  danger: "bg-danger-soft text-danger-ink hover:bg-danger hover:text-white",
  ghost: "bg-card border border-line-2 text-ink hover:bg-paper",
  soft: "bg-paper text-ink-2 hover:bg-line hover:text-ink",

  chip: "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold leading-4",
  chipBrand: "bg-brand-soft text-brand-ink",
  chipAccent: "bg-accent-soft text-accent-ink",
  chipSea: "bg-sea-soft text-sea-ink",
  chipOk: "bg-success-soft text-success-ink",
  chipWarn: "bg-warn-soft text-warn-ink",
  chipErr: "bg-danger-soft text-danger-ink",
  chipMuted: "bg-line text-ink-2",

  alertOk: "bg-success-soft border border-success/30 text-success-ink rounded-xl px-3 py-2 text-sm",
  alertErr: "bg-danger-soft border border-danger/30 text-danger-ink rounded-xl px-3 py-2 text-sm",
  alertWarn: "bg-warn-soft border border-warn/40 text-warn-ink rounded-xl px-3 py-2 text-sm",
  alertInfo: "bg-brand-soft border border-brand/20 text-brand-ink rounded-xl px-3 py-2 text-sm",

  segmented: "inline-flex gap-1 bg-line/70 rounded-xl p-1",
  segOn: "bg-card text-ink shadow-sm",
  segOff: "text-ink-2 hover:text-ink",

  pill: "text-xs font-bold px-2.5 py-1.5 rounded-full border transition",
  pillOn: "bg-brand border-brand text-white",
  pillOff: "bg-card border-line-2 text-ink-2 hover:border-brand hover:text-ink",

  th: "p-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-2 border-b border-line",
  tr: "border-b border-line/70 odd:bg-paper/60",

  backdrop: "fixed inset-0 z-30 bg-ink/35 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4",
  sheet: "bg-card rounded-t-3xl sm:rounded-3xl p-5 w-full max-h-[85dvh] overflow-auto shadow-pop",
  close: "w-8 h-8 rounded-full bg-paper text-ink-2 hover:bg-line font-bold flex items-center justify-center",
} as const;

// Boutons composes (les plus utilises).
export const btn = {
  primary: `${ui.btn} ${ui.primary}`,
  accent: `${ui.btn} ${ui.accent}`,
  dark: `${ui.btn} ${ui.dark}`,
  sea: `${ui.btn} ${ui.sea}`,
  success: `${ui.btn} ${ui.success}`,
  danger: `${ui.btn} ${ui.danger}`,
  ghost: `${ui.btn} ${ui.ghost}`,
  soft: `${ui.btn} ${ui.soft}`,
  smPrimary: `${ui.btnSm} ${ui.primary}`,
  smGhost: `${ui.btnSm} ${ui.ghost}`,
  smSoft: `${ui.btnSm} ${ui.soft}`,
  smDanger: `${ui.btnSm} ${ui.danger}`,
  smSuccess: `${ui.btnSm} ${ui.success}`,
  smSea: `${ui.btnSm} ${ui.sea}`,
  lgPrimary: `${ui.btnLg} ${ui.primary}`,
  lgAccent: `${ui.btnLg} ${ui.accent}`,
  lgSuccess: `${ui.btnLg} ${ui.success}`,
  lgDanger: `${ui.btnLg} bg-danger text-white hover:bg-danger/90 shadow-sm`,
  lgGhost: `${ui.btnLg} ${ui.ghost}`,
  lgDark: `${ui.btnLg} ${ui.dark}`,
} as const;
