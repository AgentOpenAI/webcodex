import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applySelectionPreference, loadSelectionPreference, persistSelectionPreference, SELECTION_STORAGE_KEY } from "../src/ui/selectionPreference.js";
import { useSelectionPreference } from "../src/ui/useSelectionPreference.js";
import { initializeCardAppearance } from "../src/ui/cardAppearance.js";
import { ACCENT_STORAGE_KEY, persistAccentPreference } from "../src/ui/accent.js";

function Preference() {
  const { mode, setMode } = useSelectionPreference();
  return <button onClick={() => setMode(mode === "accent" ? "monochrome" : "accent")}>{mode}</button>;
}

describe("local selected color preference", () => {
  it("defaults to accent and persists monochrome without overwriting the chosen accent", () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "#7c3aed");
    expect(loadSelectionPreference()).toBe("accent");
    persistSelectionPreference("monochrome");
    expect(loadSelectionPreference()).toBe("monochrome");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("#7c3aed");
    window.localStorage.setItem(SELECTION_STORAGE_KEY, "bad");
    expect(loadSelectionPreference()).toBe("accent");
  });
  it("updates multiple controls on same-page changes and cross-tab storage events", () => {
    render(<><Preference /><Preference /></>);
    fireEvent.click(screen.getAllByText("accent")[0]);
    expect(screen.getAllByText("monochrome")).toHaveLength(2);
    expect(document.documentElement.dataset.selectionColor).toBe("monochrome");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: SELECTION_STORAGE_KEY, newValue: "accent" })));
    expect(screen.getAllByText("accent")).toHaveLength(2);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    expect(document.documentElement.dataset.selectionColor).toBe("accent");
  });
  it("keeps a usable in-memory choice when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw Error("blocked"); });
    expect(loadSelectionPreference()).toBe("accent");
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw Error("blocked"); });
    render(<Preference />);
    fireEvent.click(screen.getByText("accent"));
    expect(document.documentElement.dataset.selectionColor).toBe("monochrome");
  });
  it("keeps Host theme authoritative in cards and stops observing after teardown", async () => {
    const card = initializeCardAppearance();
    card.updateTheme("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    persistSelectionPreference("monochrome");
    persistAccentPreference("#7c3aed");
    await act(async () => {});
    expect(document.documentElement.dataset.selectionColor).toBe("monochrome");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    card.destroy();
    applySelectionPreference("accent");
    persistSelectionPreference("monochrome");
    expect(document.documentElement.dataset.selectionColor).toBe("accent");
    document.documentElement.style.cssText = "";
  });
});
