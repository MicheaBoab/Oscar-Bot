const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const store = require('../storage/announcementStore');
const MAX_BYTES = 8 * 1024 * 1024;
function imageExtension(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (buffer.length >= 10 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'gif';
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('仅支持 PNG、JPEG、GIF、WebP 图片。');
}
async function fetchImage(url, declaredSize) {
  const address = new URL(url);
  if (!['http:', 'https:'].includes(address.protocol)) throw new Error('图片地址无效。');
  if (declaredSize > MAX_BYTES) throw new Error('图片不能超过 8 MiB。');
  const response = await fetch(address, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('图片下载失败。');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw new Error('图片不能超过 8 MiB。'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('图片不能超过 8 MiB。');
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks); imageExtension(buffer);
  return buffer;
}
function saveImage(alias, buffer, expected) {
  if (buffer.length > MAX_BYTES) throw new Error('图片不能超过 8 MiB。');
  const extension = imageExtension(buffer);
  const safe = store.aliasKey(alias).replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 50);
  const relative = `notice-images/notice_${safe}_${randomUUID()}.${extension}`;
  const file = store.imageFile(relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer, { flag: 'wx' });
  try { store.changeImage(alias, relative, expected); }
  catch (error) { fs.unlinkSync(file); throw error; }
  return relative;
}
module.exports = { MAX_BYTES, imageExtension, fetchImage, saveImage };
