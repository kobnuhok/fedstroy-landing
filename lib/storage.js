// Persistence layer for leads.json, claim leases, fencing tokens, and emergency patches.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isVercel = !!process.env.VERCEL;
const ROOT_DIR = path.resolve(__dirname, '..');

const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : (isVercel ? path.join('/tmp', 'uploads') : path.join(ROOT_DIR, 'uploads'));

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : (isVercel ? path.join('/tmp', 'data') : path.join(ROOT_DIR, 'data'));

const DATA_FILE = path.join(DATA_DIR, 'leads.json');
const shouldKeepUploadedFiles = () => process.env.KEEP_UPLOADED_FILES === 'true';

const NOTIFICATION_CLAIM_TIMEOUT_MS = 60000;
const MAX_UNPERSISTED_PATCHES = 1000;
const EMERGENCY_PATCHES_FILE = () => path.join(DATA_DIR, 'unpersisted_patches_emergency.json');

const unpersistedNotificationPatches = new Map();
const activeNotificationLeadIds = new Set();
const activeRecoveryLeadIds = activeNotificationLeadIds;

let emergencyFileUnreadable = false;
let cachedStorageHealth = { timestamp: 0, ok: true, error: null };
const STORAGE_HEALTH_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 5000;

function initStorage() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    console.error('[storage:init:fatal] Ошибка инициализации файлового хранилища:', err.message);
    if (!isVercel && process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

function writeEmergencyFileAtomic(emergencyFile, data) {
  const content = JSON.stringify(data, null, 2);
  const tmpFile = `${emergencyFile}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, emergencyFile);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    throw err;
  }
}

function loadEmergencyPatches() {
  const emergencyFile = EMERGENCY_PATCHES_FILE();
  if (!fs.existsSync(emergencyFile)) {
    emergencyFileUnreadable = false;
    return {};
  }
  try {
    const raw = fs.readFileSync(emergencyFile, 'utf8').trim();
    if (!raw) {
      emergencyFileUnreadable = false;
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      emergencyFileUnreadable = false;
      return parsed;
    }
    throw new Error('Некорректная структура JSON: ожидался объект');
  } catch (err) {
    const corruptFile = `${emergencyFile}.corrupt.${Date.now()}`;
    console.error(`[lead:emergency:corrupt] Аварийный файл ${emergencyFile} поврежден (${err.message}). Переименование в ${corruptFile} для сохранения данных и ручного анализа.`);
    try {
      fs.renameSync(emergencyFile, corruptFile);
      emergencyFileUnreadable = false;
    } catch (renameErr) {
      emergencyFileUnreadable = true;
      console.error(`[lead:emergency:corrupt-rename-fail] Не удалось переименовать поврежденный файл: ${renameErr.message}`);
    }
    return {};
  }
}

function getUnpersistedNotificationPatch(leadId, emergencyCache = null) {
  if (unpersistedNotificationPatches.has(leadId)) {
    return unpersistedNotificationPatches.get(leadId);
  }
  const emergencyData = emergencyCache || loadEmergencyPatches();
  return (emergencyData && emergencyData[leadId]) || null;
}

function enqueueUnpersistedNotificationPatch(leadId, patch) {
  if (unpersistedNotificationPatches.size >= MAX_UNPERSISTED_PATCHES && !unpersistedNotificationPatches.has(leadId)) {
    console.error(`[lead:unpersisted-patches:emergency] Достигнут лимит буфера (${MAX_UNPERSISTED_PATCHES}). Аварийная запись во внешний fallback-файл.`);
    try {
      const emergencyFile = EMERGENCY_PATCHES_FILE();
      const existingEmergency = loadEmergencyPatches();
      existingEmergency[leadId] = { ...(existingEmergency[leadId] || {}), ...patch };
      writeEmergencyFileAtomic(emergencyFile, existingEmergency);
      return;
    } catch (eErr) {
      console.error('[lead:unpersisted-patches:fatal-disk]', eErr.message);
      const oldestKey = unpersistedNotificationPatches.keys().next().value;
      if (oldestKey) {
        console.warn(`[lead:unpersisted-patches:evict] Вытеснение старейшей записи ${oldestKey} для сохранения статуса ${leadId}`);
        unpersistedNotificationPatches.delete(oldestKey);
      }
    }
  }
  const existing = unpersistedNotificationPatches.get(leadId) || {};
  unpersistedNotificationPatches.set(leadId, { ...existing, ...patch });
}

function flushUnpersistedNotificationPatches() {
  const emergencyFile = EMERGENCY_PATCHES_FILE();
  const emergencyData = loadEmergencyPatches();

  const allLeadIds = new Set([
    ...unpersistedNotificationPatches.keys(),
    ...Object.keys(emergencyData)
  ]);

  if (allLeadIds.size === 0) {
    if (fs.existsSync(emergencyFile) && !emergencyFileUnreadable) {
      try { fs.unlinkSync(emergencyFile); } catch (_) {}
    }
    return !emergencyFileUnreadable;
  }

  let allSaved = true;
  for (const leadId of allLeadIds) {
    const patch = {
      ...(emergencyData[leadId] || {}),
      ...(unpersistedNotificationPatches.get(leadId) || {})
    };
    const ok = updateLeadNotificationStatus(leadId, patch, 2);
    if (ok) {
      unpersistedNotificationPatches.delete(leadId);
      delete emergencyData[leadId];
      console.log(`[lead:notification-state:recovered] Статус заявки ${leadId} успешно синхронизирован с диском`);
    } else {
      allSaved = false;
    }
  }

  if (Object.keys(emergencyData).length > 0) {
    try {
      writeEmergencyFileAtomic(emergencyFile, emergencyData);
    } catch (_) {}
  } else if (fs.existsSync(emergencyFile) && allSaved && !emergencyFileUnreadable) {
    try { fs.unlinkSync(emergencyFile); } catch (_) {}
  }

  return allSaved && !emergencyFileUnreadable;
}

function startEmergencyFlushInterval() {
  if (process.env.NODE_ENV !== 'test') {
    setInterval(() => {
      if (unpersistedNotificationPatches.size > 0) {
        flushUnpersistedNotificationPatches();
      }
    }, 5000).unref();
  }
}

function checkStorageHealth(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && (now - cachedStorageHealth.timestamp < STORAGE_HEALTH_TTL_MS)) {
    return cachedStorageHealth;
  }

  let ok = true;
  let error = null;
  try {
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
    if (!fs.existsSync(DATA_FILE)) {
      ok = false;
      error = 'leads.json missing';
    } else {
      const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
      if (!content) {
        ok = false;
        error = 'leads.json corrupted: empty file';
      } else {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          ok = false;
          error = 'leads.json must contain a JSON array';
        }
      }
    }
  } catch (err) {
    ok = false;
    error = err.message;
  }

  cachedStorageHealth = { timestamp: now, ok, error };
  return cachedStorageHealth;
}

function saveLead(newLead) {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error('leads.json missing');
  }
  const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
  if (!content) {
    throw new Error('leads.json corrupted: empty file');
  }
  const leads = JSON.parse(content);
  if (!Array.isArray(leads)) {
    throw new Error('leads.json corrupted: expected JSON array');
  }

  leads.unshift(newLead);
  const tempFile = `${DATA_FILE}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2), 'utf8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }
    throw err;
  }

  cachedStorageHealth = { timestamp: Date.now(), ok: true, error: null };
  return true;
}

function isNotificationClaimActive(notif) {
  if (!notif || !notif.claim) return false;
  const expiresAt = notif.claim.expiresAt;
  return typeof expiresAt === 'number' && expiresAt > Date.now();
}

function updateLeadNotificationStatus(leadId, patch, maxRetries = 3) {
  updateLeadNotificationStatus.lastFailureReason = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let tempFile = null;
    try {
      if (!fs.existsSync(DATA_FILE)) {
        updateLeadNotificationStatus.lastFailureReason = 'not_found';
        return false;
      }
      const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
      if (!content) {
        updateLeadNotificationStatus.lastFailureReason = 'empty';
        return false;
      }
      const leads = JSON.parse(content);
      if (!Array.isArray(leads)) {
        updateLeadNotificationStatus.lastFailureReason = 'invalid_json';
        return false;
      }
      const lead = leads.find(l => l.leadId === leadId);
      if (!lead) {
        updateLeadNotificationStatus.lastFailureReason = 'lead_not_found';
        return false;
      }

      const prevNotif = lead.notifications || {};

      if (patch.expectedClaimToken !== undefined) {
        const currentClaim = prevNotif.claim;
        const currentClaimToken = currentClaim?.token;
        const isClaimExpired = currentClaim?.expiresAt !== undefined && Number(currentClaim.expiresAt) <= Date.now();

        if (!currentClaimToken || isClaimExpired || currentClaimToken !== patch.expectedClaimToken) {
          console.warn(`[lead:claim:fenced] Заявка ${leadId}: отказ в обновлении статуса. Токен claim недействителен (актуальный: ${currentClaimToken || 'нет'}, истек: ${Boolean(isClaimExpired)}, ожидался: ${patch.expectedClaimToken})`);
          updateLeadNotificationStatus.lastFailureReason = 'fenced';
          return false;
        }
      }

      const prevAttempts = prevNotif.attempts || {
        telegram: (prevNotif.telegram && prevNotif.telegram !== 'pending') ? 1 : 0,
        email: (prevNotif.email && prevNotif.email !== 'pending') ? 1 : 0
      };

      const newAttempts = {
        telegram: patch.incTelegramAttempt ? (prevAttempts.telegram + 1) : (patch.telegramAttempts ?? prevAttempts.telegram),
        email: patch.incEmailAttempt ? (prevAttempts.email + 1) : (patch.emailAttempts ?? prevAttempts.email)
      };

      const cleanPatch = { ...patch };
      delete cleanPatch.incTelegramAttempt;
      delete cleanPatch.incEmailAttempt;
      delete cleanPatch.telegramAttempts;
      delete cleanPatch.emailAttempts;
      delete cleanPatch.expectedClaimToken;

      lead.notifications = {
        ...prevNotif,
        ...cleanPatch,
        attempts: newAttempts,
        updatedAt: new Date().toISOString()
      };

      if (lead.notifications.telegram === 'sent') {
        delete lead.notifications.telegramDocError;
        delete lead.notifications.fileMissing;
      }
      if (lead.notifications.email === 'sent') {
        delete lead.notifications.emailError;
      }
      if (cleanPatch.claim === null) {
        delete lead.notifications.claim;
      }

      tempFile = `${DATA_FILE}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2), 'utf8');
      fs.renameSync(tempFile, DATA_FILE);
      return true;
    } catch (err) {
      if (tempFile && fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch (_) {}
      }
      if (attempt === maxRetries) {
        console.error(`[lead:status:fatal] Не удалось обновить статус заявки ${leadId} после ${maxRetries} попыток:`, err.message);
        updateLeadNotificationStatus.lastFailureReason = 'io_error';
        return false;
      }
    }
  }
  updateLeadNotificationStatus.lastFailureReason = 'io_error';
  return false;
}

module.exports = {
  isVercel,
  UPLOADS_DIR,
  DATA_DIR,
  DATA_FILE,
  shouldKeepUploadedFiles,
  NOTIFICATION_CLAIM_TIMEOUT_MS,
  unpersistedNotificationPatches,
  activeNotificationLeadIds,
  activeRecoveryLeadIds,
  initStorage,
  writeEmergencyFileAtomic,
  loadEmergencyPatches,
  getUnpersistedNotificationPatch,
  enqueueUnpersistedNotificationPatch,
  flushUnpersistedNotificationPatches,
  startEmergencyFlushInterval,
  checkStorageHealth,
  saveLead,
  isNotificationClaimActive,
  updateLeadNotificationStatus,
  isEmergencyFileUnreadable: () => emergencyFileUnreadable
};
