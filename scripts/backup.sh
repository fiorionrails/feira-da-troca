#!/bin/bash
# backup.sh — Cria uma cópia datada do banco de dados Ouroboros.
#
# Uso manual:
#   bash scripts/backup.sh
#
# Agendamento automático a cada 30 min (crontab -e):
#   */30 * * * * /caminho/para/ouroboros/scripts/backup.sh
#
# O arquivo de banco é procurado em backend-node/ e backend-python/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$PROJECT_DIR/backups"

mkdir -p "$BACKUP_DIR"

# Tenta localizar o banco (Node.js primeiro, depois Python)
DB_PATH=""
for candidate in \
  "$PROJECT_DIR/backend-node/ouroboros.db" \
  "$PROJECT_DIR/backend-python/ouroboros.db"; do
  if [ -f "$candidate" ]; then
    DB_PATH="$candidate"
    break
  fi
done

if [ -z "$DB_PATH" ]; then
  echo "ERRO: ouroboros.db não encontrado em backend-node/ nem backend-python/"
  exit 1
fi

DEST="$BACKUP_DIR/ouroboros-$TIMESTAMP.db"
cp "$DB_PATH" "$DEST"
echo "Backup criado: $DEST"

# Manter apenas os últimos 20 backups para não lotar o disco
ls -t "$BACKUP_DIR"/ouroboros-*.db 2>/dev/null | tail -n +21 | xargs -r rm --
