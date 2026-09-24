#!/usr/bin/env bash
# ==============================================================================
# Скрипт ежедневного резервного копирования базы заявок ООО «ФЕДСТРОЙ» (152-ФЗ)
# Установка в cron (каждую ночь в 03:00):
#   crontab -e
#   0 3 * * * /var/www/fedstroy-landing/deploy/backup-leads.sh >> /var/log/fedstroy-backup.log 2>&1
# ==============================================================================

set -euo pipefail

# Маска прав 077 гарантирует, что создаваемые директории (700) и архивы (600)
# будут доступны исключительно владельцу процесса backup/root (защита ПД по 152-ФЗ)
umask 077

APP_DIR="/var/www/fedstroy-landing"
BACKUP_DIR="/var/backups/fedstroy"
DATE_TAG=$(date +"%Y-%m-%d_%H%M%S")
RETENTION_DAYS=60

mkdir -p "${BACKUP_DIR}/leads"
mkdir -p "${BACKUP_DIR}/uploads"
chmod 700 "${BACKUP_DIR}" "${BACKUP_DIR}/leads" "${BACKUP_DIR}/uploads"

# 1. Резервное копирование leads.json
LEADS_FILE="${APP_DIR}/data/leads.json"
if [[ -f "${LEADS_FILE}" ]]; then
    # Валидация JSON перед созданием бэкапа
    if node -e "const d = JSON.parse(require('fs').readFileSync('${LEADS_FILE}', 'utf8')); if (!Array.isArray(d)) process.exit(1);" 2>/dev/null; then
        cp "${LEADS_FILE}" "${BACKUP_DIR}/leads/leads_${DATE_TAG}.json"
        gzip -f "${BACKUP_DIR}/leads/leads_${DATE_TAG}.json"
        chmod 600 "${BACKUP_DIR}/leads/leads_${DATE_TAG}.json.gz"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Резервная копия базы заявок создана: leads_${DATE_TAG}.json.gz"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ВНИМАНИЕ: ${LEADS_FILE} поврежден или не является массивом! Бэкап сохранен с суффиксом .corrupted"
        cp "${LEADS_FILE}" "${BACKUP_DIR}/leads/leads_${DATE_TAG}.corrupted.json"
        chmod 600 "${BACKUP_DIR}/leads/leads_${DATE_TAG}.corrupted.json"
    fi
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Файл ${LEADS_FILE} не найден, пропуск."
fi

# 2. Резервное копирование постоянных вложений (чертежей / ТЗ)
UPLOADS_DIR="${APP_DIR}/uploads"
if [[ -d "${UPLOADS_DIR}" && -n "$(ls -A "${UPLOADS_DIR}" 2>/dev/null)" ]]; then
    tar -czf "${BACKUP_DIR}/uploads/uploads_${DATE_TAG}.tar.gz" -C "${APP_DIR}" uploads/
    chmod 600 "${BACKUP_DIR}/uploads/uploads_${DATE_TAG}.tar.gz"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Архив вложений создан: uploads_${DATE_TAG}.tar.gz"
fi

# 3. Ротация устаревших копий (удаление старше $RETENTION_DAYS дней)
find "${BACKUP_DIR}/leads" -type f -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}/uploads" -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ротация завершена: файлы старше ${RETENTION_DAYS} дней удалены."
