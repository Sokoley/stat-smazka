const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Directory for pricing-dev data (separate from pricecheck)
const DATA_DIR = path.join(__dirname, '../../data/pricing-dev');
const PUBLIC_DIR = path.join(__dirname, '../public/pricing-dev');

// Ensure data directory exists
(async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('📁 Pricing-dev data directory ready:', DATA_DIR);
  } catch (error) {
    console.error('Error creating pricing-dev data directory:', error);
  }
})();

// GET /pricing-dev - Main page with sidebar (layout + iframe)
router.get('/', (req, res) => {
  res.render('layouts/main', {
    title: 'Ценообразование DEV',
    body: `
      <div class="h-full flex flex-col min-h-0 -m-6">
        <iframe src="/pricing-dev/frame" class="w-full flex-1 border-0 rounded-none" style="min-height: calc(100vh - 6rem);" title="Ценообразование DEV"></iframe>
      </div>
    `
  });
});

// GET /pricing-dev/frame - Standalone app content (for iframe inside layout)
router.get('/frame', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Serve compiled JS file
router.get('/app/index.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(PUBLIC_DIR, 'index.js'));
});

// Serve TSX file with correct MIME type (fallback for development)
router.get('/app/index.tsx', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(PUBLIC_DIR, 'index.tsx'));
});

// Health check
router.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    info: 'Pricing Dev API',
    dataDir: DATA_DIR
  });
});

// Get list of data files
router.get('/api/data/files', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    const filesInfo = [];
    for (const file of jsonFiles) {
      const filePath = path.join(DATA_DIR, file);
      try {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        const itemCount = data.competitorSelections ? Object.keys(data.competitorSelections).length : 0;
        const competitorCount = data.competitorSelections
          ? Object.values(data.competitorSelections).reduce((acc, competitors) => acc + competitors.length, 0)
          : 0;

        filesInfo.push({
          name: file,
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime,
          itemCount,
          competitorCount,
          lastUpdated: data.lastUpdated
        });
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
      }
    }

    res.json({
      success: true,
      files: filesInfo,
      count: jsonFiles.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting files list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Load data file
router.get('/api/data/load/:filename', async (req, res) => {
  try {
    let filename = req.params.filename;
    if (!filename.endsWith('.json')) {
      filename += '.json';
    }

    const filePath = path.join(DATA_DIR, filename);

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Файл не найден',
        code: 'ENOENT'
      });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    res.json({
      success: true,
      filename: filename,
      data: data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error loading data:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({
        success: false,
        error: 'Файл не найден',
        code: error.code
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message,
        code: error.code
      });
    }
  }
});

// Save data file
router.post('/api/data/save', async (req, res) => {
  const { filename, data } = req.body;

  if (!filename || !data) {
    return res.status(400).json({
      success: false,
      error: 'Не указаны filename или data'
    });
  }

  try {
    let safeFilename = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
    if (!safeFilename.endsWith('.json')) {
      safeFilename += '.json';
    }

    const filePath = path.join(DATA_DIR, safeFilename);

    const dataWithTimestamp = {
      ...data,
      lastUpdated: new Date().toISOString(),
      version: '1.0'
    };

    await fs.writeFile(
      filePath,
      JSON.stringify(dataWithTimestamp, null, 2),
      'utf-8'
    );

    console.log(`💾 Data saved to file: ${safeFilename} (${JSON.stringify(dataWithTimestamp).length} bytes)`);

    res.json({
      success: true,
      filename: safeFilename,
      size: JSON.stringify(dataWithTimestamp).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete data file
router.delete('/api/data/delete/:filename', async (req, res) => {
  try {
    let filename = req.params.filename;
    if (!filename.endsWith('.json')) {
      filename += '.json';
    }

    const filePath = path.join(DATA_DIR, filename);

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Файл не найден',
        code: 'ENOENT'
      });
    }

    await fs.unlink(filePath);

    console.log(`🗑️ File deleted: ${filename}`);

    res.json({
      success: true,
      message: 'Файл успешно удалён',
      filename: filename,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Create backup
router.post('/api/data/backup', async (req, res) => {
  try {
    const backupDir = path.join(DATA_DIR, 'backups');
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `backup_${timestamp}.json`;
    const backupPath = path.join(backupDir, backupFilename);

    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json') && !file.includes('backup_'));

    const backupData = {
      timestamp: new Date().toISOString(),
      files: jsonFiles,
      data: {}
    };

    for (const file of jsonFiles) {
      const filePath = path.join(DATA_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      backupData.data[file] = JSON.parse(content);
    }

    await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));

    res.json({
      success: true,
      message: 'Бэкап создан',
      filename: backupFilename,
      size: JSON.stringify(backupData).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all data
router.get('/api/data/all', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const allData = {};

    for (const file of jsonFiles) {
      const filePath = path.join(DATA_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      allData[file] = JSON.parse(content);
    }

    res.json({
      success: true,
      files: jsonFiles,
      data: allData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error reading data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Parse Ozon card prices via Selenium (Ozon blocks plain HTTP requests)
const OZON_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Резидентский прокси с ротацией для pricing-dev (всегда включен)
const RESIDENTIAL_PROXY = {
  host: '93.190.143.48',
  port: '443',
  username: 'lhzoconcwq-res-country-RU-state-536203-city-498817-hold-session-session-699da825d2302',
  password: 'a5XdSzQrTeDe0nmL',
  refreshUrl: 'https://api.sx.org/proxy/1956b819-1185-11f1-bf50-bc24114c89e8/refresh-ip'
};

// Кулдаун ротации IP (минимум 60 секунд между ротациями)
let lastRotationTime = 0;
const ROTATION_COOLDOWN = 60000; // 60 секунд
let consecutiveBlocks = 0; // Счётчик блокировок подряд

// Функция ротации IP с кулдауном
const rotateProxyIP = async (force = false) => {
  const now = Date.now();
  const timeSinceLastRotation = now - lastRotationTime;

  if (!force && timeSinceLastRotation < ROTATION_COOLDOWN) {
    console.log(`⏳ [pricing-dev] Кулдаун ротации: ещё ${Math.ceil((ROTATION_COOLDOWN - timeSinceLastRotation) / 1000)} сек`);
    return false;
  }

  try {
    const https = require('https');
    const response = await new Promise((resolve, reject) => {
      https.get(RESIDENTIAL_PROXY.refreshUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }).on('error', reject);
    });

    if (response.status === 200) {
      lastRotationTime = now;
      consecutiveBlocks = 0;
      console.log(`🔄 [pricing-dev] Ротация IP успешна: ${response.data}`);
      return true;
    } else if (response.status === 429) {
      console.log(`⚠️ [pricing-dev] Ротация IP: слишком частые запросы, ждём...`);
      return false;
    } else {
      console.log(`⚠️ [pricing-dev] Ротация IP: ${response.status} - ${response.data}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ [pricing-dev] Ошибка ротации IP: ${error.message}`);
    return false;
  }
};

// Proxy list and settings
let proxyList = [RESIDENTIAL_PROXY]; // Резидентский прокси по умолчанию
let proxyIndex = 0;
let proxyEnabled = true; // Всегда включен для pricing-dev

// Get proxy (всегда возвращает резидентский прокси)
const getProxy = () => RESIDENTIAL_PROXY;

console.log(`🏠 [pricing-dev] Резидентский прокси: ${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`);

// API to get proxy settings
router.get('/api/proxy', async (req, res) => {
  res.json({
    enabled: true,
    type: 'residential',
    proxy: `${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`,
    message: 'Резидентский прокси всегда включен'
  });
});

// API to rotate IP
router.post('/api/proxy/reload', async (req, res) => {
  const success = await rotateProxyIP();
  res.json({
    success,
    message: success ? 'IP успешно ротирован' : 'Ошибка ротации IP'
  });
});

// API to rotate IP (alias)
router.post('/api/proxy/rotate', async (req, res) => {
  const success = await rotateProxyIP();
  res.json({
    success,
    message: success ? 'IP успешно ротирован' : 'Ошибка ротации IP'
  });
});

// API to enable/disable proxy (no-op for residential)
router.post('/api/proxy', async (req, res) => {
  res.json({
    success: true,
    enabled: true,
    type: 'residential',
    message: 'Резидентский прокси всегда включен'
  });
});

// API to test proxy - check IP through residential proxy
router.get('/api/proxy/test', async (req, res) => {
  try {
    const proxyChain = require('proxy-chain');
    const http = require('http');

    const proxyUrl = `http://${RESIDENTIAL_PROXY.username}:${RESIDENTIAL_PROXY.password}@${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`;
    const localProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    console.log(`🧪 [pricing-dev] Тест резидентского прокси: ${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`);

    const proxyParts = new URL(localProxyUrl);

    const result = await new Promise((resolve, reject) => {
      const proxyReq = http.request({
        host: proxyParts.hostname,
        port: proxyParts.port,
        method: 'CONNECT',
        path: 'api.ipify.org:80'
      });

      proxyReq.on('error', reject);
      proxyReq.on('connect', (res, socket) => {
        const req = http.request({
          hostname: 'api.ipify.org',
          path: '/?format=json',
          method: 'GET',
          createConnection: () => socket
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.end();
      });

      proxyReq.end();
    });

    await proxyChain.closeAnonymizedProxy(localProxyUrl, true);

    const ipData = JSON.parse(result);
    console.log(`✅ [pricing-dev] Тест прокси успешен. IP: ${ipData.ip}`);

    res.json({
      success: true,
      type: 'residential',
      proxy: `${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`,
      ip: ipData.ip,
      message: `Резидентский прокси работает. Внешний IP: ${ipData.ip}`
    });
  } catch (error) {
    console.error(`❌ [pricing-dev] Ошибка теста прокси: ${error.message}`);
    res.json({
      success: false,
      proxy: `${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`,
      error: error.message
    });
  }
});

// ============ BROWSER PARSER API (Puppeteer + Stealth) ============
const ozonBrowserParser = require('../parsers/ozonBrowserParser');

// API: статус парсера
router.get('/api/parser/status', (req, res) => {
  res.json({
    mode: 'browser_parser',
    proxy: `${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`,
    enabled: true,
    engine: 'Puppeteer + Stealth (микробатчи, длинные паузы)'
  });
});

// API: парсинг через браузер (Puppeteer + Stealth), вызывается из UI
router.post('/api/parse-local', async (req, res) => {
  const { skus } = req.body;

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Не предоставлены SKU или пустой массив'
    });
  }

  const uniqueSkus = [...new Set(skus.filter(sku => sku && sku.toString().trim().length > 0))];

  console.log(`🌐 [pricing-dev] Парсинг ${uniqueSkus.length} SKU через Browser Parser (Puppeteer + Stealth)`);
  console.log(`🌐 [pricing-dev] Прокси: ${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`);

  try {
    const result = await ozonBrowserParser.parseSkus(uniqueSkus, {
      proxy: {
        host: RESIDENTIAL_PROXY.host,
        port: RESIDENTIAL_PROXY.port,
        username: RESIDENTIAL_PROXY.username,
        password: RESIDENTIAL_PROXY.password,
        refreshUrl: RESIDENTIAL_PROXY.refreshUrl,
      },
      delayBetweenRequestsMs: [12000, 20000],
      batchSize: 3,
      batchPauseMs: 60000,
      postBlockPauseMs: 30000,
      onProgress: (current, total, sku, msg) => {
        if (typeof msg === 'string' && msg.length < 50) {
          console.log(`  [${current}/${total}] SKU ${sku}: ${msg}`);
        }
      },
    });

    result.proxy = `${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`;
    result.timestamp = new Date().toISOString();

    console.log(`✅ [pricing-dev] Парсинг завершён: ${result.summary?.successful || 0}/${result.summary?.total || 0} успешно`);

    res.json(result);
  } catch (error) {
    console.error('[pricing-dev] Ошибка Browser парсера:', error.message);
    res.status(503).json({
      success: false,
      error: error.message || String(error),
      hint: 'Проверьте логи и доступность Chrome/Puppeteer',
    });
  }
});
// ============ END BROWSER PARSER API ============

router.post('/api/parse-prices', async (req, res) => {
  const { skus } = req.body;

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Не предоставлены SKU или пустой массив'
    });
  }

  const uniqueSkus = [...new Set(skus.filter(sku => sku && sku.toString().trim().length > 0))];
  if (uniqueSkus.length === 0) {
    return res.json({
      success: false,
      error: 'Нет валидных SKU для парсинга'
    });
  }

  console.log(`🔍 [pricing-dev] Parsing ${uniqueSkus.length} SKUs via Puppeteer Stealth`);

  try {
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());

    const results = [];
    let browser = null;
    let localProxyUrl = null;

    // Функция создания браузера с резидентским прокси
    const createBrowser = async () => {
      const proxyChain = require('proxy-chain');

      const proxyUrl = `http://${RESIDENTIAL_PROXY.username}:${RESIDENTIAL_PROXY.password}@${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`;
      localProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
      console.log(`🏠 [pricing-dev] Резидентский прокси: ${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`);

      const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        `--proxy-server=${localProxyUrl}`
      ];

      const newBrowser = await puppeteer.launch({
        headless: 'new',
        args,
        executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome'
      });

      return newBrowser;
    };

    // Функция закрытия прокси
    const closeLocalProxy = async () => {
      if (localProxyUrl) {
        try {
          const proxyChain = require('proxy-chain');
          await proxyChain.closeAnonymizedProxy(localProxyUrl, true);
          localProxyUrl = null;
        } catch (e) {}
      }
    };

    // Helper function for delay (waitForTimeout removed in newer Puppeteer)
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    try {
      browser = await createBrowser();
      let page = await browser.newPage();

      // Настройки страницы
      await page.setUserAgent(OZON_UA);
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      });

      // Прогрев сессии
      try {
        await page.goto('https://www.ozon.ru', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(2000 + Math.random() * 1000);
      } catch (e) {
        console.log('[pricing-dev] Прогрев не удался, продолжаем...');
      }

      let requestsBeforeRestart = 10 + Math.floor(Math.random() * 6);
      let requestCount = 0;

      for (let i = 0; i < uniqueSkus.length; i++) {
        const sku = uniqueSkus[i].toString().trim();
        console.log(`🔄 [pricing-dev] [${i + 1}/${uniqueSkus.length}] Парсинг SKU: ${sku}`);

        try {
          const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fproduct%2F${sku}`;

          await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await delay(500 + Math.random() * 500);

          let jsonText = await page.evaluate(() => {
            const pre = document.querySelector('pre');
            if (pre) return pre.textContent;
            return document.body.textContent || '';
          });

          // Проверяем на блокировку
          const isBlocked = jsonText && (
            jsonText.includes('Доступ ограничен') ||
            jsonText.includes('не бот') ||
            jsonText.includes('пазл') ||
            jsonText.includes('Подтвердите')
          );

          if (isBlocked) {
            // Ограничиваем количество попыток для одного SKU
            if (!results.find(r => r.sku === sku)) {
              const retryCount = (page._retryCount || 0) + 1;
              if (retryCount <= 3) {
                console.log(`🤖 [pricing-dev] [${i + 1}/${uniqueSkus.length}] Блокировка (попытка ${retryCount}/3)! Меняем прокси...`);
                console.log(`📄 Ответ: ${jsonText.substring(0, 200)}`);
                await page.close();
                await browser.close();
                await closeLocalProxy();
                await delay(3000 + Math.random() * 3000);
                browser = await createBrowser();
                page = await browser.newPage();
                page._retryCount = retryCount;
                await page.setUserAgent(OZON_UA);
                await page.setViewport({ width: 1920, height: 1080 });
                requestCount = 0;
                i--;
                continue;
              }
            }
            // Если 3 попытки не помогли - записываем ошибку и продолжаем
            console.log(`❌ [pricing-dev] [${i + 1}/${uniqueSkus.length}] SKU ${sku}: Заблокирован после 3 попыток`);
            results.push({
              sku,
              price: 'Заблокировано',
              success: false,
              error: 'Ozon заблокировал все прокси'
            });
            page._retryCount = 0;
            requestCount++;
            continue;
          }
          page._retryCount = 0;

          const cardPrice = (jsonText && jsonText.length >= 50) ? extractOzonCardPrice(jsonText) : null;
          results.push({
            sku,
            price: cardPrice || 'Цена не найдена',
            success: !!cardPrice,
            source: 'puppeteer_stealth',
            error: cardPrice ? undefined : 'cardPrice not found'
          });

          if (cardPrice) {
            console.log(`✅ [pricing-dev] [${i + 1}/${uniqueSkus.length}] SKU ${sku}: ${cardPrice}`);
          } else {
            const jsonPreview = jsonText ? jsonText.substring(0, 500) : '(пустой ответ)';
            console.log(`❌ [pricing-dev] [${i + 1}/${uniqueSkus.length}] SKU ${sku}: Цена не найдена`);
            console.log(`📄 JSON preview (${jsonText?.length || 0} chars): ${jsonPreview}`);
          }

          requestCount++;
        } catch (error) {
          console.log(`💥 [pricing-dev] [${i + 1}/${uniqueSkus.length}] SKU ${sku}: Ошибка - ${error.message}`);
          results.push({ sku, price: 'Ошибка загрузки', success: false, error: error.message });
          requestCount++;
        }

        // Превентивный перезапуск браузера (сброс cookies/сессии)
        if (requestCount >= requestsBeforeRestart && i < uniqueSkus.length - 1) {
          console.log(`🔄 [pricing-dev] Перезапуск браузера после ${requestCount} запросов...`);
          await page.close();
          await browser.close();
          await closeLocalProxy();
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
          browser = await createBrowser();
          page = await browser.newPage();
          await page.setUserAgent(OZON_UA);
          await page.setViewport({ width: 1920, height: 1080 });
          requestCount = 0;
          requestsBeforeRestart = 15 + Math.floor(Math.random() * 10); // Реже перезапускаем с резидентским прокси
        }

        if (i < uniqueSkus.length - 1) {
          await delay(500 + Math.random() * 500);
        }
      }

      const successful = results.filter(r => r.success && r.price && !String(r.price).includes('не найдена')).length;
      res.json({
        success: successful > 0,
        results,
        summary: { total: results.length, successful, failed: results.length - successful },
        timestamp: new Date().toISOString()
      });
    } finally {
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
      await closeLocalProxy();
    }
  } catch (error) {
    const isModuleNotFound = error.code === 'MODULE_NOT_FOUND' ||
      (error.message && error.message.includes('Cannot find module'));
    if (isModuleNotFound) {
      return res.status(503).json({
        success: false,
        error: 'Puppeteer не установлен',
        hint: 'npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth'
      });
    }
    console.error('[pricing-dev] Price parsing error:', error);
    res.status(503).json({
      success: false,
      error: error.message || String(error),
      hint: 'Проверьте логи контейнера'
    });
  }
});

// Helper function to extract Ozon Card price from JSON
function extractOzonCardPrice(jsonText) {
  try {
    const exactPattern = /"cardPrice"\s*:\s*"([^"]+)"\s*(?:,|})/;
    const exactMatch = jsonText.match(exactPattern);

    if (exactMatch && exactMatch[1]) {
      const price = exactMatch[1].trim();
      return price;
    }

    const patterns = [
      /\{"isAvailable":true,"cardPrice":"([^"]+)"/,
      /"cardPrice"\s*:\s*"([^"]+)"/,
      /cardPrice&quot;:&quot;([^&]+)&quot;/,
      /cardPrice[^:]*:\s*["']([^"']+)["']/,
      /cardPrice[^:]*:\s*"([\d\s]+ ₽)"/,
      /ozonCardPrice[^:]*:\s*["']([^"']+)["']/,
      /"ozonCardPrice":"([^"]+)"/
    ];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = jsonText.match(pattern);
      if (match && (match[1] || match[0])) {
        const price = (match[1] || match[0]).trim();
        if (isValidPrice(price)) {
          return price;
        }
      }
    }

    try {
      const jsonData = JSON.parse(jsonText);
      const price = findCardPriceInObject(jsonData);
      if (price) {
        return price;
      }
    } catch (parseError) {
      const cardPriceRegex = /cardPrice[^:]*:\s*["']([^"']+)["']/gi;
      let match;
      while ((match = cardPriceRegex.exec(jsonText)) !== null) {
        if (match[1]) {
          const price = match[1].trim();
          if (isValidPrice(price)) {
            return price;
          }
        }
      }
    }

    return null;

  } catch (error) {
    console.error('💥 [pricing-dev] Error analyzing JSON:', error.message);
    return null;
  }
}

function findCardPriceInObject(obj, depth = 0) {
  if (depth > 5) return null;
  if (!obj || typeof obj !== 'object') return null;

  if (obj.cardPrice && typeof obj.cardPrice === 'string') {
    return obj.cardPrice;
  }

  if (obj.ozonCardPrice && typeof obj.ozonCardPrice === 'string') {
    return obj.ozonCardPrice;
  }

  if (obj.widgetStates && typeof obj.widgetStates === 'object') {
    for (const key in obj.widgetStates) {
      try {
        if (typeof obj.widgetStates[key] === 'string') {
          try {
            const stateData = JSON.parse(obj.widgetStates[key]);
            const price = findCardPriceInObject(stateData, depth + 1);
            if (price) return price;
          } catch (e) {
          }
        } else if (typeof obj.widgetStates[key] === 'object') {
          const price = findCardPriceInObject(obj.widgetStates[key], depth + 1);
          if (price) return price;
        }
      } catch (e) {
      }
    }
  }

  for (const key in obj) {
    if (key !== 'widgetStates' && typeof obj[key] === 'object') {
      const price = findCardPriceInObject(obj[key], depth + 1);
      if (price) return price;
    }
  }

  return null;
}

function isValidPrice(price) {
  if (!price || typeof price !== 'string') return false;

  const trimmed = price.trim();

  if (!trimmed.includes('₽')) {
    return false;
  }

  if (!/\d/.test(trimmed)) {
    return false;
  }

  if (trimmed.length > 30) {
    return false;
  }
  return true;
}

module.exports = router;
