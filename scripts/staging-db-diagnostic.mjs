import mysql from 'mysql2/promise';

const connectionString = process.env.DATABASE_URL;

async function runDiagnostics() {
  if (!connectionString) {
    console.warn('[DIAG] DATABASE_URL is not set, skipping DB diagnostics');
    return;
  }

  const connection = await mysql.createConnection(connectionString);

  try {
    console.log('=== MIGRATION TRACKING TABLE ===');
    const [tables] = await connection.query("SHOW TABLES LIKE ?", ['%migration%']);
    console.log('Migration tables:', JSON.stringify(tables, null, 2));

    if (tables.length > 0) {
      const tableName = tables[0][Object.keys(tables[0])[0]];
      const [migrations] = await connection.query(`SELECT * FROM ?? ORDER BY id`, [tableName]);
      console.log('Applied migrations:', JSON.stringify(migrations, null, 2));
    }

    console.log('=== USER_SETTINGS COLUMNS ===');
    const [userSettings] = await connection.query('DESCRIBE user_settings');
    console.log('user_settings columns:', JSON.stringify(userSettings, null, 2));

    console.log('=== EXPORT COLUMNS CHECK ===');
    const [exportColumns] = await connection.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_settings' AND COLUMN_NAME IN ('exportSortBy', 'exportSortDirection')"
    );
    console.log('export columns:', JSON.stringify(exportColumns, null, 2));

    console.log('=== CHAT_ATTACHMENTS COLUMNS ===');
    const [chatAttachments] = await connection.query('DESCRIBE chat_attachments');
    console.log('chat_attachments columns:', JSON.stringify(chatAttachments, null, 2));

    console.log('=== EXPIRES_AT CHECK ===');
    const [expiresAt] = await connection.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_attachments' AND COLUMN_NAME = 'expiresAt'"
    );
    console.log('expiresAt exists:', JSON.stringify(expiresAt, null, 2));

    console.log('=== KEY TABLES EXISTENCE ===');
    const keyTables = ['users', 'chat_sessions', 'messages', 'memory_entries', 'memory_settings', 'memory_profiles', 'provider_health', 'chat_exports'];
    for (const table of keyTables) {
      const [result] = await connection.query('SHOW TABLES LIKE ?', [table]);
      console.log(`${table}:`, result.length > 0 ? 'EXISTS' : 'MISSING');
    }

    console.log('=== DIAGNOSTIC COMPLETE ===');
  } catch (error) {
    console.error('[DIAG] Error:', error.message);
    console.error('[DIAG] Stack:', error.stack);
  } finally {
    await connection.end();
  }
}

await runDiagnostics();

import { spawn } from 'node:child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

server.on('error', (error) => {
  console.error('[DIAG] Failed to start server:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  server.kill('SIGINT');
});
process.on('SIGTERM', () => {
  server.kill('SIGTERM');
});
