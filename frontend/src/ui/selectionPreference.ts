/** Local appearance only: never an account, authorization or Runtime setting. */
export type SelectionColorMode = "accent" | "monochrome";
export const SELECTION_STORAGE_KEY = "webcodex.ui.selection.v1";
export const SELECTION_CHANGE_EVENT = "webcodex:selection-change";

export function normalizeSelectionPreference(value: unknown): SelectionColorMode {
  return value === "monochrome" ? "monochrome" : "accent";
}

export function loadSelectionPreference(): SelectionColorMode {
  try { return normalizeSelectionPreference(window.localStorage.getItem(SELECTION_STORAGE_KEY)); }
  catch { return "accent"; }
}

export function persistSelectionPreference(mode: SelectionColorMode): void {
  const value = normalizeSelectionPreference(mode);
  try { window.localStorage.setItem(SELECTION_STORAGE_KEY, value); }
  catch { /* The current page still keeps the user's in-memory choice. */ }
  window.dispatchEvent(new CustomEvent(SELECTION_CHANGE_EVENT, { detail: value }));
}

export function applySelectionPreference(mode: SelectionColorMode, root: HTMLElement = document.documentElement): void {
  root.dataset.selectionColor = normalizeSelectionPreference(mode);
}
