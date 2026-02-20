const db = require('../db/database');

const OZON_API_URL = 'https://api-seller.ozon.ru';

// Cache for API responses (5 minutes TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCredentials() {
  const settings = db.prepare('SELECT * FROM marketplace_settings WHERE marketplace = ?').get('ozon');
  if (!settings || !settings.client_id || !settings.api_key || !settings.is_active) {
    return null;
  }
  return {
    clientId: settings.client_id,
    apiKey: settings.api_key,
  };
}

// Get all active OZON accounts
function getOzonAccounts() {
  return db.prepare('SELECT * FROM ozon_accounts WHERE is_active = 1').all();
}

async function fetchBalanceForDate(credentials, date, accountId = null) {
  // Check cache first (include accountId in cache key)
  const cacheKey = accountId ? `balance_${accountId}_${date}` : `balance_${date}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const response = await fetch(`${OZON_API_URL}/v1/finance/balance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': credentials.clientId,
      'Api-Key': credentials.apiKey,
    },
    body: JSON.stringify({
      date_from: date,
      date_to: date,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  // Store in cache
  cache.set(cacheKey, { data, timestamp: Date.now() });

  return data;
}

function formatDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchBalanceByDays(dateFrom, dateTo) {
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error('OZON API не настроен или неактивен');
  }

  // Parse dates as local dates (not UTC)
  const [fromYear, fromMonth, fromDay] = dateFrom.split('-').map(Number);
  const [toYear, toMonth, toDay] = dateTo.split('-').map(Number);
  const startDate = new Date(fromYear, fromMonth - 1, fromDay);
  const endDate = new Date(toYear, toMonth - 1, toDay);
  const days = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(formatDateLocal(new Date(d)));
  }

  // Fetch sequentially to avoid rate limiting and ensure consistent order
  const results = [];

  for (const date of days) {
    try {
      const data = await fetchBalanceForDate(credentials, date);
      results.push({ date, data });
    } catch (err) {
      console.error(`Error fetching data for ${date}:`, err.message);
      results.push({ date, data: null });
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Sort by date to ensure consistent order
  results.sort((a, b) => a.date.localeCompare(b.date));

  return results;
}

// Fetch balance data for a specific account from ozon_accounts table
async function fetchBalanceByDaysForAccount(accountId, dateFrom, dateTo) {
  const account = db.prepare('SELECT * FROM ozon_accounts WHERE id = ? AND is_active = 1').get(accountId);
  if (!account) {
    throw new Error('Аккаунт не найден или неактивен');
  }

  const credentials = {
    clientId: account.client_id,
    apiKey: account.api_key,
  };

  // Parse dates as local dates (not UTC)
  const [fromYear, fromMonth, fromDay] = dateFrom.split('-').map(Number);
  const [toYear, toMonth, toDay] = dateTo.split('-').map(Number);
  const startDate = new Date(fromYear, fromMonth - 1, fromDay);
  const endDate = new Date(toYear, toMonth - 1, toDay);
  const days = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(formatDateLocal(new Date(d)));
  }

  // Fetch sequentially to avoid rate limiting and ensure consistent order
  const results = [];

  for (const date of days) {
    try {
      const data = await fetchBalanceForDate(credentials, date, accountId);
      results.push({ date, data });
    } catch (err) {
      console.error(`Error fetching data for ${date}:`, err.message);
      results.push({ date, data: null });
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Sort by date to ensure consistent order
  results.sort((a, b) => a.date.localeCompare(b.date));

  return results;
}

async function fetchBalance(dateFrom, dateTo) {
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error('OZON API не настроен или неактивен');
  }

  const response = await fetch(`${OZON_API_URL}/v1/finance/balance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': credentials.clientId,
      'Api-Key': credentials.apiKey,
    },
    body: JSON.stringify({
      date_from: dateFrom,
      date_to: dateTo,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OZON API ошибка: ${response.status} - ${error}`);
  }

  return response.json();
}

function formatCurrency(amount) {
  if (!amount || amount.value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: amount.currency_code || 'RUB',
    maximumFractionDigits: 2,
  }).format(amount.value);
}

// ============================================
// FORECAST REPORT FUNCTIONS (Multiple accounts)
// ============================================

// Format date to RFC3339 with local timezone (like PHP DATE_RFC3339)
function formatDateRFC3339(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  // Get timezone offset
  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzMinutes = pad(Math.abs(tzOffset) % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMinutes}`;
}

// Fetch FBO orders for a single day (used in parallel fetching)
async function fetchFboOrdersForDay(account, currentDate, nextDate, retryCount = 0) {
  const maxRetries = 3;
  // Use RFC3339 format with local timezone (like PHP)
  const since = formatDateRFC3339(currentDate);
  const to = formatDateRFC3339(nextDate);
  const results = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    try {
      const response = await fetch(`${OZON_API_URL}/v2/posting/fbo/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': account.client_id,
          'Api-Key': account.api_key,
        },
        body: JSON.stringify({
          filter: { since, to },
          limit,
          offset,
        }),
      });

      if (!response.ok) {
        if (response.status === 429 && retryCount < maxRetries) {
          // Rate limited, retry after delay
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          return fetchFboOrdersForDay(account, currentDate, nextDate, retryCount + 1);
        }
        console.error(`FBO API error for ${account.name} on ${formatDateLocal(currentDate)}: ${response.status}`);
        break;
      }

      const data = await response.json();
      const orders = data.result || [];
      results.push(...orders);

      if (orders.length < limit) {
        break;
      }
      offset += limit;
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err) {
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
        return fetchFboOrdersForDay(account, currentDate, nextDate, retryCount + 1);
      }
      console.error(`FBO fetch error for ${account.name}:`, err.message);
      break;
    }
  }

  return results;
}

// Fetch FBO orders for a single account for a date range (parallel requests like PHP curl_multi)
async function fetchFboOrdersForAccount(account, startDate, endDate) {
  const days = [];

  // Build array of day ranges
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const currentDate = new Date(d);
    const nextDate = new Date(d);
    nextDate.setDate(nextDate.getDate() + 1);
    days.push({ currentDate, nextDate });
  }

  // Process in batches of 10 concurrent requests (like PHP maxConcurrentRequests)
  const batchSize = 10;
  const allResults = [];

  for (let i = 0; i < days.length; i += batchSize) {
    const batch = days.slice(i, i + batchSize);
    const batchPromises = batch.map(({ currentDate, nextDate }) =>
      fetchFboOrdersForDay(account, currentDate, nextDate)
    );

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(orders => allResults.push(...orders));

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < days.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return allResults;
}

// Fetch stock analytics for a single chunk of SKUs
async function fetchStocksChunk(account, chunk, retryCount = 0) {
  const maxRetries = 3;

  try {
    const response = await fetch(`${OZON_API_URL}/v1/analytics/stocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': account.client_id,
        'Api-Key': account.api_key,
      },
      body: JSON.stringify({ skus: chunk }),
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return fetchStocksChunk(account, chunk, retryCount + 1);
      }
      return [];
    }

    const data = await response.json();
    return data.items || [];
  } catch (err) {
    if (retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
      return fetchStocksChunk(account, chunk, retryCount + 1);
    }
    console.error(`Stocks fetch error for ${account.name}:`, err.message);
    return [];
  }
}

// Fetch stock analytics for a single account (parallel requests like PHP curl_multi)
async function fetchStocksForAccount(account, skus) {
  if (!skus || skus.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < skus.length; i += 100) {
    chunks.push(skus.slice(i, i + 100));
  }

  // Fetch all chunks in parallel
  const chunkPromises = chunks.map(chunk => fetchStocksChunk(account, chunk));
  const chunkResults = await Promise.all(chunkPromises);

  // Flatten results
  const results = [];
  chunkResults.forEach(items => results.push(...items));

  return results;
}

// Fetch warehouse data from external API
async function fetchWarehouseData() {
  const cacheKey = 'warehouse_data';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch('https://lkk.smazka.ru/apiv1/get/stock?token=gulldl9yR7XKWadO1L64', {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error(`Warehouse API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.error('Warehouse fetch error:', err.message);
    return [];
  }
}

// Fetch all data for a single account (orders + stocks)
async function fetchAccountData(account, startDate, endDate) {
  console.log(`Fetching data for account: ${account.name}`);
  console.log(`  Period: ${formatDateRFC3339(startDate)} to ${formatDateRFC3339(endDate)}`);

  // Get FBO orders (parallel by day)
  const orders = await fetchFboOrdersForAccount(account, startDate, endDate);
  console.log(`  [${account.name}] Total FBO postings (orders): ${orders.length}`);

  // Aggregate sales by offer_id
  const salesData = {};
  orders.forEach(order => {
    (order.products || []).forEach(product => {
      const offerId = product.offer_id;
      const sku = product.sku;
      if (!salesData[offerId]) {
        salesData[offerId] = { offerId, sku, totalQuantity: 0 };
      }
      salesData[offerId].totalQuantity += product.quantity || 0;
    });
  });

  // Get stocks for this account's SKUs (parallel by chunk)
  const skus = Object.values(salesData).map(s => s.sku);
  const stocks = await fetchStocksForAccount(account, skus);

  // Build stocks map
  const stocksData = {};
  stocks.forEach(item => {
    const sku = item.sku;
    if (!stocksData[sku]) {
      stocksData[sku] = {
        stock: 0,
        transitStock: 0,
        name: item.name || 'N/A',
      };
    }
    stocksData[sku].stock += item.available_stock_count || 0;
    stocksData[sku].transitStock += item.transit_stock_count || 0;
    if (stocksData[sku].name === 'N/A' && item.name) {
      stocksData[sku].name = item.name;
    }
  });

  // Debug: show totals
  const totalOrders = Object.keys(salesData).length;
  const totalQty = Object.values(salesData).reduce((sum, s) => sum + s.totalQuantity, 0);
  console.log(`  [${account.name}] Total SKUs: ${totalOrders}, Total quantity: ${totalQty}`);

  return { accountName: account.name, salesData, stocksData };
}

// Generate forecast report from all active accounts (parallel processing like PHP)
async function generateForecastReport(days) {
  const accounts = getOzonAccounts();

  console.log('=== FORECAST REPORT GENERATION ===');
  console.log(`Requested days: ${days}`);
  console.log(`Active accounts: ${accounts.length}`);
  accounts.forEach(a => console.log(`  - ${a.name} (ID: ${a.client_id})`));

  if (accounts.length === 0) {
    throw new Error('Нет активных аккаунтов OZON. Добавьте аккаунты в настройках интеграции.');
  }

  // Calculate date range (like PHP: yesterday as end, go back N days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 1);
  endDate.setHours(23, 59, 59, 0);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // Count actual days in range
  let dayCount = 0;
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dayCount++;
  }
  console.log(`Date range: ${formatDateLocal(startDate)} to ${formatDateLocal(endDate)}`);
  console.log(`Actual days in range: ${dayCount}`);

  // Fetch data from all accounts in parallel
  const accountPromises = accounts.map(account =>
    fetchAccountData(account, startDate, endDate)
  );
  const accountResults = await Promise.all(accountPromises);

  // Aggregate data from all accounts
  const allSalesData = {}; // offerId -> { offerId, sku, totalQuantity, accounts }
  const allStocksData = {}; // sku -> { stock, transitStock, name }

  accountResults.forEach(({ accountName, salesData, stocksData }) => {
    // Merge sales data
    for (const [offerId, data] of Object.entries(salesData)) {
      if (!allSalesData[offerId]) {
        allSalesData[offerId] = { ...data, accounts: [accountName] };
      } else {
        allSalesData[offerId].totalQuantity += data.totalQuantity;
        allSalesData[offerId].accounts.push(accountName);
      }
    }

    // Merge stocks data
    for (const [sku, data] of Object.entries(stocksData)) {
      if (!allStocksData[sku]) {
        allStocksData[sku] = { ...data };
      } else {
        allStocksData[sku].stock += data.stock;
        allStocksData[sku].transitStock += data.transitStock;
        if (allStocksData[sku].name === 'N/A' && data.name !== 'N/A') {
          allStocksData[sku].name = data.name;
        }
      }
    }
  });

  // Get warehouse data
  const warehouseData = await fetchWarehouseData();
  const warehouseMap = {};
  warehouseData.forEach(item => {
    warehouseMap[item['Артикул']] = {
      freeStock: item['СвободныйОстаток'] || 0,
      category: item['Категория'] || 'N/A',
    };
  });

  // Build report (matching PHP output format)
  const report = Object.values(allSalesData).map(sale => {
    const stock = allStocksData[sale.sku] || { stock: 0, transitStock: 0, name: 'N/A' };
    const warehouse = warehouseMap[sale.offerId] || { freeStock: 0, category: 'N/A' };

    const avgDailySales = days > 0 ? sale.totalQuantity / days : 0;
    const turnover = avgDailySales > 0 ? stock.stock / avgDailySales : 0;

    // Forecast need for 40 days on OZON (PHP formula)
    let forecastNeed = (40 * avgDailySales) - stock.stock - stock.transitStock;
    forecastNeed = forecastNeed > 0 ? Math.round(forecastNeed) : 0;

    // Production need (PHP: forecastNeedProizvodstvo)
    let productionNeed = forecastNeed - warehouse.freeStock;
    productionNeed = productionNeed > 0 ? Math.round(productionNeed) : 0;

    return {
      // camelCase for frontend
      offerId: sale.offerId,
      sku: sale.sku,
      productName: stock.name,
      category: warehouse.category,
      accounts: sale.accounts,
      totalQuantity: sale.totalQuantity,
      avgDailySales,
      availableStock: stock.stock,
      transitStock: stock.transitStock,
      freeStock: warehouse.freeStock,
      turnover: Math.round(turnover * 10) / 10,
      forecastNeed,
      productionNeed,
      // snake_case aliases for PHP compatibility (if needed)
      offer_id: sale.offerId,
      product_name: stock.name,
      total_quantity: sale.totalQuantity,
      avg_daily_sales: avgDailySales,
      available_stock_count: stock.stock,
      transit_stock_count: stock.transitStock,
      free_stock: warehouse.freeStock,
      forecast_need: forecastNeed,
      forecastNeedProizvodstvo: productionNeed,
    };
  });

  // Sort by total quantity descending
  report.sort((a, b) => b.totalQuantity - a.totalQuantity);

  // Get unique categories
  const categories = [...new Set(report.map(r => r.category))].filter(c => c !== 'N/A').sort();

  return {
    report,
    categories,
    startDate: formatDateLocal(startDate),
    endDate: formatDateLocal(endDate),
    start_date: formatDateLocal(startDate),
    end_date: formatDateLocal(endDate),
    totalDays: days,
    total_days: days,
    accountsUsed: accounts.map(a => a.name),
  };
}

// ============================================
// SUPPLY ORDERS FUNCTIONS
// ============================================

async function makeOzonRequest(endpoint, data, clientId, apiKey) {
  const response = await fetch(`${OZON_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': String(clientId),
      'Api-Key': String(apiKey),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`OZON API error ${endpoint}: ${response.status}`, text);
    return { error: `HTTP Error: ${response.status}`, response: text };
  }

  return response.json();
}

async function getBundleItems(bundleIds, clientId, apiKey) {
  if (!bundleIds || bundleIds.length === 0) {
    return { items: [], debug: 'empty_bundle_ids' };
  }

  const allItems = [];
  let lastId = null;
  let hasNext = true;
  let pageCount = 0;
  const maxPages = 50;
  const maxRetriesPerPage = 5;

  while (hasNext && pageCount < maxPages) {
    const bundleData = {
      bundle_ids: bundleIds,
      limit: 100,
    };

    if (lastId !== null) {
      bundleData.last_id = lastId;
    }

    let bundleResponse;
    let attempt = 0;

    // Повторяем запрос при rate limit (HTTP 429), чтобы добить данные по SKU
    while (true) {
      bundleResponse = await makeOzonRequest('/v1/supply-order/bundle', bundleData, clientId, apiKey);

      if (!bundleResponse.error) {
        break;
      }

      const respText = typeof bundleResponse.response === 'string' ? bundleResponse.response : '';
      let isRateLimit = false;
      try {
        const parsed = JSON.parse(respText);
        isRateLimit =
          parsed?.code === 8 ||
          (typeof parsed?.message === 'string' && parsed.message.includes('rate limit per second'));
      } catch (e) {
        if (respText.includes('rate limit per second')) {
          isRateLimit = true;
        }
      }

      if (!isRateLimit || attempt >= maxRetriesPerPage) {
        // Не rate limit или исчерпали попытки — отдаём как ошибку
        console.error(
          '[Поставки] Ошибка bundle без/после ретраев:',
          JSON.stringify(bundleResponse).substring(0, 500),
        );
        return { items: allItems, debug: 'api_error', error: bundleResponse };
      }

      const delayMs = 500 * (attempt + 1);
      console.warn(
        `[Поставки] Rate limit 429 по bundle, попытка ${attempt + 1}/${maxRetriesPerPage}, пауза ${delayMs} мс`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempt++;
    }

    if (!bundleResponse.items) {
      return { items: allItems, debug: 'no_items_field', response: bundleResponse };
    }

    if (Array.isArray(bundleResponse.items)) {
      allItems.push(...bundleResponse.items);
    }

    hasNext = bundleResponse.has_next === true;
    lastId = bundleResponse.last_id || null;
    pageCount++;

    // Небольшая пауза между страницами, чтобы не упираться в лимиты
    if (hasNext) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return { items: allItems, debug: 'success', pages: pageCount };
}

function calculateSkuStats(items) {
  if (!items || items.length === 0) {
    return { unique_sku: 0, total_quantity: 0 };
  }

  const uniqueSkus = new Set();
  let totalQuantity = 0;

  items.forEach(item => {
    if (item.sku !== undefined && item.sku !== null) {
      uniqueSkus.add(item.sku);
    }
    if (item.quantity !== undefined && item.quantity !== null) {
      totalQuantity += item.quantity;
    }
  });

  return {
    unique_sku: uniqueSkus.size,
    total_quantity: totalQuantity,
  };
}

async function getSupplyOrdersForAccount(accountName, clientId, apiKey) {
  console.log(`[Поставки] Загрузка заявок для аккаунта: ${accountName} (Client-Id: ${clientId})`);

  const listData = {
    filter: {
      states: ['DATA_FILLING', 'READY_TO_SUPPLY'],
    },
    last_id: null,
    limit: 100,
    sort_by: 'ORDER_CREATION',
    sort_dir: 'DESC',
  };

  const listResponse = await makeOzonRequest('/v3/supply-order/list', listData, clientId, apiKey);

  if (listResponse.error) {
    console.error(`[Поставки] Ошибка получения списка заявок для ${accountName}:`, listResponse.error);
    return { orders: [], error: listResponse.error, account: accountName };
  }

  if (!listResponse.order_ids || listResponse.order_ids.length === 0) {
    console.log(`[Поставки] Нет активных заявок для ${accountName}`);
    return { orders: [] };
  }

  console.log(`[Поставки] ${accountName}: найдено ${listResponse.order_ids.length} заявок`);

  const detailResponse = await makeOzonRequest('/v3/supply-order/get', {
    order_ids: listResponse.order_ids,
  }, clientId, apiKey);

  if (detailResponse.error || !detailResponse.orders) {
    console.error(`[Поставки] Ошибка получения деталей заявок для ${accountName}:`, detailResponse.error);
    return { orders: [], error: detailResponse.error || 'Unknown error', account: accountName };
  }

  let orderIndex = 0;
  for (const order of detailResponse.orders) {
    order.account_name = accountName;

    const bundleIds = [];
    if (order.supplies && Array.isArray(order.supplies)) {
      order.supplies.forEach(supply => {
        if (supply.bundle_id && supply.bundle_id !== '' && supply.bundle_id !== '0') {
          bundleIds.push(supply.bundle_id);
        }
      });
    }

    console.log(`[Поставки] ${accountName} заявка ${order.order_number}: ${order.supplies?.length || 0} поставок, ${bundleIds.length} bundle_ids: [${bundleIds.join(', ')}]`);

    if (bundleIds.length > 0) {
      if (orderIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      const bundleResult = await getBundleItems(bundleIds, clientId, apiKey);
      const items = bundleResult.items || [];
      order.sku_stats = calculateSkuStats(items);
      order._debug_bundle_ids = bundleIds;
      order._debug_items_count = items.length;
      order._debug_bundle_result = bundleResult.debug;
      order._debug_pages = bundleResult.pages || 0;

      if (bundleResult.error) {
        order._debug_error = bundleResult.error;
      }

      // Если после всех попыток bundle ничего не дал (например, из-за лимита),
      // пробуем добрать товары из самой заявки: supplies[*].items
      if (items.length === 0 && bundleResult.debug !== 'success') {
        let fallbackItems = [];
        if (order.supplies && Array.isArray(order.supplies)) {
          order.supplies.forEach(supply => {
            if (Array.isArray(supply.items)) {
              fallbackItems.push(...supply.items);
            }
          });
        }

        if (fallbackItems.length > 0) {
          const stats = calculateSkuStats(fallbackItems);
          order.sku_stats = stats;
          order._debug_fallback_items = true;
          order._debug_items_count = fallbackItems.length;
          console.warn(
            `[Поставки] ${accountName} заявка ${order.order_number}: fallback по supplies.items после ошибки bundle, товаров: ${fallbackItems.length}, SKU: ${stats.unique_sku}, кол-во: ${stats.total_quantity}`,
          );
        }
      }

      console.log(
        `[Поставки] ${accountName} заявка ${order.order_number}: получено ${order._debug_items_count} товаров, SKU: ${order.sku_stats.unique_sku}, кол-во: ${order.sku_stats.total_quantity}, debug: ${bundleResult.debug}`,
      );

      if (bundleResult.debug !== 'success') {
        console.error(`[Поставки] Bundle debug info:`, JSON.stringify(bundleResult).substring(0, 500));
      }
    } else {
      // Фолбэк: пытаемся посчитать SKU напрямую из supplies[*].items,
      // если OZON не вернул bundle_id, но товары есть в самой заявке.
      let fallbackItems = [];
      if (order.supplies && Array.isArray(order.supplies)) {
        order.supplies.forEach(supply => {
          if (Array.isArray(supply.items)) {
            fallbackItems.push(...supply.items);
          }
        });
      }

      if (fallbackItems.length > 0) {
        const stats = calculateSkuStats(fallbackItems);
        order.sku_stats = stats;
        order._debug_no_bundle = false;
        order._debug_fallback_items = true;
        order._debug_items_count = fallbackItems.length;
        console.log(
          `[Поставки] ${accountName} заявка ${order.order_number}: fallback по supplies.items, товаров: ${fallbackItems.length}, SKU: ${stats.unique_sku}, кол-во: ${stats.total_quantity}`,
        );
      } else {
        order.sku_stats = { unique_sku: 0, total_quantity: 0 };
        order._debug_no_bundle = true;
        console.log(
          `[Поставки] ${accountName} заявка ${order.order_number}: нет bundle_id и fallback-товаров, supplies raw:`,
          JSON.stringify(order.supplies || []).substring(0, 300),
        );
      }
    }

    orderIndex++;
  }

  return detailResponse;
}

async function getSupplyOrders() {
  const accounts = getOzonAccounts();

  if (accounts.length === 0) {
    throw new Error('Нет активных аккаунтов OZON. Добавьте аккаунты в настройках интеграции.');
  }

  const allOrders = [];
  const errors = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    try {
      const result = await getSupplyOrdersForAccount(
        account.name,
        account.client_id,
        account.api_key
      );

      if (result.error) {
        errors.push({ account: account.name, error: result.error });
      }

      if (result.orders && Array.isArray(result.orders)) {
        allOrders.push(...result.orders);
      }
    } catch (err) {
      errors.push({ account: account.name, error: err.message });
    }

    // Delay between accounts
    if (i < accounts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  const response = { orders: allOrders };
  if (errors.length > 0) {
    response._debug_errors = errors;
  }

  return response;
}

module.exports = {
  getCredentials,
  getOzonAccounts,
  fetchBalance,
  fetchBalanceByDays,
  fetchBalanceByDaysForAccount,
  formatCurrency,
  generateForecastReport,
  getSupplyOrders,
};
