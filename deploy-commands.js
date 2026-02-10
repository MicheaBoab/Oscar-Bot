const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

// ⚠️ 需要你填的 3 个东西
const CLIENT_ID = '1469059865849893116';
const GUILD_ID = '1073767351465553961';
const TOKEN = 'MTQ2OTA1OTg2NTg0OTg5MzExNg.Gb14c1.yhIHSMKmNouDJYqlRIH7IJG90n_8Kf2GaV4ItE';

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ 正在注册 Slash Commands...');

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );

    console.log('✅ Slash Commands 注册完成');
  } catch (error) {
    console.error(error);
  }
})();
