const { REST, Routes } = require('discord.js');
require("dotenv").config();

const commands = require('./helper/slashCommands').loadCommands().map(command => command.data.toJSON());

const CLIENT_ID_TOKEN = process.env.CLIENT_ID;
const GUILD_ID_TOKEN = process.env.GUILD_ID;

const TOKEN = process.env.ENVIRONMENT === 'development' 
  ? process.env.DISCORD_TOKEN_DEV 
  : process.env.DISCORD_TOKEN_PROD;

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ 正在注册 Slash Commands...');

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID_TOKEN, GUILD_ID_TOKEN),
      { body: commands },
    );

    const registered = await rest.get(Routes.applicationGuildCommands(CLIENT_ID_TOKEN, GUILD_ID_TOKEN));
    const names = registered.map(command => command.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(commands.map(command => command.name).sort())) {
      throw new Error('注册后的命令列表与预期不一致');
    }
    console.log('✅ Slash Commands 已核实：' + names.join(', '));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
