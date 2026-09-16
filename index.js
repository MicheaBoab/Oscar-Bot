const { Client, GatewayIntentBits, Events, Collection, Partials } = require('discord.js');

require("dotenv").config();
const { listPolls } = require('./storage/pollFileStore');
const { initializeCodexAutoUpdate } = require('./storage/codexItemStore');
const { startLiveQueueScheduler } = require('./helper/liveQueueScheduler');
const { startReminderScheduler } = require('./helper/reminderScheduler');
const { loadAllAttendances } = require('./storage/attendanceStore');

const pollTiles = listPolls();
console.log(`♻️ 恢复 ${pollTiles.length} 个投票`);
initializeCodexAutoUpdate();

async function syncAttendanceMessage(client, attendanceCommand, attendance) {
  if (!attendanceCommand || !attendance?.channelId || !attendance?.messageId) return;

  try {
    const channel = await client.channels.fetch(attendance.channelId);
    if (!channel || !channel.isTextBased()) return;

    let guild = null;
    if (attendance.guildId) {
      guild = await client.guilds.fetch(attendance.guildId).catch(() => null);
    }

    const message = await channel.messages.fetch(attendance.messageId);
    await message.edit({
      embeds: [attendanceCommand.buildAttendanceEmbed(attendance, { guild })],
      components: attendanceCommand.buildAttendanceComponents(attendance, guild),
    });
  } catch (error) {
    console.error('[attendance] 更新报名帖失败:', error.message);
  }
}

async function refreshActiveAttendanceMessages(client) {
  const attendanceCommand = require('./commands/attendance');
  if (!attendanceCommand) return;

  for (const { data: attendance } of loadAllAttendances()) {
    if (attendance.status !== 'active') continue;
    await syncAttendanceMessage(client, attendanceCommand, attendance);
  }
}

async function refreshControlPanels(client) {
  const controlCommand = require('./commands/control');
  if (!controlCommand || typeof controlCommand.refreshAllControlPanels !== 'function') return;

  try {
    await controlCommand.refreshAllControlPanels(client);
  } catch (error) {
    console.error('[control] 恢复中控台失败:', error.message);
  }
}

const { scanPolls } = require('./helper/pollService');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// 存放所有命令
client.commands = new Collection();

for (const command of require('./helper/slashCommands').loadCommands()) {
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  startLiveQueueScheduler(client);
  startReminderScheduler(client);
  refreshActiveAttendanceMessages(client);
  refreshControlPanels(client);
  scanPolls(client, { refreshActive: true }).catch(console.error);
  setInterval(
    () => scanPolls(client).catch(err => console.error('[poll] 定时检查失败:', err)),
    15 * 1000,
  );
});

client.on(Events.InteractionCreate, async interaction => {
  if (await require('./helper/panelInteractions').routePanelInteraction(interaction)) return;
  /* =========================
     Autocomplete
     ========================= */
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== 'function') return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error('[autocomplete error]', err);
    }
    return;
  }

  /* =========================
     Slash Command
     ========================= */ 
  if (interaction.isChatInputCommand()){
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: '❌ 执行命令时发生错误',
        flags: 64,
      });
    }
    return;
  }

  /* =========================
     Button（find 分页）
     ========================= */
  if (interaction.isButton()) {
    if (interaction.customId === 'attendance_specialization_change') {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceSpecializationChange === 'function') {
          await attendanceCommand.handleAttendanceSpecializationChange(interaction);
        }
      } catch (error) {
        console.error('[attendance] 打开职业路线选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 无法打开职业路线选择，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('attendance_specialization:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceSpecialization === 'function') {
          await attendanceCommand.handleAttendanceSpecialization(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理职业形态选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 职业形态选择失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (
      interaction.customId === 'attendance_join'
      || interaction.customId === 'attendance_next_time'
      || interaction.customId === 'attendance_cancel'
    ) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceButton === 'function') {
          await attendanceCommand.handleAttendanceButton(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理报名按钮失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 报名操作失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('attendance_close_confirm:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceCloseConfirm === 'function') {
          await attendanceCommand.handleAttendanceCloseConfirm(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理关闭报名确认失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 关闭报名失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId === 'attendance_close_cancel') {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceCloseCancel === 'function') {
          await attendanceCommand.handleAttendanceCloseCancel(interaction);
        }
      } catch (error) {
        console.error('[attendance] 取消关闭报名失败:', error);
      }
      return;
    }

    if (interaction.customId.startsWith('attendance_group_action:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleGroupPanelAction === 'function') {
          await attendanceCommand.handleGroupPanelAction(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理分队面板按钮失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 分队操作失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('reminder_board_')) {
      try {
        const reminderCommand = require('./commands/reminder');
        if (reminderCommand && typeof reminderCommand.handleButton === 'function') {
          await reminderCommand.handleButton(interaction);
        }
      } catch (error) {
        console.error('[reminder] 处理看板按钮失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ reminder 操作失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }


    return;
  }
 
  /* =========================
     Select Menu（投票逻辑）
     ========================= */
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('attendance_class:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceClassSelection === 'function') {
          await attendanceCommand.handleAttendanceClassSelection(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理报名选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 报名选择失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId === 'attendance_admin_menu') {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleAttendanceAdminMenu === 'function') {
          await attendanceCommand.handleAttendanceAdminMenu(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理管理员操作菜单失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 操作失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('attendance_group_delete_select:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleGroupDeleteSelect === 'function') {
          await attendanceCommand.handleGroupDeleteSelect(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理删除队伍失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 删除队伍失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('attendance_group_target_select:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleGroupTargetSelect === 'function') {
          await attendanceCommand.handleGroupTargetSelect(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理目标队伍选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 选择队伍失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('attendance_group_user_select:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleGroupUserSelect === 'function') {
          await attendanceCommand.handleGroupUserSelect(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理分配成员失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 分配成员失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId === 'reminder_admin_menu' || interaction.customId.startsWith('reminder_select_')) {
      try {
        const reminderCommand = require('./commands/reminder');
        if (reminderCommand && typeof reminderCommand.handleSelectMenu === 'function') {
          await reminderCommand.handleSelectMenu(interaction);
        }
      } catch (error) {
        console.error('[reminder] 处理看板选择菜单失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ reminder 操作失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    return;
  }

  if (interaction.isChannelSelectMenu()) {
    if (interaction.customId.startsWith('attendance_group_channel_select:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleGroupChannelSelect === 'function') {
          await attendanceCommand.handleGroupChannelSelect(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理分组频道选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 分组频道设置失败，请稍后再试。', flags: 64 });
        }
      }
      return;
    }

    if (interaction.customId === 'reminder_channel_select') {
      try {
        const reminderCommand = require('./commands/reminder');
        if (reminderCommand && typeof reminderCommand.handleChannelSelect === 'function') {
          await reminderCommand.handleChannelSelect(interaction);
        }
      } catch (error) {
        console.error('[reminder] 处理提醒频道选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ reminder 频道设置失败，请稍后再试。', flags: 64 });
        }
      }
    }
    return;
  }

  if (typeof interaction.isRoleSelectMenu === 'function' && interaction.isRoleSelectMenu()) {
    if (interaction.customId === 'reminder_role_select') {
      try {
        const reminderCommand = require('./commands/reminder');
        if (reminderCommand && typeof reminderCommand.handleRoleSelect === 'function') {
          await reminderCommand.handleRoleSelect(interaction);
        }
      } catch (error) {
        console.error('[reminder] 处理提醒身分组选择失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ reminder 身分组设置失败，请稍后再试。', flags: 64 });
        }
      }
    }
    return;
  }

  /* =========================
     Modal Submit（notice）
     ========================= */
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('attendance_group_create_modal:')) {
      try {
        const attendanceCommand = require('./commands/attendance');
        if (attendanceCommand && typeof attendanceCommand.handleGroupCreateModalSubmit === 'function') {
          await attendanceCommand.handleGroupCreateModalSubmit(interaction);
        }
      } catch (error) {
        console.error('[attendance] 处理新建队伍失败:', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({ content: '❌ 新建队伍失败，请稍后再试。', flags: 64 });
          } catch (replyError) {
            console.error(replyError);
          }
        }
      }
      return;
    }

    if (interaction.customId.startsWith('notice_add_modal_') || interaction.customId.startsWith('notice_edit_modal_')) {
      try {
        const noticeCommand = require('./commands/notice');
        if (noticeCommand && typeof noticeCommand.handleModalSubmit === 'function') {
          await noticeCommand.handleModalSubmit(interaction);
        }
      } catch (error) {
        console.error('[modal error]', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: '❌ 处理提交时发生错误',
              flags: 64,
            });
          } catch (replyError) {
            console.error(replyError);
          }
        }
      }
      return;
    }

    if (interaction.customId === 'reminder_add_modal' || interaction.customId.startsWith('reminder_edit_modal_') || interaction.customId === 'reminder_daynight_modal') {
      try {
        const reminderCommand = require('./commands/reminder');
        if (reminderCommand && typeof reminderCommand.handleModalSubmit === 'function') {
          await reminderCommand.handleModalSubmit(interaction);
        }
      } catch (error) {
        console.error('[modal error]', error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: '❌ 处理提交时发生错误',
              flags: 64,
            });
          } catch (replyError) {
            console.error(replyError);
          }
        }
      }
    }
  }
});

const TOKEN = process.env.ENVIRONMENT === 'development' 
  ? process.env.DISCORD_TOKEN_DEV 
  : process.env.DISCORD_TOKEN_PROD;

client.login(TOKEN);
