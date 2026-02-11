const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, Collection, EmbedBuilder} = require('discord.js');

require("dotenv").config();
const { listPolls, loadPoll } = require('./storage/pollFileStore');

const pollTiles = listPolls();
console.log(`♻️ 恢复 ${pollTiles.length} 个投票`);

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
});

client.on(Events.InteractionCreate, async interaction => {
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
        ephemeral: true,
      });
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

const TOKEN = process.env.DISCORD_TOKEN;
client.login(TOKEN);