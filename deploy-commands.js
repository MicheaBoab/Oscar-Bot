const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
require("dotenv").config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const CLIENT_ID_TOKEN = process.env.CLIENT_ID;
const GUILD_ID_TOKEN = process.env.GUILD_ID;
const TOKEN = process.env.DISCORD_TOKEN;

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ 正在注册 Slash Commands...');

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID_TOKEN, GUILD_ID_TOKEN),
      { body: commands },
    );

    console.log('✅ Slash Commands 注册完成');
  } catch (error) {
    console.error(error);
  }
})();
