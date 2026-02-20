const db = require('./database');
const bcrypt = require('bcrypt');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      is_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace TEXT UNIQUE NOT NULL,
      client_id TEXT,
      api_key TEXT,
      is_active INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create ozon_accounts table for multiple OZON accounts
  db.exec(`
    CREATE TABLE IF NOT EXISTS ozon_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create api_settings table for third-party API keys
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT UNIQUE NOT NULL,
      api_key TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create default OZON settings if not exists
  const ozon = db.prepare('SELECT id FROM marketplace_settings WHERE marketplace = ?').get('ozon');
  if (!ozon) {
    db.prepare('INSERT INTO marketplace_settings (marketplace) VALUES (?)').run('ozon');
  }

  // Create default DeepSeek settings if not exists
  const deepseek = db.prepare('SELECT id FROM api_settings WHERE service = ?').get('deepseek');
  if (!deepseek) {
    db.prepare('INSERT INTO api_settings (service, api_key) VALUES (?, ?)').run('deepseek', '');
  }

  // Create default admin if not exists
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com');
  if (!admin) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (email, password, name, is_admin) VALUES (?, ?, ?, 1)')
      .run('admin@example.com', hashedPassword, 'Administrator');
    console.log('Default admin created: admin@example.com / admin123');
  }

  console.log('Database initialized');
}

module.exports = { initDatabase };
