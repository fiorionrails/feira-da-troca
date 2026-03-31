const { v4: uuidv4 } = require('uuid');

function getCategoryByName(db, name) {
  return db.prepare('SELECT * FROM categories WHERE name = ?').get(name) || null;
}

function createOrUpdateCategory(db, name, price, initialEntries = 0) {
  const existing = getCategoryByName(db, name);

  if (existing) {
    if (price > 0) {
      db.prepare(
        'UPDATE categories SET price = ?, total_entries = total_entries + ? WHERE id = ?'
      ).run(price, initialEntries, existing.id);
    } else {
      db.prepare(
        'UPDATE categories SET total_entries = total_entries + ? WHERE id = ?'
      ).run(initialEntries, existing.id);
    }
    return getCategoryByName(db, name);
  }

  const catId = uuidv4();
  db.prepare(
    'INSERT INTO categories (id, name, price, total_entries, total_exits) VALUES (?, ?, ?, ?, ?)'
  ).run(catId, name, price, initialEntries, 0);
  return getCategoryByName(db, name);
}

function listCategories(db) {
  return db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
}

module.exports = { getCategoryByName, createOrUpdateCategory, listCategories };
