const test = require('node:test');
const assert = require('node:assert/strict');
const attendanceCommand = require('../commands/attendance');

function attendance(overrides = {}) {
  return {
    title: '测试活动',
    description: '测试说明',
    status: 'active',
    selectRole: true,
    published: true,
    participants: {},
    declinedParticipants: {},
    groups: [],
    ...overrides,
  };
}

test('发布且没有队伍时，所有报名者显示在 Waitlist', () => {
  const data = attendance({
    participants: {
      '1': { displayName: 'Alice', selection: 'Ranger', specialization: 'succession' },
      '2': { displayName: 'Bob', selection: 'Witch', specialization: 'awakening' },
    },
  });

  const embed = attendanceCommand.buildAttendanceEmbed(data).toJSON();
  assert.equal(embed.fields.length, 1);
  assert.equal(embed.fields[0].name, 'Waitlist (2)');
  assert.match(embed.fields[0].value, /🔵 Ranger/);
  assert.match(embed.fields[0].value, /🟠 Witch/);
});

test('发布面板按队伍显示成员，并将未分组成员放入 Waitlist', () => {
  const data = attendance({
    participants: {
      '1': { displayName: 'Alice', selection: 'Agent', specialization: 'not_applicable' },
      '2': { displayName: 'Shai Player', selection: 'Shai' },
    },
    groups: [{ id: 'g1', label: '队伍 1', capacity: 5, memberIds: ['1'] }],
  });

  const embed = attendanceCommand.buildAttendanceEmbed(data).toJSON();
  assert.equal(embed.fields[0].name, '队伍 1 (1/5)');
  assert.match(embed.fields[0].value, /⚪ Agent/);
  assert.equal(embed.fields[1].name, 'Waitlist (1)');
  assert.match(embed.fields[1].value, /🟡 Shai/);
});

test('长中文与 emoji 名称会截断，职业显示在名称左侧', () => {
  const data = attendance({
    participants: {
      '1': {
        displayName: '修改后的超长中文玩家名称😀测试',
        selection: 'Dark Knight',
        specialization: 'succession',
      },
    },
  });

  const value = attendanceCommand.buildAttendanceEmbed(data).toJSON().fields[0].value;
  assert.match(value, /^`\[🔵 Dark Knight\]   /u);
  assert.match(value, /…/u);
  assert.ok(value.endsWith('`'));
});

test('职业报名组件包含继承觉醒和管理员操作', () => {
  const rows = attendanceCommand.buildAttendanceComponents(attendance({ published: false }));
  const firstRowLabels = rows[0].toJSON().components.map(component => component.label);
  const adminOptions = rows.at(-1).toJSON().components[0].options.map(option => option.label);

  assert.ok(firstRowLabels.includes('⚔️ 继承/觉醒 / ⚔️ Succession/Awakening'));
  assert.ok(adminOptions.includes('🧩 分队管理 / 🧩 Manage teams'));
  assert.ok(adminOptions.includes('📍 更新分组频道 / 📍 Set team channel'));
  assert.ok(adminOptions.includes('🔄 刷新玩家名称 / 🔄 Refresh names'));
});

test('公开报名组件和分队面板使用中英双语', () => {
  const data = attendance({ published: false });
  const signupRows = attendanceCommand.buildAttendanceComponents(data).map(row => row.toJSON());
  const signupLabels = signupRows[0].components.map(component => component.label);
  const groupPanel = attendanceCommand.buildGroupPanelComponents(data).map(row => row.toJSON());
  const groupLabels = groupPanel.flatMap(row => row.components.map(component => component.label));
  const embed = attendanceCommand.buildAttendanceEmbed(data).toJSON();

  assert.ok(signupLabels.includes('下次一定U•ェ•*U / Next time, for sure 😂'));
  assert.ok(groupLabels.includes('➕ 新建队伍 / ➕ Create team'));
  assert.equal(embed.title, '📌 活动报名 / 📌 Event signup：测试活动');
});

test('私密继承觉醒按钮按用户语言显示，缺省语言使用英文', () => {
  const chineseButtons = attendanceCommand
    .buildSpecializationButtons('message', 0, { locale: 'zh-CN' })
    .toJSON().components.map(component => component.label);
  const englishButtons = attendanceCommand
    .buildSpecializationButtons('message', 0, { locale: 'en-US' })
    .toJSON().components.map(component => component.label);
  const defaultButtons = attendanceCommand
    .buildSpecializationButtons('message', 0, {})
    .toJSON().components.map(component => component.label);

  assert.deepEqual(chineseButtons, ['🔵 继承', '🟠 觉醒', '⚪ 不适用']);
  assert.deepEqual(englishButtons, ['🔵 Succession', '🟠 Awakening', '⚪ N/A']);
  assert.deepEqual(defaultButtons, englishButtons);
});

test('报名结果 Footer 根据场景使用正确的双语', () => {
  const endedEmbed = attendanceCommand.buildAttendanceResultEmbed(attendance()).toJSON();
  const activeEmbed = attendanceCommand.buildAttendanceResultEmbed(attendance(), '当前报名名单').toJSON();

  assert.equal(endedEmbed.footer.text, '该报名帖已结束 / This signup has ended');
  assert.equal(activeEmbed.footer.text, '当前报名名单 / Current signup list');
});

test('名单无成员和截断提示使用中英双语', () => {
  const emptyEmbed = attendanceCommand.buildAttendanceEmbed(attendance()).toJSON();
  assert.match(emptyEmbed.fields[0].value, /（无） \/ \(None\)/u);

  const participants = {};
  for (let index = 0; index < 40; index++) {
    participants[String(index)] = { displayName: `Player${index}`, selection: 'Dark Knight' };
  }

  const value = attendanceCommand.buildAttendanceEmbed(attendance({ participants })).toJSON().fields[0].value;
  assert.match(value, /另有 \d+ 人未显示 \/ … \d+ more not shown/u);
});

test('长名单会安全截断并显示未显示人数', () => {
  const participants = {};
  for (let index = 0; index < 40; index++) {
    participants[String(index)] = {
      displayName: `LongParticipantName${index}`,
      selection: 'Dark Knight',
      specialization: 'succession',
    };
  }

  const embed = attendanceCommand.buildAttendanceEmbed(attendance({ participants })).toJSON();
  assert.ok(embed.fields[0].value.length <= 1024);
  assert.match(embed.fields[0].value, /另有 \d+ 人未显示/u);
});

test('达到 24 个队伍时禁用新建队伍', () => {
  const groups = Array.from({ length: 24 }, (_, index) => ({
    id: `g${index + 1}`,
    label: `队伍 ${index + 1}`,
    capacity: 5,
    memberIds: [],
  }));

  const data = attendance({ groups });
  const groupComponents = attendanceCommand.buildGroupPanelComponents(data);
  const createButton = groupComponents[0].toJSON().components[0];
  assert.equal(createButton.disabled, true);
  assert.doesNotThrow(() => attendanceCommand.buildAttendanceEmbed(data).toJSON());
});
