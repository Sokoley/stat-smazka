const fs = require('fs');
const path = require('path');

const API_URL = 'http://ws1c01.vmpauto.io/db_unf/hs/views/downloadData/getRemainderPromotional';
const API_USERNAME = 'http_service';
const API_PASSWORD = '911';

const CACHE_FILE = path.join(__dirname, '../../data/pos_cache.json');
const CACHE_DURATION = 3000000 * 1000; // Cache duration in ms

// Images directory
const IMAGES_DIR = path.join(__dirname, '../public/images/products');

// Ensure directories exist
function ensureDirectories() {
  const dataDir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

// Fetch data from API with Basic Auth
async function fetchDataFromServer() {
  const credentials = Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString('base64');

  const response = await fetch(API_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// Save data to cache
function saveDataToCache(data) {
  ensureDirectories();
  const cacheData = {
    timestamp: Date.now(),
    data: data
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
}

// Get data from cache
function getDataFromCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CACHE_FILE, 'utf8');
    const cacheData = JSON.parse(content);

    // Handle both PHP (seconds) and JS (milliseconds) timestamp formats
    let timestamp = cacheData.timestamp;
    if (timestamp < 10000000000) {
      // PHP timestamp in seconds, convert to milliseconds
      timestamp = timestamp * 1000;
    }

    // Check if cache is expired
    if (Date.now() - timestamp > CACHE_DURATION) {
      return null;
    }

    return { ...cacheData, timestamp };
  } catch (e) {
    return null;
  }
}

// Get cache info (timestamp)
function getCacheInfo() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }
  try {
    const content = fs.readFileSync(CACHE_FILE, 'utf8');
    const cacheData = JSON.parse(content);
    return {
      timestamp: cacheData.timestamp,
      date: new Date(cacheData.timestamp)
    };
  } catch (e) {
    return null;
  }
}

// Create safe filename from product name (PHP-compatible byte-level processing)
function getSafeProductName(productName) {
  // PHP's preg_replace works on bytes, not Unicode characters
  // So we need to convert to latin1 (treating UTF-8 bytes as single chars) and then replace
  const phpStyle = Buffer.from(productName, 'utf8')
    .toString('latin1')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .toLowerCase();
  return phpStyle;
}

// Get product image path
function getProductImage(productName) {
  const safeName = getSafeProductName(productName);
  const formats = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

  for (const format of formats) {
    const imagePath = path.join(IMAGES_DIR, safeName + format);
    if (fs.existsSync(imagePath)) {
      return '/images/products/' + safeName + format;
    }
  }

  return null;
}

// Delete old images for a product
function deleteOldProductImages(productName) {
  const safeName = getSafeProductName(productName);
  const formats = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

  for (const format of formats) {
    const imagePath = path.join(IMAGES_DIR, safeName + format);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }
}

// Safe get value from object
function safeGet(obj, key, defaultValue = '') {
  return obj && obj[key] !== undefined ? obj[key] : defaultValue;
}

// Process and sort data
function processData(data) {
  // Sort by total quantity descending
  data.sort((a, b) => {
    const totalA = safeGet(a, 'Склады', []).reduce((sum, w) => sum + parseInt(safeGet(w, 'Остаток', 0)), 0);
    const totalB = safeGet(b, 'Склады', []).reduce((sum, w) => sum + parseInt(safeGet(w, 'Остаток', 0)), 0);
    return totalB - totalA;
  });

  // Filter out items with zero total
  data = data.filter(item => {
    const total = safeGet(item, 'Склады', []).reduce((sum, w) => sum + parseInt(safeGet(w, 'Остаток', 0)), 0);
    return total > 0;
  });

  // Get all unique warehouses
  const allWarehouses = [];
  data.forEach(item => {
    const warehouses = safeGet(item, 'Склады', []);
    warehouses.forEach(warehouse => {
      const warehouseName = safeGet(warehouse, 'Наименование', '');
      if (warehouseName && !allWarehouses.includes(warehouseName)) {
        allWarehouses.push(warehouseName);
      }
    });
  });

  // Process each item
  const processedData = data.map((item, index) => {
    const productName = safeGet(item, 'Номенклатура', 'Без названия');
    const category = safeGet(item, 'Категория', 'Без категории');
    const warehouses = safeGet(item, 'Склады', []);

    const warehouseRemainders = {};
    const warehouseDetails = [];

    warehouses.forEach(warehouse => {
      const warehouseName = safeGet(warehouse, 'Наименование', '');
      const quantity = parseInt(safeGet(warehouse, 'Остаток', 0));

      if (warehouseName) {
        warehouseRemainders[warehouseName] = quantity;
        warehouseDetails.push({
          name: warehouseName,
          quantity: quantity
        });
      }
    });

    const totalRemainder = Object.values(warehouseRemainders).reduce((sum, q) => sum + q, 0);

    return {
      id: index + 1,
      productName,
      category,
      safeProductName: getSafeProductName(productName),
      imagePath: getProductImage(productName),
      warehouseRemainders,
      warehouseDetails,
      totalRemainder
    };
  });

  // Calculate warehouse totals
  const warehouseTotals = {};
  allWarehouses.forEach(w => warehouseTotals[w] = 0);

  processedData.forEach(item => {
    allWarehouses.forEach(warehouse => {
      warehouseTotals[warehouse] += item.warehouseRemainders[warehouse] || 0;
    });
  });

  const grandTotal = Object.values(warehouseTotals).reduce((sum, t) => sum + t, 0);

  return {
    items: processedData,
    allWarehouses,
    warehouseTotals,
    grandTotal,
    totalItems: processedData.length
  };
}

// Main function to get promotional data
async function getPromotionalData() {
  ensureDirectories();

  let data = null;
  let fromCache = false;
  let serverAvailable = false;
  let cacheTime = null;

  // Try to fetch from server
  try {
    data = await fetchDataFromServer();
    serverAvailable = true;
    saveDataToCache(data);
  } catch (e) {
    console.error('Error fetching from server:', e.message);
    serverAvailable = false;

    // Try to get from cache
    const cachedData = getDataFromCache();
    if (cachedData) {
      data = cachedData.data;
      fromCache = true;
      cacheTime = new Date(cachedData.timestamp);
    } else {
      throw new Error('Сервер недоступен и нет актуальных данных в кэше.');
    }
  }

  if (!data) {
    throw new Error('Не удалось получить данные');
  }

  const processedData = processData(data);

  return {
    ...processedData,
    fromCache,
    serverAvailable,
    cacheTime,
    updateTime: new Date()
  };
}

module.exports = {
  getPromotionalData,
  getProductImage,
  getSafeProductName,
  deleteOldProductImages,
  IMAGES_DIR
};
