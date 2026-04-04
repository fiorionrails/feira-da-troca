const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { distributeItems } = require('./distributionService');

/**
 * Assume a responsabilidade por uma caixa (Claim)
 */
function claimBox(boxId, responsibleName) {
  const db = getDb();
  
  // Transação atômica para garantir que não foi pega por outro
  const box = db.prepare('SELECT responsible_name, box_number FROM boxes WHERE id = ?').get(boxId);
  if (!box) throw new Error('Caixa não encontrada.');
  if (box.responsible_name) throw new Error(`Esta caixa já foi assumida por ${box.responsible_name}.`);

  db.prepare(`
    UPDATE boxes 
    SET responsible_name = ?, status = 'in_progress', claimed_at = ? 
    WHERE id = ?
  `).run(responsibleName, new Date().toISOString(), boxId);

  return true;
}

/**
 * Conclui a montagem de uma caixa
 */
function completeBox(boxId) {
  const db = getDb();
  const box = db.prepare('SELECT distribution_id FROM boxes WHERE id = ?').get(boxId);
  if (!box) throw new Error('Caixa não encontrada.');

  db.prepare(`
    UPDATE boxes 
    SET status = 'done', completed_at = ? 
    WHERE id = ?
  `).run(new Date().toISOString(), boxId);

  // Verifica se o recálculo foi liberado (era a última in_progress?)
  return checkAndTriggerRecalc(box.distribution_id);
}

/**
 * Cancela e libera uma caixa
 */
function cancelBox(boxId) {
  const db = getDb();
  const box = db.prepare('SELECT distribution_id FROM boxes WHERE id = ?').get(boxId);
  if (!box) throw new Error('Caixa não encontrada.');

  db.prepare(`
    UPDATE boxes 
    SET responsible_name = NULL, status = 'pending', claimed_at = NULL 
    WHERE id = ?
  `).run(boxId);

  // Verifica se o recálculo foi liberado
  return checkAndTriggerRecalc(box.distribution_id);
}

/**
 * Ativa sinal de recálculo necessário
 */
function flagNeedsRecalc(distributionId) {
  const db = getDb();
  db.prepare('UPDATE distributions SET needs_recalc = 1 WHERE id = ?').run(distributionId);
}

/**
 * Verifica se pode rodar o recálculo e o executa se necessário
 */
function checkAndTriggerRecalc(distributionId) {
  const db = getDb();
  
  const inProgress = db.prepare('SELECT COUNT(*) as c FROM boxes WHERE distribution_id = ? AND status = ?').get(distributionId, 'in_progress').c;
  
  if (inProgress === 0) {
    const dist = db.prepare('SELECT needs_recalc FROM distributions WHERE id = ?').get(distributionId);
    if (dist && dist.needs_recalc === 1) {
      recalculatePendingBoxes(distributionId);
      db.prepare('UPDATE distributions SET needs_recalc = 0 WHERE id = ?').run(distributionId);
      return true; // Recalculado
    }
  }
  return false;
}

/**
 * Lógica Core de Recálculo: mantém as DONE, refaz as PENDING
 */
function recalculatePendingBoxes(distributionId) {
  const db = getDb();
  
  // 1. Inventário total (categorias atuais)
  const categories = db.prepare('SELECT * FROM categories WHERE total_entries > 0').all();
  
  // 2. O que já está em caixas DONE (que não tocaremos)
  const doneItems = db.prepare(`
    SELECT bi.category_id, SUM(bi.target_quantity) as used
    FROM box_items bi
    JOIN boxes b ON bi.box_id = b.id
    WHERE b.distribution_id = ? AND b.status = 'done'
    GROUP BY bi.category_id
  `).all(distributionId);

  const usedMap = {};
  doneItems.forEach(d => { usedMap[d.category_id] = d.used; });

  // 3. Inventário restante para distribuir
  const remaining = categories.map(c => ({
    ...c,
    total_entries: c.total_entries - (usedMap[c.id] || 0)
  })).filter(c => c.total_entries > 0);

  // 4. Caixas pendentes que serão atualizadas
  const pendingBoxes = db.prepare('SELECT * FROM boxes WHERE distribution_id = ? AND status = ?').all(distributionId, 'pending');
  if (pendingBoxes.length === 0) return;

  // 5. Deletar itens antigos das caixas pendentes
  const pendingIds = pendingBoxes.map(b => b.id);
  const placeholders = pendingIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM box_items WHERE box_id IN (${placeholders})`).run(...pendingIds);

  // 6. Rodar algoritmo para o resto
  const stores = db.prepare('SELECT * FROM stores ORDER BY name ASC').all();
  const { boxes: newBoxes } = distributeItems(remaining, pendingBoxes.length, stores);

  // 7. Inserir novos itens nas caixas existentes
  const insertItem = db.prepare('INSERT INTO box_items (id, box_id, category_id, target_quantity) VALUES (?, ?, ?, ?)');
  
  newBoxes.forEach((calcBox, i) => {
    const realBoxId = pendingBoxes[i].id;
    Object.entries(calcBox.items).forEach(([catId, qty]) => {
      insertItem.run(uuidv4(), realBoxId, catId, qty);
    });
  });
}

module.exports = {
  claimBox,
  completeBox,
  cancelBox,
  flagNeedsRecalc,
  checkAndTriggerRecalc,
  recalculatePendingBoxes
};
