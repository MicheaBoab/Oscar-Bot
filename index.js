const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, Collection, EmbedBuilder} = require('discord.js');

require("dotenv").config();
const { listPolls, loadPoll } = require('./storage/pollFileStore');
const { initializeCodexAutoUpdate } = require('./storage/codexItemStore');
const { startLiveQueueScheduler } = require('./helper/liveQueueScheduler');

const pollTiles = listPolls();
console.log(`♻️ 恢复 ${pollTiles.length} 个投票`);
initializeCodexAutoUpdate();

function closeExpiredPolls(reason = 'startup') {
  const {
    listPolls,
    loadPoll,
    updatePoll,
    archivePoll,
  } = require('./storage/pollFileStore');

  const all = listPolls();
  let closed = 0;

  for (const pollTitle of all) {
    const poll = loadPoll(pollTitle);
    if (!poll || poll.status !== 'active') continue;
    if (!Number.isFinite(poll.expiresAt)) {
      poll.expiresAt = Date.now() + 10 * 60 * 1000;
      updatePoll(pollTitle, poll);
      continue;
    }
    if (Date.now() < poll.expiresAt) continue;

    poll.status = 'ended';
    updatePoll(pollTitle, poll);
    archivePoll(pollTitle);
    closed += 1;
  }

  if (closed > 0) {
    const prefix = reason === 'startup' ? '启动时' : '定时检查';
    console.log(`⏱ ${prefix}已自动结束并归档 ${closed} 个过期投票`);
  }
}

closeExpiredPolls('startup');
setInterval(() => closeExpiredPolls('interval'), 15 * 1000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 存放所有命令
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  startLiveQueueScheduler(client);
});

client.on(Events.InteractionCreate, async interaction => {
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
    if (interaction.customId.startsWith('findall_page:')) {
      try {
        const findAllCommand = client.commands.get('findall');
        if (findAllCommand && typeof findAllCommand.handleFindAllPageButton === 'function') {
          await findAllCommand.handleFindAllPageButton(interaction);
        }
      } catch (error) {
        console.error(error);
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({ content: '❌ 翻页时发生错误', flags: 64 });
          } catch (replyError) {
            console.error(replyError);
          }
        }
      }
      return;
    }

    if (!interaction.customId.startsWith('find_page:')) return;

    try {
      const findCommand = client.commands.get('find');
      if (!findCommand || typeof findCommand.handleFindPageButton !== 'function') {
        return;
      }

      await findCommand.handleFindPageButton(interaction);
    } catch (error) {
      console.error(error);
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: '❌ 翻页时发生错误',
            flags: 64,
          });
        } catch (replyError) {
          console.error(replyError);
        }
      }
    }
    return;
  }
 
  /* =========================
     Select Menu（投票逻辑）
     ========================= */
  if (interaction.isStringSelectMenu()) {
    if(!interaction.customId.startsWith('poll_select:')) return;

    const {
      loadPoll,
      updatePoll,
      archivePoll,
    } = require('./storage/pollFileStore');

    const pollTitle = interaction.customId.split(':')[1];
    
    // ⭐ 1️⃣ 从文件读取投票
    const poll = loadPoll(pollTitle);

    // ⭐ 如果投票不存在或已结束
    if (!poll || poll.status !== 'active') {
      await interaction.update({
        content: '⏹️ 该投票已结束',
        components: [],
      });
      return;
    }

    if (Number.isFinite(poll.expiresAt) && Date.now() >= poll.expiresAt) {
      poll.status = 'ended';
      updatePoll(pollTitle, poll);
      archivePoll(pollTitle);
      await interaction.update({
        content: '⏱️ 该投票倒计时已结束',
        components: [],
      });
      return;
    }

    // ⭐ 3️⃣ 立刻占位（防止 3 秒超时）
    await interaction.deferUpdate();

    const userId = interaction.user.id;
    const selectedValue = interaction.values[0];
    const selectedIndex = poll.options.findIndex(
      opt => opt.value === selectedValue
    )

    // 修改投票
    poll.votes[userId] = selectedIndex;

    // ⭐ 写回文件
    updatePoll(pollTitle, poll);

    // 重新统计票数
    const counts = new Array(poll.options.length).fill(0);
    for (const voteIndex of Object.values(poll.votes)) {
      counts[voteIndex]++;
    }

    // 重建 Embed
    const fields = poll.options.map((opt, i) => ({
      name: `\u200B`,
      value: `${opt.label}\n**${counts[i]} 票**`,
      inline: false,
    }));

    const newEmbed = EmbedBuilder
      .from(interaction.message.embeds[0])
      .setFields(fields);

    await interaction.editReply({embeds: [newEmbed]});
  }
});

const TOKEN = process.env.ENVIRONMENT === 'development' 
  ? process.env.DISCORD_TOKEN_DEV 
  : process.env.DISCORD_TOKEN_PROD;

client.login(TOKEN);