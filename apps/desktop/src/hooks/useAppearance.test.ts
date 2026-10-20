import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useAppearance } from "./useAppearance";
import { SELECTION_STORAGE_KEY, persistSelectionPreference } from "../../../../frontend/src/ui/selectionPreference";

it("keeps the selection preference independent of appearance and accent across listeners and remounts", () => {
  const first = renderHook(useAppearance);
  const second = renderHook(useAppearance);
  act(() => first.result.current.setSelectionColor("monochrome"));
  expect(second.result.current.selectionColor).toBe("monochrome");
  expect(document.documentElement).toHaveAttribute("data-selection-color", "monochrome");
  const accent = first.result.current.accent;
  act(() => first.result.current.setAppearance("dark"));
  expect(first.result.current.accent).toBe(accent);
  expect(first.result.current.selectionColor).toBe("monochrome");
  first.unmount();
  const remounted = renderHook(useAppearance);
  expect(remounted.result.current.selectionColor).toBe("monochrome");
  act(() => persistSelectionPreference("accent"));
  expect(remounted.result.current.selectionColor).toBe("accent");
  act(() => {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, "monochrome");
    window.dispatchEvent(new StorageEvent("storage", { key: SELECTION_STORAGE_KEY, newValue: "monochrome" }));
  });
  expect(second.result.current.selectionColor).toBe("monochrome");
});
