/** Accessible single-select chrome for framework-free MCP Apps.
 * The original select remains the only owner of the value, form and change event.
 */
type SelectController = { update(): void; destroy(): void };
let nextId = 0;

export function enhanceSelects(root: HTMLElement): SelectController {
  const doc = root?.ownerDocument;
  const view = doc?.defaultView;
  if (!view || !root.querySelectorAll || !view.MutationObserver) return { update() {}, destroy() {} };
  const entries = new Map<HTMLSelectElement, SelectController>();
  let pending = 0;
  let destroyed = false;

  function enhance(select: HTMLSelectElement): SelectController {
    const id = `webcodex-select-${++nextId}`;
    const tabIndex = select.getAttribute("tabindex");
    const ariaHidden = select.getAttribute("aria-hidden");
    const wrapper = doc.createElement("span");
    wrapper.className = "ui-select";
    const trigger = doc.createElement("button");
    trigger.type = "button";
    trigger.className = "ui-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", id);
    const label = doc.createElement("span");
    label.className = "ui-select-value";
    trigger.append(label);
    const list = doc.createElement("div");
    list.className = "ui-select-menu";
    list.id = id;
    list.role = "listbox";
    list.hidden = true;
    doc.body.append(list);
    select.before(wrapper);
    wrapper.append(select, trigger);
    select.classList.add("ui-select-source");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    let open = false;
    let active = -1;
    let query = "";
    let typedAt = 0;
    let options: HTMLOptionElement[] = [];
    let optionNodes: HTMLElement[] = [];
    let signature = "";
    const enabled = (index: number) => !!options[index] && !options[index].disabled
      && !(options[index].parentElement?.localName === "optgroup" && (options[index].parentElement as HTMLOptGroupElement).disabled)
      && !options[index].hidden;

    function accessibleName(): string {
      if (select.getAttribute("aria-label")) return select.getAttribute("aria-label")!;
      const labelled = select.getAttribute("aria-labelledby");
      if (labelled) return labelled.split(/\s+/).map(id => doc.getElementById(id)?.textContent || "").join(" ").trim();
      return Array.from(select.labels || []).map(source => {
        const copy = source.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("select,.ui-select").forEach(node => node.remove());
        return copy.textContent?.trim() || "";
      }).join(" ").trim() || select.name || "Select an option";
    }
    function close() {
      open = false;
      query = "";
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
    }
    function position() {
      if (!open) return;
      const box = trigger.getBoundingClientRect();
      if (!trigger.isConnected || !box.width || !box.height) { close(); return; }
      const width = Math.min(Math.max(box.width, 160), Math.max(0, view!.innerWidth - 16));
      const below = view!.innerHeight - box.bottom - 12;
      const above = box.top - 12;
      const upwards = below < 180 && above > below;
      const height = Math.min(280, Math.max(48, upwards ? above : below));
      Object.assign(list.style, { width: `${width}px`, maxHeight: `${height}px`, left: `${Math.max(8, Math.min(box.left, view!.innerWidth - width - 8))}px`, top: upwards ? "auto" : `${box.bottom + 6}px`, bottom: upwards ? `${view!.innerHeight - box.top + 6}px` : "auto" });
    }
    function highlight(index: number) {
      active = index;
      optionNodes.forEach((node, i) => node.toggleAttribute("data-highlighted", i === index));
      if (open && optionNodes[index]) {
        trigger.setAttribute("aria-activedescendant", optionNodes[index].id);
        optionNodes[index].scrollIntoView?.({ block: "nearest" });
      }
    }
    function choose(index: number) {
      // Host updates can replace routes between paint and this click/keypress.
      // Reconcile synchronously so an old menu index cannot select a new target.
      update();
      if (!open || !enabled(index) || select.disabled) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close();
      update();
      if (changed) {
        select.dispatchEvent(new view!.Event("input", { bubbles: true }));
        select.dispatchEvent(new view!.Event("change", { bubbles: true }));
      }
      if (trigger.isConnected) trigger.focus();
    }
    function show() {
      if (select.disabled) return;
      update();
      if (!options.some((_, i) => enabled(i))) return;
      if (!list.isConnected) doc.body.append(list);
      open = true;
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      position();
      highlight(enabled(select.selectedIndex) ? select.selectedIndex : options.findIndex((_, i) => enabled(i)));
    }
    function move(direction: number) {
      let index = active;
      for (let count = 0; count < options.length; count++) {
        index = (index + direction + options.length) % options.length;
        if (enabled(index)) { highlight(index); return; }
      }
    }
    function keydown(event: KeyboardEvent) {
      if (select.disabled) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!open) show();
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") move(event.key === "ArrowDown" ? 1 : -1);
        if (event.key === "Home") highlight(options.findIndex((_, i) => enabled(i)));
        if (event.key === "End") highlight(options.map((_, i) => i).reverse().find(i => enabled(i)) ?? -1);
      } else if (event.key === "Enter" || (event.key === " " && !query)) {
        event.preventDefault();
        if (open) choose(active); else show();
      } else if (event.key === "Escape") {
        if (open) { event.preventDefault(); event.stopPropagation(); close(); }
      } else if (event.key === "Tab") close();
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (!open) show();
        const now = Date.now();
        query = now - typedAt < 700 ? query + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
        typedAt = now;
        const search = Array.from(query).every(char => char === query[0]) ? query[0] : query;
        for (let offset = 1; offset <= options.length; offset++) {
          const index = (Math.max(active, 0) + offset) % options.length;
          if (enabled(index) && options[index].text.trim().toLocaleLowerCase().startsWith(search)) { highlight(index); break; }
        }
      }
    }
    function update() {
      const nextOptions = Array.from(select.options);
      const replaced = options.length !== nextOptions.length || options.some((option, index) => option !== nextOptions[index]);
      options = nextOptions;
      const name = accessibleName();
      if (trigger.getAttribute("aria-label") !== name) trigger.setAttribute("aria-label", name);
      list.setAttribute("aria-label", name);
      trigger.disabled = select.disabled;
      trigger.setAttribute("aria-required", String(select.required));
      const describedBy = select.getAttribute("aria-describedby");
      if (describedBy) trigger.setAttribute("aria-describedby", describedBy); else trigger.removeAttribute("aria-describedby");
      const invalid = select.getAttribute("aria-invalid");
      if (invalid) trigger.setAttribute("aria-invalid", invalid); else trigger.removeAttribute("aria-invalid");
      wrapper.hidden = select.hidden || select.style.display === "none";
      const text = options[select.selectedIndex]?.text || "";
      if (label.textContent !== text) label.textContent = text;
      const next = JSON.stringify(options.map((option, i) => [option.text, option.value, enabled(i), option.parentElement?.getAttribute("label")]));
      // Route values may be reused indices and labels need not be unique.
      // Native option identity also invalidates an already-open selection.
      if (open && (replaced || signature !== next)) close();
      if (signature !== next) {
        signature = next;
        list.replaceChildren();
        optionNodes = options.map((option, index) => {
          const node = doc.createElement("div");
          node.role = "option";
          node.id = `${id}-${index}`;
          node.className = "ui-select-option";
          node.textContent = option.text;
          node.hidden = option.hidden;
          node.setAttribute("aria-disabled", String(!enabled(index)));
          node.addEventListener("pointerdown", event => event.preventDefault());
          node.addEventListener("pointermove", () => { if (enabled(index)) highlight(index); });
          node.addEventListener("click", () => choose(index));
          const group = option.parentElement?.localName === "optgroup" ? option.parentElement as HTMLOptGroupElement : null;
          if (group && (index === 0 || options[index - 1].parentElement !== group)) {
            const heading = doc.createElement("div"); heading.className = "ui-select-group"; heading.textContent = group.label; heading.setAttribute("aria-hidden", "true"); list.append(heading);
          }
          list.append(node);
          return node;
        });
      }
      optionNodes.forEach((node, i) => node.setAttribute("aria-selected", String(i === select.selectedIndex)));
      if (open && (select.disabled || wrapper.hidden || !enabled(active))) close();
      position();
    }
    const click = () => { query = ""; if (open) close(); else show(); };
    const outside = (event: Event) => { if (!wrapper.contains(event.target as Node) && !list.contains(event.target as Node)) close(); };
    const focus = () => trigger.focus();
    const reset = () => view!.queueMicrotask(update);
    const resize = new view!.ResizeObserver(position);
    resize.observe(trigger);
    trigger.addEventListener("click", click);
    trigger.addEventListener("keydown", keydown);
    trigger.addEventListener("blur", close);
    select.addEventListener("focus", focus);
    select.addEventListener("change", update);
    select.form?.addEventListener("reset", reset);
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("scroll", position, true);
    view!.addEventListener("resize", position);
    update();
    return { update, destroy() {
      close(); resize.disconnect();
      trigger.removeEventListener("click", click); trigger.removeEventListener("keydown", keydown); trigger.removeEventListener("blur", close);
      select.removeEventListener("focus", focus); select.removeEventListener("change", update); select.form?.removeEventListener("reset", reset);
      doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("scroll", position, true); view!.removeEventListener("resize", position);
      select.classList.remove("ui-select-source");
      if (tabIndex === null) select.removeAttribute("tabindex"); else select.setAttribute("tabindex", tabIndex);
      if (ariaHidden === null) select.removeAttribute("aria-hidden"); else select.setAttribute("aria-hidden", ariaHidden);
      list.remove();
      if (wrapper.parentNode) { wrapper.before(select); wrapper.remove(); }
    } };
  }
  function update() {
    if (destroyed) return;
    for (const [select, entry] of entries) if (!root.contains(select)) { entry.destroy(); entries.delete(select); }
    for (const select of root.querySelectorAll<HTMLSelectElement>("select:not([multiple])")) {
      if (select.size > 1 || select.hasAttribute("data-native-select")) continue;
      if (!entries.has(select)) entries.set(select, enhance(select));
      else entries.get(select)!.update();
    }
  }
  const observer = new view.MutationObserver(records => {
    if (!records.some(record => {
      const target = record.target as Element;
      if (target.localName === "select" || target.closest?.("select")) return true;
      return record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && ((node as Element).matches("select,.ui-select") || (node as Element).querySelector("select")));
    }) || pending) return;
    pending = view.requestAnimationFrame(() => { pending = 0; update(); });
  });
  update();
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  return { update, destroy() { destroyed = true; observer.disconnect(); view.cancelAnimationFrame(pending); entries.forEach(entry => entry.destroy()); entries.clear(); } };
}
