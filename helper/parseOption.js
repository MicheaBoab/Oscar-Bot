function parseOption(raw) {
  raw = raw.trim();

  // 匹配 <@123>, <@!123>, 123
  const userMatch = raw.match(/^<@!?(\d+)>$|^(\d{17,20})$/);

  if (userMatch) {
    return {
      type: 'user',
      value: userMatch[1] || userMatch[2],
    };
  }

  // 否则当普通文本
  return {
    type: 'text',
    value: raw,
  };
}
module.exports = {
    parseOption,
};