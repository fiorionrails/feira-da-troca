function getStoreByToken(db, terminalToken) {
  return db.prepare('SELECT * FROM stores WHERE terminal_token = ?').get(terminalToken) || null;
}

module.exports = { getStoreByToken };
