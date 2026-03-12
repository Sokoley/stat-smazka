const express = require('express');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { getOzonAccounts } = require('../services/ozon');
const db = require('../db/database');

const router = express.Router();
const PPS_API_URL = 'https://lkk.smazka.ru/apiv1/get/pps?token=gulldl9yR7XKWadO1L64&t=actual&pc=0.7&cm=6';
const OZON_API_URL = 'https://api-seller.ozon.ru';
const OZON_PRODUCT_BATCH = 100;
const DATA_DIR = path.join(__dirname, '../../data/pricing2');
const OUR_PRODUCTS_FILE = path.join(DATA_DIR, 'our_products.json');
const COMPETITORS_FILE = path.join(DATA_DIR, 'competitors.json');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// GET - страница Ценообразование 2.0
router.get('/', requireAuth, (req, res) => {
  res.render('pricing2/index', { title: 'Ценообразование 2.0' });
});

// GET - прокси API PPS (чтобы не светить токен на клиенте и обойти CORS)
// Используем https с rejectUnauthorized: false из-за возможных проблем с сертификатом lkk.smazka.ru
router.get('/api/pps', requireAuth, (req, res) => {
  const request = https.get(PPS_API_URL, { rejectUnauthorized: false }, (mpRes) => {
    let body = '';
    mpRes.on('data', (chunk) => { body += chunk; });
    mpRes.on('end', () => {
      if (mpRes.statusCode !== 200) {
        return res.status(mpRes.statusCode).json({ error: `API error: ${mpRes.statusCode}` });
      }
      try {
        const data = JSON.parse(body);
        res.json(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('PPS API parse error:', e);
        res.status(502).json({ error: 'Ошибка разбора ответа' });
      }
    });
  });
  request.on('error', (err) => {
    console.error('PPS API error:', err);
    res.status(500).json({ error: err.message || 'Ошибка загрузки данных' });
  });
});

// POST - данные по товарам из OZON (v3/product/info/list): фото (primary_image), заливочная цена (price)
// Используются все активные кабинеты OZON из раздела Интеграции; результаты объединяются.
// Body: { offer_ids: ["2506", "2507", ...] } — артикулы
// Ответ: { items: { "2506": { primary_image: "url", price: "123.45" }, ... } }
router.post('/api/ozon-products', requireAuth, async (req, res) => {
  const accounts = getOzonAccounts();
  if (!accounts || accounts.length === 0) {
    return res.status(503).json({ error: 'OZON не настроен. Добавьте кабинеты в разделе Интеграции → OZON.' });
  }
  const offerIds = req.body && req.body.offer_ids;
  if (!Array.isArray(offerIds) || offerIds.length === 0) {
    return res.json({ items: {} });
  }
  const uniqueIds = [...new Set(offerIds.map((id) => String(id).trim()).filter(Boolean))];
  const result = {};
  for (let i = 0; i < uniqueIds.length; i += OZON_PRODUCT_BATCH) {
    let missingInBatch = uniqueIds.slice(i, i + OZON_PRODUCT_BATCH);
    for (const account of accounts) {
      if (missingInBatch.length === 0) break;
      try {
        const response = await fetch(`${OZON_API_URL}/v3/product/info/list`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Id': account.client_id,
            'Api-Key': account.api_key,
          },
          body: JSON.stringify({ offer_id: missingInBatch }),
        });
        if (!response.ok) {
          const text = await response.text();
          console.error(`OZON v3/product/info/list [${account.name}]:`, response.status, text.slice(0, 200));
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        const data = await response.json();
        if (data.items && Array.isArray(data.items)) {
          data.items.forEach((item) => {
            const offerId = item.offer_id;
            if (!offerId) return;
            // Показываем только неархивные товары; архивные ищем в следующем кабинете
            if (item.is_archived === true) return;
            const primaryImage = Array.isArray(item.primary_image) && item.primary_image.length > 0
              ? item.primary_image[0]
              : (item.primary_image || '');
            result[offerId] = {
              primary_image: typeof primaryImage === 'string' ? primaryImage : '',
              price: item.price != null ? String(item.price) : '',
              sku: item.sku != null ? Number(item.sku) : null,
            };
            missingInBatch = missingInBatch.filter((id) => id !== offerId);
          });
        }
        await new Promise((r) => setTimeout(r, 150));
      } catch (err) {
        console.error(`OZON product info [${account.name}]:`, err.message);
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
  res.json({ items: result });
});

// Период по умолчанию: последние 7 дней
function getDefaultPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    d1: start.toISOString().slice(0, 10),
    d2: end.toISOString().slice(0, 10),
  };
}

// POST - данные MPStats: цена по OZON карте (за последний день с данными), продажи за период
// GET oz/get/item/{sku}/sales?d1=YYYY-MM-DD&d2=YYYY-MM-DD
// Body: { skus: [123, 456], d1?: "YYYY-MM-DD", d2?: "YYYY-MM-DD" }. По умолчанию — последние 7 дней.
// Ответ: { items: { "123": { ozon_card_price: 3835, sales: 10, sales_rub: 44990 }, ... } }
// sales_rub — сумма по дням (final_price * sales)
router.post('/api/mpstats-sales', requireAuth, async (req, res) => {
  const row = db.prepare("SELECT api_key FROM api_settings WHERE service = 'mpstats'").get();
  const token = (row && row.api_key) ? String(row.api_key).trim() : (process.env.MPSTATS_TOKEN || '');
  if (!token) {
    return res.status(503).json({ error: 'MPStats не настроен. Укажите токен в разделе Интеграции.' });
  }
  const skus = req.body && req.body.skus;
  if (!Array.isArray(skus) || skus.length === 0) {
    return res.json({ items: {} });
  }
  const uniqueSkus = [...new Set(skus.map((s) => Number(s)).filter((n) => !isNaN(n) && n > 0))];
  const { d1, d2 } = req.body.d1 && req.body.d2
    ? { d1: req.body.d1, d2: req.body.d2 }
    : getDefaultPeriod();
  const params = new URLSearchParams({ d1, d2 });
  const result = {};
  for (const sku of uniqueSkus) {
    try {
      const response = await fetch(
        `https://mpstats.io/api/oz/get/item/${sku}/sales?${params}`,
        { headers: { 'X-Mpstats-TOKEN': token, 'Content-Type': 'application/json' } }
      );
      if (!response.ok) {
        result[sku] = { ozon_card_price: null, sales: 0, sales_rub: 0 };
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        result[sku] = { ozon_card_price: null, sales: 0, sales_rub: 0 };
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const sorted = data.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      const lastWithData = sorted.find((x) => x.ozon_card_price !== undefined && x.ozon_card_price !== null && x.ozon_card_price !== '');
      const ozonCardPrice = lastWithData != null ? Number(lastWithData.ozon_card_price) : null;
      const salesSum = data.reduce((sum, x) => sum + (Number(x.sales) || 0), 0);
      const salesRub = data.reduce((sum, x) => sum + (Number(x.final_price) || 0) * (Number(x.sales) || 0), 0);
      result[sku] = { ozon_card_price: ozonCardPrice, sales: salesSum, sales_rub: salesRub };
    } catch (err) {
      console.error('MPStats sales for SKU', sku, err.message);
      result[sku] = { ozon_card_price: null, sales: 0, sales_rub: 0 };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  res.json({ items: result });
});

// GET - загрузить сохранённые данные наших товаров (ppsData, ozonInfo, mpstatsData только по нашим SKU)
router.get('/api/our-products', requireAuth, async (req, res) => {
  try {
    const raw = await fs.readFile(OUR_PRODUCTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ ppsData: [], ozonInfo: {}, mpstatsData: {} });
    console.error('Read our_products.json:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET - загрузить сохранённые данные по конкурентам (competitorsByArticul, mpstatsData только по SKU конкурентов)
router.get('/api/competitors', requireAuth, async (req, res) => {
  try {
    const raw = await fs.readFile(COMPETITORS_FILE, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ competitorsByArticul: {}, mpstatsData: {} });
    console.error('Read competitors.json:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST - сохранить данные наших товаров. Body: { ppsData, ozonInfo, mpstatsData } (mpstatsData только по нашим SKU)
router.post('/api/save-our-products', requireAuth, async (req, res) => {
  try {
    await ensureDataDir();
    const { ppsData, ozonInfo, mpstatsData } = req.body || {};
    await fs.writeFile(
      OUR_PRODUCTS_FILE,
      JSON.stringify({
        ppsData: Array.isArray(ppsData) ? ppsData : [],
        ozonInfo: ozonInfo && typeof ozonInfo === 'object' ? ozonInfo : {},
        mpstatsData: mpstatsData && typeof mpstatsData === 'object' ? mpstatsData : {},
      }, null, 2),
      'utf8'
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Write our_products.json:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST - сохранить данные по конкурентам. Body: { competitorsByArticul, mpstatsData } (mpstatsData только по SKU конкурентов)
router.post('/api/save-competitors', requireAuth, async (req, res) => {
  try {
    await ensureDataDir();
    const { competitorsByArticul, mpstatsData } = req.body || {};
    await fs.writeFile(
      COMPETITORS_FILE,
      JSON.stringify({
        competitorsByArticul: competitorsByArticul && typeof competitorsByArticul === 'object' ? competitorsByArticul : {},
        mpstatsData: mpstatsData && typeof mpstatsData === 'object' ? mpstatsData : {},
      }, null, 2),
      'utf8'
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Write competitors.json:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
