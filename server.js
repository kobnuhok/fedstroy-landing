// Express API сервер ООО «ФЕДСТРОЙ»: маршруты заявок, recovery sweep и композиция модулей.

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const storage = require('./lib/storage');
const validation = require('./lib/validation');
const notifications = require('./lib/notifications');

let vercelWaitUntil = null;
try {
  vercelWaitUntil = require('@vercel/functions').waitUntil;
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 8080;

storage.initStorage();
storage.startEmergencyFlushInterval();

app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || validation.ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin))) {
      return cb(null, true);
    }
    return cb(null, false);
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function unlinkSafe(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function cleanupFileIfNoLongerNeeded(lead, filePath) {
  if (!filePath || storage.shouldKeepUploadedFiles()) return;
  const pendingPatch = lead?.leadId ? storage.getUnpersistedNotificationPatch(lead.leadId) : null;
  const currentNotif = pendingPatch ? { ...(lead?.notifications || {}), ...pendingPatch } : (lead?.notifications || {});
  const tgRetryable = notifications.shouldRetryTelegram(currentNotif);
  const emRetryable = notifications.shouldRetryEmail(currentNotif);
  const needsFile = emRetryable || (tgRetryable && currentNotif?.telegramDocSent !== true);
  if (!needsFile) {
    unlinkSafe(filePath);
  }
}

function buildNotificationPatch(tgRes, emRes, claimToken) {
  const tgStatus = tgRes?.fullyDelivered ? 'sent' : ((tgRes?.messageSent || tgRes?.messageSkipped) ? 'partial' : 'failed');
  const emStatus = emRes?.sent ? 'sent' : 'failed';
  return {
    telegram: tgStatus,
    email: emStatus,
    incTelegramAttempt: true,
    incEmailAttempt: true,
    claim: null,
    expectedClaimToken: claimToken,
    ...(tgRes?.messageId ? { telegramMessageId: tgRes.messageId } : {}),
    ...(tgRes?.documentSent !== null && tgRes?.documentSent !== undefined ? { telegramDocSent: tgRes.documentSent } : {}),
    ...(emRes?.messageId ? { emailMessageId: emRes.messageId } : {}),
    ...(tgRes?.documentError ? { telegramDocError: tgRes.documentError } : {}),
    ...(tgRes?.fileMissing ? { fileMissing: true } : {}),
    ...(emRes?.error ? { emailError: emRes.error } : {})
  };
}

function persistNotificationResult(leadId, patch, updateStatusFn = storage.updateLeadNotificationStatus) {
  const saved = updateStatusFn(leadId, patch);
  if (!saved) {
    if (updateStatusFn.lastFailureReason === 'fenced') {
      console.warn(`[lead:notification-state:fenced] Заявка ${leadId} перехвачена другим воркером (fencing mismatch), отложенная синхронизация отменена.`);
    } else {
      console.error(`[lead:notification-state:fatal] Не удалось сохранить статус уведомлений для заявки ${leadId}! Постановка в буфер отложенной синхронизации.`);
      storage.enqueueUnpersistedNotificationPatch(leadId, patch);
    }
  }
  return saved;
}

app.get('/api/health', (req, res) => {
  const isTest = process.env.NODE_ENV === 'test';
  const { ok: storageOk, error: storageError } = storage.checkStorageHealth(isTest);

  res.status(storageOk ? 200 : 503).json({
    status: storageOk ? 'ok' : 'degraded',
    service: 'ООО «ФЕДСТРОЙ» API',
    storage: {
      ok: storageOk,
      ...(isTest && storageError ? { error: storageError } : {})
    },
    ...(isTest ? {
      notifications: {
        telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        emailRecipient: notifications.EMAIL_TO,
        smtpConfigured: !!(notifications.SMTP_USER && notifications.SMTP_PASS)
      }
    } : {}),
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.all(['/api/internal/retry', '/api/internal/recovery'], async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_RECOVERY_TOKEN;
  if (!cronSecret) {
    if (process.env.NODE_ENV !== 'test') {
      return res.status(503).json({ error: 'Recovery endpoint is not configured (CRON_SECRET missing)' });
    }
  } else if ((req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized: invalid recovery secret' });
  }

  const runtime = storage.isVercel ? 'vercel-serverless-ephemeral' : 'persistent-vps';
  const result = await retryPendingNotifications(true);
  if (!result || result.success === false) {
    return res.status(500).json({
      error: 'Recovery failed',
      details: result?.error || 'System error during recovery',
      processed: result?.processed || 0,
      runtime,
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    processed: result.processed || 0,
    totalBatch: result.totalBatch || 0,
    unprocessed: result.unprocessed !== undefined ? result.unprocessed : 0,
    remaining: result.remaining || 0,
    runtime,
    timestamp: new Date().toISOString()
  });
});

function handleMulterUpload(req, res, next) {
  validation.upload.single('attachment')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const codeMessages = {
        LIMIT_FILE_SIZE: 'Размер файла превышает лимит (35 МБ). Пожалуйста, оптимизируйте чертежи или отправьте ссылку на облачное хранилище.',
        LIMIT_FIELD_VALUE: 'Превышен максимальный размер текстового поля формы (16 КБ).',
        LIMIT_FIELD_COUNT: 'Превышено максимальное количество полей формы.'
      };
      return res.status(400).json({
        success: false,
        error: codeMessages[err.code] || `Ошибка загрузки файла: ${err.message}`
      });
    }
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}

app.post('/api/lead', validation.leadRateLimiter, handleMulterUpload, async (req, res) => {
  let attachedFile = req.file || null;
  let leadRecord = null;

  try {
    const validationError = validation.validateLeadPayload(req.body);
    if (validationError) {
      unlinkSafe(attachedFile?.path);
      return res.status(400).json({ success: false, error: validationError });
    }

    if (attachedFile) {
      const origName = attachedFile.originalname || '';
      if (!origName || (origName === 'blob' && attachedFile.size === 0)) {
        unlinkSafe(attachedFile.path);
        attachedFile = null;
      } else if (attachedFile.size === 0) {
        unlinkSafe(attachedFile.path);
        return res.status(400).json({
          success: false,
          error: 'Прикрепленный файл пуст (0 байт). Пожалуйста, выберите корректный файл проекта.'
        });
      } else {
        const fileCheck = validation.validateFileContent(attachedFile.path, attachedFile.originalname);
        if (!fileCheck.valid) {
          unlinkSafe(attachedFile.path);
          return res.status(400).json({ success: false, error: fileCheck.error });
        }
      }
    }

    const { name, phone, service, area, building, comment, source } = req.body;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const leadId = `ФС-${dateStr}-${crypto.randomBytes(4).toString('hex')}`;
    const initialClaimToken = crypto.randomBytes(4).toString('hex');

    leadRecord = {
      leadId,
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      service: (service || '').trim(),
      area: (area || '').trim(),
      building: (building || '').trim(),
      comment: (comment || '').trim(),
      source: (source || 'Форма на сайте').trim(),
      createdAt: new Date().toISOString(),
      notifications: {
        telegram: 'pending',
        email: 'pending',
        attempts: { telegram: 0, email: 0 },
        claim: {
          token: initialClaimToken,
          expiresAt: Date.now() + storage.NOTIFICATION_CLAIM_TIMEOUT_MS
        },
        updatedAt: new Date().toISOString()
      },
      file: attachedFile ? {
        originalName: Buffer.from(attachedFile.originalname, 'latin1').toString('utf8'),
        filename: attachedFile.filename,
        size: attachedFile.size
      } : null
    };

    storage.activeNotificationLeadIds.add(leadRecord.leadId);
    storage.saveLead(leadRecord);

    const fileAttachment = attachedFile ? {
      originalName: leadRecord.file.originalName,
      filename: attachedFile.filename,
      size: attachedFile.size,
      path: attachedFile.path
    } : null;

    const responsePayload = {
      success: true,
      leadId,
      message: 'Заявка зарегистрирована. Мы свяжемся с вами в рабочее время.'
    };

    if (process.env.NODE_ENV === 'test') {
      try {
        const [telegramResult, emailResult] = await notifications.runWithNotificationQueue(() => Promise.all([
          notifications.sendToTelegram(leadRecord, fileAttachment),
          notifications.sendToEmail(leadRecord, fileAttachment)
        ]));
        persistNotificationResult(leadRecord.leadId, buildNotificationPatch(telegramResult, emailResult, initialClaimToken));
        responsePayload.telegram = telegramResult;
        responsePayload.email = emailResult;
        return res.status(200).json(responsePayload);
      } finally {
        storage.activeNotificationLeadIds.delete(leadRecord.leadId);
      }
    }

    const dispatchAsync = () => notifications.runWithNotificationQueue(() => Promise.allSettled([
      notifications.sendToTelegram(leadRecord, fileAttachment),
      notifications.sendToEmail(leadRecord, fileAttachment)
    ])).then(([tgSettled, emSettled]) => {
      const tgRes = tgSettled.status === 'fulfilled' ? tgSettled.value : { fullyDelivered: false, messageSent: false, error: tgSettled.reason?.message };
      const emRes = emSettled.status === 'fulfilled' ? emSettled.value : { sent: false, error: emSettled.reason?.message };
      persistNotificationResult(leadRecord.leadId, buildNotificationPatch(tgRes, emRes, initialClaimToken));
      if (tgRes && !tgRes.sent && !tgRes.fullyDelivered) console.warn('[lead:notify:telegram:warn]', tgRes.error || tgRes.reason);
      if (emRes && !emRes.sent) console.warn('[lead:notify:email:warn]', emRes.error || emRes.reason);
    }).catch(err => {
      if (err.code === 'QUEUE_OVERFLOW') {
        console.warn(`[lead:notify:backpressure] Очередь уведомлений переполнена (${notifications.MAX_NOTIFICATION_QUEUE}). Заявка ${leadRecord.leadId} зарегистрирована в leads.json со статусом pending и будет обработана через retry.`);
        storage.updateLeadNotificationStatus(leadRecord.leadId, { claim: null, expectedClaimToken: initialClaimToken });
      } else {
        console.error('[lead:notify:background:error]', err.message);
      }
    }).finally(() => {
      storage.activeNotificationLeadIds.delete(leadRecord.leadId);
      cleanupFileIfNoLongerNeeded(leadRecord, attachedFile?.path);
    });

    if (storage.isVercel) {
      const notifyPromise = dispatchAsync();
      if (typeof vercelWaitUntil === 'function') {
        vercelWaitUntil(notifyPromise);
        return res.status(200).json(responsePayload);
      }
      await Promise.race([notifyPromise, new Promise(resolve => setTimeout(() => resolve('timeout'), 10000))]);
      return res.status(200).json(responsePayload);
    }

    res.status(200).json(responsePayload);
    dispatchAsync();
  } catch (err) {
    if (leadRecord?.leadId) {
      storage.activeNotificationLeadIds.delete(leadRecord.leadId);
    }
    if (!storage.shouldKeepUploadedFiles()) {
      unlinkSafe(attachedFile?.path);
    }
    console.error('[lead:process:error]', err);
    return res.status(500).json({
      success: false,
      error: 'Произошла ошибка при обработке заявки на сервере. Пожалуйста, позвоните нам по номеру 8 (800) 700-02-23.'
    });
  } finally {
    if (process.env.NODE_ENV === 'test') {
      cleanupFileIfNoLongerNeeded(leadRecord, attachedFile?.path);
    }
  }
});

const ALLOWED_ROOT_FILES = new Set([
  'index.html',
  'app.js',
  'privacy.html',
  'consent.html',
  'requisites.html',
  'robots.txt',
  'favicon.ico'
]);

app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.get('/:file', (req, res, next) => {
  if (ALLOWED_ROOT_FILES.has(req.params.file)) {
    return res.sendFile(req.params.file, { root: __dirname });
  }
  next();
});

app.use((req, res) => {
  res.status(404).send('Not Found');
});

let isRecoveryRunning = false;
const DEFAULT_RECOVERY_BATCH_SIZE = 20;
const MIN_RECOVERY_BATCH_SIZE = 1;
const MAX_RECOVERY_BATCH_SIZE = 100;

function getRecoveryBatchSize() {
  const envVal = process.env.RECOVERY_BATCH_SIZE;
  if (envVal !== undefined && envVal !== null && String(envVal).trim() !== '') {
    const parsed = Number(envVal);
    if (Number.isInteger(parsed) && parsed >= MIN_RECOVERY_BATCH_SIZE && parsed <= MAX_RECOVERY_BATCH_SIZE) {
      return parsed;
    }
  }
  return DEFAULT_RECOVERY_BATCH_SIZE;
}

async function retryPendingNotifications(force = false) {
  if ((!force && process.env.NODE_ENV === 'test' && !process.env.TEST_ENABLE_STARTUP_RETRY) || (!force && storage.isVercel)) {
    return { success: true, skipped: true, reason: 'startup retry disabled' };
  }
  if (!fs.existsSync(storage.DATA_FILE)) {
    return { success: true, processed: 0, totalBatch: 0, unprocessed: 0, remaining: 0 };
  }
  if (isRecoveryRunning) {
    console.log('[notify:recovery] Пропуск: recovery sweep уже выполняется.');
    return { success: true, skipped: true, reason: 'recovery sweep already running' };
  }
  isRecoveryRunning = true;

  let processedCount = 0;
  let totalBatchCount = 0;
  let unprocessedCount = 0;
  let batchUnresolvedRetryableCount = 0;

  storage.flushUnpersistedNotificationPatches();

  try {
    const content = fs.readFileSync(storage.DATA_FILE, 'utf8').trim();
    if (!content) {
      return { success: true, processed: 0, totalBatch: 0, unprocessed: 0, remaining: 0 };
    }
    const leads = JSON.parse(content);
    if (!Array.isArray(leads)) {
      throw new Error('leads.json is not a valid JSON array');
    }

    const emergencyPatchesCache = storage.loadEmergencyPatches();
    const allRetryableLeads = leads.filter(l => {
      if (storage.activeNotificationLeadIds.has(l.leadId)) return false;
      const pendingPatch = storage.getUnpersistedNotificationPatch(l.leadId, emergencyPatchesCache);
      const effectiveNotif = pendingPatch ? { ...l.notifications, ...pendingPatch } : l.notifications;
      if (storage.isNotificationClaimActive(effectiveNotif)) return false;
      return notifications.shouldRetryTelegram(effectiveNotif) || notifications.shouldRetryEmail(effectiveNotif);
    });

    const totalRetryable = allRetryableLeads.length;
    const retryableLeads = allRetryableLeads.slice(0, getRecoveryBatchSize());
    totalBatchCount = retryableLeads.length;
    unprocessedCount = Math.max(0, totalRetryable - totalBatchCount);

    if (retryableLeads.length > 0) {
      console.log(`[notify:recovery] Найдено ${totalRetryable} заявок, обрабатываем пачку из ${totalBatchCount} (не вошло в пачку: ${unprocessedCount}).`);
      const updateStatusFn = app.updateLeadNotificationStatus || storage.updateLeadNotificationStatus;
      const sendTgFn = app.sendToTelegram || notifications.sendToTelegram;
      const sendEmFn = app.sendToEmail || notifications.sendToEmail;

      for (const lead of retryableLeads) {
        if (storage.activeNotificationLeadIds.has(lead.leadId)) {
          batchUnresolvedRetryableCount++;
          continue;
        }
        const pendingPatchBefore = storage.getUnpersistedNotificationPatch(lead.leadId, emergencyPatchesCache);
        const currentNotifBefore = pendingPatchBefore ? { ...lead.notifications, ...pendingPatchBefore } : (lead.notifications || {});
        if (storage.isNotificationClaimActive(currentNotifBefore)) {
          batchUnresolvedRetryableCount++;
          continue;
        }

        storage.activeNotificationLeadIds.add(lead.leadId);
        const claimToken = crypto.randomBytes(4).toString('hex');
        const claimed = updateStatusFn(lead.leadId, {
          claim: { token: claimToken, expiresAt: Date.now() + storage.NOTIFICATION_CLAIM_TIMEOUT_MS }
        });
        if (!claimed) {
          console.warn(`[notify:recovery] Не удалось подтвердить lease claim в storage для заявки ${lead.leadId}, пропуск.`);
          storage.activeNotificationLeadIds.delete(lead.leadId);
          batchUnresolvedRetryableCount++;
          continue;
        }

        try {
          await notifications.runWithNotificationQueue(async () => {
            const pendingPatch = storage.getUnpersistedNotificationPatch(lead.leadId, emergencyPatchesCache);
            const effectiveNotif = pendingPatch ? { ...lead.notifications, ...pendingPatch } : (lead.notifications || {});
            const effectiveLead = { ...lead, notifications: effectiveNotif };

            let fileAttachment = null;
            let fileMissing = false;
            if (effectiveLead.file) {
              const filePath = effectiveLead.file.filename ? path.join(storage.UPLOADS_DIR, effectiveLead.file.filename) : null;
              if (filePath && fs.existsSync(filePath)) {
                fileAttachment = {
                  originalName: effectiveLead.file.originalName,
                  filename: effectiveLead.file.filename,
                  size: effectiveLead.file.size,
                  path: filePath
                };
              } else {
                fileMissing = true;
              }
            }

            const doRetryTelegram = notifications.shouldRetryTelegram(effectiveNotif);
            const doRetryEmail = notifications.shouldRetryEmail(effectiveNotif);
            let skipTelegramSend = false;

            if (doRetryTelegram && effectiveNotif.telegram === 'partial' && fileMissing) {
              skipTelegramSend = true;
              persistNotificationResult(effectiveLead.leadId, {
                telegram: 'partial',
                telegramDocError: 'Вложение отсутствует на диске сервера, повтор отменен',
                fileMissing: true,
                incTelegramAttempt: true,
                expectedClaimToken: claimToken
              }, updateStatusFn);
            }

            const isPartialWithText = effectiveNotif.telegram === 'partial' && !!effectiveNotif.telegramMessageId;
            const [tgSettled, emSettled] = await Promise.allSettled([
              (doRetryTelegram && !skipTelegramSend) ? sendTgFn(effectiveLead, fileAttachment, { onlyDocument: isPartialWithText }) : Promise.resolve(null),
              doRetryEmail ? sendEmFn(effectiveLead, fileAttachment) : Promise.resolve(null)
            ]);

            const patch = { claim: null, expectedClaimToken: claimToken };
            if (tgSettled.status === 'fulfilled' && tgSettled.value) {
              const tgVal = tgSettled.value;
              patch.telegram = tgVal.fullyDelivered ? 'sent' : ((tgVal.messageSent || tgVal.messageSkipped) ? 'partial' : 'failed');
              patch.incTelegramAttempt = true;
              if (tgVal.messageId) patch.telegramMessageId = tgVal.messageId;
              if (tgVal.documentSent !== null && tgVal.documentSent !== undefined) patch.telegramDocSent = tgVal.documentSent;
              if (tgVal.documentError) patch.telegramDocError = tgVal.documentError;
              if (tgVal.fileMissing) patch.fileMissing = true;
            } else if (tgSettled.status === 'rejected') {
              patch.telegram = 'failed';
              patch.incTelegramAttempt = true;
              patch.telegramDocError = tgSettled.reason?.message || 'Неизвестная ошибка Telegram';
            }

            if (emSettled.status === 'fulfilled' && emSettled.value) {
              const emVal = emSettled.value;
              patch.email = emVal.sent ? 'sent' : 'failed';
              patch.incEmailAttempt = true;
              if (emVal.messageId) patch.emailMessageId = emVal.messageId;
              if (emVal.error) patch.emailError = emVal.error;
              if (fileMissing) patch.fileMissing = true;
            } else if (emSettled.status === 'rejected') {
              patch.email = 'failed';
              patch.incEmailAttempt = true;
              patch.emailError = emSettled.reason?.message || 'Неизвестная ошибка Email';
            }

            if (persistNotificationResult(effectiveLead.leadId, patch, updateStatusFn)) {
              effectiveLead.notifications = { ...effectiveLead.notifications, ...patch };
            }

            const currentPending = storage.getUnpersistedNotificationPatch(effectiveLead.leadId);
            const finalNotif = currentPending ? { ...effectiveLead.notifications, ...currentPending } : effectiveLead.notifications;
            if (notifications.shouldRetryTelegram(finalNotif) || notifications.shouldRetryEmail(finalNotif)) {
              batchUnresolvedRetryableCount++;
            }
            cleanupFileIfNoLongerNeeded(effectiveLead, fileAttachment?.path);
            processedCount++;
          });
        } catch (leadErr) {
          console.error(`[notify:recovery:lead-fail] Сбой при обработке заявки ${lead.leadId}:`, leadErr.message);
          updateStatusFn(lead.leadId, { claim: null, expectedClaimToken: claimToken });
          batchUnresolvedRetryableCount++;
        } finally {
          storage.activeNotificationLeadIds.delete(lead.leadId);
        }
      }
      console.log(`[notify:recovery] Повторная отправка пачки завершена (обработано: ${processedCount}).`);
    }

    return {
      success: true,
      processed: processedCount,
      totalBatch: totalBatchCount,
      unprocessed: unprocessedCount,
      remaining: unprocessedCount + batchUnresolvedRetryableCount
    };
  } catch (err) {
    console.error('[notify:recovery:error] Ошибка при повторной отправке заявок:', err.message);
    return {
      success: false,
      error: err.message,
      processed: processedCount,
      totalBatch: totalBatchCount,
      unprocessed: unprocessedCount,
      remaining: unprocessedCount + batchUnresolvedRetryableCount
    };
  } finally {
    isRecoveryRunning = false;
  }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[ООО «ФЕДСТРОЙ»] Сервер запущен: http://localhost:${PORT}`);
    retryPendingNotifications().catch(e => console.error('[notify:recovery:fatal]', e.message));
  });
}

app.retryPendingNotifications = retryPendingNotifications;
app.shouldRetryTelegram = notifications.shouldRetryTelegram;
app.shouldRetryEmail = notifications.shouldRetryEmail;
app.MAX_NOTIFICATION_ATTEMPTS = notifications.MAX_NOTIFICATION_ATTEMPTS;
app.runWithNotificationQueue = notifications.runWithNotificationQueue;
app.MAX_CONCURRENT_NOTIFICATIONS = notifications.MAX_CONCURRENT_NOTIFICATIONS;
app.MAX_NOTIFICATION_QUEUE = notifications.MAX_NOTIFICATION_QUEUE;
app.updateLeadNotificationStatus = storage.updateLeadNotificationStatus;
app.sendToTelegram = notifications.sendToTelegram;
app.sendToEmail = notifications.sendToEmail;
app.requestTelegram = notifications.requestTelegram;
app.TELEGRAM_REQUEST_TIMEOUT_MS = notifications.TELEGRAM_REQUEST_TIMEOUT_MS;
app.unpersistedNotificationPatches = storage.unpersistedNotificationPatches;
app.getUnpersistedNotificationPatch = storage.getUnpersistedNotificationPatch;
app.activeRecoveryLeadIds = storage.activeRecoveryLeadIds;
app.activeNotificationLeadIds = storage.activeNotificationLeadIds;
app.isNotificationClaimActive = storage.isNotificationClaimActive;
app.NOTIFICATION_CLAIM_TIMEOUT_MS = storage.NOTIFICATION_CLAIM_TIMEOUT_MS;
app.enqueueUnpersistedNotificationPatch = storage.enqueueUnpersistedNotificationPatch;
app.flushUnpersistedNotificationPatches = storage.flushUnpersistedNotificationPatches;
app.loadEmergencyPatches = storage.loadEmergencyPatches;
app.writeEmergencyFileAtomic = storage.writeEmergencyFileAtomic;
Object.defineProperty(app, 'MAX_RECOVERY_BATCH', {
  get: () => getRecoveryBatchSize(),
  enumerable: true,
  configurable: true
});
app.getRecoveryBatchSize = getRecoveryBatchSize;
app.isEmergencyFileUnreadable = storage.isEmergencyFileUnreadable;
app.ALLOWED_ORIGIN_PATTERNS = validation.ALLOWED_ORIGIN_PATTERNS;
app.validateFileContent = validation.validateFileContent;

module.exports = app;
