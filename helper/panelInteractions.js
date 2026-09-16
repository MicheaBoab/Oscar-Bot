// Independent of slash registration: retiring a command must not disable its panel.
async function routePanelInteraction(interaction) {
  const id = interaction.customId || '';
  if (id.startsWith('ann:')) {
    try { await require('./announcementPanel').handle(interaction); }
    catch (error) {
      console.error('[announcement panel]', error);
      const payload = { content: `❌ ${error.message}`, allowedMentions: { parse: [] } };
      if (interaction.deferred) await interaction.editReply(payload);
      else if (interaction.replied) await interaction.followUp({ ...payload, flags: 64 });
      else await interaction.reply({ ...payload, flags: 64 });
    }
    return true;
  }
  if (id.startsWith('mp:')) {
    try { await require('./marketPanel').handle(interaction); }
    catch (error) {
      console.error('[market panel]', error);
      const content = '❌ Market 操作失败，请重新打开面板后重试。';
      if (interaction.deferred) await interaction.editReply({ content });
      else if (interaction.replied) await interaction.followUp({ content, flags: 64 });
      else await interaction.reply({ content, flags: 64 });
    }
    return true;
  }
  if (/^(pp|poll_vote|poll_select|poll_end):/.test(id)) {
    try { await require('./pollPanel').handle(interaction); }
    catch (error) {
      console.error('[poll panel]', error);
      const content = '❌ 投票操作未完成，请稍后重试；结束中的投票会自动重试公布结果。';
      // Voting uses deferUpdate: do not overwrite the public poll with a private error.
      if (interaction.isStringSelectMenu() && interaction.deferred) await interaction.followUp({ content, flags: 64 });
      else if (interaction.deferred) await interaction.editReply({ content });
      else if (interaction.replied) await interaction.followUp({ content, flags: 64 });
      else await interaction.reply({ content, flags: 64 });
    }
    return true;
  }
  if (id.startsWith('ap:')) {
    try { await require('./attendancePanel').handle(interaction); }
    catch (error) {
      console.error('[attendance panel]', error);
      const content = '❌ 报名面板操作失败，请重新打开面板。';
      if (interaction.deferred) await interaction.editReply({ content });
      else if (interaction.replied) await interaction.followUp({ content, flags: 64 });
      else await interaction.reply({ content, flags: 64 });
    }
    return true;
  }
  let handler;
  if (interaction.isButton() && (id.startsWith('control_module:') || id.startsWith('control_page:') || id === 'control_reminder_setup')) {
    handler = 'handleButton';
  } else if (interaction.isChannelSelectMenu() && id.startsWith('control_reminder_channel:')) {
    handler = 'handleChannelSelect';
  } else return false;
  try { await require('../commands/control')[handler](interaction); }
  catch (error) {
    console.error('[panel] 操作失败:', error);
    const payload = { content: '❌ 面板操作失败，请重新打开面板后重试。', flags: 64 };
    if (interaction.deferred) await interaction.editReply({ content: payload.content });
    else if (interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
  return true;
}
module.exports = { routePanelInteraction };
