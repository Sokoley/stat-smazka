import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

async function testSelenium() {
  let driver = null;
  
  try {
    console.log('=== ТЕСТ SELENIUM ===');
    
    const options = new chrome.Options();
    options.addArguments('--window-size=1400,1000');
    options.addArguments('--disable-blink-features=AutomationControlled');
    options.addArguments('--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();
    
    console.log('1. Открываем главную страницу Ozon...');
    await driver.get('https://www.ozon.ru');
    await driver.sleep(3000);
    
    console.log('2. Переходим на страницу товара...');
    await driver.get('https://www.ozon.ru/product/279073839/');
    await driver.sleep(5000);
    
    console.log('3. Получаем заголовок страницы...');
    const title = await driver.getTitle();
    console.log('Заголовок:', title);
    
    console.log('4. Получаем исходный код страницы...');
    const pageSource = await driver.getPageSource();
    
    // Сохраняем HTML для анализа
    const fs = await import('fs');
    fs.writeFileSync('ozon-page.html', pageSource);
    console.log('HTML сохранен в ozon-page.html');
    
    // Ищем цену
    console.log('5. Ищем цену на странице...');
    
    // Попробуем несколько селекторов
    const selectors = [
      'span[data-widget="webPrice"]',
      '.a2a0',
      '.ui-q4',
      '.q4',
      '.price',
      '[class*="price"]',
      '[class*="Price"]',
      'div:contains("₽")',
      'span:contains("₽")'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = await driver.findElements(By.css(selector));
        for (const element of elements) {
          const text = await element.getText();
          if (text.includes('₽')) {
            console.log(`Нашли по селектору "${selector}": ${text}`);
          }
        }
      } catch (e) {}
    }
    
    // Ищем в исходном коде
    console.log('6. Ищем в исходном коде...');
    const priceMatches = [
      ...pageSource.matchAll(/"price":"([^"]+)"/g),
      ...pageSource.matchAll(/"cardPrice":"([^"]+)"/g),
      ...pageSource.matchAll(/"ozonCardPrice":"([^"]+)"/g),
      ...pageSource.matchAll(/(\d[\d\s]*₽)/g)
    ];
    
    for (const match of priceMatches) {
      if (match[1]) {
        console.log('Нашли в коде:', match[1]);
      }
    }
    
    console.log('=== ТЕСТ ЗАВЕРШЕН ===');
    
  } catch (error) {
    console.error('Ошибка теста:', error);
  } finally {
    if (driver) {
      await driver.quit();
      console.log('Драйвер закрыт');
    }
  }
}

testSelenium();