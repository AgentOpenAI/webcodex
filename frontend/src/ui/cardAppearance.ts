import { ACCENT_CHANGE_EVENT, ACCENT_STORAGE_KEY, applyAccentPreference, loadAccentPreference, normalizeAccent } from "./accent.js";
import { applySelectionPreference, loadSelectionPreference, normalizeSelectionPreference, SELECTION_CHANGE_EVENT, SELECTION_STORAGE_KEY } from "./selectionPreference.js";

/** Host theme remains authoritative; personal accent/selection are local only. */
export function initializeCardAppearance(root: HTMLElement = document.documentElement) {
  const view = root?.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return { updateTheme(_theme: "light" | "dark") {}, destroy() {} };
  let accent = loadAccentPreference();
  let mode = loadSelectionPreference();
  let previous = "";
  const theme = () => {
    const scheme = view.getComputedStyle(root).colorScheme;
    return scheme === "dark" || (scheme !== "light" && view.matchMedia?.("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  };
  function update() {
    const resolved = theme();
    const key = `${resolved}:${accent}`;
    if (key !== previous) {
      previous = key;
      applyAccentPreference(accent, resolved, root);
    }
    if (root.dataset.selectionColor !== mode) applySelectionPreference(mode, root);
  }
  function changed(event: Event) {
    if (event instanceof view!.StorageEvent) {
      if (event.key === ACCENT_STORAGE_KEY || event.key === null) accent = normalizeAccent(event.newValue) || loadAccentPreference();
      if (event.key === SELECTION_STORAGE_KEY || event.key === null) mode = normalizeSelectionPreference(event.newValue);
    } else if (event.type === ACCENT_CHANGE_EVENT) accent = normalizeAccent((event as CustomEvent).detail) || accent;
    else mode = normalizeSelectionPreference((event as CustomEvent).detail);
    update();
  }
  const observer = new view.MutationObserver(update);
  const media = view.matchMedia?.("(prefers-color-scheme: dark)");
  observer.observe(root, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-resolved-theme"] });
  media?.addEventListener("change", update);
  view.addEventListener("storage", changed);
  view.addEventListener(ACCENT_CHANGE_EVENT, changed);
  view.addEventListener(SELECTION_CHANGE_EVENT, changed);
  update();
  return {
    updateTheme(value: "light" | "dark") { if (root.style.colorScheme !== value) root.style.colorScheme = value; update(); },
    destroy() {
      observer.disconnect(); media?.removeEventListener("change", update);
      view.removeEventListener("storage", changed); view.removeEventListener(ACCENT_CHANGE_EVENT, changed); view.removeEventListener(SELECTION_CHANGE_EVENT, changed);
    },
  };
}
