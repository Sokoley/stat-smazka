const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getCredentials } = require('../services/ozon');
const db = require('../db/database');

const router = express.Router();
const OZON_API_URL = 'https://api-seller.ozon.ru';

function getMonthKey(year, month) {
  return String(year) + '-' + String(month).padStart(2, '0');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createPostingsReport(credentials, fromIso, toIso) {
  const response = await fetch(`${OZON_API_URL}/v1/report/postings/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': credentials.clientId,
      'Api-Key': credentials.apiKey,
    },
    body: JSON.stringify({
      filter: {
        processed_at_from: fromIso,
        processed_at_to: toIso,
        delivery_schema: ['fbo'],
      },
      language: 'DEFAULT',
      with: {
        additional_data: false,
        analytics_data: false,
        customer_data: false,
        jewelry_codes: false,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.result || !data.result.code) {
    throw new Error(data.message || data.error || 'Не удалось создать отчёт продаж OZON');
  }
  return data.result.code;
}

async function waitForReportReady(credentials, code, timeoutMs = 10 * 60 * 1000, intervalMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${OZON_API_URL}/v1/report/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': credentials.clientId,
        'Api-Key': credentials.apiKey,
      },
      body: JSON.stringify({ code }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || 'Ошибка при проверке статуса отчёта OZON');
    }

    const result = data.result || {};
    if (result.status === 'success' && result.file) {
      return result.file;
    }
    if (result.status === 'failed' || result.status === 'cancelled') {
      throw new Error('Отчёт OZON завершился с ошибкой.');
    }

    await delay(intervalMs);
  }

  throw new Error('Отчёт OZON не успел сформироваться. Попробуйте позже.');
}

// Продажи считаются по столбцу "Ваша цена". Акции — по столбцу "Акции".
const PRICE_COLUMN_NAMES = [
  'Ваша цена',
  'Оплачено покупателем',
  'Оплачено',
  'product_price',
  'price',
  'paid',
  'Сумма оплаты',
  'Сумма',
];

const PROMO_COLUMN_NAMES = [
  'Акции',
  'Акция',
  'promotions',
  'promotion',
  'promo',
  'actions',
  'action',
  'Акция / Промокод',
];

const PROCESSED_AT_COLUMN_NAMES = [
  'Принят в обработку',
  'processed_at',
  'date',
  'Дата',
];

function normalizeHeaderCell(h) {
  return (h || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function findColumnIndex(header, names) {
  const normalized = header.map(normalizeHeaderCell);
  for (const name of names) {
    const lower = name.toLowerCase();
    const idx = normalized.findIndex((h) => h === lower || h.includes(lower) || lower.includes(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

function detectDelimiter(firstLine) {
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

/**
 * Разбивает строку CSV по разделителю с учётом кавычек: содержимое в кавычках не режется по разделителю.
 * Так ячейка "Акция A, Акция B" остаётся одной колонкой.
 */
function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  const d = delimiter === ';' ? ';' : ',';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === d) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  result.push(current.trim());
  return result;
}

/** Нормализация названия акции для сравнения: trim + схлопнуть пробелы в один */
function normalizePromoTitle(s) {
  if (s == null || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ');
}

async function downloadAndAggregateReport(fileUrl, credentials) {
  const headers = {};
  if (credentials && credentials.clientId && credentials.apiKey) {
    headers['Client-Id'] = credentials.clientId;
    headers['Api-Key'] = credentials.apiKey;
  }
  const response = await fetch(fileUrl, { headers });
  if (!response.ok) {
    const status = response.status;
    let detail = '';
    try {
      const body = await response.text();
      if (body && body.length < 200) detail = ': ' + body;
    } catch (_) {}
    throw new Error(
      'Не удалось скачать файл отчёта OZON.' + (status ? ` HTTP ${status}` : '') + detail
    );
  }

  let text = await response.text();
  if (!text) {
    return new Map();
  }

  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return new Map();
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = parseCSVLine(lines[0], delimiter).map((h) => (h || '').trim().replace(/^["']|["']$/g, ''));
  const idxPrice = findColumnIndex(header, PRICE_COLUMN_NAMES);
  const idxActions = findColumnIndex(header, PROMO_COLUMN_NAMES);
  const idxProcessedAt = findColumnIndex(header, PROCESSED_AT_COLUMN_NAMES);

  if (idxPrice === -1 || idxActions === -1) {
    const found = [];
    if (idxPrice === -1) found.push('Ваша цена');
    if (idxActions === -1) found.push('акции');
    const headerPreview = header.slice(0, 20).join(' | ');
    throw new Error(
      'В отчёте OZON не найдены столбцы: ' +
        found.join(', ') +
        '. Заголовок отчёта: ' +
        (headerPreview.length > 80 ? headerPreview.slice(0, 80) + '…' : headerPreview)
    );
  }

  const sums = new Map();
  const details = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line, delimiter);
    const promoTitleRaw = cols[idxActions] || '';
    const priceRaw = cols[idxPrice] || '';
    const processedAtRaw = idxProcessedAt >= 0 ? (cols[idxProcessedAt] || '').trim().replace(/^["']|["']$/g, '') : '';

    let priceStr = (priceRaw || '').trim().replace(/^["']|["']$/g, '');
    if (!priceStr) continue;
    priceStr = priceStr.replace(/\s/g, '').replace(',', '.');
    const amount = parseFloat(priceStr);
    if (!Number.isFinite(amount)) continue;

    const rawTitle = promoTitleRaw.trim().replace(/^["']|["']$/g, '');
    const promoNames = rawTitle
      ? rawTitle.split(/[,;\n]+/).map((p) => normalizePromoTitle(p)).filter(Boolean)
      : [];
    if (promoNames.length === 0) continue;

    for (const promoTitle of promoNames) {
      const current = sums.get(promoTitle) || 0;
      sums.set(promoTitle, current + amount);
      details.push({ promo_title: promoTitle, processed_at: processedAtRaw || null, price: amount });
    }
  }

  return { sums, details };
}

/**
 * Extract YouTube video ID from various URL formats.
 * @param {string} url - YouTube URL (watch, youtu.be, embed)
 * @returns {string|null} Video ID or null
 */
function extractYouTubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  // youtu.be/VIDEO_ID
  const shortMatch = trimmed.match(/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\?|$)/);
  if (shortMatch) return shortMatch[1];
  // youtube.com/watch?v=VIDEO_ID or youtube.com/embed/VIDEO_ID
  const longMatch = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]{11})/);
  if (longMatch) return longMatch[1];
  // If it's already just an ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * GET /bloggers - Bloggers page with YouTube stats form
 */
router.get('/', requireAuth, (req, res) => {
  res.render('bloggers/index', {
    title: 'Блогеры',
  });
});

/**
 * GET /bloggers/api/ozon-promos - List OZON voucher promos (active and ended) for integration selector
 */
router.get('/api/ozon-promos', requireAuth, async (req, res) => {
  const credentials = getCredentials();
  if (!credentials) {
    return res.status(503).json({
      error: 'OZON API не настроен. Настройте учётные данные в разделе Интеграции.',
      actions: [],
    });
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Client-Id': credentials.clientId,
      'Api-Key': credentials.apiKey,
    };
    const baseBody = { action_type: ['VOUCHER_DISCOUNT'], limit: 100, offset: 0 };

    const [resActive, resEnded] = await Promise.all([
      fetch(`${OZON_API_URL}/v1/seller-actions/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...baseBody, status: ['ACTIVE'] }),
      }),
      fetch(`${OZON_API_URL}/v1/seller-actions/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...baseBody, status: ['ENDED'] }),
      }),
    ]);

    const dataActive = await resActive.json().catch(() => ({}));
    const dataEnded = await resEnded.json().catch(() => ({}));

    if (!resActive.ok) {
      return res.status(resActive.status).json({
        error: dataActive.message || dataActive.error || 'Ошибка при загрузке списка акций OZON',
        actions: [],
      });
    }

    const yearFilter = 2026;

    function yearFromIso(isoStr) {
      if (!isoStr || typeof isoStr !== 'string') return null;
      const y = parseInt(isoStr.slice(0, 4), 10);
      return Number.isFinite(y) ? y : null;
    }

    function actionMatchesYear(a) {
      const params = a.action_parameters;
      if (!params) return false;
      const startYear = yearFromIso(params.date_start);
      const endYear = yearFromIso(params.date_end);
      return startYear === yearFilter || endYear === yearFilter;
    }

    const byId = new Map();
    for (const a of dataActive.actions || []) {
      if (!actionMatchesYear(a)) continue;
      byId.set(a.action_id, { action_id: a.action_id, title: (a.action_parameters && a.action_parameters.title) || `Акция #${a.action_id}` });
    }
    if (resEnded.ok && Array.isArray(dataEnded.actions)) {
      for (const a of dataEnded.actions) {
        if (!actionMatchesYear(a)) continue;
        if (!byId.has(a.action_id)) {
          byId.set(a.action_id, { action_id: a.action_id, title: (a.action_parameters && a.action_parameters.title) || `Акция #${a.action_id}` });
        }
      }
    }
    const actions = Array.from(byId.values())
      .map(({ action_id, title }) => ({ action_id, title }))
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    res.json({ actions });
  } catch (err) {
    console.error('OZON seller-actions/list error:', err);
    res.status(500).json({
      error: 'Не удалось загрузить список промокодов OZON.',
      actions: [],
    });
  }
});

/**
 * GET /bloggers/api/video-stats?url=... - Fetch YouTube video statistics
 * Requires YOUTUBE_API_KEY in environment.
 */
router.get('/api/video-stats', requireAuth, async (req, res) => {
  const url = req.query.url || '';
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return res.status(400).json({
      error: 'Неверная ссылка на YouTube. Вставьте ссылку на ролик (youtube.com/watch?v=... или youtu.be/...).',
    });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'YouTube API не настроен. Добавьте переменную окружения YOUTUBE_API_KEY (ключ из Google Cloud Console, YouTube Data API v3).',
    });
  }

  try {
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    apiUrl.searchParams.set('part', 'snippet,statistics');
    apiUrl.searchParams.set('id', videoId);
    apiUrl.searchParams.set('key', apiKey);

    const response = await fetch(apiUrl.toString());
    const data = await response.json();

    if (!response.ok) {
      const message = data.error?.message || data.error?.errors?.[0]?.reason || 'Ошибка YouTube API';
      return res.status(response.status === 403 ? 503 : response.status).json({
        error: message,
      });
    }

    const items = data.items || [];
    if (items.length === 0) {
      return res.status(404).json({
        error: 'Ролик не найден или недоступен.',
      });
    }

    const video = items[0];
    const snippet = video.snippet || {};
    const stats = video.statistics || {};

    res.json({
      videoId,
      title: snippet.title || 'Без названия',
      description: snippet.description || '',
      channelTitle: snippet.channelTitle || '',
      channelId: snippet.channelId || '',
      publishedAt: snippet.publishedAt || '',
      thumbnails: snippet.thumbnails || {},
      viewCount: parseInt(stats.viewCount || '0', 10),
      likeCount: parseInt(stats.likeCount || '0', 10),
      commentCount: parseInt(stats.commentCount || '0', 10),
    });
  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).json({
      error: 'Не удалось получить данные. Проверьте подключение и ключ API.',
    });
  }
});

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

/**
 * GET /bloggers/api/sales/report/stream?year=&month= - Build report with Server-Sent Events (progress/status)
 */
router.get('/api/sales/report/stream', requireAuth, async (req, res) => {
  const y = parseInt(req.query.year, 10);
  const m = parseInt(req.query.month, 10);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (!y || !m || m < 1 || m > 12) {
    sendSSE(res, 'error', { error: 'Укажите корректные год и месяц.' });
    res.end();
    return;
  }

  const credentials = getCredentials();
  if (!credentials) {
    sendSSE(res, 'error', { error: 'OZON API не настроен. Настройте учётные данные в разделе Интеграции.' });
    res.end();
    return;
  }

  const fromDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();
  const monthKey = getMonthKey(y, m);

  try {
    sendSSE(res, 'status', { step: 'creating_report', message: 'Создание заявки на отчёт OZON…' });
    const code = await createPostingsReport(credentials, fromIso, toIso);

    sendSSE(res, 'status', { step: 'waiting_for_report', message: 'Ожидание готовности отчёта (может занять несколько минут)…' });
    const fileUrl = await waitForReportReady(credentials, code);

    sendSSE(res, 'status', { step: 'downloading', message: 'Загрузка и подсчёт продаж…' });
    const { sums, details } = await downloadAndAggregateReport(fileUrl, credentials);

    sendSSE(res, 'status', { step: 'saving', message: 'Сохранение данных…' });
    const entries = Array.from(sums.entries());
    const tx = db.transaction((rows, detailRows) => {
      db.prepare('DELETE FROM blogger_promo_sales WHERE month_key = ?').run(monthKey);
      db.prepare('DELETE FROM blogger_promo_sales_detail WHERE month_key = ?').run(monthKey);
      const insertStmt = db.prepare(`
        INSERT INTO blogger_promo_sales (month_key, ozon_action_title, sales_amount)
        VALUES (?, ?, ?)
      `);
      for (const [title, amount] of rows) {
        insertStmt.run(monthKey, normalizePromoTitle(title || ''), amount);
      }
      const insertDetailStmt = db.prepare(`
        INSERT INTO blogger_promo_sales_detail (month_key, ozon_action_title, processed_at, price)
        VALUES (?, ?, ?, ?)
      `);
      for (const d of detailRows) {
        insertDetailStmt.run(monthKey, normalizePromoTitle(d.promo_title || ''), d.processed_at || null, d.price);
      }
    });
    tx(entries, details);

    const items = entries.map(([title, amount]) => ({
      ozon_action_title: normalizePromoTitle(title || ''),
      sales_amount: amount,
    }));
    sendSSE(res, 'done', { month_key: monthKey, items });
  } catch (err) {
    console.error('OZON sales report error:', err);
    sendSSE(res, 'error', { error: err.message || 'Ошибка формирования отчёта продаж OZON.' });
  } finally {
    res.end();
  }
});

/**
 * POST /bloggers/api/sales/report - Build OZON postings report for month and store promo sales
 * Body: { year, month }
 */
router.post('/api/sales/report', requireAuth, async (req, res) => {
  const { year, month } = req.body || {};
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  if (!y || !m || m < 1 || m > 12) {
    return res.status(400).json({ error: 'Укажите корректные год и месяц.' });
  }

  const credentials = getCredentials();
  if (!credentials) {
    return res.status(503).json({ error: 'OZON API не настроен. Настройте учётные данные в разделе Интеграции.' });
  }

  const fromDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();
  const monthKey = getMonthKey(y, m);

  try {
    const code = await createPostingsReport(credentials, fromIso, toIso);
    const fileUrl = await waitForReportReady(credentials, code);
    const { sums, details } = await downloadAndAggregateReport(fileUrl, credentials);

    const entries = Array.from(sums.entries());
    const tx = db.transaction((rows, detailRows) => {
      db.prepare('DELETE FROM blogger_promo_sales WHERE month_key = ?').run(monthKey);
      db.prepare('DELETE FROM blogger_promo_sales_detail WHERE month_key = ?').run(monthKey);
      const insertStmt = db.prepare(`
        INSERT INTO blogger_promo_sales (month_key, ozon_action_title, sales_amount)
        VALUES (?, ?, ?)
      `);
      for (const [title, amount] of rows) {
        insertStmt.run(monthKey, normalizePromoTitle(title || ''), amount);
      }
      const insertDetailStmt = db.prepare(`
        INSERT INTO blogger_promo_sales_detail (month_key, ozon_action_title, processed_at, price)
        VALUES (?, ?, ?, ?)
      `);
      for (const d of detailRows) {
        insertDetailStmt.run(monthKey, normalizePromoTitle(d.promo_title || ''), d.processed_at || null, d.price);
      }
    });
    tx(entries, details);

    const items = entries.map(([title, amount]) => ({
      ozon_action_title: normalizePromoTitle(title || ''),
      sales_amount: amount,
    }));

    res.json({ month_key: monthKey, items });
  } catch (err) {
    console.error('OZON sales report error:', err);
    res.status(500).json({ error: err.message || 'Ошибка формирования отчёта продаж OZON.' });
  }
});

/**
 * GET /bloggers/api/sales/by-promo?year=&month= - Sum sales by promo for the selected month
 */
router.get('/api/sales/by-promo', requireAuth, (req, res) => {
  try {
    const { year, month } = req.query || {};
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!y || !m || m < 1 || m > 12) {
      return res.json({ month_key: null, items: [] });
    }
    const monthKey = getMonthKey(y, m);
    const rows = db.prepare(`
      SELECT s.ozon_action_title,
             s.sales_amount,
             COALESCE(d.sales_count, 0) AS sales_count
      FROM blogger_promo_sales s
      LEFT JOIN (
        SELECT ozon_action_title,
               COUNT(*) AS sales_count
        FROM blogger_promo_sales_detail
        WHERE month_key = ?
        GROUP BY ozon_action_title
      ) d ON d.ozon_action_title = s.ozon_action_title
      WHERE s.month_key = ?
      ORDER BY s.ozon_action_title
    `).all(monthKey, monthKey);
    res.json({ month_key: monthKey, items: rows });
  } catch (err) {
    console.error('sales by-promo error:', err);
    res.json({ month_key: null, items: [] });
  }
});

/**
 * GET /bloggers/api/sales/details?year=&month=&promo= - Детализация покупок по акции: дата (Принят в обработку) и цена (Ваша цена)
 */
router.get('/api/sales/details', requireAuth, (req, res) => {
  try {
    const { year, month, promo } = req.query || {};
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const promoTitle = normalizePromoTitle(typeof promo === 'string' ? promo : '');
    if (!y || !m || m < 1 || m > 12 || !promoTitle) {
      return res.json({ items: [] });
    }
    const monthKey = getMonthKey(y, m);
    const rows = db.prepare(`
      SELECT processed_at, price
      FROM blogger_promo_sales_detail
      WHERE month_key = ? AND ozon_action_title = ?
      ORDER BY processed_at ASC, id ASC
    `).all(monthKey, promoTitle);
    res.json({ items: rows.map((r) => ({ processed_at: r.processed_at, price: r.price })) });
  } catch (err) {
    console.error('sales details error:', err);
    res.json({ items: [] });
  }
});

/**
 * GET /bloggers/api/integrations - List all saved blogger integrations (optionally with sales for month).
 * If year&month&refresh_views=1, обновляет просмотры/лайки/комментарии через YouTube API для роликов за этот период.
 */
router.get('/api/integrations', requireAuth, async (req, res) => {
  try {
    const { year, month, refresh_views } = req.query || {};
    let rows;

    if (year && month) {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      const monthKey = getMonthKey(y, m);
      const monthPadded = String(m).padStart(2, '0');
      const yearStr = String(y);
      rows = db.prepare(`
        SELECT bi.id,
               bi.video_url,
               bi.video_id,
               bi.video_title,
               bi.channel_title,
               bi.video_published_at,
               bi.view_count,
               bi.like_count,
               bi.comment_count,
               bi.ozon_action_id,
               bi.ozon_action_title,
               bi.integration_cost,
               bi.created_at
        FROM blogger_integrations bi
        WHERE bi.video_published_at IS NOT NULL
          AND strftime('%Y', bi.video_published_at) = ?
          AND strftime('%m', bi.video_published_at) = ?
        ORDER BY bi.video_published_at DESC, bi.created_at DESC
      `).all(yearStr, monthPadded);
      const salesRows = db.prepare(`
        SELECT ozon_action_title, sales_amount FROM blogger_promo_sales WHERE month_key = ?
      `).all(monthKey);
      const salesByPromo = new Map(salesRows.map((r) => [r.ozon_action_title, r.sales_amount]));
      rows = rows.map((r) => ({
        ...r,
        sales_amount: salesByPromo.get(normalizePromoTitle(r.ozon_action_title)) ?? null,
      }));

      if (refresh_views === '1' || refresh_views === 'true') {
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (apiKey) {
          for (const row of rows) {
            if (!row.video_id) continue;
            try {
              const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
              apiUrl.searchParams.set('part', 'statistics');
              apiUrl.searchParams.set('id', row.video_id);
              apiUrl.searchParams.set('key', apiKey);
              const response = await fetch(apiUrl.toString());
              const data = await response.json().catch(() => ({}));
              if (!response.ok || !data.items || !data.items.length) continue;
              const stats = data.items[0].statistics || {};
              const viewCount = parseInt(stats.viewCount || '0', 10);
              const likeCount = parseInt(stats.likeCount || '0', 10);
              const commentCount = parseInt(stats.commentCount || '0', 10);
              db.prepare(
                'UPDATE blogger_integrations SET view_count = ?, like_count = ?, comment_count = ? WHERE id = ?'
              ).run(viewCount, likeCount, commentCount, row.id);
              row.view_count = viewCount;
              row.like_count = likeCount;
              row.comment_count = commentCount;
            } catch (e) {
              console.error('refresh views error for video', row.video_id, e);
            }
          }
        }
      }
    } else {
      rows = db.prepare(`
        SELECT id,
               video_url,
               video_id,
               video_title,
               channel_title,
               video_published_at,
               view_count,
               like_count,
               comment_count,
               ozon_action_id,
               ozon_action_title,
               integration_cost,
               created_at,
               NULL AS sales_amount
        FROM blogger_integrations
        ORDER BY created_at DESC
      `).all();
    }

    res.json({ integrations: rows });
  } catch (err) {
    console.error('blogger_integrations list error:', err);
    res.status(500).json({ error: 'Ошибка загрузки списка интеграций', integrations: [] });
  }
});

/**
 * POST /bloggers/api/integrations - Add new integration (video + promo + cost), fetch video stats then save
 * Body: { url, action_id, ozon_action_title, integration_cost }
 */
router.post('/api/integrations', requireAuth, async (req, res) => {
  const { url, action_id, ozon_action_title, integration_cost } = req.body || {};
  const videoId = extractYouTubeVideoId(url || '');

  if (!videoId) {
    return res.status(400).json({ error: 'Неверная ссылка на YouTube.' });
  }
  if (!action_id || !ozon_action_title) {
    return res.status(400).json({ error: 'Укажите промокод OZON.' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'YouTube API не настроен (YOUTUBE_API_KEY).' });
  }

  try {
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    apiUrl.searchParams.set('part', 'snippet,statistics');
    apiUrl.searchParams.set('id', videoId);
    apiUrl.searchParams.set('key', apiKey);

    const response = await fetch(apiUrl.toString());
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || data.error?.errors?.[0]?.reason || 'Ошибка YouTube API',
      });
    }

    const items = data.items || [];
    if (items.length === 0) {
      return res.status(404).json({ error: 'Ролик не найден.' });
    }

    const video = items[0];
    const snippet = video.snippet || {};
    const stats = video.statistics || {};
    const videoUrl = (url || '').trim() || `https://www.youtube.com/watch?v=${videoId}`;

    const cost = integration_cost !== undefined && integration_cost !== '' && integration_cost !== null
      ? parseFloat(integration_cost)
      : null;

    const publishedAt = snippet.publishedAt || null;

    db.prepare(`
      INSERT INTO blogger_integrations (
        video_url, video_id, video_title, channel_title, video_published_at,
        view_count, like_count, comment_count,
        ozon_action_id, ozon_action_title, integration_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      videoUrl,
      videoId,
      snippet.title || null,
      snippet.channelTitle || null,
      publishedAt,
      parseInt(stats.viewCount || '0', 10),
      parseInt(stats.likeCount || '0', 10),
      parseInt(stats.commentCount || '0', 10),
      action_id,
      ozon_action_title,
      cost
    );

    const row = db.prepare('SELECT * FROM blogger_integrations WHERE id = last_insert_rowid()').get();
    res.status(201).json({ integration: row });
  } catch (err) {
    console.error('Add blogger integration error:', err);
    res.status(500).json({ error: 'Не удалось добавить интеграцию.' });
  }
});

/**
 * PATCH /bloggers/api/integrations/:id - Update integration (cost and/or promo)
 * Body: { integration_cost?, action_id?, ozon_action_title? }
 */
router.patch('/api/integrations/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Неверный id.' });

  const { integration_cost, action_id, ozon_action_title } = req.body || {};
  const updates = [];
  const params = [];

  if (integration_cost !== undefined && integration_cost !== null && integration_cost !== '') {
    updates.push('integration_cost = ?');
    params.push(parseFloat(integration_cost));
  } else if (integration_cost === '' || integration_cost === null) {
    updates.push('integration_cost = ?');
    params.push(null);
  }
  if (action_id !== undefined && action_id !== null && action_id !== '') {
    updates.push('ozon_action_id = ?');
    params.push(action_id);
  }
  if (ozon_action_title !== undefined && ozon_action_title !== null) {
    updates.push('ozon_action_title = ?');
    params.push(ozon_action_title);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Нет данных для обновления.' });
  }

  params.push(id);
  try {
    const sql = `UPDATE blogger_integrations SET ${updates.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...params);
    if (result.changes === 0) return res.status(404).json({ error: 'Интеграция не найдена.' });
    const row = db.prepare('SELECT * FROM blogger_integrations WHERE id = ?').get(id);
    res.json({ integration: row });
  } catch (err) {
    console.error('Update blogger integration error:', err);
    res.status(500).json({ error: 'Ошибка обновления.' });
  }
});

/**
 * DELETE /bloggers/api/integrations/:id - Remove one integration
 */
router.delete('/api/integrations/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Неверный id.' });
  try {
    const result = db.prepare('DELETE FROM blogger_integrations WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Интеграция не найдена.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete blogger integration error:', err);
    res.status(500).json({ error: 'Ошибка удаления.' });
  }
});

module.exports = router;
