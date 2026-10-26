'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Filenames use an explicit timezone, independent of the Server's UTC setting.
function screenshotTimestamp(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits:3, hourCycle:'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}-${parts.fractionalSecond}`;
}

function reserveScreenshot(root, hint, { now = new Date(), uuid = randomUUID } = {}) {
  const requested = hint ? path.resolve(root, hint) : path.join(root, 'artifacts', 'managed-browser', 'screenshot.png');
  if (!isInside(root, requested)) throw new Error('截图路径必须在配置的项目目录内');
  let existing = path.dirname(requested);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (!isInside(root, fs.realpathSync(existing)) || (fs.existsSync(requested) && !isInside(root, fs.realpathSync(requested)))) {
    throw new Error('截图目标不能指向项目外');
  }
  const extension = path.extname(requested);
  const suffix = extension.toLowerCase() || '.png';
  const stem = path.basename(requested, extension);
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(suffix) || Buffer.byteLength(stem) > 100) {
    throw new Error('截图文件名过长或图片扩展名不受支持');
  }
  const timestamp = screenshotTimestamp(now);
  fs.mkdirSync(path.dirname(requested), { recursive:true });
  const parent = fs.realpathSync(path.dirname(requested));
  if (!isInside(root, parent)) throw new Error('截图目录不能指向项目外');
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = uuid();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('截图随机标识无效');
    const filename = path.join(parent, `${stem}-${timestamp}-${id}${suffix}`);
    let fd;
    try { fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      const stat = fs.fstatSync(fd);
      return { filename, dev:stat.dev, ino:stat.ino };
    } finally { fs.closeSync(fd); }
  }
  throw new Error('无法分配唯一截图文件；未执行截图');
}

// A known completed failure may remove only its own still-empty reservation.
// An uncertain upstream effect never triggers screenshot or page-operation retries.
function removeEmptyReservation(reservation) {
  try {
    const stat = fs.lstatSync(reservation.filename);
    if (stat.isFile() && stat.dev === reservation.dev && stat.ino === reservation.ino && stat.size === 0) fs.unlinkSync(reservation.filename);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function readScreenshot(root, result, filename) {
  if (result.isError) return result;
  const target = fs.realpathSync(filename);
  if (!isInside(root, target)) throw new Error('截图目标不在配置的项目目录内');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('截图目标不是普通文件');
    // Upstream ResourceLinks have no downstream resources/read route. Preserve
    // original text and always report the actual saved path, including oversize files.
    const content = result.content.filter(block => block.type !== 'image' && block.type !== 'resource_link');
    const MAX_IMAGE = 4 * 1024 * 1024;
    const location = { screenshot_project_path:path.relative(root, target).split(path.sep).join('/') };
    location.user_preview = 'present_image';
    content.push({ type:'text', text:JSON.stringify(location) });
    if (stat.size > MAX_IMAGE) {
      content.push({ type:'text', text:'截图已保存，原图超过原生 MCP 图片 4 MiB 限制；已返回实际项目路径，请调用 present_image 查看，以该工具返回的能力为准，原图保持不变。' });
      return { ...result, content };
    }
    const data = fs.readFileSync(fd);
    if (data.length > MAX_IMAGE) throw new Error('截图大小发生变化');
    const mime = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'image/jpeg'
      : data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null;
    if (!mime) throw new Error('截图不是支持的图片');
    content.push({ type:'image', mimeType:mime, data:data.toString('base64') });
    return { ...result, content };
  } finally { fs.closeSync(fd); }
}

module.exports = { reserveScreenshot, removeEmptyReservation, readScreenshot };
