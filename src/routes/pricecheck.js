const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Directory for price check data
const DATA_DIR = path.join(__dirname, '../../data/pricecheck');
const PUBLIC_DIR = path.join(__dirname, '../public/pricecheck');

// Ensure data directory exists
(async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('📁 Price check data directory ready:', DATA_DIR);
  } catch (error) {
    console.error('Error creating pricecheck data directory:', error);
  }
})();

// GET /pricecheck - Main page with sidebar (layout + iframe)
router.get('/', (req, res) => {
  res.render('layouts/main', {
    title: 'Регулирование цен',
    body: `
      <div class="h-full flex flex-col min-h-0 -m-6">
        <iframe src="/pricecheck/frame" class="w-full flex-1 border-0 rounded-none" style="min-height: calc(100vh - 6rem);" title="Регулирование цен"></iframe>
      </div>
    `
  });
});

// GET /pricecheck/frame - Standalone app content (for iframe inside layout)
router.get('/frame', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Serve TSX file with correct MIME type for ES modules
router.get('/app/index.tsx', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(PUBLIC_DIR, 'index.tsx'));
});

// Health check
router.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    info: 'Ozon Card Price Parser API',
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

// Proxy settings (can be set via environment or API)
let proxyConfig = {
  enabled: process.env.PROXY_ENABLED === 'true',
  host: process.env.PROXY_HOST || '',
  port: process.env.PROXY_PORT || '',
  username: process.env.PROXY_USERNAME || '',
  password: process.env.PROXY_PASSWORD || ''
};

// API to get proxy settings
router.get('/api/proxy', (req, res) => {
  res.json({
    enabled: proxyConfig.enabled,
    host: proxyConfig.host,
    port: proxyConfig.port,
    username: proxyConfig.username ? '***' : '',
    hasAuth: !!(proxyConfig.username && proxyConfig.password)
  });
});

// API to update proxy settings
router.post('/api/proxy', (req, res) => {
  const { enabled, host, port, username, password } = req.body;

  proxyConfig = {
    enabled: enabled === true,
    host: host || '',
    port: port || '',
    username: username || '',
    password: password || ''
  };

  console.log(`🔧 Proxy settings updated: ${proxyConfig.enabled ? `${proxyConfig.host}:${proxyConfig.port}` : 'disabled'}`);

  res.json({
    success: true,
    message: proxyConfig.enabled ? `Прокси включен: ${proxyConfig.host}:${proxyConfig.port}` : 'Прокси отключен'
  });
});

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

  console.log(`🔍 Parsing ${uniqueSkus.length} SKUs via Selenium`);

  try {
    const { Builder, By, until } = require('selenium-webdriver');
    const chrome = require('selenium-webdriver/chrome');

    const results = [];
    let driver = null;

    // Функция создания нового драйвера
    const createDriver = async () => {
      const options = new chrome.Options();
      options.addArguments('--headless=new');
      options.addArguments('--no-sandbox');
      options.addArguments('--disable-dev-shm-usage');
      options.addArguments('--disable-gpu');
      options.addArguments('--window-size=1920,1080');
      options.addArguments(`--user-agent=${OZON_UA}`);
      options.addArguments('--disable-blink-features=AutomationControlled');
      options.addArguments('--disable-automation');
      options.addArguments('--disable-extensions');
      options.addArguments('--disable-plugins');
      options.addArguments('--disable-images');

      // Добавляем прокси если включен
      if (proxyConfig.enabled && proxyConfig.host && proxyConfig.port) {
        const proxyUrl = proxyConfig.username && proxyConfig.password
          ? `${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`
          : `${proxyConfig.host}:${proxyConfig.port}`;

        options.addArguments(`--proxy-server=http://${proxyConfig.host}:${proxyConfig.port}`);
        console.log(`🌐 Используется прокси: ${proxyConfig.host}:${proxyConfig.port}`);

        // Для прокси с авторизацией используем расширение
        if (proxyConfig.username && proxyConfig.password) {
          // Chrome headless не поддерживает расширения напрямую для proxy auth
          // Используем альтернативный подход через capabilities
          console.log(`🔐 Прокси с авторизацией: ${proxyConfig.username}`);
        }
      }

      const newDriver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
      await newDriver.manage().setTimeouts({ implicit: 10000, pageLoad: 20000, script: 20000 });

      // Прогреваем сессию
      try {
        await newDriver.get('https://www.ozon.ru');
        await newDriver.sleep(2000);
      } catch (e) {
        // ignore
      }

      return newDriver;
    };

    try {
      driver = await createDriver();

      // Количество запросов до перезапуска браузера (рандомизируем 10-15)
      let requestsBeforeRestart = 10 + Math.floor(Math.random() * 6);
      let requestCount = 0;

      for (let i = 0; i < uniqueSkus.length; i++) {
        const sku = uniqueSkus[i].toString().trim();
        console.log(`🔄 [${i + 1}/${uniqueSkus.length}] Парсинг SKU: ${sku}`);

        try {
          const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fproduct%2F${sku}`;
          await driver.get(apiUrl);

          let jsonText = '';
          for (let attempts = 0; attempts < 3 && (!jsonText || jsonText.length < 50); attempts++) {
            try {
              await driver.wait(until.elementLocated(By.css('body')), 8000);
              try {
                const preEl = await driver.findElement(By.css('pre'));
                jsonText = await preEl.getText();
              } catch {
                const bodyEl = await driver.findElement(By.css('body'));
                jsonText = await bodyEl.getText();
              }
              if (jsonText.length < 50) await driver.sleep(1000);
            } catch {
              await driver.sleep(1000);
            }
          }

          // Проверяем на капчу
          const isCaptcha = jsonText && (jsonText.includes('не бот') || jsonText.includes('пазл') || jsonText.includes('Подтвердите'));

          if (isCaptcha) {
            console.log(`🤖 [${i + 1}/${uniqueSkus.length}] Обнаружена капча! Перезапуск браузера...`);
            try { await driver.quit(); } catch (e) {}
            await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
            driver = await createDriver();
            requestCount = 0;
            requestsBeforeRestart = 10 + Math.floor(Math.random() * 6);

            // Повторяем запрос после перезапуска
            i--;
            continue;
          }

          const cardPrice = (jsonText && jsonText.length >= 50) ? extractOzonCardPrice(jsonText) : null;
          results.push({
            sku,
            price: cardPrice || 'Цена не найдена',
            success: !!cardPrice,
            source: 'json_api',
            error: cardPrice ? undefined : 'cardPrice not found'
          });
          if (cardPrice) {
            console.log(`✅ [${i + 1}/${uniqueSkus.length}] SKU ${sku}: ${cardPrice}`);
          } else {
            const jsonPreview = jsonText ? jsonText.substring(0, 500) : '(пустой ответ)';
            console.log(`❌ [${i + 1}/${uniqueSkus.length}] SKU ${sku}: Цена не найдена`);
            console.log(`📄 JSON preview (${jsonText?.length || 0} chars): ${jsonPreview}`);
          }

          requestCount++;
        } catch (error) {
          console.log(`💥 [${i + 1}/${uniqueSkus.length}] SKU ${sku}: Ошибка - ${error.message}`);
          results.push({ sku, price: 'Ошибка загрузки', success: false, error: error.message });
          requestCount++;
        }

        // Перезапуск браузера каждые N запросов для избежания капчи
        if (requestCount >= requestsBeforeRestart && i < uniqueSkus.length - 1) {
          console.log(`🔄 Превентивный перезапуск браузера после ${requestCount} запросов...`);
          try { await driver.quit(); } catch (e) {}
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
          driver = await createDriver();
          requestCount = 0;
          requestsBeforeRestart = 10 + Math.floor(Math.random() * 6);
        }

        if (i < uniqueSkus.length - 1) {
          const delay = 500 + Math.random() * 300;
          await driver.sleep(delay);
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
      if (driver) {
        try { await driver.quit(); } catch (e) { console.error('Driver quit error:', e); }
      }
    }
  } catch (error) {
    const isModuleNotFound = error.code === 'MODULE_NOT_FOUND' ||
      (error.message && error.message.includes('Cannot find module'));
    if (isModuleNotFound) {
      return res.status(503).json({
        success: false,
        error: 'Selenium не настроен. Установите: npm install selenium-webdriver chromedriver',
        hint: 'npm install selenium-webdriver chromedriver'
      });
    }
    console.error('Price parsing error:', error);
    res.status(503).json({
      success: false,
      error: error.message || String(error),
      hint: 'Перезапустите сервер после npm install.'
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
    console.error('💥 Error analyzing JSON:', error.message);
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
