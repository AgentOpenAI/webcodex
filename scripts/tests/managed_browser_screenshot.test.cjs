'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reserveScreenshot, removeEmptyReservation, readScreenshot } = require('../managed_browser_screenshot.cjs');
const now = new Date('2026-10-26T06:46:52.123Z');
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webcodex-screenshot-test-'));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const root = path.join(directory, 'project'); fs.mkdirSync(root);
  return { root, directory };
}

test('same-millisecond screenshots keep distinct files and the previous image', t => {
  const {root} = fixture(t);
  const first = reserveScreenshot(root, undefined, {now});
  fs.writeFileSync(first.filename, 'first screenshot');
  const second = reserveScreenshot(root, undefined, {now});
  fs.writeFileSync(second.filename, 'second screenshot');
  assert.notEqual(first.filename, second.filename);
  assert.equal(path.dirname(first.filename), path.join(root, 'artifacts', 'managed-browser'));
  assert.match(path.basename(first.filename), /^screenshot-2026-10-26_14-46-52-123-[0-9a-f-]{36}\.png$/);
  assert.equal(fs.readFileSync(first.filename, 'utf8'), 'first screenshot');
  assert.equal(fs.statSync(second.filename).mode & 0o777, 0o600);
});

test('an explicit repeated filename is a hint and never overwrites the existing file', t => {
  const {root} = fixture(t);
  const hint = path.join(root, 'custom', 'latest.png');
  fs.mkdirSync(path.dirname(hint)); fs.writeFileSync(hint, 'existing user image');
  const first = reserveScreenshot(root, hint, {now});
  const second = reserveScreenshot(root, hint, {now});
  assert.equal(path.dirname(first.filename), path.dirname(hint));
  assert.match(path.basename(first.filename), /^latest-2026-10-26_14-46-52-123-/);
  assert.notEqual(first.filename, second.filename);
  assert.equal(fs.readFileSync(hint, 'utf8'), 'existing user image');
});

test('an actual timestamp/UUID collision reallocates without truncating the old screenshot', t => {
  const {root} = fixture(t);
  const first = reserveScreenshot(root, undefined, {now, uuid:()=>firstId});
  fs.writeFileSync(first.filename, 'retain on collision');
  const ids = [firstId, secondId];
  const second = reserveScreenshot(root, undefined, {now, uuid:()=>ids.shift()});
  assert(second.filename.includes(secondId));
  assert.equal(fs.readFileSync(first.filename, 'utf8'), 'retain on collision');
  assert.throws(() => reserveScreenshot(root, undefined, {now, uuid:()=>firstId}), /无法分配唯一截图/);
});

test('outside paths and escaping symlink directories are rejected', t => {
  const {root, directory} = fixture(t);
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside);
  assert.throws(() => reserveScreenshot(root, path.join(outside, 'image.png')), /项目目录内/);
  fs.symlinkSync(outside, path.join(root, 'escape'));
  assert.throws(() => reserveScreenshot(root, 'escape/image.png'), /项目外/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('failed captures may clean only their own empty reservation', t => {
  const {root} = fixture(t);
  const empty = reserveScreenshot(root); removeEmptyReservation(empty);
  assert.equal(fs.existsSync(empty.filename), false);
  const complete = reserveScreenshot(root); fs.writeFileSync(complete.filename, 'keep');
  removeEmptyReservation(complete); assert.equal(fs.readFileSync(complete.filename, 'utf8'), 'keep');
  const replaced = reserveScreenshot(root);
  fs.renameSync(replaced.filename, replaced.filename + '.original');
  fs.writeFileSync(replaced.filename, '');
  removeEmptyReservation(replaced); assert.equal(fs.existsSync(replaced.filename), true);
});

test('an oversized saved screenshot still reports its actual path without unusable links or model bytes', t => {
  const {root} = fixture(t);
  const saved = reserveScreenshot(root);
  fs.truncateSync(saved.filename, 4 * 1024 * 1024 + 1);
  const delivered = readScreenshot(root, {content:[{type:'text',text:'capture complete'},{type:'resource_link',uri:'file:///unroutable'},{type:'image',data:'upstream bytes',mimeType:'image/png'}]}, saved.filename);
  assert.equal(delivered.content[0].text, 'capture complete');
  assert.equal(delivered.content.some(block => block.type === 'image' || block.type === 'resource_link'), false);
  const location = delivered.content.filter(block => block.type === 'text').map(block => {
    try { return JSON.parse(block.text); } catch { return null; }
  }).find(value => value?.screenshot_project_path);
  assert.equal(path.resolve(root, location.screenshot_project_path), saved.filename);
  assert.equal(location.user_preview, 'present_image', 'Large screenshots use the automatically compressed preview');
  assert(delivered.content.some(block => block.text?.includes('请调用 present_image 查看')));
  assert.equal(fs.statSync(saved.filename).size, 4 * 1024 * 1024 + 1);
});

test('a small screenshot delivers its original bytes and saved path', t => {
  const {root} = fixture(t);
  const saved = reserveScreenshot(root);
  const bytes = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  fs.writeFileSync(saved.filename, bytes);
  const delivered = readScreenshot(root, {content:[{type:'resource_link',uri:'file:///unroutable'}]}, saved.filename);
  const image = delivered.content.find(block => block.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(image.data, 'base64'), bytes);
  assert.equal(path.resolve(root, JSON.parse(delivered.content.find(block => block.type === 'text').text).screenshot_project_path), saved.filename);
  assert.equal(delivered.content.some(block => block.type === 'resource_link'), false);
});

test('image delivery rejects a link to a file outside the configured workspace', t => {
  const {root, directory} = fixture(t);
  const outside = path.join(directory, 'private.png'); fs.writeFileSync(outside, 'private');
  const linked = path.join(root, 'linked.png'); fs.symlinkSync(outside, linked);
  assert.throws(() => readScreenshot(root, {content:[]}, linked), /项目目录内/);
});
