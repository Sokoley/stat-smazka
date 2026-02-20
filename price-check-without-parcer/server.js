import express from 'express';
import cors from 'cors';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Создаем директорию для данных
const DATA_DIR = path.join(__dirname, 'data');
try {
  await fs.mkdir(DATA_DIR, { recursive: true });
  console.log('📁 Директория для данных создана:', DATA_DIR);
} catch (error) {
  console.error('Ошибка создания директории:', error);
}

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    info: 'Ozon Card Price Parser API',
    dataDir: DATA_DIR
  });
});

app.post('/api/parse-prices', async (req, res) => {
  const { skus } = req.body;
  
  console.log('📦 Получен запрос на парсинг SKU:', skus);
  
  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Не предоставлены SKU или пустой массив' 
    });
  }

  let driver = null;
  const results = [];
  const uniqueSkus = [...new Set(skus.filter(sku => sku && sku.toString().trim().length > 0))];

  if (uniqueSkus.length === 0) {
    return res.json({ 
      success: false, 
      error: 'Нет валидных SKU для парсинга' 
    });
  }

  console.log(`🔍 Начинаем парсинг ${uniqueSkus.length} уникальных SKU через JSON API Ozon`);

  try {
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');
    options.addArguments('--window-size=1920,1080');
    options.addArguments('--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    options.addArguments('--disable-blink-features=AutomationControlled');
    options.addArguments('--disable-automation');

    console.log('🚀 Инициализация ChromeDriver...');
    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    console.log('✅ ChromeDriver успешно инициализирован');

    await driver.manage().setTimeouts({
      implicit: 15000,
      pageLoad: 30000,
      script: 30000
    });

    // Получаем куки с главной страницы Ozon
    console.log('🍪 Получаем куки с главной страницы Ozon...');
    try {
      await driver.get('https://www.ozon.ru');
      await driver.sleep(2000);
      console.log('✅ Куки получены');
    } catch (e) {
      console.log('⚠️ Не удалось получить куки:', e.message);
    }

    // Парсим цены для каждого SKU
    for (let i = 0; i < uniqueSkus.length; i++) {
      const sku = uniqueSkus[i].toString().trim();
      console.log(`\n[${i + 1}/${uniqueSkus.length}] 🔎 Парсим SKU: ${sku}`);
      
      try {
        const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fproduct%2F${sku}`;
        console.log(`📡 Запрашиваем: ${apiUrl}`);
        
        await driver.get(apiUrl);
        
        let jsonText = '';
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && (!jsonText || jsonText.length < 50)) {
          try {
            await driver.wait(until.elementLocated(By.css('body')), 10000);
            
            try {
              const preElement = await driver.findElement(By.css('pre'));
              jsonText = await preElement.getText();
              console.log(`📄 Получили JSON из pre (${jsonText.length} символов)`);
            } catch (preError) {
              const bodyElement = await driver.findElement(By.css('body'));
              jsonText = await bodyElement.getText();
              console.log(`📄 Получили текст из body (${jsonText.length} символов)`);
            }
            
            if (jsonText.length < 50) {
              console.log(`⏳ Текст слишком короткий (${jsonText.length}), жду еще...`);
              await driver.sleep(2000);
              attempts++;
            }
          } catch (waitError) {
            console.log(`⏳ Ожидание загрузки... попытка ${attempts + 1}/${maxAttempts}`);
            await driver.sleep(2000);
            attempts++;
          }
        }
        
        if (!jsonText || jsonText.length < 50) {
          throw new Error(`Не удалось получить JSON для SKU ${sku}`);
        }
        
        let cardPrice = extractOzonCardPrice(jsonText);
        
        if (cardPrice) {
          console.log(`✅ Найдена цена Ozon Card для ${sku}: ${cardPrice}`);
          results.push({
            sku,
            price: cardPrice,
            success: true,
            source: 'json_api'
          });
        } else {
          console.log(`❌ Цена Ozon Card не найдена в JSON для SKU ${sku}`);
          
          const debugJson = jsonText.substring(0, 1000);
          console.log(`🔍 Первые 1000 символов JSON: ${debugJson}...`);
          
          results.push({
            sku,
            price: 'Цена не найдена',
            success: false,
            error: 'cardPrice not found in JSON',
            debug: debugJson
          });
        }
        
      } catch (error) {
        console.error(`💥 Ошибка при парсинге ${sku}:`, error.message);
        results.push({
          sku,
          price: 'Ошибка загрузки',
          success: false,
          error: error.message
        });
      }
      
      if (i < uniqueSkus.length - 1) {
        const delay = 3000 + Math.random() * 2000;
        console.log(`⏸️  Задержка ${Math.round(delay)}мс перед следующим запросом`);
        await driver.sleep(delay);
      }
    }
    
    console.log('\n🎉 Парсинг завершен!');
    console.log('📊 Результаты:', results);
    
    const successful = results.filter(r => r.success && r.price && !r.price.includes('не найдена')).length;
    const failed = results.length - successful;
    
    res.json({ 
      success: successful > 0,
      results,
      summary: {
        total: results.length,
        successful,
        failed
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('💥 Критическая ошибка:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (driver) {
      try {
        console.log('🛑 Закрываю ChromeDriver...');
        await driver.quit();
        console.log('✅ ChromeDriver успешно закрыт');
      } catch (e) {
        console.error('⚠️ Ошибка закрытия драйвера:', e);
      }
    }
  }
});

// API для работы с данными
app.get('/api/data/files', async (req, res) => {
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
        const competitorCount = data.competitorSelections ? 
          Object.values(data.competitorSelections).reduce((acc, competitors) => acc + competitors.length, 0) : 0;
        
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
        console.error(`Ошибка чтения файла ${file}:`, error);
      }
    }
    
    res.json({
      success: true,
      files: filesInfo,
      count: jsonFiles.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Ошибка получения списка файлов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/data/load/:filename', async (req, res) => {
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
    console.error('Ошибка загрузки данных:', error);
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

app.post('/api/data/save', async (req, res) => {
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
    
    console.log(`💾 Данные сохранены в файл: ${safeFilename} (${JSON.stringify(dataWithTimestamp).length} байт)`);
    
    res.json({
      success: true,
      filename: safeFilename,
      size: JSON.stringify(dataWithTimestamp).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Ошибка сохранения данных:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/data/delete/:filename', async (req, res) => {
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
    
    console.log(`🗑️ Файл удалён: ${filename}`);
    
    res.json({
      success: true,
      message: 'Файл успешно удалён',
      filename: filename,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Ошибка удаления файла:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code 
    });
  }
});

app.post('/api/data/backup', async (req, res) => {
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
    console.error('Ошибка создания бэкапа:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/data/all', async (req, res) => {
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
    console.error('Ошибка чтения данных:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function extractOzonCardPrice(jsonText) {
  try {
    console.log('🔍 Анализируем JSON для поиска cardPrice...');
    
    const exactPattern = /"cardPrice"\s*:\s*"([^"]+)"\s*(?:,|})/;
    const exactMatch = jsonText.match(exactPattern);
    
    if (exactMatch && exactMatch[1]) {
      const price = exactMatch[1].trim();
      console.log(`✅ Нашли по точному паттерну: ${price}`);
      return price;
    }
    
    const patterns = [
      /\{"isAvailable":true,"cardPrice":"([^"]+)"/,
      /"cardPrice"\s*:\s*"([^"]+)"/,
      /cardPrice&quot;:&quot;([^&]+)&quot;/,
      /cardPrice[^:]*:\s*["']([^"']+)["']/,
      /cardPrice[^:]*:\s*"([\d\s]+ ₽)"/,
      /ozonCardPrice[^:]*:\s*["']([^"']+)["']/,
      /"ozonCardPrice":"([^"]+)"/
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = jsonText.match(pattern);
      if (match && (match[1] || match[0])) {
        const price = (match[1] || match[0]).trim();
        console.log(`✅ Нашли по паттерну ${i + 1}: ${price}`);
        
        if (isValidPrice(price)) {
          return price;
        }
      }
    }
    
    try {
      const jsonData = JSON.parse(jsonText);
      const price = findCardPriceInObject(jsonData);
      if (price) {
        console.log(`✅ Нашли рекурсивным поиском: ${price}`);
        return price;
      }
    } catch (parseError) {
      console.log(`⚠️ Не удалось распарсить JSON: ${parseError.message}`);
      
      const cardPriceRegex = /cardPrice[^:]*:\s*["']([^"']+)["']/gi;
      let match;
      while ((match = cardPriceRegex.exec(jsonText)) !== null) {
        if (match[1]) {
          const price = match[1].trim();
          if (isValidPrice(price)) {
            console.log(`✅ Нашли в текстовом поиске: ${price}`);
            return price;
          }
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('💥 Ошибка при анализе JSON:', error.message);
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

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`🚀 Сервер парсинга Ozon Card цен запущен`);
  console.log(`📍 Порт: ${PORT}`);
  console.log(`📁 Директория данных: ${DATA_DIR}`);
  console.log(`📅 Дата: ${new Date().toISOString()}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 API парсинга: POST http://localhost:${PORT}/api/parse-prices`);
  console.log(`💾 API данных: GET http://localhost:${PORT}/api/data/files`);
  console.log(`========================================`);
});