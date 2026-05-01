function parseDurationInput(input, defaultMs = 10 * 60 * 1000) {
  const raw = String(input || '').trim();
  if (!raw) {
    return {
      ok: true,
      ms: defaultMs,
      normalized: '10min',
      usedDefault: true,
    };
  }

  const match = raw.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!match) {
    return {
      ok: false,
      error: '格式无效，请使用例如 30s、60s、120min、5d',
    };
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      error: '时间必须是大于 0 的数字',
    };
  }

  let multiplier = 1000;
  let normalizedUnit = 's';

  if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
    multiplier = 1000;
    normalizedUnit = 's';
  } else if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
    multiplier = 60 * 1000;
    normalizedUnit = 'min';
  } else if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
    multiplier = 60 * 60 * 1000;
    normalizedUnit = 'h';
  } else if (unit === 'd' || unit === 'day' || unit === 'days') {
    multiplier = 24 * 60 * 60 * 1000;
    normalizedUnit = 'd';
  }

  const ms = value * multiplier;

  return {
    ok: true,
    ms,
    normalized: `${value}${normalizedUnit}`,
    usedDefault: false,
  };
}

module.exports = {
  parseDurationInput,
};
