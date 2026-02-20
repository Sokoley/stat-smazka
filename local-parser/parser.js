#!/usr/bin/env node
/**
 * Локальный парсер цен Ozon (Selenium)
 *
 * Парсит страницы товаров вместо API для обхода блокировок.
 *
 * Использование:
 *   npm install
 *   node parser.js https://stat.smazka.ru
 */

const SERVER_URL = process.argv[2] || 'https://stat.smazka.ru';
const POLL_INTERVAL = 5000;
const PARSE_DELAY = 2000; // Увеличенная задержка

const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const OZON_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let driver = null;

// Задержка
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Инициализация браузера
async function initBrowser() {
  if (driver) return;

  console.log('🚀 Запуск браузера...');

  const options = new chrome.Options();
  // НЕ headless - показываем браузер для обхода детекции
  // options.addArguments('--headless=new');
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-dev-shm-usage');
  options.addArguments('--disable-blink-features=AutomationControlled');
  options.addArguments('--disable-automation');
  options.addArguments('--window-size=1920,1080');
  options.addArguments(`--user-agent=${OZON_UA}`);
  options.addArguments('--disable-extensions');
  options.excludeSwitches(['enable-automation']);
  options.setUserPreferences({
    'credentials_enable_service': false,
    'profile.password_manager_enabled': false
  });

  driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  await driver.manage().setTimeouts({ implicit: 10000, pageLoad: 30000 });

  // Скрываем webdriver
  await driver.executeScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  `);

  // Прогрев - заходим на главную
  try {
    console.log('🔄 Прогрев сессии...');
    await driver.get('https://www.ozon.ru');
    await delay(3000);
    console.log('✅ Браузер готов');
  } catch (e) {
    console.log('⚠️ Прогрев:', e.message);
  }
}

// Закрытие браузера
async function closeBrowser() {
  if (driver) {
    try {
      await driver.quit();
    } catch (e) {}
    driver = null;
  }
}

// Парсинг цены со страницы товара
async function parseSku(sku) {
  if (!driver) await initBrowser();

  try {
    // Переходим на страницу товара
    const url = `https://www.ozon.ru/product/${sku}/`;
    console.log(`   Загрузка: ${url}`);

    await driver.get(url);
    await delay(2000 + Math.random() * 1000);

    // Проверяем на блокировку
    const pageSource = await driver.getPageSource();
    if (pageSource.includes('Доступ ограничен') ||
        pageSource.includes('не бот') ||
        pageSource.includes('Подтвердите')) {
      return { success: false, error: 'blocked', needRestart: true };
    }

    // Ищем цену с картой Ozon
    let price = null;

    // Способ 1: ищем через data-widget="webPrice"
    try {
      const priceWidget = await driver.findElement(By.css('[data-widget="webPrice"]'));
      const priceText = await priceWidget.getText();

      // Ищем цену с картой (обычно вторая цена или с пометкой "с Ozon Картой")
      const priceMatch = priceText.match(/(\d[\d\s]*)\s*₽/g);
      if (priceMatch && priceMatch.length > 0) {
        // Берём первую найденную цену (обычно это цена с картой)
        price = priceMatch[0].trim();
      }
    } catch (e) {}

    // Способ 2: ищем span с ценой
    if (!price) {
      try {
        const priceElements = await driver.findElements(By.css('span[class*="price"], span[class*="Price"]'));
        for (const el of priceElements) {
          const text = await el.getText();
          if (text.includes('₽')) {
            price = text.trim();
            break;
          }
        }
      } catch (e) {}
    }

    // Способ 3: ищем в JSON-LD
    if (!price) {
      try {
        const scripts = await driver.findElements(By.css('script[type="application/ld+json"]'));
        for (const script of scripts) {
          const content = await script.getAttribute('innerHTML');
          const priceMatch = content.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
          if (priceMatch) {
            price = priceMatch[1] + ' ₽';
            break;
          }
        }
      } catch (e) {}
    }

    if (price) {
      return { success: true, price };
    } else {
      return { success: false, error: 'price_not_found' };
    }

  } catch (e) {
    console.log(`   Ошибка: ${e.message}`);
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
  } catch (e) {}
  return null;
}

// Отправка результатов
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
║     Локальный парсер цен Ozon (Selenium)   ║
║                                            ║
║  Сервер: ${SERVER_URL.padEnd(30)}║
║                                            ║
║  Браузер будет виден (не headless)         ║
╚════════════════════════════════════════════╝
  `);

  await initBrowser();

  console.log('🔄 Ожидание заданий...\n');

  let consecutiveBlocks = 0;

  while (true) {
    const task = await getTask();

    if (task && task.skus && task.skus.length > 0) {
      console.log(`\n📋 Получено задание: ${task.skus.length} SKU`);

      const results = [];

      for (let i = 0; i < task.skus.length; i++) {
        const sku = task.skus[i];
        console.log(`🔄 [${i + 1}/${task.skus.length}] SKU: ${sku}`);

        const result = await parseSku(sku);

        if (result.needRestart) {
          consecutiveBlocks++;
          console.log(`🤖 Блокировка! (${consecutiveBlocks}/5)`);

          if (consecutiveBlocks >= 5) {
            console.log('❌ Много блокировок. Пауза 60 сек...');
            await closeBrowser();
            await delay(60000);
            await initBrowser();
            consecutiveBlocks = 0;
          } else {
            await delay(10000);
          }

          i--; // Повторить
          continue;
        }

        consecutiveBlocks = 0;

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

        // Задержка между запросами
        await delay(PARSE_DELAY + Math.random() * 1000);
      }

      console.log(`\n📤 Отправка ${results.length} результатов...`);
      if (await sendResults(results)) {
        console.log('✅ Результаты отправлены\n');
      } else {
        console.log('❌ Ошибка отправки\n');
      }
    }

    await delay(POLL_INTERVAL);
  }
}

process.on('SIGINT', async () => {
  console.log('\n👋 Завершение...');
  await closeBrowser();
  process.exit(0);
});

main().catch(console.error);
