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

// ── Poll result helpers ─────────────────────────────────────────────────────
function computePollResult(poll) {
  const counts = new Array(poll.options.length).fill(0);
  for (const voteIndex of Object.values(poll.votes || {})) {
    if (Number.isFinite(voteIndex) && voteIndex >= 0 && voteIndex < poll.options.length) {
      counts[voteIndex]++;
    }
  }
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const maxVotes = totalVotes > 0 ? Math.max(...counts) : 0;
  const winnerIndexes = totalVotes > 0
    ? counts.map((c, i) => ({ c, i })).filter(x => x.c === maxVotes).map(x => x.i)
    : [];
  const winnerMentions = winnerIndexes.map(i => {
    const opt = poll.options[i];
    if (opt.value.startsWith('user:')) return `<@${opt.value.split(':')[1]}>`;
    return opt.label;
  });
  return { counts, totalVotes, maxVotes, winnerIndexes, winnerMentions };
}

function buildResultEmbed(poll, footerText = '该投票已结束') {
  const { winnerMentions } = computePollResult(poll);
  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🟢 投票已结束\n')
    .setDescription([
      `\n🏆 **${poll.title}** 投票结果公布\n`,
      `🎉 获胜者为：**${winnerMentions.join(' | ')}**`,
      '\n👏 感谢大家的参与',
    ].join('\n'))
    .setFooter({ text: footerText })
    .setTimestamp();
}

function buildDisabledEmbed(poll) {
  const { counts } = computePollResult(poll);
  const fields = poll.options.map((opt, i) => ({
    name: '\u200B',
    value: `${opt.label}\n**${counts[i]} 票**`,
    inline: false,
  }));
  return new EmbedBuilder()
    .setTitle(`📊 投票已结束：${poll.title}`)
    .setDescription('⏱️ 该投票已到期结束，无法继续投票。')
    .setFields(fields)
    .setColor(0x99AAB5);
}

async function closeExpiredPolls(client = null, reason = 'startup') {
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

    // 有 client 时向频道发送统计结果，并将原消息更新为已结束样式
    if (client && poll.channelId) {
      try {
        const channel = await client.channels.fetch(poll.channelId);
        if (poll.messageId) {
          try {
            const msg = await channel.messages.fetch(poll.messageId);
            await msg.edit({ content: null, embeds: [buildDisabledEmbed(poll)], components: [] });
          } catch {
            // 原消息已被删除或无权限，忽略
          }
        }
        const { totalVotes } = computePollResult(poll);
        if (totalVotes === 0) {
          await channel.send({ content: `🏆 **投票结果公布**\n⚖️ **${poll.title}** 无人投票\n👏 感谢大家的参与` });
        } else {
          await channel.send({ embeds: [buildResultEmbed(poll, '该投票已超时自动结束')] });
        }
      } catch (err) {
        console.error(`[poll] 自动结束 ${pollTitle} 时通知失败:`, err.message);
      }
    }
  }

  if (closed > 0) {
    const prefix = reason === 'startup' ? '启动时' : '定时检查';
    console.log(`⏱ ${prefix}已自动结束并归档 ${closed} 个过期投票`);
  }
}

closeExpiredPolls(null, 'startup');

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
  setInterval(
    () => closeExpiredPolls(client, 'interval').catch(err => console.error('[poll] 定时检查失败:', err)),
    15 * 1000,
  );
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
      // 将原投票消息更新为已结束样式，移除下拉菜单
      await interaction.update({ content: null, embeds: [buildDisabledEmbed(poll)], components: [] });
      // 向频道发送投票结果
      const { totalVotes } = computePollResult(poll);
      if (totalVotes === 0) {
        await interaction.channel.send({ content: `🏆 **投票结果公布**\n⚖️ **${poll.title}** 无人投票\n👏 感谢大家的参与` });
      } else {
        await interaction.channel.send({ embeds: [buildResultEmbed(poll, '该投票倒计时已结束')] });
      }
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