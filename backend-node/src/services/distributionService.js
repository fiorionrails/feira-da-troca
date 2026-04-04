const { v4: uuidv4 } = require('uuid');

/**
 * Algoritmo de Distribuição Justa (Round-Robin com Rotação)
 */
function distributeItems(categories, numBoxes, stores) {
  const availableCategories = categories.filter(c => c.total_entries > 0);
  const totalItems = availableCategories.reduce((sum, c) => sum + (c.total_entries || 0), 0);

  if (totalItems === 0) {
    throw new Error('Nenhum produto cadastrado para distribuir.');
  }

  if (numBoxes <= 0) {
    throw new Error('Número de caixas deve ser maior que zero.');
  }

  if (numBoxes > totalItems) {
    throw new Error(`Impossível criar ${numBoxes} caixas com apenas ${totalItems} itens.`);
  }

  // Inicializar caixas vazias
  const boxes = Array.from({ length: numBoxes }, (_, i) => ({
    box_number: i + 1,
    items: {} // category_id -> target_quantity
  }));

  // Passo 1: Distribuir itens por categoria
  availableCategories.forEach((category, catIndex) => {
    const base = Math.floor(category.total_entries / numBoxes);
    const remainder = category.total_entries % numBoxes;

    // Offset rotativo para evitar que a Caixa 1 sempre ganhe o resto
    const offset = catIndex % numBoxes;

    for (let i = 0; i < numBoxes; i++) {
      const rotatedIndex = (i + offset) % numBoxes;
      const bonus = rotatedIndex < remainder ? 1 : 0;
      const quantity = base + bonus;

      if (quantity > 0) {
        boxes[i].items[category.id] = quantity;
      }
    }
  });

  // Passo 2: Atribuição de Lojas
  // (Nota: assumimos que stores já vem ordenado por quem tem menos caixas se for recálculo,
  // ou apenas a lista total se for criação inicial)
  boxes.forEach((box, i) => {
    const store = stores[i % stores.length];
    box.assigned_store_id = store.id;
    box.assigned_store_name = store.name;
  });

  // Passo 3: Gerar Warnings
  const warnings = [];
  availableCategories.forEach(cat => {
    if (cat.total_entries < numBoxes) {
      const missing = numBoxes - cat.total_entries;
      warnings.push(`"${cat.name}" tem apenas ${cat.total_entries} itens — ${missing} caixa(s) ficarão sem esta categoria.`);
    }
  });

  return { boxes, warnings };
}

function suggestBoxCount(categories, storesCount) {
  const ITEMS_PER_BOX_IDEAL = 15;
  const totalItems = categories.reduce((sum, c) => sum + (c.total_entries || 0), 0);
  
  const byCapacity = Math.ceil(totalItems / ITEMS_PER_BOX_IDEAL);
  const suggestion = Math.max(storesCount, byCapacity);

  return {
    suggested: suggestion,
    reasoning: `${storesCount} lojas, ${totalItems} itens → mínimo ${storesCount} caixas (1/loja), ideal ${byCapacity} caixas (~${ITEMS_PER_BOX_IDEAL} itens/caixa)`
  };
}

module.exports = {
  distributeItems,
  suggestBoxCount
};
