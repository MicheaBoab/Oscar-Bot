'use strict';

const { syncCodexItemTable } = require('../storage/codexItemStore');

(async () => {
  try {
    const count = await syncCodexItemTable(true);
    if (typeof count === 'number') {
      console.log(`Codex item table updated: ${count} items`);
    } else {
      console.log('Codex item table update skipped (fresh cache).');
    }
  } catch (error) {
    console.error('Failed to update Codex item table:', error);
    process.exit(1);
  }
})();
