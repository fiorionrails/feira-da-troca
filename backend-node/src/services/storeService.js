function getStoreByToken(db, terminalToken) {
  return db.prepare('SELECT * FROM stores WHERE terminal_token = ?').get(terminalToken.toUpperCase()) || null;
}

module.exports = { getStoreByToken };
