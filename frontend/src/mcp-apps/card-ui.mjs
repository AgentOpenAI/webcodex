// Self-contained MCP card presentation. No Host requests or authority state.
export { createSelectionMotion } from '../ui/selectionMotion';
import { initializeCardAppearance } from '../ui/cardAppearance';
import { enhanceSelects } from '../ui/enhancedSelect';
import { loadSelectionPreference, persistSelectionPreference, applySelectionPreference, SELECTION_CHANGE_EVENT } from '../ui/selectionPreference';

export function initializeCardControls(preferenceSelect) {
  const root = preferenceSelect?.ownerDocument?.documentElement;
  const win = root?.ownerDocument?.defaultView;
  // Protocol fixtures intentionally have no browser document.
  if (!win) return { destroy() {}, updateTheme() {}, update() {} };
  const appearance = initializeCardAppearance(root);
  const selects = enhanceSelects(root.ownerDocument.body);
  const sync = event => {
    preferenceSelect.value = event?.detail === 'accent' || event?.detail === 'monochrome' ? event.detail : loadSelectionPreference();
    selects.update();
  };
  const change = () => {
    const mode = preferenceSelect.value === 'monochrome' ? 'monochrome' : 'accent';
    persistSelectionPreference(mode);
    applySelectionPreference(mode, root);
    selects.update();
  };
  preferenceSelect.addEventListener('change', change);
  win.addEventListener(SELECTION_CHANGE_EVENT, sync);
  win.addEventListener('storage', sync);
  sync();
  return {
    updateTheme: theme => appearance.updateTheme(theme),
    update: () => selects.update(),
    destroy() {
      preferenceSelect.removeEventListener('change', change);
      win.removeEventListener(SELECTION_CHANGE_EVENT, sync);
      win.removeEventListener('storage', sync);
      selects.destroy(); appearance.destroy();
    },
  };
}
