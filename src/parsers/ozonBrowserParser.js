/**
 * Парсер цен Ozon через Puppeteer + Stealth и резидентский прокси.
 * Консервативная стратегия: микробатчи, длинные паузы, ротация браузера и IP при блокировках.
 */

const OZON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const rand = (min, max) => min + Math.random() * (max - min);

function extractCardPrice(jsonText) {
  if (!jsonText || jsonText.length < 50) return null;
  const m = jsonText.match(/"cardPrice"\s*:\s*"([^"]+)"\s*(?:,|})/);
  if (m && m[1]) return m[1].trim();
  const m2 = jsonText.match(/"cardPrice"\s*:\s*"([^"]+)"/);
  if (m2 && m2[1]) return m2[1].trim();
  return null;
}

function isBlocked(content) {
  if (!content || typeof content !== 'string') return false;
  const s = content.toLowerCase();
  return (
    s.includes('доступ ограничен') ||
    s.includes('не бот') ||
    s.includes('подтвердите') ||
    s.includes('captcha') ||
    s.includes('пазл')
  );
}

async function rotateProxy(refreshUrl, log) {
  try {
    const https = require('https');
    const res = await new Promise((resolve, reject) => {
      https.get(refreshUrl, (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => resolve({ status: r.statusCode, data }));
      }).on('error', reject);
    });
    if (res.status === 200) {
      if (log) log('[ROTATE] IP rotated successfully');
      return true;
    }
    if (res.status === 429 && log) log('[ROTATE] Too many requests, skip');
    return false;
  } catch (e) {
    if (log) log('[ROTATE] Error: ' + e.message);
    return false;
  }
}

/**
 * @param {string[]} skus - массив SKU
 * @param {object} options
 * @param {object} options.proxy - { host, port, username, password, refreshUrl }
 * @param {number} options.delayBetweenRequestsMs - пауза между запросами (мин-макс) [12000, 20000]
 * @param {number} options.batchSize - сколько SKU обрабатывать до паузы [3]
 * @param {number} options.batchPauseMs - пауза между батчами [60000]
 * @param {number} options.postBlockPauseMs - пауза после блокировки перед новым браузером [30000]
 * @param {function} options.onProgress - (current, total, sku, message) => void
 */
async function parseSkus(skus, options = {}) {
  const proxy = options.proxy || {};
  const delayBetweenRequestsMs = options.delayBetweenRequestsMs ?? [12000, 20000];
  const batchSize = options.batchSize ?? 3;
  const batchPauseMs = options.batchPauseMs ?? 60000;
  const postBlockPauseMs = options.postBlockPauseMs ?? 30000;
  const onProgress = options.onProgress || (() => {});

  const results = [];
  const total = skus.length;
  let browser = null;
  let page = null;
  let localProxyUrl = null;

  const log = (msg) => {
    const out = typeof process !== 'undefined' && process.stderr && process.stderr.write;
    if (out) process.stderr.write(msg + '\n');
  };

  const createBrowser = async () => {
    const proxyChain = require('proxy-chain');
    const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    localProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    const puppeteer = require('puppeteer-extra');
    const Stealth = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(Stealth());
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
      `--proxy-server=${localProxyUrl}`,
    ];
    const b = await puppeteer.launch({
      headless: 'new',
      args,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || '/usr/bin/google-chrome',
    });
    return b;
  };

  const closeBrowser = async () => {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
      browser = null;
      page = null;
    }
    if (localProxyUrl) {
      try {
        const proxyChain = require('proxy-chain');
        await proxyChain.closeAnonymizedProxy(localProxyUrl, true);
      } catch (e) {}
      localProxyUrl = null;
    }
  };

  const newPage = async () => {
    if (!browser) return null;
    const p = await browser.newPage();
    await p.setUserAgent(OZON_UA);
    await p.setViewport({ width: 1920, height: 1080 });
    await p.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });
    return p;
  };

  try {
    for (let i = 0; i < skus.length; i++) {
      const sku = String(skus[i]).trim();
      const oneBased = i + 1;

      if (i % batchSize === 0 && i > 0) {
        log(`[BATCH] Pause ${Math.round(batchPauseMs / 1000)}s after batch...`);
        await closeBrowser();
        await delay(batchPauseMs);
      }

      if (!browser) {
        browser = await createBrowser();
        page = await newPage();
        await page.goto('https://www.ozon.ru', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await delay(rand(3000, 5000));
      }

      onProgress(oneBased, total, sku, 'parsing');

      const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fproduct%2F${sku}`;
      let blocked = false;
      let jsonText = '';

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await delay(rand(1500, 3000));
          jsonText = await page.evaluate(() => {
            const pre = document.querySelector('pre');
            return (pre && pre.textContent) || document.body.textContent || '';
          });
        } catch (e) {
          jsonText = e.message || '';
        }

        if (isBlocked(jsonText)) {
          blocked = true;
          log(`[BLOCK] SKU ${sku}: Blocked (attempt ${attempt + 1})`);
          onProgress(oneBased, total, sku, 'blocked');
          await closeBrowser();
          if (proxy.refreshUrl) {
            await rotateProxy(proxy.refreshUrl, log);
            await delay(rand(20000, 35000));
          } else {
            await delay(postBlockPauseMs);
          }
          browser = await createBrowser();
          page = await newPage();
          await page.goto('https://www.ozon.ru', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          await delay(rand(3000, 5000));
          continue;
        }
        break;
      }

      if (blocked) {
        results.push({ sku, price: null, success: false, error: 'blocked_after_retry', source: 'browser_parser' });
        log(`[${oneBased}/${total}] SKU ${sku}: blocked_after_retry`);
        onProgress(oneBased, total, sku, 'blocked_after_retry');
      } else {
        const price = extractCardPrice(jsonText);
        results.push({
          sku,
          price: price || null,
          success: !!price,
          error: price ? undefined : 'price_not_found',
          source: 'browser_parser',
        });
        if (price) {
          log(`[${oneBased}/${total}] SKU ${sku}: ${price}`);
          onProgress(oneBased, total, sku, price);
        } else {
          log(`[${oneBased}/${total}] SKU ${sku}: price_not_found`);
          onProgress(oneBased, total, sku, 'price_not_found');
        }
      }

      if (i < skus.length - 1) {
        const [dMin, dMax] = Array.isArray(delayBetweenRequestsMs)
          ? delayBetweenRequestsMs
          : [delayBetweenRequestsMs, delayBetweenRequestsMs];
        await delay(rand(dMin, dMax));
      }
    }

    const successful = results.filter((r) => r.success).length;
    return {
      success: successful > 0,
      results,
      summary: { total: results.length, successful, failed: results.length - successful },
      source: 'browser_parser',
    };
  } finally {
    await closeBrowser();
  }
}

module.exports = { parseSkus, extractCardPrice, isBlocked };
