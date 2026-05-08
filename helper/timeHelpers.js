/**
 * 根据给定的时刻模板，计算下一个相同 UTC 时刻的 unix 时间戳
 * 例：如果 unix 表示"每天 14:00 UTC"，则返回下一个 14:00 的 unix 时间戳
 *
 * @param {number} unix - 模板时间戳（只用来提取 UTC 时、分、秒）
 * @param {number} nowMs - 当前时间（毫秒）
 * @returns {number} 下一个相同 UTC 时刻的 unix 时间戳（秒）
 */
function toNextSameUtcTime(unix, nowMs) {
  const src = new Date(unix * 1000);
  const now = new Date(nowMs);

  let candidateMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    src.getUTCHours(),
    src.getUTCMinutes(),
    src.getUTCSeconds(),
    0
  );

  if (candidateMs <= nowMs) {
    candidateMs += 24 * 60 * 60 * 1000;
  }

  return Math.floor(candidateMs / 1000);
}

// Discord 时间戳正则表达式
const DISCORD_TS_REGEX = /<t:(\d{1,12})(?::([tTdDfFR]))?>/g;

/**
 * 将文本中的 Discord 时间戳替换为计算后的值
 * @param {string} text - 包含时间戳的文本
 * @param {number} nowMs - 当前时间（毫秒），默认为当前时间
 * @param {number} offsetSeconds - 时间偏移（秒），默认为 0（无偏移）
 * @returns {string} 处理后的文本
 */
function renderRecurringDiscordTimestamps(text, nowMs = Date.now(), offsetSeconds = 0) {
  const source = String(text || '');
  return source.replace(DISCORD_TS_REGEX, (_, unixRaw, fmtRaw) => {
    const unix = Number(unixRaw);
    if (!Number.isFinite(unix)) return _;

    const nextUnix = Math.max(1, toNextSameUtcTime(unix, nowMs) + offsetSeconds);
    const suffix = fmtRaw ? `:${fmtRaw}` : '';
    return `<t:${nextUnix}${suffix}>`;
  });
}

module.exports = {
  toNextSameUtcTime,
  renderRecurringDiscordTimestamps,
};
