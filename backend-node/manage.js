/**
 * manage.js – Inicializa o banco de dados SQLite do Ouroboros.
 * Execute com: node manage.js
 *
 * O schema completo (tabelas, views e índices) é criado automaticamente
 * pelo getDb() em src/database.js — este script é apenas um atalho conveniente.
 */
const { getDb } = require('./src/database');

const db = getDb();

console.log('Banco de dados inicializado com sucesso!');
db.close();
process.exit(0);
