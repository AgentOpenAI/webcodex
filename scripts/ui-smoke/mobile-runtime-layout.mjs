import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startFixtureServer } from './server.mjs';
import { key, now, windowActivity } from './fixtures.mjs';

// Real production bundles with public read-only fixture data, never a live Runtime.
const output = new URL('../../artifacts/mobile-runtime-layout/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const report = { checks: [], screenshots: [], errors: [], fixture: true, nativeHost: false };
const check = (name, data, passed) => { report.checks.push({ name, data, passed }); assert(passed, `${name}: ${JSON.stringify(data)}`); };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function capture(page, name) {
  await page.waitForFunction(() => document.getAnimations().filter(a => a.effect?.target?.matches('[data-selection-motion-overlay]')).every(a => a.playState !== 'running' && !a.pending));
  await page.screenshot({ path: new URL(name + '.png', output).pathname });
  report.screenshots.push(name + '.png');
}
async function wholePageScroll(page, name) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('.app-content'), view = main.querySelector(':scope > .page');
    const wrappers = [...view.querySelectorAll('.project-browser-list,.agents-sidebar,.agent-list,.agents-main')];
    const properties = n => ({ className: n.className, overflow: getComputedStyle(n).overflowY,
      gutter: getComputedStyle(n).scrollbarGutter, top: n.scrollTop, height: n.clientHeight, scrollHeight: n.scrollHeight });
    return { main: properties(main), view: properties(view), wrappers: wrappers.map(properties),
      scrollbarWidth: main.offsetWidth - main.clientWidth, horizontalOverflow: main.scrollWidth > main.clientWidth + 1 };
  });
  check(name + ' one whole-page scroll owner', geometry, geometry.main.overflow === 'auto'
    && geometry.main.scrollHeight > geometry.main.height && geometry.view.overflow === 'visible'
    && geometry.view.gutter === 'auto' && geometry.view.top === 0
    && geometry.wrappers.every(n => n.overflow === 'visible' && n.top === 0)
    && geometry.scrollbarWidth <= 12 && !geometry.horizontalOverflow);
  await page.locator('.app-content').evaluate(n => { n.scrollTop = 0; });
  await page.mouse.move(100, 180);
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(() => document.querySelector('.app-content').scrollTop > 0);
  check(name + ' wheel scrolls only the page owner', {}, await page.evaluate(() =>
    document.querySelector('.app-content').scrollTop > 0 && document.querySelector('.app-content > .page').scrollTop === 0 && scrollY === 0));
}
async function separation(page, name) {
  const geometry = await page.evaluate(() => {
    const box = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, height: b.height }; };
    const main = document.querySelector('.app-content'), dock = document.querySelector('.mobile-navigation-dock');
    const nav = document.querySelector('.mobile-primary-nav'), bar = document.querySelector('.mobile-app-bar');
    return { main: box(main), dock: dock && box(dock), nav: box(nav), bar: box(bar), height: innerHeight,
      pageScroll: scrollY, pageHeight: document.documentElement.scrollHeight,
      padding: parseFloat(getComputedStyle(main).paddingLeft), contentRight: main.getBoundingClientRect().x + main.clientWidth,
      divider: dock && getComputedStyle(dock).borderTopWidth,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(name + ' separate viewport rows and aligned insets', geometry, geometry.dock && geometry.main.y >= geometry.bar.bottom - 1
    && Math.abs(geometry.main.bottom - geometry.dock.y) < 1 && geometry.nav.y >= geometry.dock.y + 1
    && Math.abs(geometry.nav.x - geometry.main.x - geometry.padding) < 1
    && Math.abs(geometry.nav.right - geometry.contentRight + geometry.padding) < 1
    && geometry.dock.bottom <= geometry.height + 1 && parseFloat(geometry.divider) >= 1
    && geometry.pageScroll === 0 && geometry.pageHeight <= geometry.height + 1 && !geometry.overflow);
}
async function reachable(page, locator, name) {
  const result = await locator.evaluate(node => {
    const b = node.getBoundingClientRect(), main = document.querySelector('.app-content').getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { x: b.x, right: b.right, top: b.top, bottom: b.bottom, mainTop: main.top, mainBottom: main.bottom,
      hitElement: hit?.outerHTML.slice(0, 180), hit: hit && (node === hit || node.contains(hit)) };
  });
  check(name, result, result.top >= result.mainTop - 1 && result.bottom <= result.mainBottom + 1 && result.hit);
}
try {
  for (const [width, height] of [[625, 825], [390, 844], [320, 568], [700, 600]]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(), name = `${width}-${height}-${theme}`;
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.errors.push(error.message));
    await context.addInitScript(theme => localStorage.setItem('webcodex.runtime.appearance.v1', theme), theme);
    await page.route('**/api/runtime-console/window-collaboration', route => route.fulfill({ json: { available: true, can_send: true, messages: [], truncated: false } }));
    await page.route('**/api/runtime-console/communication/agents', route => route.fulfill({ json: {
      agents: Array.from({ length: 16 }, (_, i) => ({ agent_id: `public-layout-agent-${i}`, handle: `layout-${i}`,
        display_name: `Public layout Agent ${i + 1}`, profile_revision: 1, queued_delivery_count: 0 })), returned: 16, total: 16,
    } }));
    await page.route('**/api/runtime-console/window', async route => {
      const response = await route.fetch(), detail = await response.json();
      detail.active_requests = []; detail.active_count = 0; detail.linked_sessions = []; detail.sessions_returned = 0;
      detail.activity = Array.from({ length: 40 }, (_, i) => ({ ...windowActivity, tool_name: `fixture_activity_${i + 1}`,
        server_trace_id: `public-mobile-trace-${i}`, started_at_ms: now - (i + 1) * 1000 }));
      detail.activity_returned = detail.activity.length;
      await route.fulfill({ json: detail });
    });
    await page.goto(fixture.url + '/runtime/');
    const summary = page.locator('.window-header-details > summary');
    await summary.waitFor();
    check(name + ' readable collapsed Window details', { summary: await summary.textContent() }, (await summary.textContent()) === 'Window details');
    await separation(page, name + ' initial');
    // Scroll both owning containers to their actual end, without centering the target.
    await page.locator('.app-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.locator('.window-activity-results').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await frames(page);
    await separation(page, name + ' activity end');
    await reachable(page, page.locator('.window-call-card').last().getByRole('button', { name: 'Inspect call diagnostics' }), name + ' final activity action visible and hit-testable');
    await capture(page, name + '-activity-end');
    await summary.click();
    const identity = page.getByTestId('current-window-identity');
    check(name + ' expanded exact Window identity', { value: await identity.locator('code').textContent() }, await identity.locator('code').textContent() === key);
    await identity.getByRole('button', { name: 'Copy Window ID' }).click();
    check(name + ' exact Window copy', {}, await page.evaluate(() => navigator.clipboard.readText()) === key);
    await capture(page, name + '-window-details');
    await summary.click();
    await page.getByRole('tab', { name: 'Collaboration', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message this Window', exact: true }).fill('Public fixture draft; no message is sent.');
    await page.locator('.app-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.locator('.window-collaboration-composer').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await frames(page);
    await separation(page, name + ' collaboration end');
    await capture(page, name + '-collaboration-end');
    await reachable(page, page.locator('.window-collaboration-compose-footer button'), name + ' composer action visible and hit-testable');
    for (const view of ['Projects', 'Runtime', 'Work']) {
      await page.locator('.mobile-primary-nav').getByRole('button', { name: view, exact: true }).click();
      await frames(page);
      await separation(page, name + ' ' + view);
      if (view === 'Projects') {
        await page.locator('.project-session-row').first().waitFor();
        await wholePageScroll(page, name + ' Projects');
        await page.locator('.app-content').evaluate(n => { n.scrollTop = n.scrollHeight; }); await frames(page);
        await reachable(page, page.locator('.project-session-row').last(), name + ' final Project Session reachable');
        await capture(page, name + '-projects-end');
      }
      if (view === 'Runtime') {
        await page.locator('.runtime-metrics').waitFor();
        await wholePageScroll(page, name + ' Runtime Overview');
        await page.locator('.app-content').evaluate(n => { n.scrollTop = 0; }); await frames(page);
        await capture(page, name + '-overview-top');
        await page.locator('.app-content').evaluate(n => { n.scrollTop = n.scrollHeight; }); await frames(page);
        const diagnostics = page.locator('.runtime-diagnostics > summary');
        await reachable(page, diagnostics, name + ' final Overview disclosure reachable');
        await diagnostics.click();
        await page.locator('.app-content').evaluate(n => { n.scrollTop = n.scrollHeight; }); await frames(page);
        await reachable(page, page.locator('.runtime-diagnostic-row code').last(), name + ' expanded final revision reachable');
        await capture(page, name + '-overview-end');
        await page.getByRole('tab', { name: 'Agents', exact: true }).click();
        await page.locator('.agent-row').last().waitFor();
        await page.locator('.agent-create-disclosure > summary').click();
        await page.locator('.agent-create-disclosure button').scrollIntoViewIfNeeded(); await frames(page);
        await reachable(page, page.locator('.agent-create-disclosure button'), name + ' Agent create action reachable');
        await page.getByRole('tab', { name: 'Profile', exact: true }).click();
        await wholePageScroll(page, name + ' Agents');
        await page.locator('.edit-agent-card button').scrollIntoViewIfNeeded(); await frames(page);
        await reachable(page, page.locator('.edit-agent-card button'), name + ' Agent profile action reachable');
        await capture(page, name + '-agent-profile');
      }
    }
    const footer = await page.locator('.mobile-navigation-dock').evaluate(dock => {
      const nav = dock.querySelector('nav'), bar = document.querySelector('.mobile-app-bar');
      return { background: getComputedStyle(dock).backgroundColor, barBackground: getComputedStyle(bar).backgroundColor,
        overflow: getComputedStyle(dock).overflowY, padding: parseFloat(getComputedStyle(dock).paddingTop),
        navBackground: getComputedStyle(nav).backgroundColor, shadow: getComputedStyle(nav).boxShadow, border: getComputedStyle(nav).borderTopWidth };
    });
    check(name + ' flat footer surface without heavy frame', footer, footer.background === footer.barBackground
      && footer.overflow === 'hidden' && footer.padding <= 4 && footer.navBackground === 'rgba(0, 0, 0, 0)' && footer.shadow === 'none' && parseFloat(footer.border) === 0);
    // A viewport shrink (including keyboard-sized height) must move the dock with it.
    await page.setViewportSize({ width, height: 400 }); await frames(page);
    await separation(page, name + ' short viewport');
    await page.setViewportSize({ width: 1440, height: 900 }); await frames(page);
    check(name + ' desktop dock hidden after resize', {}, !await page.locator('.mobile-navigation-dock').isVisible() && await page.locator('.app-nav').isVisible());
    await page.locator('.app-nav > nav').getByTitle('Runtime', { exact: true }).click();
    await page.locator('.runtime-metrics').waitFor();
    check(name + ' desktop keeps its page scroll owner', {}, await page.evaluate(() =>
      getComputedStyle(document.querySelector('.runtime-page')).overflowY === 'auto'
      && getComputedStyle(document.querySelector('.app-content')).overflowY === 'hidden'));
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; process.exitCode = 1; }
finally {
  await browser.close(); await new Promise(resolve => fixture.server.close(resolve));
  fs.writeFileSync(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, errors: report.errors, failure: report.failure }));
}
