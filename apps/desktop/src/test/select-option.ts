import { fireEvent } from "@testing-library/react";

/** Exercise the real Mantine listbox rather than changing its readonly input. */
export function selectOption(input: HTMLElement, value: string) {
  fireEvent.click(input);
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.getAttribute("value") === value);
  if (!option) throw new Error(`No listbox option for ${value}`);
  fireEvent.click(option);
}

export function selectListbox(input: HTMLElement) {
  const listbox = document.querySelector<HTMLElement>(`[role="listbox"][aria-labelledby="${input.id}-label"]`);
  if (!listbox) throw new Error("Select listbox missing");
  return listbox;
}
