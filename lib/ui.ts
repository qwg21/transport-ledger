export const ui = {
  // Surfaces & Cards
  card: 'rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow',
  cardPadded: 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm',
  cardHeader: 'flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-slate-100',
  kpiCard: 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow transition-shadow',

  // Typography
  pageTitle: 'text-2xl sm:text-3xl font-bold tracking-tight text-slate-900',
  sectionTitle: 'text-lg font-bold text-slate-900 tracking-tight',
  cardTitle: 'text-base font-bold text-slate-900',
  body: 'text-sm text-slate-700 leading-relaxed',
  label: 'block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5',
  groupLabel: 'px-3 text-xs font-semibold uppercase tracking-wider text-slate-400',
  muted: 'text-xs text-slate-500',
  mono: 'font-mono text-xs sm:text-sm',

  // Form Controls
  input:
    'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors',
  select:
    'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors',
  textarea:
    'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors',

  // Buttons (Clear Visual Hierarchy)
  btnPrimary:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow transition disabled:opacity-50 disabled:cursor-not-allowed',
  btnSuccess:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow transition disabled:opacity-50 disabled:cursor-not-allowed',
  btnDark:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow transition disabled:opacity-50 disabled:cursor-not-allowed',
  btnSecondary:
    'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed',
  btnDanger:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow transition disabled:opacity-50 disabled:cursor-not-allowed',
  btnDangerGhost:
    'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold text-rose-600 hover:bg-rose-50 active:bg-rose-100 transition',
  iconBtn:
    'p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-600 hover:text-slate-900 shadow-xs transition disabled:opacity-40 disabled:cursor-not-allowed',

  // Badges & Pills
  badgeSuccess:
    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  badgeWarning:
    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  badgeInfo:
    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20',
  badgeDanger:
    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20',
  badgeNeutral:
    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20',

  // Responsive Tables (Modern Web Guidance responsive-table pattern)
  tableWrapper:
    'w-full overflow-x-auto rounded-xl border border-slate-200/80 focus:outline-none focus:ring-2 focus:ring-blue-100',
  table: 'w-full text-left text-sm border-collapse',
  thead: 'bg-slate-50/90 backdrop-blur-xs text-xs font-semibold uppercase tracking-wider text-slate-600 border-b border-slate-200 sticky top-0 z-10',
  th: 'py-3.5 px-3 whitespace-nowrap',
  td: 'py-3.5 px-3 align-middle',
  trHover: 'hover:bg-slate-50/80 transition-colors'
} as const;
