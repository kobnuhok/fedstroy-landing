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
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ОШИБКА: ${LEADS_FILE} поврежден или не является массивом! Аварийный слепок сохранен с суффиксом .corrupted" >&2
        cp "${LEADS_FILE}" "${BACKUP_DIR}/leads/leads_${DATE_TAG}.corrupted.json"
        chmod 600 "${BACKUP_DIR}/leads/leads_${DATE_TAG}.corrupted.json"
        exit 1
    fi
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Файл ${LEADS_FILE} не найден, пропуск."
fi

# 2. Резервное копирование постоянных вложений (чертежей / ТЗ)
# Защита от переполнения диска: вместо ежедневного дублирования многогигабайтного каталога:
# 2.1. Зеркалирование актуального каталога uploads в ${BACKUP_DIR}/uploads/mirror/
# 2.2. Еженедельный полный срез по воскресеньям (DOW=7)
# 2.3. Ежедневный инкрементальный архив только новых/измененных файлов за последние 24 часа
UPLOADS_DIR="${APP_DIR}/uploads"
UPLOADS_MIRROR="${BACKUP_DIR}/uploads/mirror"
mkdir -p "${UPLOADS_MIRROR}"
chmod 700 "${UPLOADS_MIRROR}"

if [[ -d "${UPLOADS_DIR}" && -n "$(ls -A "${UPLOADS_DIR}" 2>/dev/null)" ]]; then
    # Синхронизация зеркала требует rsync для гарантии точной очистки удаленных файлов (--delete)
    if ! command -v rsync >/dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ОШИБКА: для корректного зеркалирования вложений требуется утилита rsync. Установите: apt-get install -y rsync" >&2
        exit 1
    fi
    rsync -a --delete "${UPLOADS_DIR}/" "${UPLOADS_MIRROR}/"

    DOW=$(date +%u)
    if [[ "${DOW}" -eq 7 ]]; then
        tar -czf "${BACKUP_DIR}/uploads/uploads_full_${DATE_TAG}.tar.gz" -C "${UPLOADS_MIRROR}" .
        chmod 600 "${BACKUP_DIR}/uploads/uploads_full_${DATE_TAG}.tar.gz"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Еженедельный полный архив вложений создан: uploads_full_${DATE_TAG}.tar.gz"
    else
        # Архивируем только файлы, измененные за последние 24 часа
        NEW_FILES=$(cd "${APP_DIR}" && find uploads/ -type f -mtime -1 2>/dev/null || true)
        if [[ -n "${NEW_FILES}" ]]; then
            tar -czf "${BACKUP_DIR}/uploads/uploads_incr_${DATE_TAG}.tar.gz" -C "${APP_DIR}" ${NEW_FILES}
            chmod 600 "${BACKUP_DIR}/uploads/uploads_incr_${DATE_TAG}.tar.gz"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ежедневный инкрементальный архив новых файлов создан: uploads_incr_${DATE_TAG}.tar.gz"
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Новых вложений за 24ч не обнаружено (зеркало актуализировано)."
        fi
    fi
fi

# 3. Ротация устаревших копий (удаление архивов старше $RETENTION_DAYS дней)
find "${BACKUP_DIR}/leads" -type f -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}/uploads" -name "*.tar.gz" -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ротация завершена: архивы старше ${RETENTION_DAYS} дней удалены."
