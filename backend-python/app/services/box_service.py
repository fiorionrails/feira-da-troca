from uuid import uuid4
from datetime import datetime
from app.database import get_db_connection
from app.services.distribution_service import distribute_items

def claim_box(box_id: str, responsible_name: str):
    with get_db_connection() as conn:
        box = conn.execute('SELECT responsible_name FROM boxes WHERE id = ?', (box_id,)).fetchone()
        if not box:
            raise ValueError("Caixa não encontrada.")
        if box['responsible_name']:
            raise ValueError(f"Esta caixa já foi assumida por {box['responsible_name']}.")

        conn.execute("""
            UPDATE boxes 
            SET responsible_name = ?, status = 'in_progress', claimed_at = ? 
            WHERE id = ?
        """, (responsible_name, datetime.now().isoformat(), box_id))
        conn.commit()
    return True

def complete_box(box_id: str):
    with get_db_connection() as conn:
        box = conn.execute('SELECT distribution_id FROM boxes WHERE id = ?', (box_id,)).fetchone()
        if not box:
            raise ValueError("Caixa não encontrada.")

        conn.execute("""
            UPDATE boxes 
            SET status = 'done', completed_at = ? 
            WHERE id = ?
        """, (datetime.now().isoformat(), box_id))
        conn.commit()

        # Verifica recálculo
        return check_and_trigger_recalc(conn, box['distribution_id'])

def cancel_box(box_id: str):
    with get_db_connection() as conn:
        box = conn.execute('SELECT distribution_id FROM boxes WHERE id = ?', (box_id,)).fetchone()
        if not box:
            raise ValueError("Caixa não encontrada.")

        conn.execute("""
            UPDATE boxes 
            SET responsible_name = NULL, status = 'pending', claimed_at = NULL 
            WHERE id = ?
        """, (box_id,))
        conn.commit()

        # Verifica recálculo
        return check_and_trigger_recalc(conn, box['distribution_id'])

def flag_needs_recalc(distribution_id: str):
    with get_db_connection() as conn:
        conn.execute('UPDATE distributions SET needs_recalc = 1 WHERE id = ?', (distribution_id,))
        conn.commit()

def check_and_trigger_recalc(conn, distribution_id: str):
    in_progress = conn.execute(
        'SELECT COUNT(*) as c FROM boxes WHERE distribution_id = ? AND status = ?', 
        (distribution_id, 'in_progress')
    ).fetchone()['c']
    
    if in_progress == 0:
        dist = conn.execute('SELECT needs_recalc FROM distributions WHERE id = ?', (distribution_id,)).fetchone()
        if dist and dist['needs_recalc'] == 1:
            recalculate_pending_boxes(conn, distribution_id)
            conn.execute('UPDATE distributions SET needs_recalc = 0 WHERE id = ?', (distribution_id,))
            conn.commit()
            return True
    return False

def recalculate_pending_boxes(conn, distribution_id: str):
    # 1. Inventário total
    categories = conn.execute('SELECT id, name, total_entries FROM categories WHERE total_entries > 0').fetchall()
    
    # 2. O que já está em caixas DONE
    done_items = conn.execute("""
        SELECT bi.category_id, SUM(bi.target_quantity) as used
        FROM box_items bi
        JOIN boxes b ON bi.box_id = b.id
        WHERE b.distribution_id = ? AND b.status = 'done'
        GROUP BY bi.category_id
    """, (distribution_id,)).fetchall()

    used_map = {d['category_id']: d['used'] for d in done_items}

    # 3. Inventário restante
    remaining = []
    for c in categories:
        qty = c['total_entries'] - used_map.get(c['id'], 0)
        if qty > 0:
            remaining.append({"id": c['id'], "name": c['name'], "total_entries": qty})

    # 4. Caixas pendentes
    pending_boxes = conn.execute(
        'SELECT id FROM boxes WHERE distribution_id = ? AND status = ?', 
        (distribution_id, 'pending')
    ).fetchall()
    
    if not pending_boxes:
        return

    # 5. Deletar box_items antigos das caixas pending
    pending_ids = [b['id'] for b in pending_boxes]
    placeholders = ','.join('?' * len(pending_ids))
    conn.execute(f"DELETE FROM box_items WHERE box_id IN ({placeholders})", tuple(pending_ids))

    # 6. Rodar algoritmo
    stores = conn.execute('SELECT id, name FROM stores ORDER BY name ASC').fetchall()
    stores_list = [{"id": s['id'], "name": s['name']} for s in stores]
    
    result = distribute_items(remaining, len(pending_boxes), stores_list)

    # 7. Inserir novos itens
    for i, calc_box in enumerate(result['boxes']):
        real_box_id = pending_boxes[i]['id']
        for cat_id, qty in calc_box['items'].items():
            conn.execute(
                'INSERT INTO box_items (id, box_id, category_id, target_quantity) VALUES (?, ?, ?, ?)',
                (str(uuid4()), real_box_id, cat_id, qty)
            )
