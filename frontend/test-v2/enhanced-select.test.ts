import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enhanceSelects } from "../src/ui/enhancedSelect.js";

let controller: ReturnType<typeof enhanceSelects> | undefined;
afterEach(() => { controller?.destroy(); controller = undefined; document.body.replaceChildren(); });
function fixture(html = '<label>Kind<select name="kind"><option value="note">Note</option><option value="question" disabled>Question</option><option value="todo">Todo</option></select></label>') {
  document.body.innerHTML = html;
  controller = enhanceSelects(document.body);
  const select = document.querySelector("select")!;
  const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ x: 50, y: 50, top: 50, left: 50, bottom: 86, right: 210, width: 160, height: 36, toJSON() {} });
  return { select, trigger, list: () => document.querySelector<HTMLElement>('[role="listbox"]')! };
}
describe("MCP single-select chrome", () => {
  it("preserves form/value ownership and emits exactly one real change on keyboard selection", () => {
    const { select, trigger, list } = fixture();
    const change = vi.fn(); select.addEventListener("change", change);
    expect(trigger.getAttribute("aria-label")).toBe("Kind");
    trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(list().parentElement).toBe(document.body);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(select.value).toBe("todo"); expect(change).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger); expect(trigger.getAttribute("aria-expanded")).toBe("false");
    controller!.destroy(); controller = undefined;
    expect(select.parentElement?.localName).toBe("label"); expect(select.hasAttribute("aria-hidden")).toBe(false); expect(select.tabIndex).toBe(0);
    expect(document.querySelector('[role="combobox"]')).toBeNull();
  });
  it("cancels with Escape/Tab/outside click without changing value", () => {
    const { select, trigger } = fixture();
    fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: "End" }); fireEvent.keyDown(trigger, { key: "Escape" });
    expect(select.value).toBe("note"); expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: "Tab" }); expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger); fireEvent.pointerDown(document.body); expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
  it("handles typeahead, optgroup disabled options and disabled state", () => {
    const { select, trigger } = fixture('<select aria-label="Pick"><option value="a">Alpha</option><optgroup label="Unavailable" disabled><option value="b">Beta</option></optgroup><option value="g">Gamma</option></select>');
    fireEvent.keyDown(trigger, { key: "g" }); fireEvent.keyDown(trigger, { key: "Enter" }); expect(select.value).toBe("g");
    select.disabled = true; controller!.update(); expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger); expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
  it("synchronizes programmatic values and dynamically replaced options/selects", async () => {
    const { select, trigger } = fixture();
    select.value = "todo"; controller!.update(); expect(trigger.textContent).toBe("Todo");
    await act(async () => { select.replaceChildren(new Option("Latest", "new")); await new Promise(requestAnimationFrame); });
    expect(trigger.textContent).toBe("Latest");
    await act(async () => { document.body.innerHTML = '<select aria-label="New"><option>Replacement</option></select>'; await new Promise(requestAnimationFrame); });
    expect(document.querySelectorAll('[role="combobox"]')).toHaveLength(1);
    expect(document.querySelector('[role="combobox"]')?.textContent).toBe("Replacement");
  });
  it("does not commit a stale popup option after the native inventory changes before paint", () => {
    const { select, trigger, list } = fixture('<select aria-label="Executor"><option value="">Choose an executor</option><option value="old">Original Runner</option></select>');
    const change = vi.fn(); select.addEventListener("change", change);
    fireEvent.click(trigger);
    const staleOption = list().querySelectorAll('[role="option"]')[1];
    select.replaceChildren(new Option("Choose an executor", ""), new Option("Replacement Runner", "new"));
    fireEvent.click(staleOption);
    expect(select.value).toBe("");
    expect(change).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    fireEvent.click(list().querySelectorAll('[role="option"]')[1]);
    expect(select.value).toBe("new");
    expect(change).toHaveBeenCalledTimes(1);
  });
  it("cancels the active popup when refreshed routes reuse the same option values and labels", () => {
    const { select, trigger } = fixture('<select aria-label="Executor"><option value="">Choose an executor</option><option value="0">Runner</option></select>');
    const change = vi.fn(); select.addEventListener("change", change);
    fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: "End" });
    select.replaceChildren(new Option("Choose an executor", ""), new Option("Runner", "0"));
    controller!.update();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(select.value).toBe("");
    expect(change).not.toHaveBeenCalled();
  });
  it("positions the popup within the viewport and repositions while scrolling", () => {
    const { trigger, list } = fixture();
    vi.mocked(trigger.getBoundingClientRect).mockReturnValue({ x: 960, y: 720, top: 720, left: 960, bottom: 756, right: 1120, width: 160, height: 36, toJSON() {} });
    fireEvent.click(trigger);
    expect(parseFloat(list().style.left)).toBeLessThanOrEqual(window.innerWidth - 160 - 8);
    expect(list().style.bottom).not.toBe("auto");
    vi.mocked(trigger.getBoundingClientRect).mockReturnValue({ x: 50, y: 50, top: 50, left: 50, bottom: 86, right: 210, width: 160, height: 36, toJSON() {} });
    fireEvent.scroll(document);
    expect(list().style.top).toBe("92px");
  });
});
