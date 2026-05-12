const { SlashCommandBuilder } = require('discord.js');
const { appendSignup } = require('../storage/signupFileStore');
const SIGNUP_CONSTANTS = require('../helper/signupConstants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('signup')
    .setDescription('记录报名信息')
    .addIntegerOption(option =>
      option
        .setName('当前最高层')
        .setDescription('当前最高层')
        .setMinValue(SIGNUP_CONSTANTS.FLOOR_MIN)
        .setMaxValue(SIGNUP_CONSTANTS.FLOOR_MAX)
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('ap')
        .setDescription('AP')
        .setMinValue(SIGNUP_CONSTANTS.AP_MIN)
        .setMaxValue(SIGNUP_CONSTANTS.AP_MAX)
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('职业')
        .setDescription('职业')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('需要carry')
        .setDescription('是否需要大腿 carry')
        .setRequired(true),
    ),

  async execute(interaction) {
    const 当前最高层 = interaction.options.getInteger('当前最高层');
    const AP = interaction.options.getInteger('ap');
    const 职业 = interaction.options.getString('职业');
    const 需要carry = interaction.options.getBoolean('需要carry');
    const 昵称 = interaction.member?.displayName || interaction.user.username;

    if (当前最高层 < SIGNUP_CONSTANTS.FLOOR_MIN || 当前最高层 > SIGNUP_CONSTANTS.FLOOR_MAX) {
      return interaction.reply({
        content: `❌ 当前最高层必须在 ${SIGNUP_CONSTANTS.FLOOR_MIN} 到 ${SIGNUP_CONSTANTS.FLOOR_MAX} 之间`,
        flags: 64,
      });
    }

    if (AP < SIGNUP_CONSTANTS.AP_MIN || AP > SIGNUP_CONSTANTS.AP_MAX) {
      return interaction.reply({
        content: `❌ AP 必须在 ${SIGNUP_CONSTANTS.AP_MIN} 到 ${SIGNUP_CONSTANTS.AP_MAX} 之间`,
        flags: 64,
      });
    }

    appendSignup({
      userId: interaction.user.id,
      昵称,
      username: interaction.user.tag,
      当前最高层,
      AP,
      职业,
      需要carry,
      createdAt: Date.now(),
    });

    await interaction.reply({
      content: 'sign up successfully',
      flags: 64,
    });
  },
};