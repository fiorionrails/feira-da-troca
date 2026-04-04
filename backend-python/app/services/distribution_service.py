from typing import List, Dict, Any
import math

def distribute_items(categories: List[Dict[str, Any]], num_boxes: int, stores: List[Dict[str, Any]]):
    available_categories = [c for c in categories if c.get('total_entries', 0) > 0]
    total_items = sum(c.get('total_entries', 0) for c in available_categories)

    if total_items == 0:
        raise ValueError("Nenhum produto cadastrado para distribuir.")

    if num_boxes <= 0:
        raise ValueError("Número de caixas deve ser maior que zero.")

    if num_boxes > total_items:
        raise ValueError(f"Impossível criar {num_boxes} caixas com apenas {total_items} itens.")

    # Inicializar caixas vazias
    boxes = [{"box_number": i + 1, "items": {}} for i in range(num_boxes)]

    # Passo 1: Distribuição Round-Robin com Rotação
    for cat_index, category in enumerate(available_categories):
        total_entries = category['total_entries']
        base = total_entries // num_boxes
        remainder = total_entries % num_boxes
        
        # Offset rotativo por categoria
        offset = cat_index % num_boxes

        for i in range(num_boxes):
            rotated_index = (i + offset) % num_boxes
            bonus = 1 if rotated_index < remainder else 0
            quantity = base + bonus
            
            if quantity > 0:
                boxes[i]["items"][category["id"]] = quantity

    # Passo 2: Atribuição de Lojas
    for i, box in enumerate(boxes):
        store = stores[i % len(stores)]
        box["assigned_store_id"] = store["id"]
        box["assigned_store_name"] = store["name"]

    # Passo 3: Warnings
    warnings = []
    for cat in available_categories:
        if cat['total_entries'] < num_boxes:
            missing = num_boxes - cat['total_entries']
            warnings.append(f'"{cat["name"]}" tem apenas {cat["total_entries"]} itens — {missing} caixa(s) ficarão sem esta categoria.')

    return {"boxes": boxes, "warnings": warnings}

def suggest_box_count(categories: List[Dict[str, Any]], stores_count: int):
    ITEMS_PER_BOX_IDEAL = 15
    total_items = sum(c.get('total_entries', 0) for c in categories)
    
    if total_items == 0:
        return {"suggested": stores_count, "reasoning": "Sem itens no inventário."}
        
    by_capacity = math.ceil(total_items / ITEMS_PER_BOX_IDEAL)
    suggestion = max(stores_count, by_capacity)

    return {
        "suggested": suggestion,
        "reasoning": f"{stores_count} lojas, {total_items} itens → mínimo {stores_count} caixas (1/loja), ideal {by_capacity} caixas (~{ITEMS_PER_BOX_IDEAL} itens/caixa)"
    }
