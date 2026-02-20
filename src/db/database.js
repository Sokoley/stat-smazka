const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/stat.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

module.exports = db;
