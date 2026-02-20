#!/usr/bin/env node
/**
 * Локальный парсер цен Ozon
 *
 * Запускается на домашнем ПК, получает задания с сервера,
 * парсит цены и отправляет результаты обратно.
 *
 * Использование:
 *   npm install
 *   node parser.js https://stat.smazka.ru
 */

const SERVER_URL = process.argv[2] || 'https://stat.smazka.ru';
const POLL_INTERVAL = 5000; // Проверять задания каждые 5 сек
const PARSE_DELAY = 1000; // Задержка между парсингом SKU

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const OZON_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let browser = null;
let page = null;

// Инициализация браузера
async function initBrowser() {
  if (browser) return;

  console.log('🚀 Запуск браузера...');
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  page = await browser.newPage();
  await page.setUserAgent(OZON_UA);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
  });

  // Прогрев
  try {
    await page.goto('https://www.ozon.ru', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);
    console.log('✅ Браузер готов');
  } catch (e) {
    console.log('⚠️ Прогрев не удался:', e.message);
  }
}

// Закрытие браузера
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// Задержка
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Извлечение цены из JSON
function extractOzonCardPrice(jsonText) {
  try {
    const patterns = [
      /"cardPrice"\s*:\s*"([^"]+)"/,
      /\{"isAvailable":true,"cardPrice":"([^"]+)"/,
      /"ozonCardPrice":"([^"]+)"/
    ];

    for (const pattern of patterns) {
      const match = jsonText.match(pattern);
      if (match && match[1] && match[1].includes('₽')) {
        return match[1].trim();
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Парсинг одного SKU
async function parseSku(sku) {
  if (!page) await initBrowser();

  try {
    const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fproduct%2F${sku}`;
    await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(500 + Math.random() * 500);

    const jsonText = await page.evaluate(() => {
      const pre = document.querySelector('pre');
      if (pre) return pre.textContent;
      return document.body.textContent || '';
    });

    // Проверка на блокировку
    if (jsonText.includes('Доступ ограничен') || jsonText.includes('не бот')) {
      return { success: false, error: 'blocked', needRestart: true };
    }

    const price = extractOzonCardPrice(jsonText);
    return {
      success: !!price,
      price: price || 'Цена не найдена',
      error: price ? null : 'price_not_found'
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Получение заданий с сервера
async function getTask() {
  try {
    const response = await fetch(`${SERVER_URL}/pricecheck/api/parser/task`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // Сервер недоступен
  }
  return null;
}

// Отправка результатов на сервер
async function sendResults(results) {
  try {
    const response = await fetch(`${SERVER_URL}/pricecheck/api/parser/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results })
    });
    return response.ok;
  } catch (e) {
    console.error('❌ Ошибка отправки:', e.message);
    return false;
  }
}

// Основной цикл
async function main() {
  console.log(`
╔════════════════════════════════════════════╗
║     Локальный парсер цен Ozon              ║
║                                            ║
║  Сервер: ${SERVER_URL.padEnd(30)}║
╚════════════════════════════════════════════╝
  `);

  await initBrowser();

  console.log('🔄 Ожидание заданий...');

  while (true) {
    const task = await getTask();

    if (task && task.skus && task.skus.length > 0) {
      console.log(`\n📋 Получено задание: ${task.skus.length} SKU`);

      const results = [];
      let blockedCount = 0;

      for (let i = 0; i < task.skus.length; i++) {
        const sku = task.skus[i];
        console.log(`🔄 [${i + 1}/${task.skus.length}] SKU: ${sku}`);

        const result = await parseSku(sku);

        if (result.needRestart) {
          console.log('🤖 Блокировка! Перезапуск браузера...');
          await closeBrowser();
          await delay(5000);
          await initBrowser();
          blockedCount++;

          if (blockedCount > 3) {
            console.log('❌ Слишком много блокировок, пауза 30 сек...');
            await delay(30000);
            blockedCount = 0;
          }

          i--; // Повторить этот SKU
          continue;
        }

        results.push({
          sku,
          price: result.price || 'Ошибка',
          success: result.success,
          error: result.error
        });

        if (result.success) {
          console.log(`✅ ${sku}: ${result.price}`);
        } else {
          console.log(`❌ ${sku}: ${result.error}`);
        }

        await delay(PARSE_DELAY + Math.random() * 500);
      }

      // Отправка результатов
      console.log(`\n📤 Отправка ${results.length} результатов...`);
      const sent = await sendResults(results);
      if (sent) {
        console.log('✅ Результаты отправлены');
      } else {
        console.log('❌ Ошибка отправки результатов');
      }
    }

    await delay(POLL_INTERVAL);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Завершение работы...');
  await closeBrowser();
  process.exit(0);
});

main().catch(console.error);
