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

  // Blogger integrations: video + OZON promo, views, cost, sales (for effectiveness)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blogger_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_title TEXT,
      channel_title TEXT,
      video_published_at TEXT,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      ozon_action_id INTEGER NOT NULL,
      ozon_action_title TEXT NOT NULL,
      integration_cost REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec('ALTER TABLE blogger_integrations ADD COLUMN video_published_at TEXT');
  } catch (e) {
    // column already exists
  }

  // Monthly sales by promo title (for bloggers effectiveness)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blogger_promo_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL, -- YYYY-MM
      ozon_action_title TEXT NOT NULL,
      sales_amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Детализация покупок по акции: дата (Принят в обработку) и цена (Ваша цена)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blogger_promo_sales_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL,
      ozon_action_title TEXT NOT NULL,
      processed_at TEXT,
      price REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Create default YouTube settings if not exists
  const youtube = db.prepare('SELECT id FROM api_settings WHERE service = ?').get('youtube');
  if (!youtube) {
    db.prepare('INSERT INTO api_settings (service, api_key) VALUES (?, ?)').run('youtube', '');
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
