const { randomUUID } = require('crypto');
const sessions = new Map();
const TTL = 15 * 60 * 1000;
function createSession(interaction, data) {
  for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(id);
  const id = randomUUID();
  sessions.set(id, { ...data, owner: interaction.user.id, guildId: interaction.guildId, expiresAt: Date.now() + TTL });
  return id;
}
function getSession(id, interaction) {
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(id); return null; }
  return session.owner === interaction.user.id && session.guildId === interaction.guildId ? session : null;
}
function deleteSession(id) { sessions.delete(id); }
module.exports = { createSession, getSession, deleteSession };
