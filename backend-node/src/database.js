const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const DB_PATH = path.isAbsolute(config.databaseUrl)
  ? config.databaseUrl
  : path.resolve(__dirname, '..', config.databaseUrl);

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = -64000');
  }
  return _db;
}

module.exports = { getDb };
