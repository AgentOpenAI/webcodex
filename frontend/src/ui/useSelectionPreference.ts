import { useLayoutEffect, useState } from "react";
import { applySelectionPreference, loadSelectionPreference, normalizeSelectionPreference, persistSelectionPreference, SELECTION_CHANGE_EVENT, SELECTION_STORAGE_KEY, type SelectionColorMode } from "./selectionPreference.js";

export function useSelectionPreference() {
  const [mode, setMode] = useState(loadSelectionPreference);
  useLayoutEffect(() => {
    const update = (event: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key === SELECTION_STORAGE_KEY || event.key === null) setMode(normalizeSelectionPreference(event.newValue));
      } else setMode(normalizeSelectionPreference((event as CustomEvent).detail));
    };
    window.addEventListener("storage", update);
    window.addEventListener(SELECTION_CHANGE_EVENT, update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener(SELECTION_CHANGE_EVENT, update);
    };
  }, []);
  useLayoutEffect(() => applySelectionPreference(mode), [mode]);
  return { mode, setMode: (next: SelectionColorMode) => { setMode(next); persistSelectionPreference(next); } };
}
