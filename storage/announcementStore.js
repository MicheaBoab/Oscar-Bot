const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
function aliasKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key || key.length > 80 || FORBIDDEN.has(key)) throw new Error('别名须为 1–80 字符，且不能使用保留名称。');
  return key;
}
function createStore(root = __dirname) {
  function read(name, field) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))[field] || {};
    return Object.fromEntries(Object.entries(data).filter(([key]) => key && !FORBIDDEN.has(key)));
  }
  function write(name, field, value) {
    const file = path.join(root, name), temporary = `${file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify({ [field]: value }, null, 2)); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function notices() {
    return Object.fromEntries(Object.entries(read('noticeTexts.json', 'notices')).map(([key, value]) =>
      [key, typeof value === 'string' ? { text: value, imagePath: null } : value]));
  }
  const aliases = () => read('roleAliases.json', 'aliases');
  function imageFile(relative) {
    if (!relative) return null;
    const target = path.resolve(root, relative);
    const allowed = ['images', 'notice-images'].some(dir => target.startsWith(path.resolve(root, dir) + path.sep));
    if (!allowed) throw new Error('模板图片路径无效。');
    return target;
  }
  function cleanup(relative) {
    try {
      if (!relative || Object.values(notices()).some(notice => notice.imagePath === relative)) return;
      fs.unlinkSync(imageFile(relative));
    } catch (error) { if (error.code !== 'ENOENT') console.error('[notice image cleanup]', error.message); }
  }
  function putNotice(rawKey, text, { create = false, expected } = {}) {
    const key = aliasKey(rawKey), data = notices(), old = data[key];
    if (create ? Boolean(old) : !old) throw new Error(create ? '模板别名已存在。' : '模板不存在。');
    if (expected !== undefined && JSON.stringify(old) !== expected) throw new Error('模板已被其他操作修改，请重新打开。');
    if (!String(text).trim() || text.length > 4000) throw new Error('公告内容须为 1–4000 字符。');
    data[key] = { ...old, text, imagePath: old?.imagePath || null, revision: randomUUID() };
    write('noticeTexts.json', 'notices', data);
    return data[key];
  }
  function changeImage(rawKey, relative, expected) {
    const key = aliasKey(rawKey), data = notices(), old = data[key];
    if (!old || (expected !== undefined && JSON.stringify(old) !== expected)) throw new Error('模板已更改或删除，请重新操作。');
    if (relative) imageFile(relative);
    data[key] = { ...old, imagePath: relative, revision: randomUUID() };
    write('noticeTexts.json', 'notices', data); cleanup(old.imagePath);
    return data[key];
  }
  function removeNotice(rawKey, expected) {
    const key = aliasKey(rawKey), data = notices(), old = data[key];
    if (!old || (expected !== undefined && JSON.stringify(old) !== expected)) throw new Error('模板已更改或删除，请重新操作。');
    delete data[key]; write('noticeTexts.json', 'notices', data); cleanup(old.imagePath);
  }
  function putAlias(rawKey, roleIds) {
    const key = aliasKey(rawKey), data = aliases();
    const roles = [...new Set(roleIds.map(String))];
    if (!roles.length || roles.length > 5) throw new Error('请选择 1–5 个身分组。');
    data[key] = roles; write('roleAliases.json', 'aliases', data);
  }
  function removeAlias(rawKey, expected) {
    const key = aliasKey(rawKey), data = aliases();
    if (!data[key] || (expected !== undefined && JSON.stringify(data[key]) !== expected)) throw new Error('别名已更改或删除。');
    delete data[key]; write('roleAliases.json', 'aliases', data);
  }
  return { root, notices, aliases, imageFile, putNotice, changeImage, removeNotice, putAlias, removeAlias };
}
module.exports = { ...createStore(), createStore, aliasKey };
