import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Production bundles, public loopback fixtures, ephemeral listener; no Runtime services.
const serverModule = process.env.WEBCODEX_UI_SERVER_MODULE
  ? pathToFileURL(process.env.WEBCODEX_UI_SERVER_MODULE).href : new URL('./server.mjs', import.meta.url).href;
const { startFixtureServer } = await import(serverModule);
const output = new URL('../../artifacts/selection-consistency/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const report = { fixture: true, nativeBackend: false, matrix: { widths: [1440, 390], themes: ['light', 'dark'], selectionModes: ['accent', 'monochrome'] }, checks: [], screenshots: [], errors: [],
  limitations: ['Production Chromium renderer with synthetic public fixtures; no live Runtime, model, or native WebView acceptance.'] };
report.bundles = ['frontend/dist/app.js', 'frontend/dist/styles.css', 'frontend/dist/admin.js', 'frontend/dist/admin.css'].map(file => ({
  file, sha256: createHash('sha256').update(fs.readFileSync(new URL(file, new URL('../../', serverModule)))).digest('hex'),
}));
const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
function check(name, data, passed) {
  report.checks.push({ name, ...data, passed });
  assert(passed, `${name}: ${JSON.stringify(data)}`);
}
async function frames(page, count = 2) {
  await page.evaluate(count => new Promise(resolve => {
    const tick = () => --count ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick);
  }), count);
}
async function settle(page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) if (animation.effect?.target?.matches('[data-selection-motion-overlay]')) animation.finish();
  });
  await frames(page);
  // A final smooth-scroll event can enqueue a new React selection after the
  // current animation was finished above. Measure after that animation settles.
  await page.waitForFunction(() => document.getAnimations().filter(animation =>
    animation.effect?.target?.matches('[data-selection-motion-overlay]')).every(animation =>
    animation.playState !== 'running' && !animation.pending));
}
async function screenshot(page, name) {
  await page.screenshot({ path: new URL(`${name}.png`, output).pathname, caret: 'hide' });
  report.screenshots.push(`${name}.png`);
}
async function bounds(locator) {
  return locator.evaluate(node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; });
}
async function noOverflow(page, name) {
  const geometry = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, root: document.documentElement.scrollWidth }));
  check(`${name} no horizontal overflow`, geometry, geometry.body <= geometry.width + 1 && geometry.root <= geometry.width + 1);
}
async function inspectSelection(page, selector, variant, name) {
  const group = page.locator(selector).first();
  await group.locator('[data-selection-motion-plate]').waitFor({ state: 'visible' });
  await settle(page);
  const state = await group.evaluate(group => {
    const plate = group.querySelector('[data-selection-motion-plate]'), selected = group.querySelector('[data-selection-motion-selected]');
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom }; };
    const resolve = token => { const probe = document.createElement('span'); probe.style.color = `var(${token})`; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; };
    const content = [...selected.querySelectorAll('svg')].map(node => node.getBoundingClientRect());
    const walker = document.createTreeWalker(selected, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { if (!walker.currentNode.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(walker.currentNode); content.push(range.getBoundingClientRect()); }
    const contentBounds = { x: Math.min(...content.map(b => b.x)), right: Math.max(...content.map(b => b.right)) };
    contentBounds.width = contentBounds.right - contentBounds.x;
    return { content: contentBounds, variant: group.dataset.selectionMotionVariant, count: group.querySelectorAll('[data-selection-motion-plate]').length,
      plate: rect(plate), selected: rect(selected), background: getComputedStyle(plate).backgroundColor,
      fill: resolve('--ui-selection-fill'), color: resolve('--ui-selection-color'), ink: resolve('--ui-selection-ink'),
      mode: document.documentElement.dataset.selectionColor, soft: resolve('--ui-accent-soft'), onSoft: resolve('--ui-on-accent-soft'), accent: resolve('--ui-accent'),
      selectedColor: getComputedStyle(selected).color, mirrorColor: group.querySelector('[data-selection-motion-label]') ? getComputedStyle(group.querySelector('[data-selection-motion-label]')).color : null, label: selected.textContent.trim() };
  });
  const aligned = variant === 'filled'
    ? near(state.plate.x, state.selected.x) && near(state.plate.width, state.selected.width) && near(state.plate.y, state.selected.y) && near(state.plate.height, state.selected.height)
    : near(state.plate.x, state.content.x) && near(state.plate.width, state.content.width) && state.plate.height <= 3 && near(state.plate.bottom, state.selected.bottom);
  check(`${name} ${variant} selection geometry/color`, state,
    state.variant === variant && state.count === 1 && aligned && state.background === (variant === 'filled' ? state.fill : state.color) && (variant === 'filled' ? state.mirrorColor === state.ink : state.selectedColor === state.color));
  if (variant === 'filled' && state.mode === 'accent') check(`${name} pale accent navigation`, state,
    state.background === state.soft && state.mirrorColor === state.onSoft && state.background !== state.accent);
  return state;
}
async function stationaryVisuals(page, selector, name) {
  const geometry = await page.locator(selector).first().evaluate(group => {
    const box = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const text = node => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), result = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        result.push({ text: walker.currentNode.textContent, ...box(range) });
      }
      return result;
    };
    const visuals = node => ({ text: text(node), icons: [...node.querySelectorAll('svg')].map(box) });
    const mirrors = [...group.querySelectorAll('[data-selection-motion-label]')];
    return [...group.querySelectorAll('[data-selection-motion-item]')].map((item, index) => ({
      label: item.textContent.trim(), original: visuals(item), mirror: mirrors[index] ? visuals(mirrors[index]) : null,
    }));
  });
  const equalBox = (a, b) => ['x', 'y', 'width', 'height'].every(key => near(a[key], b[key], 1));
  check(`${name} stationary text and icons`, { geometry }, geometry.every(({ original, mirror }) => mirror
    && original.text.length === mirror.text.length && original.icons.length === mirror.icons.length
    && original.text.every((text, index) => text.text === mirror.text[index].text && equalBox(text, mirror.text[index]))
    && original.icons.every((icon, index) => equalBox(icon, mirror.icons[index]))));
}
async function midpoint(page, selector, targetSelector, name) {
  await settle(page);
  const sample = await page.locator(selector).first().evaluate(async (group, targetSelector) => {
    const plate = group.querySelector('[data-selection-motion-plate]');
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const before = rect(plate), originalPlate = plate;
    group.querySelector(targetSelector).click();
    await Promise.resolve(); await new Promise(resolve => requestAnimationFrame(resolve));
    const animation = plate.getAnimations()[0];
    if (!animation) return { before, missingAnimation: true };
    animation.pause(); animation.currentTime = animation.effect.getTiming().duration;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const end = rect(plate);
    animation.currentTime = 35;
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { before, middle: rect(plate), end, sampleTime: 35, selected: rect(group.querySelector('[data-selection-motion-selected]')),
      duration: animation.effect.getTiming().duration, persistent: originalPlate === group.querySelector('[data-selection-motion-plate]') };
  }, targetSelector);
  check(`${name} intermediate motion`, sample, !sample.missingAnimation && sample.persistent && sample.duration === 260
    && ['x', 'y', 'width', 'height'].some(key => !near(sample.before[key], sample.middle[key]))
    && ['x', 'y', 'width', 'height'].some(key => !near(sample.end[key], sample.middle[key])));
  if (selector === '.mobile-primary-nav') await stationaryVisuals(page, selector, `${name} midpoint`);
  await screenshot(page, `${name}-mid-motion`);
  await settle(page);
}
async function preference(page, mode, name) {
  const trigger = page.getByRole('button', { name: 'Accent color', exact: true }).filter({ visible: true }).first();
  await trigger.click();
  const palette = page.getByRole('dialog', { name: 'Accent color', exact: true });
  await palette.waitFor();
  const next = mode === 'accent' ? 'monochrome' : 'accent';
  await palette.locator(`label[for$="-${next}"]`).click();
  await page.waitForFunction(next => localStorage.getItem('webcodex.ui.selection.v1') === next && document.documentElement.dataset.selectionColor === next, next);
  await palette.locator(`label[for$="-${mode}"]`).click();
  await page.waitForFunction(mode => localStorage.getItem('webcodex.ui.selection.v1') === mode && document.documentElement.dataset.selectionColor === mode, mode);
  await screenshot(page, `${name}-selected-color-preferences`);
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'hidden' });
  check(`${name} selected-color preference controls`, { mode, toggledTo: next, persisted: await page.evaluate(() => localStorage.getItem('webcodex.ui.selection.v1')) }, true);
}
async function runtime(context, width, theme, mode) {
  const page = await context.newPage(), name = `runtime-${width}-${theme}-${mode}`;
  page.on('pageerror', error => report.errors.push({ name, error: error.message }));
  await page.route('**/api/runtime-console/window-collaboration', route => route.fulfill({ json: { available: true, can_send: true, messages: [], truncated: false } }));
  await page.goto(`${fixture.url}/runtime/`);
  await page.locator('.window-work-header').waitFor();
  await page.waitForFunction(({theme,mode}) => document.documentElement.dataset.resolvedTheme === theme && document.documentElement.dataset.selectionColor === mode, {theme,mode});
  if (width === 390) {
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await preference(page, mode, name);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  } else await preference(page, mode, name);
  const layout = { row: await bounds(page.locator('.work-view-navigation')), list: await bounds(page.locator('.window-primary-list')),
    main: await bounds(page.locator('.window-work-main')), body: await bounds(page.locator('.work-view-body')),
    compactControl: await bounds(page.locator('.work-surface-control')) };
  check(`${name} full work header row`, layout, near(layout.row.x, layout.body.x) && near(layout.row.width, layout.body.width)
    && layout.compactControl.width <= 253 && layout.row.bottom <= layout.list.y + 1 && layout.row.bottom <= layout.main.y + 1
    && (width === 390 || near(layout.list.y, layout.main.y)));
  const navigation = width === 390 ? '.mobile-primary-nav' : '.app-nav > nav';
  await inspectSelection(page, navigation, 'filled', `${name} main navigation`);
  if (width === 390) await stationaryVisuals(page, navigation, `${name} main navigation`);
  await inspectSelection(page, '.work-surface-control', 'filled', `${name} work surface`);
  await inspectSelection(page, '.window-center-tabs', 'underline', `${name} Window tabs`);
  await screenshot(page, `${name}-activity`);
  await midpoint(page, '.window-center-tabs', '#window-collaboration-tab', `${name}-tabs`);
  await inspectSelection(page, '.window-center-tabs', 'underline', `${name} Collaboration tabs`);
  const kind = page.getByRole('combobox', { name: 'Message type', exact: true });
  await kind.click();
  const options = page.getByRole('listbox', { name: 'Message type', exact: true });
  await options.waitFor();
  const dropdown = await bounds(options);
  check(`${name} Kind Mantine popup`, dropdown, dropdown.width > 0 && dropdown.x >= -1 && dropdown.right <= width + 1);
  await kind.press('ArrowDown');
  await kind.press('ArrowDown');
  const highlighted = page.locator('[role="option"][data-combobox-selected]');
  const highlightColor = await highlighted.evaluate(node => {
    const probe = document.createElement('span'); document.body.append(probe);
    probe.style.color = 'var(--ui-selection-fill)'; const fill = getComputedStyle(probe).color;
    probe.style.color = 'var(--ui-selection-ink)'; const ink = getComputedStyle(probe).color; probe.remove();
    return { background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, fill, ink, checked: node.hasAttribute('data-checked') };
  });
  check(`${name} keyboard-highlighted option palette`, highlightColor,
    !highlightColor.checked && highlightColor.background === highlightColor.fill && highlightColor.color === highlightColor.ink);
  await screenshot(page, `${name}-kind-select`);
  await page.getByRole('option', { name: 'Question', exact: true }).click();
  assert.equal(await kind.inputValue(), 'Question');
  const composer = page.getByRole('textbox', { name: 'Message this Window', exact: true });
  await composer.fill('Public fixture draft; no message is sent.');
  await composer.focus();
  const focus = await page.locator('.window-collaboration-compose-box').evaluate(box => {
    const textarea = box.querySelector('textarea'), outer = getComputedStyle(box), inner = getComputedStyle(textarea);
    return { outerRadius: outer.borderTopLeftRadius, outerOutline: outer.outlineStyle, outerWidth: outer.outlineWidth, innerOutline: inner.outlineStyle,
      focusWithin: box.matches(':focus-within'), value: textarea.value };
  });
  check(`${name} rounded composer focus`, focus, focus.focusWithin && parseFloat(focus.outerRadius) >= 8 && focus.outerOutline === 'solid'
    && parseFloat(focus.outerWidth) >= 2 && focus.innerOutline === 'none');
  await screenshot(page, `${name}-composer-focus`);
  await midpoint(page, navigation, 'button:not([aria-current])', `${name}-navigation`);
  await inspectSelection(page, navigation, 'filled', `${name} moved main navigation`);
  if (width === 390) await stationaryVisuals(page, navigation, `${name} moved main navigation`);
  await noOverflow(page, name);
  await page.close();
}
async function admin(context, width, theme, mode) {
  const page = await context.newPage(), name = `admin-${width}-${theme}-${mode}`;
  page.on('pageerror', error => report.errors.push({ name, error: error.message }));
  await page.goto(`${fixture.url}/admin/`);
  await page.getByLabel('Admin token', { exact: true }).fill('fixture-only-not-a-secret');
  await page.getByRole('button', { name: 'Unlock console', exact: true }).click();
  await page.getByRole('heading', { name: 'Operations', exact: true }).waitFor();
  await page.waitForFunction(({theme,mode}) => document.documentElement.dataset.resolvedTheme === theme && document.documentElement.dataset.selectionColor === mode, {theme,mode});
  await preference(page, mode, name);
  const initial = { rail: await bounds(page.locator('.admin-rail')), main: await bounds(page.locator('.admin-workspace')), toolbar: await bounds(page.locator('.workspace-toolbar')) };
  const gutter = width === 390 ? initial.toolbar.x : initial.main.x - initial.rail.right;
  const rightGutter = width - (width === 390 ? initial.toolbar.right : initial.main.right);
  check(`${name} fills available width`, { ...initial, gutter, rightGutter }, gutter >= 0 && gutter <= 24 && rightGutter >= 0 && rightGutter <= 24
    && initial.toolbar.x >= initial.main.x && initial.toolbar.right <= initial.main.right + 1
    && (width !== 390 || initial.toolbar.y >= initial.rail.bottom));
  await inspectSelection(page, '.section-nav', 'filled', name);
  await screenshot(page, `${name}-top`);
  // More public fixture rows make every anchor reachable without changing production CSS/layout.
  await page.route('**/api/admin/dashboard', async route => {
    const response = await route.fetch(), data = await response.json();
    data.devices = Array.from({ length: 18 }, (_, index) => ({ ...data.devices[0], display_name: `Public fixture Runner ${index + 1}`, client_id: `fixture-runner-${index + 1}` }));
    await route.fulfill({ json: data });
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Public fixture Runner 18', { exact: true }).waitFor();
  const scrollStart = { y: await page.evaluate(() => scrollY), toolbar: await bounds(page.locator('.workspace-toolbar')), rail: await bounds(page.locator('.admin-rail')) };
  await page.evaluate(() => scrollTo(0, 360)); await frames(page, 4);
  const scrolled = { y: await page.evaluate(() => scrollY), toolbar: await bounds(page.locator('.workspace-toolbar')), rail: await bounds(page.locator('.admin-rail')) };
  const delta = scrolled.y - scrollStart.y;
  check(`${name} toolbar scrolls and rail stays`, { scrollStart, scrolled, delta }, delta > 100
    && near(scrollStart.toolbar.y - scrolled.toolbar.y, delta) && near(scrollStart.rail.y, scrolled.rail.y));
  await page.locator('.section-nav a[href="#devices-section"]').click();
  await page.waitForFunction(() => document.querySelector('.section-nav a[aria-current]')?.getAttribute('href') === '#devices-section');
  // Smooth anchor scrolling is allowed to finish before checking its landing geometry.
  await page.waitForFunction(width => {
    const top = document.getElementById('devices-section').getBoundingClientRect().top;
    return Math.abs(top - (width <= 700 ? 80 : 24)) < 2;
  }, width);
  const anchor = { section: await bounds(page.locator('#devices-section')), rail: await bounds(page.locator('.admin-rail')), toolbar: await bounds(page.locator('.workspace-toolbar')) };
  check(`${name} Runner anchor unobscured`, anchor, anchor.section.y >= (width === 390 ? anchor.rail.bottom : 0) && anchor.toolbar.bottom < anchor.section.y);
  await inspectSelection(page, '.section-nav', 'filled', `${name} anchor navigation`);
  await screenshot(page, `${name}-scrolled-anchor`);
  await noOverflow(page, name);
  await page.close();
}
try {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const mode of ['accent', 'monochrome']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: 'no-preference' });
    context.setDefaultTimeout(10_000);
    await context.addInitScript(({theme,mode}) => {
      if (!localStorage.getItem('webcodex.runtime.appearance.v1')) localStorage.setItem('webcodex.runtime.appearance.v1', theme);
      if (!localStorage.getItem('webcodex.admin.appearance.v1')) localStorage.setItem('webcodex.admin.appearance.v1', theme);
      if (!localStorage.getItem('webcodex.ui.selection.v1')) localStorage.setItem('webcodex.ui.selection.v1', mode);
    }, {theme,mode});
    try { await runtime(context, width, theme, mode); await admin(context, width, theme, mode); }
    finally { await context.close(); }
  }
  assert.deepEqual(report.errors, [], 'No browser page errors');
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; process.exitCode = 1;
} finally {
  await browser.close(); await new Promise(resolve => fixture.server.close(resolve));
  fs.writeFileSync(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, errors: report.errors, failure: report.failure, output: output.pathname }));
}
