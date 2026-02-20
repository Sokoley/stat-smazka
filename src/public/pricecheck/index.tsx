// React is available globally from CDN
const { useState, useEffect, useMemo, useRef } = React;
const { createRoot } = ReactDOM;
// Chart.js is available globally from CDN
const Chart = window.Chart;

// Type definitions for global libraries
declare global {
  interface Window {
    XLSX: any;
  }
}

// Configuration
const VMP_API_URL = "https://lkk.smazka.ru/apiv1/get/pps?token=gulldl9yR7XKWadO1L64&t=actual&pc=0&cm=8";
const VMP_AUTH = null;

const OZON_ACCOUNTS = [
  { name: 'account1', client_id: '106736', api_key: '5cf6e47b-0f73-4b23-b8cd-6a097e7cd60d' },
  { name: 'account2', client_id: '224361', api_key: '7ac7cd44-9acf-47b5-b7ca-30de0a46f5d0' },
  { name: 'account3', client_id: '224458', api_key: '7e634373-5841-4eaf-9cef-b5afebe888ac' }
];

// API URLs
const PARSER_API_URL = '/pricecheck/api';
const DEFAULT_DATA_FILENAME = 'price_regulator_data';

// Types
interface VmpItem {
  Номенклатура: string;
  ВидТовара: string;
  Артикул: string;
  Процент: number;
  ФСС: number;
}

interface OzonProductPrice {
  offer_id: string;
  sku: number;
  customer_price: {
    amount: string;
    currency: string;
  };
  price: {
    amount: string;
    currency: string;
  };
  discount_percent: number;
}

interface OzonPriceResponse {
  prices: OzonProductPrice[];
}


interface OzonProductInfo {
  product_id?: number;
  offer_id: string;
  sku?: number;
  price?: string;
  primary_image?: string;
  images?: string[];
  is_archived: boolean;
  description_category_id?: number;
  type_id?: number;
}

interface OzonPriceDetails {
  offer_id: string;
  sku: number;
  price: {
    amount: string;
    currency: string;
  };
  customer_price: {
    amount: string;
    currency: string;
  };
  discount_percent: number;
}

interface OzonItem {
  offer_id: string;
  sku?: number;
  price: string;
  customer_price?: string;
  primary_image?: string;
  images?: string[];
  is_archived: boolean;
  description_category_id?: number;
  type_id?: number;
}

interface PriceHistoryItem {
  price: string;
  priceNumber: number; // Добавляем числовое значение для графиков
  date: string;
  source: string;
  qty?: string | number;
  sum?: string | number;
  qtyNumber?: number; // Числовое значение для графиков
  sumNumber?: number; // Числовое значение для графиков
}

interface CompetitorRow {
  name: string;
  brand: string;
  link: string;
  qty: string | number;
  sum: string | number;
  originalIndex: number;
  ozonCardPrice?: string;
  sku?: string;
  lastUpdated?: string;
  priceHistory: PriceHistoryItem[];
}

// Данные о продажах из Ozon API
interface OzonSalesData {
  qty: number;      // количество
  sum: number;      // сумма продаж
}

interface AppState {
  vmpData: VmpItem[];
  ozonData: Record<string, OzonItem>;
  ozonPrices: Record<string, OzonProductPrice>; // Добавьте эту строку
  loading: boolean;
  error: string | null;
  selectedType: string | null;
  uploadedFiles: Record<string, any[][]>;
  usingFallback: boolean;
  competitorSelections: Record<string, CompetitorRow[]>;
  activeModalSku: string | null;
  isParsingPrices: boolean;
  parsedPrices: Record<string, Record<string, string>>;
  searchTerm: string;
  filteredRows: number[] | null;
  expandedProducts: Record<string, boolean>;
  salesData: Record<string, OzonSalesData>; // Данные о продажах по SKU
  salesLoading: boolean;
  ozonCategories: Record<number, string>; // ID категории -> Название категории
  collapsedCategories: Record<string, boolean>; // Свёрнутые подкатегории
}

interface DataFileInfo {
  name: string;
  size: number;
  modified: Date;
  created: Date;
  itemCount: number;
  competitorCount: number;
  lastUpdated?: string;
}

// Helper function to extract price as number
const extractPriceNumber = (priceString: string): number => {
  if (!priceString) return 0;
  
  // Remove spaces, currency symbols and any non-numeric characters except dots
  const cleanString = priceString
    .replace(/[^\d.,]/g, '') // Remove non-numeric except dots and commas
    .replace(/,/g, '.') // Replace comma with dot
    .replace(/\s+/g, ''); // Remove all spaces
  
  const number = parseFloat(cleanString);
  return isNaN(number) ? 0 : number;
};

// Добавьте эту функцию в helpers
const getTopCompetitors = (competitors: CompetitorRow[]): {
  topBySum: CompetitorRow | null;
  topByQty: CompetitorRow | null;
  otherCompetitors: CompetitorRow[];
} => {
  if (!competitors || competitors.length === 0) {
    return { topBySum: null, topByQty: null, otherCompetitors: [] };
  }
  
  // Функция для извлечения числового значения из строки/числа
  const extractNumber = (value: string | number): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      // Удаляем все символы кроме цифр и точек
      const num = parseFloat(value.replace(/[^\d.,]/g, '').replace(',', '.'));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };
  
  // Находим топ по сумме
  let topBySum: CompetitorRow | null = null;
  let maxSum = -Infinity;
  
  // Находим топ по количеству
  let topByQty: CompetitorRow | null = null;
  let maxQty = -Infinity;
  
  competitors.forEach(competitor => {
    const sum = extractNumber(competitor.sum);
    const qty = extractNumber(competitor.qty);
    
    if (sum > maxSum) {
      maxSum = sum;
      topBySum = competitor;
    }
    
    if (qty > maxQty) {
      maxQty = qty;
      topByQty = competitor;
    }
  });
  
  // Собираем остальных конкурентов (исключая топы, если они разные)
  const otherCompetitors = competitors.filter(competitor => {
    if (topBySum && competitor === topBySum) return false;
    if (topByQty && competitor === topByQty) return false;
    return true;
  });
  
  return { topBySum, topByQty, otherCompetitors };
};

// Функция для проверки, нужно ли добавлять qty и sum данные
const shouldAddQtySumData = (lastHistoryEntry: PriceHistoryItem | null, currentDate: Date): boolean => {
  if (!lastHistoryEntry) {
    return true; // Первая запись - добавляем всё
  }
  
  const lastDate = new Date(lastHistoryEntry.date);
  const current = new Date(currentDate);
  
  // Разница в миллисекундах
  const diffMs = Math.abs(current.getTime() - lastDate.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  // Возвращаем true если прошло больше 6 дней
  return diffDays > 6;
};

// Добавьте эту функцию
const fetchCompetitorPrices = async (skus: string[]): Promise<Record<string, OzonProductPrice>> => {
  const results: Record<string, OzonProductPrice> = {};
  
  console.log('💰 Загрузка соинвеста для конкурентов:', skus.length);
  
  if (skus.length === 0) {
    console.log('⚠️ Нет SKU конкурентов для загрузки');
    return results;
  }
  
  const CHUNK_SIZE = 100;
  const chunks: string[][] = [];
  
  for (let i = 0; i < skus.length; i += CHUNK_SIZE) {
    chunks.push(skus.slice(i, i + CHUNK_SIZE));
  }

  console.log(`📦 Разделили на ${chunks.length} чанков по ${CHUNK_SIZE} SKU`);
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const skuChunk = chunks[chunkIndex];
    console.log(`\n💳 Чанк ${chunkIndex + 1}/${chunks.length}: Запрашиваем соинвест для ${skuChunk.length} SKU конкурентов`);
    
    let missingPricesInChunk = [...skuChunk];
    
    // Пробуем получить цены с каждого аккаунта
    for (const account of OZON_ACCOUNTS) {
      if (missingPricesInChunk.length === 0) break;
      
      console.log(`🔐 Аккаунт для соинвеста конкурентов: ${account.name}, осталось SKU: ${missingPricesInChunk.length}`);
      
      try {
        const response = await fetch("https://api-seller.ozon.ru/v1/product/prices/details", {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Id': account.client_id,
            'Api-Key': account.api_key
          },
          body: JSON.stringify({ skus: missingPricesInChunk })
        });

        console.log(`📡 Статус ответа v1/product/prices/details: ${response.status}`);
        
        if (response.ok) {
          const data: OzonPriceResponse = await response.json();
          console.log(`💰 Аккаунт ${account.name}: получено ${data.prices?.length || 0} цен с соинвестом для конкурентов`);
          
          if (data.prices && Array.isArray(data.prices)) {
            data.prices.forEach((priceDetail: OzonProductPrice) => {
              if (!results[priceDetail.sku.toString()]) {
                results[priceDetail.sku.toString()] = priceDetail;
                missingPricesInChunk = missingPricesInChunk.filter(sku => sku !== priceDetail.sku.toString());
                console.log(`✅ Соинвест конкурента от ${account.name} для SKU ${priceDetail.sku}: ${priceDetail.discount_percent}`);
              }
            });
          }
        } else {
          const errorText = await response.text();
          console.warn(`❌ Ошибка API v1/product/prices/details у аккаунта ${account.name}: ${response.status}`, errorText.substring(0, 200));
        }
      } catch (e: any) {
        console.warn(`❌ Ошибка получения соинвеста конкурента от аккаунта ${account.name}:`, e.message);
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log(`✅ Чанк ${chunkIndex + 1} завершен, найдено записей: ${Object.keys(results).length}`);
  }
  
  console.log(`\n🎉 Итог: загружено соинвеста для ${Object.keys(results).length} конкурентов`);
  return results;
};

// Добавьте эту функцию в helpers
const calculateRecommendedPrice = (
  competitorPrice: string | number,
  ourDiscountPercent: number | undefined
): {
  priceByCard: string; // Цена по карте - 10
  priceByCoinvest: string; // (Цена по карте - 10) / (1 - соинвест)
  isValid: boolean;
  note: string;
  competitorPriceNum: number;
} => {
  if (!competitorPrice) {
    return { 
      priceByCard: 'Нет данных', 
      priceByCoinvest: 'Нет данных', 
      isValid: false, 
      note: 'Нет цены конкурента',
      competitorPriceNum: 0
    };
  }
  
  try {
    // Преобразуем цену конкурента в число
    const competitorPriceNum = typeof competitorPrice === 'string' 
      ? extractPriceNumber(competitorPrice)
      : competitorPrice;
    
    if (competitorPriceNum <= 0) {
      return { 
        priceByCard: 'Нет данных', 
        priceByCoinvest: 'Нет данных', 
        isValid: false, 
        note: 'Некорректная цена конкурента',
        competitorPriceNum: 0
      };
    }
    
    // Цена по карте - 10
    const priceByCard = competitorPriceNum - 10;
    const roundedPriceByCard = Math.round(priceByCard * 100) / 100;
    const priceByCardFormatted = `${roundedPriceByCard.toLocaleString('ru-RU')} ₽`;
    
    // Если нет соинвеста, возвращаем только цену по карте
    if (ourDiscountPercent === undefined || ourDiscountPercent === null) {
      return {
        priceByCard: priceByCardFormatted,
        priceByCoinvest: 'Нет соинвеста',
        isValid: true,
        note: `Цена по карте: ${competitorPriceNum} - 10 = ${priceByCard}`,
        competitorPriceNum
      };
    }
    
    if (ourDiscountPercent <= 0 || ourDiscountPercent >= 1) {
      return { 
        priceByCard: priceByCardFormatted,
        priceByCoinvest: 'Некорректный соинвест', 
        isValid: false, 
        note: 'Некорректный соинвест',
        competitorPriceNum
      };
    }
    
    // (Цена по карте - 10) / (1 - соинвест)
    const priceByCoinvest = priceByCard / (1 - ourDiscountPercent);
    const roundedPriceByCoinvest = Math.round(priceByCoinvest * 100) / 100;
    const priceByCoinvestFormatted = `${roundedPriceByCoinvest.toLocaleString('ru-RU')} ₽`;

    return {
      priceByCard: priceByCardFormatted,
      priceByCoinvest: priceByCoinvestFormatted,
      isValid: true,
      note: `Формула: (${competitorPriceNum} - 10) / (1 - ${(ourDiscountPercent).toFixed(2)}) = ${roundedPriceByCoinvest}`,
      competitorPriceNum
    };
  } catch (error) {
    return { 
      priceByCard: 'Ошибка', 
      priceByCoinvest: 'Ошибка', 
      isValid: false, 
      note: 'Ошибка в расчетах',
      competitorPriceNum: 0
    };
  }
};

// Helper to extract SKU from Ozon URL
const extractSkuFromUrl = (url: string): string | null => {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    
    const productIndex = pathParts.indexOf('product');
    if (productIndex !== -1 && pathParts[productIndex + 1]) {
      return pathParts[productIndex + 1];
    }
    
    const lastPart = pathParts[pathParts.length - 1];
    const numericMatch = lastPart.match(/\d+/);
    if (numericMatch) {
      return numericMatch[0];
    }
    
    return null;
  } catch (e) {
    const match = url.match(/product\/(\d+)/);
    return match ? match[1] : null;
  }
};

// Helper to clean header string
const cleanHeader = (h: any): string => String(h).toLowerCase().replace(/\s+/g, ' ').trim();

// Helper to guess columns from Excel headers
// Обновленная функция detectColumns - ищем только по точным названиям
const detectColumns = (data: any[][]): { name: number; brand: number; link: number; qty: number; sum: number } => {
  if (!data || data.length === 0) {
    console.error('❌ Нет данных для анализа');
    return { name: -1, brand: -1, link: -1, qty: -1, sum: -1 };
  }
  
  // Ищем строку, которая содержит заголовки таблицы
  let headersRowIndex = -1;
  let headers: any[] = [];
  
  // Ищем строку, содержащую все необходимые заголовки
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row) || row.length === 0) continue;
    
    // Проверяем, содержит ли строка ключевые заголовки
    const normalizedRow = row.map((h: any) => 
      String(h).toLowerCase().replace(/\s+/g, ' ').trim()
    );
    
    // Проверяем наличие ключевых слов в строке
    const hasName = normalizedRow.some(cell => cell.includes('название товара') || cell.includes('наименование товара'));
    const hasLink = normalizedRow.some(cell => cell.includes('ссылка на товар') || cell.includes('ссылка'));
    const hasBrand = normalizedRow.some(cell => cell.includes('бренд') || cell.includes('продавец'));
    const hasQty = normalizedRow.some(cell => cell.includes('заказано, штуки') || cell.includes('штуки'));
    const hasSum = normalizedRow.some(cell => cell.includes('заказано на сумму') || cell.includes('сумма, ₽'));
    
    if (hasName && hasLink && hasBrand && hasQty && hasSum) {
      headersRowIndex = i;
      headers = row;
      console.log(`✅ Найдена строка заголовков на строке ${i + 1}:`, normalizedRow);
      break;
    }
  }
  
  if (headersRowIndex === -1) {
    console.error('❌ Не найдена строка с заголовками таблицы');
    // Пробуем использовать первую строку данных как заголовки
    headers = data[0] || [];
    console.log('⚠️ Используем первую строку как заголовки:', headers);
  }
  
  const normalizedHeaders = headers.map((h: any) => 
    String(h).toLowerCase().replace(/\s+/g, ' ').trim()
  );
  
  console.log('🔍 Ищем колонки по точным названиям в:', normalizedHeaders);
  
  // Функция для поиска точного совпадения (только точное совпадение!)
  const findExactColumn = (exactNames: string[]): number => {
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const header = normalizedHeaders[i];
      for (const exactName of exactNames) {
        if (header === exactName) {
          console.log(`✅ Найдено точное совпадение: "${header}" = "${exactName}" на индексе ${i}`);
          return i;
        }
      }
    }
    return -1;
  };

  // Ищем колонки по точным названиям из вашего файла
  const nameIdx = findExactColumn(['название товара']);
  const linkIdx = findExactColumn(['ссылка на товар']);
  // Сначала ищем "бренд", если не найдено - ищем "продавец"
  let brandIdx = findExactColumn(['бренд']);
  if (brandIdx === -1) {
    brandIdx = findExactColumn(['продавец']);
  }
  const qtyIdx = findExactColumn(['заказано, штуки']);
  const sumIdx = findExactColumn(['заказано на сумму, ₽']);

  console.log('📊 Найденные индексы:', { nameIdx, brandIdx, linkIdx, qtyIdx, sumIdx });

  // Проверяем, что все необходимые колонки найдены
  const missingColumns: string[] = [];
  if (nameIdx === -1) missingColumns.push('Название товара');
  if (linkIdx === -1) missingColumns.push('Ссылка на товар');
  if (brandIdx === -1) missingColumns.push('Бренд или Продавец');
  if (qtyIdx === -1) missingColumns.push('Заказано, штуки');
  if (sumIdx === -1) missingColumns.push('Заказано на сумму, ₽');
  
  if (missingColumns.length > 0) {
    console.error('❌ Не найдены колонки:', missingColumns);
    console.log('ℹ️ Все заголовки:', normalizedHeaders);
    // Возвращаем -1 для всех, чтобы показать ошибку
    return { name: -1, brand: -1, link: -1, qty: -1, sum: -1 };
  }
  
  console.log('✅ Все колонки найдены!');
  console.log('📋 Фактические заголовки:', {
    name: headers[nameIdx],
    link: headers[linkIdx],
    brand: headers[brandIdx],
    qty: headers[qtyIdx],
    sum: headers[sumIdx]
  });
  
  return { 
    name: nameIdx, 
    brand: brandIdx, 
    link: linkIdx, 
    qty: qtyIdx, 
    sum: sumIdx 
  };
};

// Функции для работы с сервером данных
const saveDataToServer = async (data: any, filename: string = DEFAULT_DATA_FILENAME) => {
  try {
    const cleanedData = {
      competitorSelections: data.competitorSelections || {},
      uploadedFiles: data.uploadedFiles || {},
      parsedPrices: data.parsedPrices || {},
      lastUpdated: new Date().toISOString()
    };
    
    console.log('💾 Сохранение данных на сервер:', {
      competitors: Object.keys(cleanedData.competitorSelections).length,
      files: Object.keys(cleanedData.uploadedFiles).length,
      size: JSON.stringify(cleanedData).length / 1024 + ' KB'
    });
    
    const response = await fetch(`${PARSER_API_URL}/data/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        data: cleanedData
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Ошибка сохранения данных на сервер:', error);
    throw error;
  }
};

const loadDataFromServer = async (filename: string = DEFAULT_DATA_FILENAME) => {
  try {
    const response = await fetch(`${PARSER_API_URL}/data/load/${filename}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, data: null, message: 'Файл не найден' };
      }
      const errorText = await response.text();
      throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Ошибка загрузки данных с сервера:', error);
    throw error;
  }
};

const getFilesList = async (): Promise<{success: boolean; files: DataFileInfo[]}> => {
  try {
    const response = await fetch(`${PARSER_API_URL}/data/files`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Ошибка получения списка файлов:', error);
    throw error;
  }
};

const deleteDataFile = async (filename: string) => {
  try {
    const response = await fetch(`${PARSER_API_URL}/data/delete/${filename}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Ошибка удаления файла:', error);
    throw error;
  }
};

const createBackup = async () => {
  try {
    const response = await fetch(`${PARSER_API_URL}/data/backup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Ошибка создания бэкапа:', error);
    throw error;
  }
};

// Функция для получения последней спарсенной цены
const getLatestParsedPrice = (
  parsedPrices: Record<string, Record<string, string>>,
  article: string
): { price: string; date: string } | null => {
  const dates = Object.keys(parsedPrices).sort().reverse();
  for (const date of dates) {
    if (parsedPrices[date]?.[article]) {
      return { price: parsedPrices[date][article], date };
    }
  }
  return null;
};

// Функция для проверки есть ли спарсенные цены
const hasParsedPrices = (parsedPrices: Record<string, Record<string, string>>): boolean => {
  return Object.keys(parsedPrices).some(date =>
    parsedPrices[date] && Object.keys(parsedPrices[date]).length > 0
  );
};

// Компонент для отрисовки графиков истории
const HistoryChart = ({ priceHistory }: { priceHistory: PriceHistoryItem[] }) => {
  const chartRef1 = useRef<HTMLCanvasElement>(null);
  const chartRef2 = useRef<HTMLCanvasElement>(null);
  const chartRef3 = useRef<HTMLCanvasElement>(null);
  const chartInstance1 = useRef<Chart | null>(null);
  const chartInstance2 = useRef<Chart | null>(null);
  const chartInstance3 = useRef<Chart | null>(null);

  useEffect(() => {
    if (!chartRef1.current || !chartRef2.current || !chartRef3.current || priceHistory.length < 2) return;

    // Сортируем данные по дате
    const sortedHistory = [...priceHistory].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

// Подготавливаем данные
const dates = sortedHistory.map(item => 
  new Date(item.date).toLocaleDateString('ru-RU')
);

const prices = sortedHistory.map(item => item.priceNumber || 0);

// Для количества используем 0 если данные не должны быть добавлены (менее 6 дней)
const quantities = sortedHistory.map(item => 
  (item.qtyNumber !== undefined && item.qtyNumber !== null) ? item.qtyNumber : 0
);

// Для суммы используем 0 если данные не должны быть добавлены
const sums = sortedHistory.map(item => 
  (item.sumNumber !== undefined && item.sumNumber !== null) ? item.sumNumber : 0
);

    // Уничтожаем предыдущие графики
    if (chartInstance1.current) chartInstance1.current.destroy();
    if (chartInstance2.current) chartInstance2.current.destroy();
    if (chartInstance3.current) chartInstance3.current.destroy();

    // ГРАФИК 1: ЦЕНА
    const ctx1 = chartRef1.current.getContext('2d');
    if (ctx1) {
      chartInstance1.current = new Chart(ctx1, {
        type: 'line',
        data: {
          labels: dates,
          datasets: [{
            label: 'Цена по Ozon Card (₽)',
            data: prices,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.3,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: 'История цен',
              font: {
                size: 16,
                weight: 'bold'
              },
              color: '#333'
            },
            legend: {
              display: true,
              position: 'top',
              labels: {
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const item = sortedHistory[context.dataIndex];
                  return `Цена: ${item.price || 'нет данных'}`;
                }
              }
            }
          },
          scales: {
            x: {
              display: true,
              title: {
                display: true,
                text: 'Дата',
                font: {
                  weight: 'bold'
                }
              },
              ticks: {
                maxRotation: 45,
                minRotation: 45
              }
            },
            y: {
              display: true,
              title: {
                display: true,
                text: 'Цена (₽)',
                font: {
                  weight: 'bold'
                }
              },
              beginAtZero: false
            }
          },
          interaction: {
            intersect: false,
            mode: 'index'
          }
        }
      });
    }

    // ГРАФИК 2: КОЛИЧЕСТВО
    const ctx2 = chartRef2.current.getContext('2d');
    if (ctx2) {
      const hasQuantityData = quantities.some(q => q > 0);
      
      chartInstance2.current = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [{
            label: 'Заказано, штуки',
            data: quantities,
            backgroundColor: 'rgba(255, 99, 132, 0.6)',
            borderColor: 'rgb(255, 99, 132)',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: 'История количества заказов',
              font: {
                size: 16,
                weight: 'bold'
              },
              color: '#333'
            },
            legend: {
              display: true,
              position: 'top',
              labels: {
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const item = sortedHistory[context.dataIndex];
                  return `Количество: ${item.qty || '0'} шт`;
                }
              }
            }
          },
          scales: {
            x: {
              display: true,
              title: {
                display: true,
                text: 'Дата',
                font: {
                  weight: 'bold'
                }
              },
              ticks: {
                maxRotation: 45,
                minRotation: 45
              }
            },
            y: {
              display: true,
              title: {
                display: true,
                text: 'Количество (шт)',
                font: {
                  weight: 'bold'
                }
              },
              beginAtZero: true
            }
          }
        }
      });
    }

    // ГРАФИК 3: СУММА
    const ctx3 = chartRef3.current.getContext('2d');
    if (ctx3) {
      const hasSumData = sums.some(s => s > 0);
      
      chartInstance3.current = new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [{
            label: 'Сумма заказа (₽)',
            data: sums,
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgb(54, 162, 235)',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: 'История суммы заказов',
              font: {
                size: 16,
                weight: 'bold'
              },
              color: '#333'
            },
            legend: {
              display: true,
              position: 'top',
              labels: {
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const item = sortedHistory[context.dataIndex];
                  return `Сумма: ${item.sum || '0'} ₽`;
                }
              }
            }
          },
          scales: {
            x: {
              display: true,
              title: {
                display: true,
                text: 'Дата',
                font: {
                  weight: 'bold'
                }
              },
              ticks: {
                maxRotation: 45,
                minRotation: 45
              }
            },
            y: {
              display: true,
              title: {
                display: true,
                text: 'Сумма (₽)',
                font: {
                  weight: 'bold'
                }
              },
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return `${value} ₽`;
                }
              }
            }
          }
        }
      });
    }

    // Очистка при размонтировании
    return () => {
      if (chartInstance1.current) chartInstance1.current.destroy();
      if (chartInstance2.current) chartInstance2.current.destroy();
      if (chartInstance3.current) chartInstance3.current.destroy();
    };
  }, [priceHistory]);

  if (priceHistory.length < 2) {
    return (
      <div className="text-center text-muted py-4">
        <i className="bi bi-bar-chart fs-1 mb-3 d-block"></i>
        <p>Недостаточно данных для построения графиков (нужно минимум 2 записи)</p>
      </div>
    );
  }

  return (
    <div className="history-chart-container">
      <div className="row">
        {/* График 1: Цена */}
        <div className="col-md-12 mb-4">
          <div className="card">
            <div className="card-body">
              <div style={{ position: 'relative', height: '300px', width: '100%' }}>
                <canvas ref={chartRef1}></canvas>
              </div>
            </div>
          </div>
        </div>
        
        {/* График 2: Количество */}
        <div className="col-md-6 mb-4">
          <div className="card h-100">
            <div className="card-body">
              <div style={{ position: 'relative', height: '250px', width: '100%' }}>
                <canvas ref={chartRef2}></canvas>
              </div>
            </div>
          </div>
        </div>
        
        {/* График 3: Сумма */}
        <div className="col-md-6 mb-4">
          <div className="card h-100">
            <div className="card-body">
              <div style={{ position: 'relative', height: '250px', width: '100%' }}>
                <canvas ref={chartRef3}></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* <div className="alert alert-info mt-3">
        <div className="d-flex align-items-center">
          <i className="bi bi-info-circle me-2"></i>
          <div>
            <strong>Информация о графиках:</strong>
            <ul className="mb-0 mt-1">
              <li><span style={{ color: 'rgb(75, 192, 192)' }}>●</span> <strong>Линейный график</strong> показывает динамику изменения цен</li>
              <li><span style={{ color: 'rgb(255, 99, 132)' }}>●</span> <strong>Столбчатый график</strong> показывает количество заказов по дням</li>
              <li><span style={{ color: 'rgb(54, 162, 235)' }}>●</span> <strong>Столбчатый график</strong> показывает сумму заказов по дням</li>
            </ul>
          </div>
        </div>
      </div> */}
    </div>
  );
};

const App = () => {
  const [state, setState] = useState<AppState>({
    vmpData: [],
    ozonData: {},
    ozonPrices: {},
    loading: true,
    error: null,
    selectedType: null,
    uploadedFiles: {},
    usingFallback: false,
    competitorSelections: {},
    activeModalSku: null,
    isParsingPrices: false,
    parsedPrices: {},
    searchTerm: '',
    filteredRows: null,
    expandedProducts: {},
    salesData: {},
    salesLoading: false,
    ozonCategories: {},
    collapsedCategories: {}
  });

  const [modalImage, setModalImage] = useState<string | null>(null);
  const [tempSelectedIndices, setTempSelectedIndices] = useState<Set<number>>(new Set());
  const [parsingProgress, setParsingProgress] = useState<{ current: number; total: number; status: string }>({
    current: 0,
    total: 0,
    status: ''
  });
  const [selectedVolumeFilter, setSelectedVolumeFilter] = useState<string | null>(null);
  const [selectedBrandFilter, setSelectedBrandFilter] = useState<string | null>(null);
  const [selectedViscosityFilter, setSelectedViscosityFilter] = useState<string | null>(null);
  const [ozonProgress, setOzonProgress] = useState<{ current: number; total: number; stage: string }>({ 
    current: 0, 
    total: 0, 
    stage: '' 
  });
  const [dataFiles, setDataFiles] = useState<DataFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>(DEFAULT_DATA_FILENAME);
  const [isManagingFiles, setIsManagingFiles] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [activeHistoryModal, setActiveHistoryModal] = useState<{competitor: CompetitorRow | null, productName: string}>({competitor: null, productName: ''});

  useEffect(() => {
    fetchData();
    loadFilesList();
    
    const autoSaveInterval = setInterval(() => {
      autoSaveData();
    }, 5 * 60 * 1000);
    
    return () => {
      clearInterval(autoSaveInterval);
    };
  }, []);

  useEffect(() => {
    const hasData = Object.keys(state.competitorSelections).length > 0 ||
                   Object.keys(state.uploadedFiles).length > 0;
    
    if (hasData && !isSaving) {
      const saveTimeout = setTimeout(() => {
        autoSaveData();
      }, 2000);
      
      return () => clearTimeout(saveTimeout);
    }
  }, [state.competitorSelections, state.uploadedFiles, selectedFile]);

  const fetchData = async () => {
    try {
      console.log('🔄 Загрузка данных...');
      let vmpItems: VmpItem[] = [];
      let isFallback = false;

      try {
        console.log('🌐 Запрос к:', VMP_API_URL);
        
        const vmpResponse = await fetch(VMP_API_URL, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });

        console.log('📊 Статус:', vmpResponse.status, 'OK:', vmpResponse.ok);
        
        if (!vmpResponse.ok) {
          const errorText = await vmpResponse.text();
          console.error('❌ Ошибка API:', errorText);
          throw new Error(`VMP API Error: ${vmpResponse.status}`);
        }
        
        const rawText = await vmpResponse.text();
        console.log('📦 Сырой ответ (первые 500 символов):', rawText.substring(0, 500));
        
        let parsedData;
        try {
          parsedData = JSON.parse(rawText);
          console.log('✅ JSON успешно распарсен:', typeof parsedData);
        } catch (parseError: any) {
          console.error('❌ Ошибка парсинга JSON:', parseError.message);
          throw new Error('Invalid JSON response');
        }
        
        if (Array.isArray(parsedData)) {
          vmpItems = parsedData;
          console.log(`✅ Получен массив из ${vmpItems.length} элементов`);
        } else {
          console.warn('⚠️ Неизвестная структура ответа:', parsedData);
          vmpItems = [];
        }
        
      } catch (apiError: any) {
        console.warn("❌ API Fetch failed:", apiError.message);
        try {
          console.log('🔄 Пробуем загрузить fallback данные...');
          const fallbackResponse = await fetch('./data_cache.json');
          if (!fallbackResponse.ok) throw new Error("Could not load local cache file");
          const fallbackData = await fallbackResponse.json();
          vmpItems = fallbackData.data || [];
          isFallback = true;
          console.log(`✅ Используем fallback: ${vmpItems.length} элементов`);
        } catch (fileError) {
          console.error('💥 Fallback тоже не сработал:', fileError);
          throw new Error("Failed to load data from any source.");
        }
      }

      if (vmpItems.length === 0) {
        console.warn('⚠️ Получен пустой массив товаров');
      } else {
        console.log(`🎉 Успешно загружено: ${vmpItems.length} товаров`);
      }

      const typeCounts: Record<string, number> = {};
      vmpItems.forEach((i: VmpItem) => { 
        if(i.ВидТовара) {
          typeCounts[i.ВидТовара] = (typeCounts[i.ВидТовара] || 0) + 1;
        }
      });
      
      const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
      const initialType = sortedTypes.length > 0 ? sortedTypes[0][0] : null;
      
      console.log('🏷️ Доступные категории:', sortedTypes);

      const offerIds = Array.from(new Set(vmpItems.map(i => i.Артикул).filter(Boolean)));
      let ozonMap: Record<string, OzonItem> = {};
      let ozonPricesMap: Record<string, OzonProductPrice> = {};

      try {
        console.log('🛒 Загружаем Ozon данные...');
        ozonMap = await fetchOzonData(offerIds);
        console.log(`✅ Ozon данных: ${Object.keys(ozonMap).length} товаров`);
      } catch (ozonError) {
        console.warn("Ozon API fetch failed", ozonError);
      }

      try {
        console.log('💰 Загружаем данные о соинвесте...');
        const offerIds = Array.from(new Set(vmpItems.map(i => i.Артикул).filter(Boolean)));
        ozonPricesMap = await fetchOzonPrices(offerIds, ozonMap);
        console.log(`✅ Данных о соинвесте: ${Object.keys(ozonPricesMap).length} товаров`);
      } catch (pricesError) {
        console.warn("Ozon prices API fetch failed", pricesError);
      }

      // Загрузка данных о продажах за неделю
      let salesDataMap: Record<string, OzonSalesData> = {};
      try {
        console.log('📊 Загружаем данные о продажах за неделю...');
        salesDataMap = await fetchSalesData();
        console.log(`✅ Данных о продажах: ${Object.keys(salesDataMap).length} SKU`);
      } catch (salesError) {
        console.warn("Ozon sales API fetch failed", salesError);
      }

      // Загрузка названий типов товаров Ozon (type_id - более конкретная категория)
      let ozonCategoriesMap: Record<number, string> = {};
      try {
        // Собираем уникальные type_id из загруженных товаров
        const typeIds = Array.from(new Set(
          Object.values(ozonMap)
            .map(item => item.type_id)
            .filter((id): id is number => id !== undefined && id > 0)
        ));
        if (typeIds.length > 0) {
          console.log('📁 Загружаем названия типов товаров...');
          ozonCategoriesMap = await fetchOzonCategories(typeIds);
        }
      } catch (catError) {
        console.warn("Ozon categories fetch failed", catError);
      }

      setState(prev => ({
        ...prev,
        vmpData: vmpItems,
        ozonData: ozonMap,
        ozonPrices: ozonPricesMap,
        salesData: salesDataMap,
        ozonCategories: ozonCategoriesMap,
        loading: false,
        usingFallback: isFallback,
        selectedType: initialType
      }));

      console.log('🚀 Приложение готово!');

    } catch (err: any) {
      console.error('💥 Критическая ошибка:', err);
      setState(prev => ({ ...prev, loading: false, error: `Ошибка: ${err.message}` }));
    }
  };

  // Функция для получения дерева категорий Ozon
  // Принимает объект с type_id (тип товара - более конкретный) и description_category_id
  const fetchOzonCategories = async (typeIds: number[]): Promise<Record<number, string>> => {
    const categories: Record<number, string> = {};

    if (typeIds.length === 0) return categories;

    console.log('📁 Загрузка названий типов товаров Ozon для', typeIds.length, 'ID:', typeIds);

    // Используем первый аккаунт для запроса
    const account = OZON_ACCOUNTS[0];

    try {
      const response = await fetch('https://api-seller.ozon.ru/v1/description-category/tree', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': account.client_id,
          'Api-Key': account.api_key
        },
        body: JSON.stringify({ language: 'RU' })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('📁 Ответ от description-category/tree получен');

        // Рекурсивно обходим дерево категорий и ищем типы товаров
        const processCategory = (cat: any) => {
          // Проверяем типы товаров внутри категории
          if (cat.children && Array.isArray(cat.children)) {
            cat.children.forEach((child: any) => {
              // Если у элемента есть type_id - это тип товара (конечный уровень)
              if (child.type_id && typeIds.includes(child.type_id)) {
                const typeName = child.type_name || child.category_name || child.title;
                if (typeName) {
                  categories[child.type_id] = typeName;
                  console.log(`📁 Найден тип товара: ${child.type_id} = "${typeName}"`);
                }
              }
              // Если это категория - продолжаем рекурсию
              if (child.description_category_id) {
                processCategory(child);
              }
            });
          }
        };

        const resultArray = data.result || [];
        if (Array.isArray(resultArray)) {
          resultArray.forEach((cat: any) => processCategory(cat));
        }

        console.log(`✅ Загружено названий типов: ${Object.keys(categories).length} из ${typeIds.length}`);
      } else {
        const errorText = await response.text();
        console.warn(`❌ Ошибка получения категорий: ${response.status}`, errorText.substring(0, 200));
      }
    } catch (e: any) {
      console.warn(`❌ Ошибка при запросе категорий:`, e.message);
    }

    return categories;
  };

  const fetchOzonData = async (offerIds: string[]): Promise<Record<string, OzonItem>> => {
    const CHUNK_SIZE = 50;
    const results: Record<string, OzonItem> = {};

    console.log('🛒 Загрузка Ozon данных для артикулов:', offerIds.length);
    
    if (offerIds.length === 0) {
      console.log('⚠️ Нет артикулов для загрузки Ozon данных');
      return results;
    }
    
    const chunks: string[][] = [];
    
    for (let i = 0; i < offerIds.length; i += CHUNK_SIZE) {
      chunks.push(offerIds.slice(i, i + CHUNK_SIZE));
    }

    console.log(`📦 Разделили на ${chunks.length} чанков по ${CHUNK_SIZE} артикулов`);
    
    const allProducts: OzonProductInfo[] = [];
    
    // Шаг 1: Получаем информацию о товарах и SKU со всех аккаунтов
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      setOzonProgress({ current: chunkIndex + 1, total: chunks.length, stage: 'Получение информации о товарах' });
      
      console.log(`\n📊 Чанк ${chunkIndex + 1}/${chunks.length}: Получение информации о товарах`);
      
      let missingInChunk = [...chunk];
      
      for (const account of OZON_ACCOUNTS) {
        if (missingInChunk.length === 0) break;
        
        console.log(`🔐 Аккаунт: ${account.name}, осталось: ${missingInChunk.length}`);
        
        try {
          const response = await fetch("https://api-seller.ozon.ru/v3/product/info/list", {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Client-Id': account.client_id,
              'Api-Key': account.api_key
            },
            body: JSON.stringify({ offer_id: missingInChunk })
          });

          console.log(`📡 Статус ответа v3/product/info/list: ${response.status}`);
          
          if (response.ok) {
            const data = await response.json();
            console.log(`📦 Ответ содержит: ${data.items?.length || 0} товаров`);
            
            if (data.items && Array.isArray(data.items)) {
              data.items.forEach((item: any) => {
                if (!item.is_archived) {
                  allProducts.push({
                    offer_id: item.offer_id,
                    sku: item.sku,
                    price: item.price,
                    primary_image: Array.isArray(item.primary_image) ? item.primary_image[0] : item.primary_image,
                    images: item.images,
                    is_archived: item.is_archived,
                    description_category_id: item.description_category_id,
                    type_id: item.type_id
                  });
                  missingInChunk = missingInChunk.filter(id => id !== item.offer_id);
                  console.log(`✅ Добавлен товар: ${item.offer_id}, SKU: ${item.sku}, категория: ${item.description_category_id}, тип: ${item.type_id}`);
                }
              });
            }
          } else {
            const errorText = await response.text();
            console.warn(`❌ Ошибка API v3/product/info/list: ${response.status}`, errorText.substring(0, 200));
          }
        } catch (e: any) {
          console.warn(`❌ Сетевая ошибка для аккаунта ${account.name}:`, e.message);
        }
        
        await new Promise(r => setTimeout(r, 500));
      }
      
      console.log(`✅ Чанк ${chunkIndex + 1} завершен, найдено товаров: ${allProducts.length}`);
    }
    
    if (allProducts.length > 0) {
      console.log(`\n💰 Получение цен по Ozon Card для ${allProducts.length} товаров`);
      
      const allSkus = allProducts
        .filter(p => p.sku && p.sku > 0)
        .map(p => p.sku!.toString());
      
      console.log(`🔢 Найдено SKU: ${allSkus.length}`);
      
      const priceChunkSize = 100;
      const priceChunks: string[][] = [];
      
      for (let i = 0; i < allSkus.length; i += priceChunkSize) {
        priceChunks.push(allSkus.slice(i, i + priceChunkSize));
      }
      
      console.log(`📊 Разделили SKU на ${priceChunks.length} чанков для запроса цен`);
      
      const priceResults: Record<string, OzonPriceDetails> = {};
      
      // Шаг 2: Получаем цены по Ozon Card со ВСЕХ аккаунтов
      for (let chunkIndex = 0; chunkIndex < priceChunks.length; chunkIndex++) {
        const skuChunk = priceChunks[chunkIndex];
        setOzonProgress({ current: chunkIndex + 1, total: priceChunks.length, stage: 'Получение цен по Ozon Card' });
        
        console.log(`\n💳 Чанк ${chunkIndex + 1}/${priceChunks.length}: Запрашиваем цены для ${skuChunk.length} SKU`);
        
        let missingPricesInChunk = [...skuChunk];
        
        // Пробуем получить цены с каждого аккаунта
        for (const account of OZON_ACCOUNTS) {
          if (missingPricesInChunk.length === 0) break;
          
          console.log(`🔐 Аккаунт для цен: ${account.name}, осталось SKU: ${missingPricesInChunk.length}`);
          
          try {
            const response = await fetch("https://api-seller.ozon.ru/v1/product/prices/details", {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Client-Id': account.client_id,
                'Api-Key': account.api_key
              },
              body: JSON.stringify({ skus: missingPricesInChunk })
            });

            console.log(`📡 Статус ответа v1/product/prices/details: ${response.status}`);
            
            if (response.ok) {
              const data = await response.json();
              console.log(`💰 Аккаунт ${account.name}: получено ${data.prices?.length || 0} цен`);
              
              if (data.prices && Array.isArray(data.prices)) {
                data.prices.forEach((priceDetail: OzonPriceDetails) => {
                  if (!priceResults[priceDetail.sku.toString()]) {
                    priceResults[priceDetail.sku.toString()] = priceDetail;
                    missingPricesInChunk = missingPricesInChunk.filter(sku => sku !== priceDetail.sku.toString());
                    console.log(`✅ Цена от ${account.name} для SKU ${priceDetail.sku}: ${priceDetail.customer_price.amount} ${priceDetail.customer_price.currency}`);
                  }
                });
              }
            } else {
              const errorText = await response.text();
              console.warn(`❌ Ошибка API v1/product/prices/details у аккаунта ${account.name}: ${response.status}`, errorText.substring(0, 200));
            }
          } catch (e: any) {
            console.warn(`❌ Ошибка получения цен от аккаунта ${account.name}:`, e.message);
          }
          
          await new Promise(r => setTimeout(r, 1000));
        }
        
        console.log(`✅ Чанк ${chunkIndex + 1} завершен, найдено цен: ${Object.keys(priceResults).length}`);
      }
      
      // Шаг 3: Объединяем данные
      console.log(`\n🔗 Объединяем данные о товарах и ценах...`);
      
      allProducts.forEach(product => {
        if (product.sku && priceResults[product.sku.toString()]) {
          const priceDetail = priceResults[product.sku.toString()];
          results[product.offer_id] = {
            offer_id: product.offer_id,
            sku: product.sku,
            price: product.price || '0',
            customer_price: `${priceDetail.customer_price.amount} ${priceDetail.customer_price.currency}`,
            primary_image: product.primary_image,
            images: product.images,
            is_archived: product.is_archived,
            description_category_id: product.description_category_id,
            type_id: product.type_id
          };
          console.log(`🎯 ${product.offer_id}: категория: ${product.description_category_id}, тип: ${product.type_id}`);
        } else if (product.price) {
          results[product.offer_id] = {
            offer_id: product.offer_id,
            sku: product.sku,
            price: product.price,
            customer_price: undefined,
            primary_image: product.primary_image,
            images: product.images,
            is_archived: product.is_archived,
            description_category_id: product.description_category_id,
            type_id: product.type_id
          };
          console.log(`⚠️ ${product.offer_id}: категория: ${product.description_category_id}, тип: ${product.type_id}`);
        }
      });
      
    } else {
      console.log('⚠️ Не найдено товаров для получения цен');
    }
    
    console.log(`\n🎉 Итог: загружено ${Object.keys(results).length} товаров с ценами`);
    
    setOzonProgress({ current: 0, total: 0, stage: '' });
    return results;
  };

// Обновите функцию fetchOzonPrices, добавив тип для offerIds
const fetchOzonPrices = async (offerIds: string[], ozonData: Record<string, OzonItem>): Promise<Record<string, OzonProductPrice>> => {
  const results: Record<string, OzonProductPrice> = {};
  
  console.log('💰 Загрузка цен и соинвеста для товаров:', offerIds.length);
  
  if (offerIds.length === 0) {
    console.log('⚠️ Нет товаров для загрузки цен');
    return results;
  }
  
  // Собираем SKU для товаров
  const skusToFetch: string[] = [];
  const skuToOfferIdMap: Record<string, string> = {};
  
  offerIds.forEach(offerId => {
    const ozonItem = ozonData[offerId];
    if (ozonItem && ozonItem.sku) {
      const skuStr = ozonItem.sku.toString();
      skusToFetch.push(skuStr);
      skuToOfferIdMap[skuStr] = offerId;
      console.log(`🔗 Маппинг: SKU ${skuStr} -> offer_id ${offerId}`);
    } else {
      console.log(`⚠️ У товара ${offerId} нет SKU или данных в ozonData`);
    }
  });
  
  if (skusToFetch.length === 0) {
    console.log('⚠️ Нет SKU для загрузки соинвеста');
    return results;
  }
  
  console.log(`🔢 Найдено SKU: ${skusToFetch.length} из ${offerIds.length} товаров`);
  console.log('📋 Маппинг SKU->offer_id:', skuToOfferIdMap);
  
  const CHUNK_SIZE = 100;
  const chunks: string[][] = [];
  
  for (let i = 0; i < skusToFetch.length; i += CHUNK_SIZE) {
    chunks.push(skusToFetch.slice(i, i + CHUNK_SIZE));
  }

  console.log(`📦 Разделили на ${chunks.length} чанков по ${CHUNK_SIZE} SKU`);
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const skuChunk = chunks[chunkIndex];
    console.log(`\n💳 Чанк ${chunkIndex + 1}/${chunks.length}: Запрашиваем соинвест для ${skuChunk.length} SKU`);
    
    let missingPricesInChunk = [...skuChunk];
    
    // Пробуем получить цены с каждого аккаунта
    for (const account of OZON_ACCOUNTS) {
      if (missingPricesInChunk.length === 0) break;
      
      console.log(`🔐 Аккаунт для соинвеста: ${account.name}, осталось SKU: ${missingPricesInChunk.length}`);
      
      try {
        const response = await fetch("https://api-seller.ozon.ru/v1/product/prices/details", {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Id': account.client_id,
            'Api-Key': account.api_key
          },
          body: JSON.stringify({ skus: missingPricesInChunk })
        });

        console.log(`📡 Статус ответа v1/product/prices/details: ${response.status}`);
        
        if (response.ok) {
          const data: OzonPriceResponse = await response.json();
          console.log(`💰 Аккаунт ${account.name}: получено ${data.prices?.length || 0} цен с соинвестом`);
          
          if (data.prices && Array.isArray(data.prices)) {
            data.prices.forEach((priceDetail: OzonProductPrice) => {
              const skuStr = priceDetail.sku.toString();
              if (!results[skuStr]) {
                results[skuStr] = priceDetail;
                missingPricesInChunk = missingPricesInChunk.filter(sku => sku !== skuStr);
                console.log(`✅ Соинвест от ${account.name} для SKU ${skuStr}: ${priceDetail.discount_percent}`);
              }
            });
          }
        } else {
          const errorText = await response.text();
          console.warn(`❌ Ошибка API v1/product/prices/details у аккаунта ${account.name}: ${response.status}`, errorText.substring(0, 200));
        }
      } catch (e: any) {
        console.warn(`❌ Ошибка получения соинвеста от аккаунта ${account.name}:`, e.message);
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log(`✅ Чанк ${chunkIndex + 1} завершен, найдено записей: ${Object.keys(results).length}`);
  }
  
  // Создаем маппинг offer_id -> price data
  const finalResults: Record<string, OzonProductPrice> = {};
  
  Object.entries(results).forEach(([sku, priceData]) => {
    const offerId = skuToOfferIdMap[sku];
    if (offerId) {
      finalResults[offerId] = priceData;
      console.log(`🔗 Связали: SKU ${sku} -> offer_id ${offerId}`);
    } else {
      console.warn(`⚠️ Не найден offer_id для SKU ${sku}`);
    }
  });
  
  console.log(`\n🎉 Итог: загружено соинвеста для ${Object.keys(finalResults).length} товаров`);
  console.log('📊 Статистика:', {
    totalOfferIds: offerIds.length,
    foundSkus: skusToFetch.length,
    loadedPrices: Object.keys(results).length,
    mappedToOffers: Object.keys(finalResults).length
  });
  
  return finalResults;
};

  // Загрузка данных о продажах за последнюю неделю
  const fetchSalesData = async (): Promise<Record<string, OzonSalesData>> => {
    const results: Record<string, OzonSalesData> = {};

    // Получаем даты за последнюю неделю
    const today = new Date();
    const dates: { day: number; month: number; year: number }[] = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push({
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear()
      });
    }

    console.log('📊 Загрузка данных о продажах за неделю:', dates);

    for (const dateParams of dates) {
      for (const account of OZON_ACCOUNTS) {
        try {
          console.log(`📅 Запрос продаж за ${dateParams.day}.${dateParams.month}.${dateParams.year} от ${account.name}`);

          const response = await fetch("https://api-seller.ozon.ru/v1/finance/realization/by-day", {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Client-Id': account.client_id,
              'Api-Key': account.api_key
            },
            body: JSON.stringify(dateParams)
          });

          if (response.ok) {
            const data = await response.json();

            if (data.rows && Array.isArray(data.rows)) {
              data.rows.forEach((row: any) => {
                const sku = row.item?.sku ? String(row.item.sku) : null;
                if (sku) {
                  // Суммируем quantity из delivery_commission
                  const qty = row.delivery_commission?.quantity || 0;
                  // seller_price_per_instance - цена за единицу, умножаем на количество
                  const sum = (row.seller_price_per_instance || 0) * qty;

                  if (!results[sku]) {
                    results[sku] = { qty: 0, sum: 0 };
                  }
                  results[sku].qty += qty;
                  results[sku].sum += sum;
                }
              });
              console.log(`✅ ${account.name}: получено ${data.rows.length} записей за ${dateParams.day}.${dateParams.month}`);
            }
          } else {
            console.warn(`⚠️ Ошибка API для ${account.name}: ${response.status}`);
          }
        } catch (e: any) {
          console.warn(`❌ Ошибка загрузки продаж от ${account.name}:`, e.message);
        }

        // Задержка между запросами
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`🎉 Итог: загружены данные о продажах для ${Object.keys(results).length} SKU`);
    return results;
  };

  const loadFilesList = async () => {
    try {
      const result = await getFilesList();
      if (result.success) {
        setDataFiles(result.files);

        if (result.files.length > 0) {
          // Ищем основной файл, если не найден - берём первый
          const mainFile = result.files.find(f => f.name === `${DEFAULT_DATA_FILENAME}.json`);
          const fileToLoad = mainFile ? mainFile.name : result.files[0].name;
          await loadSelectedFile(fileToLoad.replace('.json', ''));
        } else {
          // Если файлов нет - пробуем загрузить основной (может быть создан при первом сохранении)
          try {
            const mainResult = await loadDataFromServer(DEFAULT_DATA_FILENAME);
            if (mainResult.success && mainResult.data) {
              setSelectedFile(DEFAULT_DATA_FILENAME);
              setState(prev => ({
                ...prev,
                competitorSelections: mainResult.data.competitorSelections || {},
                parsedPrices: mainResult.data.parsedPrices || {},
                uploadedFiles: mainResult.data.uploadedFiles || {}
              }));
            }
          } catch (e) {
            console.log('Основной файл данных ещё не создан');
          }
        }
      }
    } catch (error) {
      console.warn('Не удалось загрузить список файлов:', error);
    }
  };

  const autoSaveData = async () => {
    const hasData = Object.keys(state.competitorSelections).length > 0 ||
                   Object.keys(state.uploadedFiles).length > 0;
    
    if (hasData && !isSaving) {
      const now = Date.now();
      const lastSaveTime = localStorage.getItem('lastSaveTime');
      const minTimeBetweenSaves = 30000;
      
      if (lastSaveTime && (now - parseInt(lastSaveTime)) < minTimeBetweenSaves) {
        console.log('⏳ Слишком рано для автосохранения');
        return;
      }
      
      try {
        setIsSaving(true);
        
        const dataToSave = {
          competitorSelections: state.competitorSelections,
          parsedPrices: state.parsedPrices,
          uploadedFiles: state.uploadedFiles,
          lastUpdated: new Date().toISOString()
        };
        
        await saveDataToServer(dataToSave, selectedFile);
        localStorage.setItem('lastSaveTime', now.toString());
        console.log('💾 Данные автосохранены');
      } catch (error) {
        console.warn('Ошибка автосохранения:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const parseOzonCardPrices = async () => {
    setState(prev => ({ ...prev, isParsingPrices: true }));
    setParsingProgress({ current: 0, total: 0, status: 'Инициализация...' });

    try {
      // Фильтруем товары по выбранной категории
      const categoryProducts = state.selectedType
        ? state.vmpData.filter(item => item.ВидТовара === state.selectedType)
        : state.vmpData;

      // Артикулы товаров выбранной категории
      const categoryArticles = new Set(categoryProducts.map(item => item.Артикул));

      // Собираем конкурентов только для товаров выбранной категории
      const allCompetitors: Array<{
        vmpSku: string;
        competitor: CompetitorRow;
        sku: string;
      }> = [];

      Object.entries(state.competitorSelections).forEach(([vmpSku, competitors]) => {
        // Пропускаем, если товар не в выбранной категории
        if (!categoryArticles.has(vmpSku)) {
          return;
        }

        const competitorArray = competitors as CompetitorRow[];
        competitorArray.forEach((competitor: CompetitorRow) => {
          if (competitor.link && competitor.link.includes('ozon.ru')) {
            const sku = extractSkuFromUrl(competitor.link);
            if (sku && /^\d+$/.test(sku)) {
              allCompetitors.push({
                vmpSku,
                competitor,
                sku
              });
            }
          }
        });
      });

      // Собираем SKU наших товаров только для выбранной категории
      const ourProducts: Array<{
        sku: string;
        article: string;
      }> = [];

      categoryProducts.forEach(item => {
        const ozonItem = state.ozonData[item.Артикул];
        if (ozonItem && ozonItem.sku) {
          ourProducts.push({
            sku: String(ozonItem.sku),
            article: item.Артикул
          });
        }
      });

      if (allCompetitors.length === 0 && ourProducts.length === 0) {
        alert(state.selectedType
          ? `Нет товаров для парсинга в категории "${state.selectedType}"`
          : 'Нет товаров для парсинга');
        setState(prev => ({ ...prev, isParsingPrices: false }));
        return;
      }

      // Объединяем все SKU
      const competitorSkus = allCompetitors.map(item => item.sku);
      const ourSkus = ourProducts.map(item => item.sku);
      const allSkus = [...competitorSkus, ...ourSkus];
      const uniqueSkus = [...new Set(allSkus)];

      console.log(`🔍 Начинаем парсинг SKU для категории "${state.selectedType || 'Все'}":`, uniqueSkus);

      setParsingProgress({
        current: 0,
        total: uniqueSkus.length,
        status: state.selectedType
          ? `Парсинг ${uniqueSkus.length} товаров (${state.selectedType})...`
          : `Подготовка к парсингу ${uniqueSkus.length} товаров...`
      });

      try {
        const healthResponse = await fetch(`${PARSER_API_URL}/health`);
        if (!healthResponse.ok) {
          throw new Error('Сервер парсинга недоступен');
        }
      } catch (error) {
        alert('⚠️ Сервер парсинга не запущен.\n\nЗапустите в отдельном терминале:\nnode server.js\n\nИли если есть ошибки:\nnpm install chromedriver\nnode server.js');
        setState(prev => ({ ...prev, isParsingPrices: false }));
        return;
      }

      setParsingProgress({
        current: 0,
        total: uniqueSkus.length,
        status: 'Ожидание локального парсера...'
      });

      const response = await fetch(`${PARSER_API_URL}/parse-local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ skus: uniqueSkus })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      console.log('📊 Получены результаты парсинга:', data);

      const priceMap: Record<string, string> = {};
      
      if (data.results && Array.isArray(data.results)) {
        data.results.forEach((result: any) => {
          if (result.success && result.price && 
              result.price !== 'Цена не найдена' && 
              result.price !== 'Ошибка загрузки' &&
              result.price !== 'Не найдено' &&
              result.price.includes('₽')) {
            priceMap[result.sku] = result.price;
            console.log(`✅ Добавляем цену для ${result.sku}: ${result.price}`);
          } else if (result.price) {
            console.log(`❌ Пропускаем ${result.sku}: ${result.price} (success: ${result.success})`);
          }
        });
      }

      const updatedSelections = { ...state.competitorSelections };
      const ourParsedPrices: Record<string, string> = {};
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const todayFormatted = now.toLocaleDateString('ru-RU');

      // Обрабатываем цены наших товаров
      ourProducts.forEach(({ sku, article }) => {
        if (priceMap[sku]) {
          ourParsedPrices[article] = priceMap[sku];
          console.log(`✅ Спарсена цена для нашего товара ${article} (SKU: ${sku}): ${priceMap[sku]}`);
        }
      });

      let updatedCount = 0;
      allCompetitors.forEach(({ vmpSku, competitor, sku }) => {
        if (priceMap[sku]) {
          if (!updatedSelections[vmpSku]) {
            updatedSelections[vmpSku] = [];
          }
          
          const existingCompetitorIndex = updatedSelections[vmpSku].findIndex(c => 
            c.link === competitor.link
          );
          
          if (existingCompetitorIndex !== -1) {
            // Обновляем существующего конкурента
            const existingCompetitor = updatedSelections[vmpSku][existingCompetitorIndex];
            
            // Получаем текущие значения qty и sum
            const currentQty = competitor.qty && competitor.qty !== '' && competitor.qty !== 0 ? competitor.qty : existingCompetitor.qty;
            const currentSum = competitor.sum && competitor.sum !== '' && competitor.sum !== 0 ? competitor.sum : existingCompetitor.sum;
            
            // Преобразуем значения в числа для графиков
            const priceNumber = extractPriceNumber(priceMap[sku]);
            const qtyNumber = currentQty ? parseFloat(String(currentQty)) : undefined;
            const sumNumber = currentSum ? parseFloat(String(currentSum)) : undefined;
            
            // Создаем или обновляем историю цен
            const priceHistory = existingCompetitor.priceHistory || [];
            
            // Проверяем, есть ли уже запись за сегодня
const todayPriceIndex = priceHistory.findIndex(item => 
  item.date.startsWith(today)
);
            
if (todayPriceIndex !== -1) {
  // Обновляем сегодняшнюю запись только если это обновление цены
  priceHistory[todayPriceIndex] = {
    price: priceMap[sku],
    priceNumber: priceNumber,
    date: now.toISOString(),
    source: 'ozon_card_parser',
    qty: currentQty,
    sum: currentSum,
    qtyNumber: qtyNumber,
    sumNumber: sumNumber
  };
} else {
  // Проверяем, когда была последняя запись
  const lastEntry = priceHistory.length > 0 
    ? priceHistory[priceHistory.length - 1] 
    : null;
  
  // Проверяем разницу в днях для количества и суммы
  const shouldAddQtySumEntry = !lastEntry || 
    (lastEntry && 
      (Math.abs(new Date(now).getTime() - new Date(lastEntry.date).getTime()) > 6 * 24 * 60 * 60 * 1000));
  
  // Если прошло больше 6 дней или это первая запись, добавляем с qty и sum
  if (shouldAddQtySumEntry) {
    priceHistory.push({
      price: priceMap[sku],
      priceNumber: priceNumber,
      date: now.toISOString(),
      source: 'ozon_card_parser',
      qty: currentQty,
      sum: currentSum,
      qtyNumber: qtyNumber,
      sumNumber: sumNumber
    });
  } else {
    // Добавляем только цену без qty и sum
    priceHistory.push({
      price: priceMap[sku],
      priceNumber: priceNumber,
      date: now.toISOString(),
      source: 'ozon_card_parser',
      qty: undefined,
      sum: undefined,
      qtyNumber: undefined,
      sumNumber: undefined
    });
  }
}
            
            updatedSelections[vmpSku][existingCompetitorIndex] = {
              ...existingCompetitor,
              ozonCardPrice: priceMap[sku],
              qty: currentQty,
              sum: currentSum,
              lastUpdated: now.toISOString(),
              priceHistory
            };
          } else {
            // Добавляем нового конкурента с историей
            const priceNumber = extractPriceNumber(priceMap[sku]);
            const qtyNumber = competitor.qty ? parseFloat(String(competitor.qty)) : undefined;
            const sumNumber = competitor.sum ? parseFloat(String(competitor.sum)) : undefined;
            
            updatedSelections[vmpSku].push({
              ...competitor,
              ozonCardPrice: priceMap[sku],
              lastUpdated: now.toISOString(),
              priceHistory: [{
                price: priceMap[sku],
                priceNumber: priceNumber,
                date: now.toISOString(),
                source: 'ozon_card_parser',
                qty: competitor.qty,
                sum: competitor.sum,
                qtyNumber: qtyNumber,
                sumNumber: sumNumber
              }]
            });
          }
          updatedCount++;
          
          console.log(`✅ Обновлена цена для ${vmpSku} -> ${sku}: ${priceMap[sku]}, qty: ${competitor.qty}, sum: ${competitor.sum}`);
        }
      });

      // Сохраняем ежедневные данные
      try {
        const dailyData = {
          date: today,
          timestamp: now.toISOString(),
          prices: priceMap,
          competitorSelections: updatedSelections,
          summary: {
            totalParsed: uniqueSkus.length,
            successful: updatedCount,
            failed: uniqueSkus.length - updatedCount
          }
        };
        
        // Сохраняем ежедневные данные в отдельный файл
        await saveDataToServer(dailyData, `daily_data_${today}`);
        
        // Сохраняем обновленные основные данные (включая новые спарсенные цены наших товаров)
        const updatedParsedPrices = {
          ...state.parsedPrices,
          [today]: {
            ...(state.parsedPrices[today] || {}),
            ...ourParsedPrices
          }
        };
        await saveDataToServer({
          competitorSelections: updatedSelections,
          parsedPrices: updatedParsedPrices,
          uploadedFiles: state.uploadedFiles,
          lastUpdated: now.toISOString()
        }, selectedFile);
        
        console.log('✅ Цены и история сохранены');
      } catch (error) {
        console.error('Ошибка сохранения данных:', error);
      }

      setState(prev => ({
        ...prev,
        competitorSelections: updatedSelections,
        parsedPrices: {
          ...prev.parsedPrices,
          [today]: {
            ...(prev.parsedPrices[today] || {}),
            ...ourParsedPrices
          }
        },
        isParsingPrices: false
      }));

      const ourProductsCount = Object.keys(ourParsedPrices).length;
      const competitorsCount = updatedCount;
      const totalParsed = ourProductsCount + competitorsCount;
      const failed = uniqueSkus.length - totalParsed;

      let statusMessage = '';
      if (totalParsed > 0) {
        statusMessage = `✅ Парсинг завершен!\n\n`;
        statusMessage += `📦 Наших товаров: ${ourProductsCount}\n`;
        statusMessage += `🏢 Конкурентов: ${competitorsCount}\n`;
        statusMessage += `📊 Всего спарсено: ${totalParsed}`;
        if (failed > 0) {
          statusMessage += `\n⚠️ Не удалось получить: ${failed}`;
        }
        statusMessage += `\n\n📅 Дата: ${todayFormatted}\n💾 Данные сохранены:\n• Основной файл: ${selectedFile}\n• Ежедневный файл: daily_data_${today}.json`;
      } else {
        statusMessage = `❌ Не удалось получить цены ни для одного товара`;
      }

      alert(statusMessage);

      setParsingProgress({ 
        current: uniqueSkus.length, 
        total: uniqueSkus.length, 
        status: statusMessage 
      });

      setTimeout(() => {
        setParsingProgress({ current: 0, total: 0, status: '' });
      }, 5000);

    } catch (error: any) {
      console.error('💥 Ошибка парсинга:', error);
      setState(prev => ({ ...prev, isParsingPrices: false }));
      
      let errorMessage = error.message || 'Неизвестная ошибка';
      
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        errorMessage = 'Ошибка сети';
      }
      
      setParsingProgress({ 
        current: 0, 
        total: 0, 
        status: `❌ Ошибка: ${errorMessage}` 
      });
      
      alert(`❌ Ошибка при парсинге:\n${errorMessage}`);
      
      setTimeout(() => {
        setParsingProgress({ current: 0, total: 0, status: '' });
      }, 5000);
    }
  };

  const showCompetitorHistory = (competitor: CompetitorRow, productName: string) => {
    // Обновляем числовые значения если их нет
    const updatedHistory = competitor.priceHistory.map(item => ({
      ...item,
      priceNumber: item.priceNumber || extractPriceNumber(item.price),
      qtyNumber: item.qtyNumber || (item.qty ? parseFloat(String(item.qty)) || 0 : 0),
      sumNumber: item.sumNumber || (item.sum ? parseFloat(String(item.sum)) || 0 : 0)
    }));
    
    const updatedCompetitor = {
      ...competitor,
      priceHistory: updatedHistory
    };
    
    setActiveHistoryModal({ competitor: updatedCompetitor, productName });
  };

  const handleRemoveCompetitor = async (vmpSku: string, competitorIndex: number) => {
    if (confirm('Удалить этого конкурента?')) {
      const updatedSelections = { ...state.competitorSelections };
      if (updatedSelections[vmpSku]) {
        updatedSelections[vmpSku].splice(competitorIndex, 1);
        
        try {
          await saveDataToServer({
            competitorSelections: updatedSelections,
            parsedPrices: state.parsedPrices,
            uploadedFiles: state.uploadedFiles,
            lastUpdated: new Date().toISOString()
          }, selectedFile);
          
          setState(prev => ({
            ...prev,
            competitorSelections: updatedSelections
          }));
        } catch (error) {
          console.error('Ошибка сохранения:', error);
        }
      }
    }
  };

  const handleTypeSelect = (type: string | null) => {
    setState(prev => ({ ...prev, selectedType: type }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file || !state.selectedType) return;

  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой. Максимальный размер: 10MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    const arrayBuffer = evt.target?.result;
    const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];
    
    const rawData = window.XLSX.utils.sheet_to_json(ws, { 
      header: 1,
      defval: '',
      raw: false,
      blankrows: false
    }) as any[][];
    
    console.log('📊 Загруженные данные:', {
      sheetName: wsname,
      totalRows: rawData.length,
      headers: rawData[0],
      firstRow: rawData[1]
    });
    
    const maxRows = 1000;
    const limitedData = rawData.slice(0, maxRows + 1);
    
    // Проверяем данные
    if (limitedData.length < 2) {
      alert('Файл слишком мал или не содержит данных');
      return;
    }
    
    const headers = limitedData[0];
    const mapping = detectColumns(limitedData);
    
    // Проверяем, что все необходимые колонки найдены
    if (mapping.name === -1 || mapping.link === -1 || mapping.brand === -1 || 
        mapping.qty === -1 || mapping.sum === -1) {
      alert(`❌ В файле не найдены все необходимые колонки!\n\nОбязательные колонки:\n1. Название товара\n2. Ссылка на товар\n3. Бренд (или Продавец)\n4. Заказано, штуки\n5. Заказано на сумму, ₽\n\nПроверьте заголовки в Excel файле.`);
      return;
    }
    
    console.log('✅ Все колонки найдены правильно');
    console.log('📋 Пример данных (первая строка):', {
      name: limitedData[1][mapping.name],
      link: limitedData[1][mapping.link],
      brand: limitedData[1][mapping.brand],
      qty: limitedData[1][mapping.qty],
      sum: limitedData[1][mapping.sum]
    });

    const cleanData = limitedData;

    // Автоматический подбор конкурентов по объёму
    console.log('🔄 Автоматический подбор конкурентов по объёму...');
    const autoMatched = autoMatchCompetitors(cleanData, mapping, state.vmpData);

    // Объединяем с существующими конкурентами (новые перезаписывают старые для этой категории)
    const updatedSelections = { ...state.competitorSelections };

    // Добавляем автоматически подобранных конкурентов
    Object.entries(autoMatched).forEach(([sku, competitors]) => {
      updatedSelections[sku] = competitors;
    });

    const matchedCount = Object.keys(autoMatched).length;
    const totalCompetitors = Object.values(autoMatched).reduce((sum, arr) => sum + arr.length, 0);

    const updatedFiles = {
      ...state.uploadedFiles,
      [state.selectedType!]: cleanData
    };

    saveDataToServer({
      competitorSelections: updatedSelections,
      parsedPrices: state.parsedPrices,
      uploadedFiles: updatedFiles,
      lastUpdated: new Date().toISOString()
    }, selectedFile).then(() => {
      setState(prev => ({
        ...prev,
        uploadedFiles: updatedFiles,
        competitorSelections: updatedSelections
      }));
      alert(`✅ Файл успешно загружен\nСтрок: ${cleanData.length - 1}\n\n🎯 Автоподбор конкурентов:\n• Товаров с конкурентами: ${matchedCount}\n• Всего конкурентов: ${totalCompetitors}\n\nКонкуренты подобраны по схожему объёму.`);
    }).catch(error => {
      console.error('Ошибка сохранения файла:', error);
      alert('⚠️ Ошибка при загрузке файла');
    });
  };
  reader.readAsArrayBuffer(file);
};

  const handleOpenCompetitorModal = (sku: string, currentSelections: CompetitorRow[]) => {
    const indices = new Set<number>(currentSelections.map(s => s.originalIndex));
    setTempSelectedIndices(indices);
    setState(prev => ({ ...prev, activeModalSku: sku }));
  };

  const handleCloseModal = () => {
    setState(prev => ({ ...prev, activeModalSku: null }));
    setTempSelectedIndices(new Set());
    setSelectedVolumeFilter(null);
    setSelectedBrandFilter(null);
  };

  // В функции handleSaveCompetitors исправьте получение значений:
const handleSaveCompetitors = async () => {
  if (!state.activeModalSku || !state.selectedType) return;
  
  const excelData = state.uploadedFiles[state.selectedType];
  if (!excelData || excelData.length < 2) return;

  const headers = excelData[0];
  const mapping = detectColumns(excelData);

  console.log('📋 Заголовки Excel:', headers);
  console.log('🗺️ Сопоставление колонок:', mapping);

  const selectedRows: CompetitorRow[] = [];
  tempSelectedIndices.forEach(idx => {
    const row = excelData[idx];
    if (row && row.length > 0) {
      const link = mapping.link !== -1 && row[mapping.link] ? 
        String(row[mapping.link]).trim() : '#';
      
      const name = mapping.name !== -1 && row[mapping.name] ? 
        String(row[mapping.name]).trim() : 'Нет названия';
      
      const brand = mapping.brand !== -1 && row[mapping.brand] ? 
        String(row[mapping.brand]).trim() : '-';
      
      let qty = '';
      if (mapping.qty !== -1 && row[mapping.qty] !== undefined && row[mapping.qty] !== null) {
        const qtyValue = row[mapping.qty];
        qty = typeof qtyValue === 'number' ? 
          new Intl.NumberFormat('ru-RU').format(qtyValue) : 
          String(qtyValue).trim();
      }
      
      let sum = '';
      if (mapping.sum !== -1 && row[mapping.sum] !== undefined && row[mapping.sum] !== null) {
        const sumValue = row[mapping.sum];
        if (typeof sumValue === 'number') {
          sum = new Intl.NumberFormat('ru-RU', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          }).format(sumValue) + ' ₽';
        } else {
          const sumStr = String(sumValue).trim();
          sum = sumStr ? (sumStr.includes('₽') ? sumStr : sumStr + ' ₽') : '';
        }
      }
      
      const sku = extractSkuFromUrl(link);
      
      const qtyNumber = qty ? parseFloat(qty.replace(/\s+/g, '').replace(',', '.')) : undefined;
      const sumNumber = sum ? parseFloat(sum.replace(/[^\d.,]/g, '').replace(',', '.')) : undefined;
      
      console.log(`📝 Добавляем конкурента:`, { name, brand, link, qty, sum, sku });
      
      selectedRows.push({
        name: name,
        brand: brand,
        link: link,
        qty: qty,
        sum: sum,
        originalIndex: idx,
        sku: sku || undefined,
        lastUpdated: new Date().toISOString(),
priceHistory: [{
  date: new Date().toISOString(),
  price: '',
  priceNumber: 0,
  source: 'initial_selection',
  qty: qty,
  sum: sum,
  qtyNumber: qtyNumber,
  sumNumber: sumNumber
}]
      });
    }
  });

  if (selectedRows.length === 0) {
    alert('Не удалось загрузить данные из выбранных строк. Проверьте формат Excel файла.');
    return;
  }

  const updatedSelections = {
    ...state.competitorSelections,
    [state.activeModalSku!]: selectedRows
  };

  try {
    await saveDataToServer({
      competitorSelections: updatedSelections,
      parsedPrices: state.parsedPrices,
      uploadedFiles: state.uploadedFiles,
      lastUpdated: new Date().toISOString()
    }, selectedFile);
    
    console.log('✅ Данные сохранены на сервер');
    alert(`✅ Сохранено ${selectedRows.length} конкурентов`);
  } catch (error) {
    console.error('Ошибка сохранения на сервере:', error);
    alert('⚠️ Данные сохранены локально, но не на сервере');
  }

  setState(prev => ({
    ...prev,
    competitorSelections: updatedSelections,
    activeModalSku: null
  }));
};

  const toggleCompetitorSelection = (index: number) => {
    setTempSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Функция для извлечения объёма из названия товара
  const extractVolume = (productName: string): string => {
    if (!productName) return 'Не определён';

    // Функция для нормализации числа - округляет близкие значения к целым
    // Например: 3.93, 4.06, 4.0 -> 4; 0.5 -> 0.5; 2.5 -> 2.5
    const normalizeNumber = (num: string): string => {
      const n = parseFloat(num.replace(',', '.'));
      const rounded = Math.round(n);
      // Если разница с ближайшим целым меньше 0.15, округляем до целого
      // Это объединит 3.93, 4.06, 4.0 и т.д. в "4"
      if (Math.abs(n - rounded) < 0.15) {
        return String(rounded);
      }
      // Для значений типа 0.5, 2.5 - оставляем как есть
      if (Number.isInteger(n)) return String(n);
      // Иначе округляем до 1 знака и убираем trailing zeros
      return n.toFixed(1).replace(/\.?0+$/, '');
    };

    // Паттерны для поиска объёма (от более специфичных к более общим)
    // ВАЖНО: \b не работает с кириллицей, поэтому используем (?:\s|/|,|$|[^\w])
    const patterns = [
      // Литры: 4л, 4 л, 4.0л, 4,5л, 0,2л, 5 литров, 24 Л
      { regex: /(\d+[.,]?\d*)\s*л(?:итр)?(?:ов|а)?(?=\s|\/|,|$|[^\wа-яА-Я])/i, unit: 'л' },
      // Миллилитры: 500мл, 500 мл, 100МЛ, 50 Мл, 335 МЛ
      { regex: /(\d+[.,]?\d*)\s*мл(?=\s|\/|,|$|[^\wа-яА-Я])/i, unit: 'мл' },
      // Граммы: 200г, 200 г, 200гр, 30 гр, 50 грамм, 396,9 грамм, 10Г
      { regex: /(\d+[.,]?\d*)\s*г(?:р)?(?:амм)?(?:ов|а)?(?=\s|\/|,|$|[^\wа-яА-Я])/i, unit: 'г' },
      // Килограммы: 2кг, 2 кг, 0,4 кг, 0.39 кг, 4 КГ
      { regex: /(\d+[.,]?\d*)\s*кг(?:илограмм)?(?:ов|а)?(?=\s|\/|,|$|[^\wа-яА-Я])/i, unit: 'кг' },
    ];

    // Проверяем наборы отдельно (набор 3*20гр, 3х20г, 3x20г)
    const setMatch = productName.match(/набор\s*(\d+)\s*[*xх×]\s*(\d+[.,]?\d*)\s*([а-яa-z]+)/i) ||
                     productName.match(/(\d+)\s*[*xх×]\s*(\d+[.,]?\d*)\s*([а-яa-z]+)/i);
    if (setMatch) {
      const count = setMatch[1];
      const volume = normalizeNumber(setMatch[2]);
      const unit = setMatch[3].toLowerCase();
      return `Набор ${count}×${volume}${unit}`;
    }

    // Пытаемся найти объём по паттернам
    for (const pattern of patterns) {
      const match = productName.match(pattern.regex);
      if (match) {
        const value = normalizeNumber(match[1]);
        return `${value} ${pattern.unit}`;
      }
    }

    return 'Не определён';
  };

  // Функция для извлечения объёма в миллилитрах (нормализация)
  const extractVolumeInMl = (productName: string): number | null => {
    if (!productName) return null;

    // Паттерны для поиска объёма
    const patterns = [
      // Литры: 4л, 4 л, 4.0л, 4,5л
      { regex: /(\d+[.,]?\d*)\s*л(?:итр)?(?:ов|а)?(?=\s|\/|,|$|[^\wа-яА-Я])/i, multiplier: 1000 },
      // Миллилитры: 500мл, 500 мл
      { regex: /(\d+[.,]?\d*)\s*мл(?=\s|\/|,|$|[^\wа-яА-Я])/i, multiplier: 1 },
      // Граммы: 200г, 200 г (приравниваем к мл для сравнения)
      { regex: /(\d+[.,]?\d*)\s*г(?:р)?(?:амм)?(?:ов|а)?(?=\s|\/|,|$|[^\wа-яА-Я])/i, multiplier: 1 },
      // Килограммы: 2кг, 2 кг
      { regex: /(\d+[.,]?\d*)\s*кг(?:илограмм)?(?:ов|а)?(?=\s|\/|,|$|[^\wа-яА-Я])/i, multiplier: 1000 },
    ];

    for (const pattern of patterns) {
      const match = productName.match(pattern.regex);
      if (match) {
        const value = parseFloat(match[1].replace(',', '.'));
        return value * pattern.multiplier;
      }
    }

    return null;
  };

  // Функция для определения диапазона объёмов для сопоставления
  const getVolumeRange = (volumeInMl: number): { min: number; max: number } => {
    // ±5% от объёма нашего товара
    return { min: volumeInMl * 0.95, max: volumeInMl * 1.05 };
  };

  // Функция для автоматического подбора конкурентов к нашим товарам
  const autoMatchCompetitors = (
    excelData: any[][],
    mapping: { name: number; link: number; brand: number; qty: number; sum: number },
    ourProducts: VmpItem[]
  ): Record<string, CompetitorRow[]> => {
    const result: Record<string, CompetitorRow[]> = {};
    const excludedBrands = ['ВМПАВТО', 'РМ', 'Смазка.ру'];

    // Фильтруем наши товары по текущей категории
    const filteredOurProducts = state.selectedType
      ? ourProducts.filter(p => p.ВидТовара === state.selectedType)
      : ourProducts;

    // Для каждого нашего товара
    filteredOurProducts.forEach(ourProduct => {
      // Извлекаем объём из названия нашего товара
      const ourVolume = extractVolumeInMl(ourProduct.Номенклатура);

      if (!ourVolume) {
        console.log(`⚠️ Не удалось определить объём для: ${ourProduct.Номенклатура}`);
        return;
      }

      const range = getVolumeRange(ourVolume);
      const competitors: CompetitorRow[] = [];

      // Проходим по конкурентам в Excel
      for (let i = 1; i < excelData.length; i++) {
        const row = excelData[i];
        const brand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';

        // Пропускаем наши бренды
        if (excludedBrands.some(b => b.toLowerCase() === brand.toLowerCase())) {
          continue;
        }

        const productName = row[mapping.name] ? String(row[mapping.name]) : '';
        const competitorVolume = extractVolumeInMl(productName);

        // Проверяем, попадает ли объём конкурента в диапазон
        if (competitorVolume && competitorVolume >= range.min && competitorVolume <= range.max) {
          const link = row[mapping.link] ? String(row[mapping.link]).trim() : '';
          const sku = extractSkuFromUrl(link);

          competitors.push({
            name: productName,
            brand: brand,
            link: link,
            qty: row[mapping.qty] || 0,
            sum: row[mapping.sum] || 0,
            originalIndex: i,
            sku: sku || undefined,
            priceHistory: []
          });
        }
      }

      // Сортируем по сумме продаж и ограничиваем до 20 конкурентов
      const sortedCompetitors = competitors
        .sort((a, b) => {
          const sumA = typeof a.sum === 'number' ? a.sum : parseFloat(String(a.sum || '0').replace(/[^\d.-]/g, '')) || 0;
          const sumB = typeof b.sum === 'number' ? b.sum : parseFloat(String(b.sum || '0').replace(/[^\d.-]/g, '')) || 0;
          return sumB - sumA;
        })
        .slice(0, 20); // Ограничиваем до 20 конкурентов

      if (sortedCompetitors.length > 0) {
        result[ourProduct.Артикул] = sortedCompetitors;
        console.log(`✅ ${ourProduct.Номенклатура} (${ourVolume}мл): найдено ${sortedCompetitors.length} конкурентов (макс. 20)`);
      }
    });

    return result;
  };

  // Функция для извлечения вязкости из названия товара (для масел)
  const extractViscosity = (productName: string): string | null => {
    if (!productName) return null;

    // Паттерны для вязкости масел (SAE классификация)
    // Примеры: 5W-30, 5W30, 5w-30, 0W-20, 10W-40, 75W-90, 75W-140
    const patterns = [
      // Основной паттерн: число + W + дефис/пробел + число
      /(\d{1,2})\s*[Ww]\s*[-–—]?\s*(\d{1,3})/,
      // Всесезонные без дефиса: 5W30
      /(\d{1,2})[Ww](\d{1,3})/,
    ];

    for (const pattern of patterns) {
      const match = productName.match(pattern);
      if (match) {
        // Нормализуем формат: 5W-30
        return `${match[1]}W-${match[2]}`;
      }
    }

    return null;
  };

  // Проверка, является ли текущая категория маслом
  const isOilCategory = (): boolean => {
    if (!state.selectedType) return false;
    const oilCategories = ['Моторные масла', 'Трансмиссионные масла'];
    return oilCategories.some(cat => state.selectedType?.toLowerCase().includes(cat.toLowerCase()));
  };

  // Функция для получения вязкостей для выбранного бренда
  const getViscosityStatsForBrand = (brand: string) => {
    if (!currentExtraData || !isOilCategory()) return [];

    const excelData = currentExtraData as any[][];
    const mapping = detectColumns(excelData);

    if (mapping.name === -1 || mapping.brand === -1 || mapping.sum === -1) {
      return [];
    }

    const viscosityStats: Record<string, { count: number; totalSum: number }> = {};

    for (let i = 1; i < excelData.length; i++) {
      const row = excelData[i];
      const rowBrand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';

      if (rowBrand !== brand) continue;

      const productName = row[mapping.name] ? String(row[mapping.name]) : '';
      const viscosity = extractViscosity(productName);

      if (!viscosity) continue;

      const sumValue = row[mapping.sum];
      const sum = typeof sumValue === 'number' ? sumValue : parseFloat(String(sumValue || '0').replace(/[^\d.-]/g, '')) || 0;

      if (!viscosityStats[viscosity]) {
        viscosityStats[viscosity] = { count: 0, totalSum: 0 };
      }
      viscosityStats[viscosity].count++;
      viscosityStats[viscosity].totalSum += sum;
    }

    return Object.entries(viscosityStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        totalSum: stats.totalSum
      }))
      .sort((a, b) => b.totalSum - a.totalSum);
  };

  // Функция для получения топ-5 брендов по общей сумме продаж
  const getTopBrands = () => {
    if (!currentExtraData) return [];

    const excelData = currentExtraData as any[][];
    const mapping = detectColumns(excelData);

    if (mapping.brand === -1 || mapping.sum === -1) {
      return [];
    }

    const excludedBrands = ['ВМПАВТО', 'РМ', 'Смазка.ру'];
    let rowsToProcess: number[] = [];

    if (state.filteredRows && state.filteredRows.length > 0) {
      rowsToProcess = state.filteredRows;
    } else {
      for (let i = 1; i < excelData.length; i++) {
        rowsToProcess.push(i);
      }
    }

    // Собираем статистику по брендам
    const brandStats: Record<string, { count: number; totalSum: number }> = {};

    rowsToProcess.forEach(rowIndex => {
      const row = excelData[rowIndex];
      const brand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';

      if (excludedBrands.includes(brand)) return;

      const sumValue = row[mapping.sum];
      const sum = typeof sumValue === 'number' ? sumValue : parseFloat(String(sumValue || '0').replace(/[^\d.-]/g, '')) || 0;

      if (!brandStats[brand]) {
        brandStats[brand] = { count: 0, totalSum: 0 };
      }
      brandStats[brand].count++;
      brandStats[brand].totalSum += sum;
    });

    // Возвращаем топ-5 брендов
    return Object.entries(brandStats)
      .map(([brand, stats]) => ({
        name: brand,
        count: stats.count,
        totalSum: stats.totalSum
      }))
      .sort((a, b) => b.totalSum - a.totalSum)
      .slice(0, 5);
  };

  // Функция для получения статистики по объёмам для выбранного бренда
  const getVolumeStatsForBrand = (brand: string, viscosity?: string | null) => {
    if (!currentExtraData) return [];

    const excelData = currentExtraData as any[][];
    const mapping = detectColumns(excelData);

    if (mapping.name === -1 || mapping.brand === -1 || mapping.sum === -1) {
      return [];
    }

    let rowsToProcess: number[] = [];

    if (state.filteredRows && state.filteredRows.length > 0) {
      rowsToProcess = state.filteredRows;
    } else {
      for (let i = 1; i < excelData.length; i++) {
        rowsToProcess.push(i);
      }
    }

    // Собираем статистику по объёмам для этого бренда (и вязкости, если указана)
    const volumeStats: Record<string, { count: number; totalSum: number }> = {};

    rowsToProcess.forEach(rowIndex => {
      const row = excelData[rowIndex];
      const rowBrand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';

      if (rowBrand !== brand) return;

      const productName = row[mapping.name] ? String(row[mapping.name]) : '';

      // Для масел проверяем вязкость
      if (isOilCategory() && viscosity) {
        const rowViscosity = extractViscosity(productName);
        if (rowViscosity !== viscosity) return;
      }

      const volume = extractVolume(productName);
      const sumValue = row[mapping.sum];
      const sum = typeof sumValue === 'number' ? sumValue : parseFloat(String(sumValue || '0').replace(/[^\d.-]/g, '')) || 0;

      if (!volumeStats[volume]) {
        volumeStats[volume] = { count: 0, totalSum: 0 };
      }
      volumeStats[volume].count++;
      volumeStats[volume].totalSum += sum;
    });

    // Возвращаем объёмы, отсортированные по сумме
    return Object.entries(volumeStats)
      .map(([volume, stats]) => ({
        name: volume,
        count: stats.count,
        totalSum: stats.totalSum
      }))
      .sort((a, b) => b.totalSum - a.totalSum);
  };

  // Функция для получения видимых строк с учётом фильтров
  const getVisibleRows = () => {
    if (!currentExtraData) return [];

    const excelData = currentExtraData as any[][];
    const mapping = detectColumns(excelData);

    if (mapping.name === -1 || mapping.brand === -1 || mapping.sum === -1) {
      return [];
    }

    // Получаем топ-5 брендов по общей сумме продаж
    const topBrands = getTopBrands();
    const topBrandNames = topBrands.map(b => b.name);

    let rowsToProcess: number[] = [];

    if (state.filteredRows && state.filteredRows.length > 0) {
      rowsToProcess = state.filteredRows;
    } else {
      for (let i = 1; i < excelData.length; i++) {
        rowsToProcess.push(i);
      }
    }

    const isOil = isOilCategory();

    // Фильтруем строки: только топ-5 брендов
    const filteredRows = rowsToProcess.filter(rowIndex => {
      const row = excelData[rowIndex];
      const brand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';
      const productName = row[mapping.name] ? String(row[mapping.name]) : '';

      // Только топ-5 брендов
      if (!topBrandNames.includes(brand)) return false;

      // Фильтр по выбранному бренду
      if (selectedBrandFilter && brand !== selectedBrandFilter) return false;

      // Фильтр по выбранной вязкости (только для масел)
      if (isOil && selectedViscosityFilter) {
        const viscosity = extractViscosity(productName);
        if (viscosity !== selectedViscosityFilter) return false;
      }

      // Фильтр по выбранному объёму
      if (selectedVolumeFilter) {
        const volume = extractVolume(productName);
        if (volume !== selectedVolumeFilter) return false;
      }

      return true;
    });

    // Для масел группируем по бренду → вязкость → объём
    // Для остальных: бренду → объём
    if (isOil) {
      // Группируем по бренду → вязкость → объём
      const brandViscosityVolumeGroups: Record<string, Record<string, Record<string, number[]>>> = {};

      filteredRows.forEach(rowIndex => {
        const row = excelData[rowIndex];
        const brand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';
        const productName = row[mapping.name] ? String(row[mapping.name]) : '';
        const viscosity = extractViscosity(productName) || 'Без вязкости';
        const volume = extractVolume(productName);

        if (!brandViscosityVolumeGroups[brand]) {
          brandViscosityVolumeGroups[brand] = {};
        }
        if (!brandViscosityVolumeGroups[brand][viscosity]) {
          brandViscosityVolumeGroups[brand][viscosity] = {};
        }
        if (!brandViscosityVolumeGroups[brand][viscosity][volume]) {
          brandViscosityVolumeGroups[brand][viscosity][volume] = [];
        }
        brandViscosityVolumeGroups[brand][viscosity][volume].push(rowIndex);
      });

      // Собираем результат
      const resultRows: number[] = [];
      const sortedBrands = topBrandNames.filter(brand => brandViscosityVolumeGroups[brand]);

      sortedBrands.forEach(brand => {
        const viscosityGroups = brandViscosityVolumeGroups[brand];

        Object.values(viscosityGroups).forEach(volumeGroups => {
          Object.values(volumeGroups).forEach(rows => {
            const sortedRows = rows
              .map(rowIndex => {
                const row = excelData[rowIndex];
                const sumValue = row[mapping.sum];
                const sum = typeof sumValue === 'number' ? sumValue : parseFloat(String(sumValue || '0').replace(/[^\d.-]/g, '')) || 0;
                return { rowIndex, sum };
              })
              .sort((a, b) => b.sum - a.sum)
              .slice(0, 5);

            resultRows.push(...sortedRows.map(r => r.rowIndex));
          });
        });
      });

      return resultRows;
    }

    // Для не-масел: группируем по бренду → объём
    const brandVolumeGroups: Record<string, Record<string, number[]>> = {};

    filteredRows.forEach(rowIndex => {
      const row = excelData[rowIndex];
      const brand = row[mapping.brand] ? String(row[mapping.brand]).trim() : '';
      const productName = row[mapping.name] ? String(row[mapping.name]) : '';
      const volume = extractVolume(productName);

      if (!brandVolumeGroups[brand]) {
        brandVolumeGroups[brand] = {};
      }
      if (!brandVolumeGroups[brand][volume]) {
        brandVolumeGroups[brand][volume] = [];
      }
      brandVolumeGroups[brand][volume].push(rowIndex);
    });

    // Собираем результат: от каждого бренда берём по 5 позиций в каждом объёме
    const resultRows: number[] = [];

    // Сортируем бренды по их позиции в топ-5
    const sortedBrands = topBrandNames.filter(brand => brandVolumeGroups[brand]);

    sortedBrands.forEach(brand => {
      const volumeGroups = brandVolumeGroups[brand];

      // Для каждого объёма этого бренда
      Object.values(volumeGroups).forEach(rows => {
        // Сортируем по сумме и берём топ-5
        const sortedRows = rows
          .map(rowIndex => {
            const row = excelData[rowIndex];
            const sumValue = row[mapping.sum];
            const sum = typeof sumValue === 'number' ? sumValue : parseFloat(String(sumValue || '0').replace(/[^\d.-]/g, '')) || 0;
            return { rowIndex, sum };
          })
          .sort((a, b) => b.sum - a.sum)
          .slice(0, 5);

        resultRows.push(...sortedRows.map(r => r.rowIndex));
      });
    });

    return resultRows;
  };

  const handleExport = () => {
  const wb = window.XLSX.utils.book_new();
  
  const exportData = filteredData.map(item => {
    const ozonItem = state.ozonData[item.Артикул];
    const competitors = state.competitorSelections[item.Артикул] || [];
    const ourDiscountPercent = state.ozonPrices[item.Артикул]?.discount_percent;
    
    // Собираем рекомендованные цены для конкурентов
    const recommendedPrices = competitors.map(c => {
      if (c.ozonCardPrice && ourDiscountPercent) {
        const competitorPriceNum = extractPriceNumber(c.ozonCardPrice);
        const recommendedPrice = (competitorPriceNum - 10) / (1 - ourDiscountPercent);
        return `${Math.round(recommendedPrice * 100) / 100} ₽`;
      }
      return 'Нет данных';
    });
    
    // Получаем цену по Ozon Card (сначала спарсенную, потом из API)
    const parsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);
    const parsedPrice = parsedData?.price;
    const ozonCardPrice = parsedPrice || ozonItem?.customer_price || 'Нет данных';
    const priceSource = parsedPrice ? ` (спарсено ${parsedData?.date})` : ozonItem?.customer_price ? ' (API)' : '';

    return {
      'Артикул': item.Артикул,
      'Номенклатура': item.Номенклатура,
      'Обычная цена Ozon': ozonItem ? `${ozonItem.price} ₽` : 'Товар в архиве',
      'Цена по Ozon Card': ozonCardPrice + priceSource,
      'Соинвест, %': ourDiscountPercent ? `${(ourDiscountPercent * 100).toFixed(1)}%` : 'Нет данных',
      'Вид товара': item.ВидТовара,
      'Конкуренты (Имена)': competitors.map(c => `${c.name} (${c.link})`).join('\n'),
      'Конкуренты (Бренд)': competitors.map(c => c.brand).join('\n'),
      'Цены конкурентов Ozon Card': competitors.map(c => c.ozonCardPrice || 'Не спарсена').join('\n'),
      'Рекомендованные цены': recommendedPrices.join('\n'),
      'Конкуренты (Штуки)': competitors.map(c => c.qty).join('\n'),
      'Конкуренты (Сумма)': competitors.map(c => c.sum).join('\n'),
      'Дата обновления': competitors.map(c => c.lastUpdated ? new Date(c.lastUpdated).toLocaleString() : '').join('\n'),
    };
  });

  const ws = window.XLSX.utils.json_to_sheet(exportData);
  window.XLSX.utils.book_append_sheet(wb, ws, "Price Data");
  window.XLSX.writeFile(wb, `price_regulation_${new Date().toISOString().slice(0,10)}.xlsx`);
};

  const createNewFile = async () => {
    const filename = prompt('Введите имя нового файла:', `data_${new Date().toISOString().slice(0,10)}`);
    if (filename) {
      const cleanFilename = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
      setSelectedFile(cleanFilename);
      setState(prev => ({
        ...prev,
        competitorSelections: {},
        uploadedFiles: {},
        parsedPrices: {}
      }));
      await loadFilesList();
    }
  };

  const loadSelectedFile = async (filename: string) => {
    try {
      const result = await loadDataFromServer(filename);
      if (result.success && result.data) {
        setSelectedFile(filename.replace('.json', ''));
        setState(prev => ({
          ...prev,
          competitorSelections: result.data.competitorSelections || {},
          parsedPrices: result.data.parsedPrices || {},
          uploadedFiles: result.data.uploadedFiles || {}
        }));
      } else {
        alert(`Файл "${filename}" не найден или пуст`);
      }
    } catch (error: any) {
      alert(`Ошибка загрузки файла: ${error.message}`);
    }
  };

  const deleteSelectedFile = async (filename: string) => {
    if (confirm(`Удалить файл "${filename}"?`)) {
      try {
        await deleteDataFile(filename);
        await loadFilesList();
        
        if (selectedFile === filename.replace('.json', '')) {
          setSelectedFile(DEFAULT_DATA_FILENAME);
          setState(prev => ({
            ...prev,
            competitorSelections: {},
            uploadedFiles: {},
            parsedPrices: {}
          }));
        }
        
        alert(`Файл "${filename}" удалён`);
      } catch (error: any) {
        alert(`Ошибка удаления файла: ${error.message}`);
      }
    }
  };

  const handleCreateBackup = async () => {
    try {
      const result = await createBackup();
      if (result.success) {
        alert(`✅ Бэкап создан: ${result.filename}\nРазмер: ${(result.size / 1024).toFixed(2)} KB`);
        await loadFilesList();
      }
    } catch (error: any) {
      alert(`Ошибка создания бэкапа: ${error.message}`);
    }
  };

  const showDataStatistics = () => {
    const itemCount = Object.keys(state.competitorSelections).length;
    const competitorCount = Object.values(state.competitorSelections)
      .reduce((acc: number, val: any) => acc + (Array.isArray(val) ? val.length : 0), 0);
    
    // Считаем записи в истории
    let historyCount = 0;
    Object.values(state.competitorSelections).forEach((competitors: any) => {
      if (Array.isArray(competitors)) {
        competitors.forEach((competitor: CompetitorRow) => {
          if (competitor.priceHistory) {
            historyCount += competitor.priceHistory.length;
          }
        });
      }
    });
    
    const selectedFileInfo = dataFiles.find(f => f.name === `${selectedFile}.json`);
    
    alert(`📊 Статистика данных:\n\n` +
      `Текущий файл: ${selectedFile}\n` +
      `Товаров с конкурентами: ${itemCount}\n` +
      `Всего конкурентов: ${competitorCount}\n` +
      `Записей в истории: ${historyCount}\n` +
      `Загруженных Excel файлов: ${Object.keys(state.uploadedFiles).length}\n` +
      `Последнее обновление: ${selectedFileInfo?.lastUpdated ? new Date(selectedFileInfo.lastUpdated).toLocaleString() : 'нет данных'}\n` +
      `Размер файла: ${selectedFileInfo ? (selectedFileInfo.size / 1024).toFixed(2) + ' KB' : 'неизвестно'}\n` +
      `Всего файлов в системе: ${dataFiles.length}`);
  };

  const loadHistoricalData = async (date: string) => {
    try {
      const result = await loadDataFromServer(`daily_data_${date}`);
      if (result.success && result.data) {
        alert(`📊 Загружены исторические данные за ${date}\n\n` +
              `Товаров: ${Object.keys(result.data.competitorSelections || {}).length}\n` +
              `Конкурентов: ${Object.values(result.data.competitorSelections || {}).reduce((acc: number, val: any) => acc + (Array.isArray(val) ? val.length : 0), 0)}\n` +
              `Дата создания: ${new Date(result.data.timestamp).toLocaleString()}`);
      } else {
        alert(`Исторические данные за ${date} не найдены`);
      }
    } catch (error: any) {
      alert(`Ошибка загрузки исторических данных: ${error.message}`);
    }
  };

  const hasCompetitors = useMemo(() => {
    return Object.values(state.competitorSelections).some((competitors: any) =>
      Array.isArray(competitors) && competitors.length > 0
    );
  }, [state.competitorSelections]);

  const productTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    state.vmpData.forEach((item: VmpItem) => {
      if (item.ВидТовара) {
        counts[item.ВидТовара] = (counts[item.ВидТовара] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [state.vmpData]);

  const filteredData = useMemo(() => {
    let data = state.vmpData;

    // Фильтр по виду товара
    if (state.selectedType) {
      data = data.filter((item: VmpItem) => item.ВидТовара === state.selectedType);
    }

    // Скрываем товары со статусом "Архив/Нет" (нет в ozonData или архивные)
    data = data.filter((item: VmpItem) => {
      const ozonItem = state.ozonData[item.Артикул];
      return ozonItem && !ozonItem.is_archived;
    });

    return data;
  }, [state.vmpData, state.selectedType, state.ozonData]);

  const activeItem = state.activeModalSku ? state.vmpData.find(i => i.Артикул === state.activeModalSku) : null;
  // currentExtraData теперь зависит от type_id товара, для которого открыто модальное окно
  const activeOzonItem = state.activeModalSku ? state.ozonData[state.activeModalSku] : null;
  const activeTypeKey = activeOzonItem?.type_id ? `type_${activeOzonItem.type_id}` : null;
  const currentExtraData = activeTypeKey ? state.uploadedFiles[activeTypeKey] : null;

  // Разделяем товары на видимые и скрытые
  const { visibleProducts, hiddenProducts } = useMemo(() => {
    const visible: VmpItem[] = [];
    const hidden: VmpItem[] = [];

    // Проверяем, был ли выполнен парсинг (есть ли спарсенные цены)
    const hasParsedPricesAny = hasParsedPrices(state.parsedPrices);

    filteredData.forEach((item: VmpItem) => {
      const ozonItem = state.ozonData[item.Артикул];
      const sku = ozonItem?.sku ? String(ozonItem.sku) : null;
      const salesData = sku ? state.salesData[sku] : null;
      const competitors = state.competitorSelections[item.Артикул] || [];

      // Проверяем, загружен ли файл для type_id этого товара
      const typeKey = ozonItem?.type_id ? `type_${ozonItem.type_id}` : null;
      const hasFileLoaded = typeKey && state.uploadedFiles[typeKey];

      // Проверяем наличие СПАРСЕННОЙ цены (цена из API не считается)
      const parsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);
      const hasParsedPrice = !!parsedData;

      // Проверяем наличие продаж
      const hasSales = salesData && (salesData.qty > 0 || salesData.sum > 0);

      // Проверяем наличие конкурентов
      const hasCompetitors = competitors.length > 0;

      // Логика видимости:
      // 1. До загрузки файла для подкатегории - все скрыты
      // 2. После загрузки файла - показываем тех, у кого есть продажи и конкуренты

      if (!hasFileLoaded) {
        // До загрузки файла - все скрыты
        hidden.push(item);
      } else if (hasCompetitors && hasSales) {
        // Показываем тех, у кого есть конкуренты и продажи (независимо от парсинга цены)
        visible.push(item);
      } else {
        hidden.push(item);
      }
    });

    return { visibleProducts: visible, hiddenProducts: hidden };
  }, [filteredData, state.ozonData, state.salesData, state.competitorSelections, state.parsedPrices, state.uploadedFiles]);

  // Группировка ВСЕХ товаров по типам Ozon (type_id - конкретная подкатегория)
  // Включаем все товары, чтобы показать кнопки загрузки файлов для каждой подкатегории
  const groupedProducts = useMemo(() => {
    const groups: Record<string, { categoryId: number | null; categoryName: string; items: VmpItem[]; visibleItems: VmpItem[] }> = {};

    // Создаём Set для быстрой проверки видимости
    const visibleSet = new Set(visibleProducts.map((item: VmpItem) => item.Артикул));

    filteredData.forEach((item: VmpItem) => {
      const ozonItem = state.ozonData[item.Артикул];
      // Используем type_id как более конкретную категорию
      const typeId = ozonItem?.type_id;
      const categoryName = typeId ? (state.ozonCategories[typeId] || 'Тип не определён') : 'Без типа';
      const groupKey = typeId?.toString() || 'no-type';

      if (!groups[groupKey]) {
        groups[groupKey] = {
          categoryId: typeId || null,
          categoryName,
          items: [],
          visibleItems: []
        };
      }
      groups[groupKey].items.push(item);

      // Добавляем в visibleItems только видимые товары
      if (visibleSet.has(item.Артикул)) {
        groups[groupKey].visibleItems.push(item);
      }
    });

    // Сортируем группы: сначала с типами (по названию), потом без типа
    return Object.values(groups).sort((a, b) => {
      if (!a.categoryId && b.categoryId) return 1;
      if (a.categoryId && !b.categoryId) return -1;
      return a.categoryName.localeCompare(b.categoryName, 'ru');
    });
  }, [filteredData, visibleProducts, state.ozonData, state.ozonCategories]);

  if (state.loading) return <div className="text-center mt-5"><div className="spinner-border text-primary" role="status"></div><p className="mt-2">Loading data...</p></div>;
  if (state.error) return <div className="alert alert-danger m-4">{state.error}</div>;

  return (
    <div className="container-fluid pb-5">
      <h1 className="mb-4 text-center">Регулирование цен</h1>
      
      {state.usingFallback && (
        <div className="alert alert-warning mb-3">
          <strong>Примечание:</strong> Использованы кэшированные данные (data_cache.json), так как прямой доступ к API ограничен.
        </div>
      )}

      {ozonProgress.total > 0 && (
        <div className="alert alert-info mb-3">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <strong>Загрузка Ozon данных:</strong> {ozonProgress.stage}
            </div>
            <div>
              {ozonProgress.current} / {ozonProgress.total}
            </div>
          </div>
          <div className="progress mt-2">
            <div 
              className="progress-bar progress-bar-striped progress-bar-animated" 
              role="progressbar" 
              style={{ width: `${(ozonProgress.current / ozonProgress.total) * 100}%` }}
            >
              {Math.round((ozonProgress.current / ozonProgress.total) * 100)}%
            </div>
          </div>
        </div>
      )}

      <div className="alert alert-info mb-3" style={{ display: 'none' }}>
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <strong>Файл данных:</strong> 
            <select 
              className="form-select form-select-sm d-inline-block w-auto mx-2"
              value={selectedFile}
              onChange={(e) => loadSelectedFile(e.target.value)}
            >
              <option value={DEFAULT_DATA_FILENAME}>Основной файл</option>
              {dataFiles.map((file, index) => (
                <option key={index} value={file.name.replace('.json', '')}>
                  {file.name} ({file.itemCount} товаров)
                </option>
              ))}
            </select>
            {isSaving && <span className="text-muted ms-2">Сохранение...</span>}
          </div>
          <div className="btn-group btn-group-sm">
            <button 
              className="btn btn-outline-primary"
              onClick={() => setIsManagingFiles(!isManagingFiles)}
            >
              📁 Управление файлами
            </button>
            <button 
              className="btn btn-outline-success"
              onClick={createNewFile}
            >
              ➕ Новый файл
            </button>
            <button 
              className="btn btn-outline-warning"
              onClick={showDataStatistics}
            >
              📊 Статистика
            </button>
            <button 
              className="btn btn-outline-secondary"
              onClick={handleCreateBackup}
            >
              💾 Бэкап
            </button>
          </div>
        </div>
      </div>

      {isManagingFiles && (
        <div className="card mb-3">
          <div className="card-header">
            <h5 className="mb-0">📁 Управление файлами данных</h5>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-sm table-hover">
                <thead>
                  <tr>
                    <th>Имя файла</th>
                    <th>Размер</th>
                    <th>Изменён</th>
                    <th>Товаров</th>
                    <th>Конкурентов</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {dataFiles.map((file, index) => (
                    <tr key={index} className={selectedFile === file.name.replace('.json', '') ? 'table-active' : ''}>
                      <td>{file.name}</td>
                      <td>{(file.size / 1024).toFixed(2)} KB</td>
                      <td>{new Date(file.modified).toLocaleDateString()}</td>
                      <td>{file.itemCount}</td>
                      <td>{file.competitorCount}</td>
                      <td>
                        <button 
                          className="btn btn-sm btn-outline-primary me-1"
                          onClick={() => loadSelectedFile(file.name.replace('.json', ''))}
                          disabled={selectedFile === file.name.replace('.json', '')}
                        >
                          📂 Открыть
                        </button>
                        {file.name.startsWith('daily_data_') && (
                          <button 
                            className="btn btn-sm btn-outline-info me-1"
                            onClick={() => loadHistoricalData(file.name.replace('daily_data_', '').replace('.json', ''))}
                          >
                            📅 История
                          </button>
                        )}
                        <button 
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => deleteSelectedFile(file.name)}
                        >
                          🗑️ Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-end">
              <button 
                className="btn btn-sm btn-secondary"
                onClick={loadFilesList}
              >
                🔄 Обновить список
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tag-cloud">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="m-0">Фильтр по виду товара:</h5>
          <button className="btn btn-secondary btn-sm" onClick={() => handleTypeSelect(null)}>Сбросить фильтр</button>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {productTypes.map(([type, count]) => (
            <span 
              key={type} 
              className={`badge rounded-pill border tag p-2 ${state.selectedType === type ? 'active' : 'bg-light text-dark'}`}
              onClick={() => handleTypeSelect(type)}
            >
              {type} ({count})
            </span>
          ))}
        </div>
      </div>

<div className="mb-3 d-flex gap-2 flex-wrap">
  {/* <button className="btn btn-success" onClick={handleExport}>📊 Скачать в Excel</button> */}
  
  {hasCompetitors && (
    <button 
      className="btn btn-warning"
      onClick={parseOzonCardPrices}
      disabled={state.isParsingPrices}
    >
      {state.isParsingPrices ? (
        <>
          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
          Парсинг...
        </>
      ) : 'Получить цены по Ozon Card'}
    </button>
  )}
  
  {/* <button 
    className="btn btn-info"
    onClick={async () => {
      try {
        setState(prev => ({ ...prev, loading: true }));
        const offerIds = Array.from(new Set(state.vmpData.map(i => i.Артикул).filter(Boolean)));
        const ozonPricesMap = await fetchOzonPrices(offerIds, state.ozonData);
        setState(prev => ({
          ...prev,
          ozonPrices: ozonPricesMap,
          loading: false
        }));
        alert(`✅ Обновлены данные о соинвесте\nТоваров: ${Object.keys(ozonPricesMap).length}`);
      } catch (error: any) {
        setState(prev => ({ ...prev, loading: false }));
        alert(`❌ Ошибка обновления соинвеста: ${error.message}`);
      }
    }}
    disabled={state.loading}
  >
    {state.loading ? (
      <>
        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
        Загрузка...
      </>
    ) : '🔄 Обновить соинвест'}
  </button> */}
</div>

      {/* {state.isParsingPrices && (
        <div className="alert alert-info mb-3">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <strong>Парсинг цен:</strong> {parsingProgress.status}
            </div>
            <div>
              {parsingProgress.current > 0 && (
                <span>
                  {parsingProgress.current} / {parsingProgress.total}
                </span>
              )}
            </div>
          </div>
          {parsingProgress.total > 0 && (
            <div className="progress mt-2">
              <div 
                className="progress-bar progress-bar-striped progress-bar-animated" 
                role="progressbar" 
                style={{ width: `${(parsingProgress.current / parsingProgress.total) * 100}%` }}
              >
                {Math.round((parsingProgress.current / parsingProgress.total) * 100)}%
              </div>
            </div>
          )}
        </div>
      )} */}

      <div className="main-table-container">
        <table className="product-table table-hover align-middle">
          <thead className="table-light sticky-top">
            <tr>
              <th style={{width: '30px'}} title="Предупреждение: конкурент дешевле и продаёт больше">⚠️</th>
              <th style={{width: '80px'}}>Фото</th>
              <th style={{width: '25%'}}>Номенклатура</th>
              <th style={{width: '10%'}}>Цена Ozon заливочная</th>
              <th style={{width: '15%'}}>Цена по Ozon Card</th>
              <th style={{width: '10%'}}>Заказано, шт</th>
              <th style={{width: '12%'}}>Сумма заказа</th>
              <th style={{width: '100px'}}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {groupedProducts.map((group, groupIdx) => {
              const isCollapsed = state.collapsedCategories[group.categoryId?.toString() || 'no-type'];
              const typeKey = `type_${group.categoryId || 'no-type'}`;
              const hasTypeFile = state.uploadedFiles[typeKey];

              return (
                <React.Fragment key={`group-${group.categoryId || 'no-type'}-${groupIdx}`}>
                  {/* Заголовок подкатегории */}
                  <tr className="table-light">
                    <td colSpan={8} className="py-2 px-3" style={{background: '#f8f9fa'}}>
                      <div className="d-flex align-items-center justify-content-between">
                        <div
                          className="d-flex align-items-center"
                          style={{cursor: 'pointer'}}
                          onClick={() => {
                            const key = group.categoryId?.toString() || 'no-type';
                            setState((prev: AppState) => ({
                              ...prev,
                              collapsedCategories: {
                                ...prev.collapsedCategories,
                                [key]: !prev.collapsedCategories[key]
                              }
                            }));
                          }}
                        >
                          <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'} me-2 text-muted`}></i>
                          <span className="text-muted" style={{fontSize: '0.9rem'}}>
                            {group.categoryName}
                          </span>
                          <span className="badge bg-light text-muted border ms-2">
                            {group.visibleItems.length > 0 ? `${group.visibleItems.length} / ${group.items.length}` : group.items.length}
                          </span>
                        </div>
                        {/* Загрузка файла для подкатегории */}
                        <div className="d-flex align-items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {hasTypeFile ? (
                            <span className="text-muted small">
                              <i className="bi bi-check"></i> Файл загружен ({(hasTypeFile as any[][]).length - 1} строк)
                            </span>
                          ) : (
                            <span className="text-muted small">Нет файла</span>
                          )}
                          <label className="btn btn-sm btn-outline-secondary mb-0" style={{cursor: 'pointer'}}>
                            <i className="bi bi-upload me-1"></i>
                            {hasTypeFile ? 'Заменить' : 'Загрузить XLS'}
                            <input
                              type="file"
                              accept=".xls,.xlsx"
                              style={{display: 'none'}}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                const reader = new FileReader();
                                reader.onload = (evt) => {
                                  try {
                                    const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                                    const workbook = window.XLSX.read(data, { type: 'array' });
                                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                                    const jsonData = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];

                                    // Автоматический подбор конкурентов для товаров этой подкатегории
                                    const mapping = detectColumns(jsonData);
                                    const categoryProducts = group.items; // Все товары этой подкатегории
                                    const autoMatched = autoMatchCompetitors(jsonData, mapping, categoryProducts);

                                    // Объединяем с существующими конкурентами
                                    const updatedSelections = { ...state.competitorSelections };
                                    Object.entries(autoMatched).forEach(([sku, competitors]) => {
                                      updatedSelections[sku] = competitors;
                                    });

                                    const matchedCount = Object.keys(autoMatched).length;
                                    const totalCompetitors = Object.values(autoMatched).reduce((sum, arr) => sum + arr.length, 0);

                                    const updatedFiles = {
                                      ...state.uploadedFiles,
                                      [typeKey]: jsonData
                                    };

                                    // Сохраняем на сервер
                                    saveDataToServer({
                                      competitorSelections: updatedSelections,
                                      parsedPrices: state.parsedPrices,
                                      uploadedFiles: updatedFiles,
                                      lastUpdated: new Date().toISOString()
                                    }, selectedFile).then(() => {
                                      setState((prev: AppState) => ({
                                        ...prev,
                                        uploadedFiles: updatedFiles,
                                        competitorSelections: updatedSelections
                                      }));
                                      console.log(`✅ Файл загружен для ${group.categoryName}: ${jsonData.length - 1} строк, ${matchedCount} товаров с конкурентами (${totalCompetitors} всего)`);
                                    });
                                  } catch (err) {
                                    console.error('Ошибка чтения Excel:', err);
                                    alert('Ошибка чтения файла Excel');
                                  }
                                };
                                reader.readAsArrayBuffer(file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </td>
                  </tr>

                  {/* Товары подкатегории */}
                  {!isCollapsed && group.visibleItems.map((item: VmpItem, idx: number) => {
              const ozonItem = state.ozonData[item.Артикул];
              const imageUrl = ozonItem?.primary_image || ozonItem?.images?.[0];
              const competitors = state.competitorSelections[item.Артикул] || [];
              const hasFile = hasTypeFile;

              // Проверяем, есть ли конкуренты с предупреждением
              const ourParsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);
              const ourParsedPrice = ourParsedData?.price;
              const ourSku = ozonItem?.sku ? String(ozonItem.sku) : null;
              const ourSalesData = ourSku ? state.salesData[ourSku] : null;
              const ourDiscountPercent = state.ozonPrices[item.Артикул]?.discount_percent || 0;
              const ourAdjustedSum = ourSalesData?.sum ? ourSalesData.sum * (1 - ourDiscountPercent) : 0;
              // Цена по Ozon Card = спарсенная цена - 10%
              const ourParsedPriceNum = ourParsedPrice
                ? parseFloat(String(ourParsedPrice).replace(/[^\d.,]/g, '').replace(',', '.')) || 0
                : 0;
              const ourPriceNum = ourParsedPriceNum * 0.9;

              // Проверяем каждого конкурента на условие предупреждения
              const hasWarningCompetitor = competitors.some((c: CompetitorRow) => {
                const competitorParsedPrice = c.ozonCardPrice
                  ? parseFloat(String(c.ozonCardPrice).replace(/[^\d.,]/g, '').replace(',', '.')) || 0
                  : 0;
                // Цена по Ozon Card = спарсенная цена - 10%
                const competitorPriceNum = competitorParsedPrice * 0.9;
                const competitorQty = typeof c.qty === 'number' ? c.qty : parseFloat(String(c.qty || '0').replace(/[^\d.-]/g, '')) || 0;
                const competitorSum = typeof c.sum === 'number' ? c.sum : parseFloat(String(c.sum || '0').replace(/[^\d.-]/g, '')) || 0;

                return ourPriceNum > 0 && competitorPriceNum > 0 &&
                  competitorPriceNum < ourPriceNum &&
                  ((ourSalesData?.qty && competitorQty > ourSalesData.qty) ||
                   (ourAdjustedSum > 0 && competitorSum > ourAdjustedSum));
              });

              return (
                <React.Fragment key={`${item.Артикул}-${idx}`}>
                  {/* Основная строка товара */}
                  <tr className={`product-row ${hasWarningCompetitor ? 'table-warning' : ''}`}>
                    <td className="text-center">
                      {hasWarningCompetitor && (
                        <i className="bi bi-exclamation-triangle-fill text-danger"
                           title="Есть конкурент дешевле с большими продажами!"
                           style={{fontSize: '1.2rem'}}></i>
                      )}
                    </td>
                    <td>
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          className="product-img shadow-sm"
                          alt={item.Номенклатура}
                          onClick={() => setModalImage(imageUrl)}
                        />
                      ) : <span className="text-muted small">Нет фото</span>}
                    </td>
                    <td>
                      <div className="fw-medium">{item.Номенклатура}</div>
                      <div className="small text-muted">{item.ВидТовара}</div>
                      <div className="small">
                        {ozonItem?.sku ? (
                          <a href={`https://www.ozon.ru/product/${ozonItem.sku}`} target="_blank" rel="noreferrer"
                            className="text-decoration-none text-muted">
                            <i className="bi bi-link"></i> Ссылка
                          </a>
                        ) : (
                          <span className="text-muted">Арт: {item.Артикул}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {ozonItem ? (
                        <div className="price-display price-regular">
                          {ozonItem.price} ₽
                          {state.ozonPrices[item.Артикул]?.discount_percent && (
                            <div className="small soinvest">
                              <i className="bi bi-percent text-muted mt-1"></i> Соинвест: {(state.ozonPrices[item.Артикул]?.discount_percent * 100).toFixed(1)}%
                            </div>
                          )}
                        </div>
                      ) : <span className="text-danger">Архив/Нет</span>}
                    </td>
                    <td>
                      {(() => {
                        // Берём последнюю спарсенную цену
                        const parsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);
                        const parsedPrice = parsedData?.price;
                        const parsedDate = parsedData?.date;

                        // Функция для расчёта цены по Ozon Card = спарсенная цена - 10%
                        const calculateOzonCardPrice = (priceStr: string): string => {
                          const priceNum = parseFloat(priceStr.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                          if (priceNum <= 0) return priceStr;
                          const ozonCardPrice = priceNum * 0.9;
                          return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(ozonCardPrice)} ₽`;
                        };

                        if (parsedPrice) {
                          const today = new Date().toISOString().split('T')[0];
                          const isToday = parsedDate === today;
                          return (
                            <div className="price-display price-card">
                              {calculateOzonCardPrice(parsedPrice)}
                              <div className="small text-muted">
                                <i className="bi bi-check-circle"></i> {isToday ? 'Спарсено' : parsedDate}
                              </div>
                            </div>
                          );
                        } else if (ozonItem?.customer_price) {
                          return (
                            <div className="price-display price-card">
                              {calculateOzonCardPrice(ozonItem.customer_price)}
                              <div className="small text-muted">
                                <i className="bi bi-cloud"></i> API - 10%
                              </div>
                            </div>
                          );
                        } else {
                          return <span className="text-muted small">Нет данных</span>;
                        }
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const sku = ozonItem?.sku ? String(ozonItem.sku) : null;
                        const salesData = sku ? state.salesData[sku] : null;
                        if (salesData?.qty) {
                          return <span>{new Intl.NumberFormat('ru-RU').format(salesData.qty)}</span>;
                        }
                        return <span className="text-muted">—</span>;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const sku = ozonItem?.sku ? String(ozonItem.sku) : null;
                        const salesData = sku ? state.salesData[sku] : null;
                        const discountPercent = state.ozonPrices[item.Артикул]?.discount_percent || 0;
                        if (salesData?.sum) {
                          // Сумма заказа = сумма из API * (1 - соинвест)
                          const adjustedSum = salesData.sum * (1 - discountPercent);
                          const formula = `Сумма из API: ${new Intl.NumberFormat('ru-RU').format(salesData.sum)} ₽\nСоинвест: ${(discountPercent * 100).toFixed(1)}%\nФормула: ${new Intl.NumberFormat('ru-RU').format(salesData.sum)} × (1 - ${(discountPercent * 100).toFixed(1)}%) = ${new Intl.NumberFormat('ru-RU').format(adjustedSum)} ₽`;
                          return (
                            <span
                              title={formula}
                              style={{cursor: 'help'}}
                            >
                              {new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(adjustedSum)} ₽
                            </span>
                          );
                        }
                        return <span className="text-muted">—</span>;
                      })()}
                    </td>
                    <td>
                      <button
                        className={`btn btn-sm ${competitors.length > 0 ? 'btn-outline-secondary' : 'btn-outline-secondary'}`}
                        disabled={!hasFile}
                        title={!hasFile ? "Сначала выберите Вид Товара и загрузите Excel" : "Выбрать конкурентов"}
                        onClick={() => handleOpenCompetitorModal(item.Артикул, competitors)}
                      >
                        {competitors.length > 0 ? (
                          <>
                            Конкуренты: {competitors.length}
                          </>
                        ) : (
                          <>
                            <i className="bi bi-plus"></i> Выбрать
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                  
{/* Строка с вложенной таблицей конкурентов */}
{competitors.length > 0 && (
  <tr>
    <td colSpan={8} className="p-0 border-0">
      <div className="competitors-table-container slide-down mb-4">
        <div className="d-flex">
          <div className="flex-grow-1">
          <table className="competitors-table">
            <thead>
              <tr>
                <th style={{width: '30px'}}></th>
                <th style={{width: '80px'}}>Действия</th>
                <th style={{width: '25%'}}>Название товара</th>
                <th style={{width: '10%'}}></th>
                <th style={{width: '15%'}}>Цена по Ozon Card</th>
                <th style={{width: '10%'}}>Заказано, шт</th>
                <th style={{width: '12%'}}>Сумма заказа</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const isExpanded = state.expandedProducts[item.Артикул];

                // Сортируем по сумме продаж
                const sortedCompetitors = [...competitors].sort((a: CompetitorRow, b: CompetitorRow) => {
                  const sumA = typeof a.sum === 'number' ? a.sum : parseFloat(String(a.sum || '0').replace(/[^\d.-]/g, '')) || 0;
                  const sumB = typeof b.sum === 'number' ? b.sum : parseFloat(String(b.sum || '0').replace(/[^\d.-]/g, '')) || 0;
                  return sumB - sumA;
                });

                // Показываем первые 3 или все, если развернуто
                const competitorsToShow = isExpanded ? sortedCompetitors : sortedCompetitors.slice(0, 3);

                return (
                  <>
                    {competitorsToShow.map((c: CompetitorRow, competitorIndex: number) => {
                      // Находим индекс в оригинальном массиве для действий
                      const originalIndex = competitors.findIndex((comp: CompetitorRow) => comp === c);

                      // Закомментировано - рекомендованные цены не используются
                      // const ourProductPrice = state.ozonPrices[item.Артикул];
                      // const ourDiscountPercent = ourProductPrice?.discount_percent;
                      // const recommendedPrice = calculateRecommendedPrice(
                      //   c.ozonCardPrice || 0,
                      //   ourDiscountPercent
                      // );

                      // Проверяем, нужно ли показывать предупреждение
                      const ourParsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);
                      const ourParsedPrice = ourParsedData?.price;
                      const ourOzonItem = state.ozonData[item.Артикул];
                      const ourSku = ourOzonItem?.sku ? String(ourOzonItem.sku) : null;
                      const ourSalesData = ourSku ? state.salesData[ourSku] : null;
                      const ourDiscountPercent = state.ozonPrices[item.Артикул]?.discount_percent || 0;
                      const ourAdjustedSum = ourSalesData?.sum ? ourSalesData.sum * (1 - ourDiscountPercent) : 0;

                      // Извлекаем числовые значения цен
                      // Цена по Ozon Card = спарсенная цена - 10%
                      const ourParsedPriceNum = ourParsedPrice
                        ? parseFloat(String(ourParsedPrice).replace(/[^\d.,]/g, '').replace(',', '.')) || 0
                        : 0;
                      const ourPriceNum = ourParsedPriceNum * 0.9;
                      const competitorParsedPrice = c.ozonCardPrice
                        ? parseFloat(String(c.ozonCardPrice).replace(/[^\d.,]/g, '').replace(',', '.')) || 0
                        : 0;
                      const competitorPriceNum = competitorParsedPrice * 0.9;

                      // Извлекаем числовые значения продаж конкурента
                      const competitorQty = typeof c.qty === 'number' ? c.qty : parseFloat(String(c.qty || '0').replace(/[^\d.-]/g, '')) || 0;
                      const competitorSum = typeof c.sum === 'number' ? c.sum : parseFloat(String(c.sum || '0').replace(/[^\d.-]/g, '')) || 0;

                      // Показываем предупреждение если:
                      // - цена конкурента ниже нашей
                      // - И (количество продаж конкурента больше ИЛИ сумма продаж больше)
                      const showWarning = ourPriceNum > 0 && competitorPriceNum > 0 &&
                        competitorPriceNum < ourPriceNum &&
                        ((ourSalesData?.qty && competitorQty > ourSalesData.qty) ||
                         (ourAdjustedSum > 0 && competitorSum > ourAdjustedSum));

                      return (
                        <tr key={`${item.Артикул}-competitor-${competitorIndex}`} className={showWarning ? 'table-danger' : ''}>
                          {/* 1. Предупреждение */}
                          <td className="text-center">
                            {showWarning && (
                              <i className="bi bi-exclamation-triangle-fill text-danger"
                                 title={`Конкурент дешевле (${competitorPriceNum} ₽ < ${ourPriceNum} ₽) и продаёт больше!`}
                                 style={{fontSize: '1rem'}}></i>
                            )}
                          </td>
                          {/* 2. Действия (вместо фото) */}
                          <td>
                            <div className="d-flex gap-1">
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  showCompetitorHistory(c, item.Номенклатура);
                                }}
                                title="Показать историю и графики"
                              >
                                <i className="bi bi-graph-up"></i>
                              </button>
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  handleRemoveCompetitor(item.Артикул, originalIndex);
                                }}
                                title="Удалить конкурента"
                              >
                                <i className="bi bi-x-lg"></i>
                              </button>
                            </div>
                          </td>
                          {/* 3. Название товара */}
                          <td>
                            <div title={String(c.name)} style={{fontSize: '0.9rem'}}>
                              {String(c.name).substring(0, 80)}{String(c.name).length > 80 ? '...' : ''}
                            </div>
                            <div className="small text-muted">
                              <a href={c.link} target="_blank" rel="noreferrer"
                                className="text-decoration-none text-muted">
                                <i className="bi bi-link-45deg"></i> Ozon
                              </a>
                              <span className="ms-2">{c.brand}</span>
                            </div>
                          </td>
                          {/* 4. Пустой столбец */}
                          <td></td>
                          {/* 5. Цена по Ozon Card (спарсенная - 10%) */}
                          <td>
                            {c.ozonCardPrice ? (
                              (() => {
                                const priceNum = parseFloat(String(c.ozonCardPrice).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                                const ozonCardPrice = priceNum * 0.9;
                                return (
                                  <span className="badge badge-success"
                                        title={`Спарсено: ${c.ozonCardPrice}, -10% = ${ozonCardPrice.toFixed(0)} ₽\nОбновлено: ${c.lastUpdated ? new Date(c.lastUpdated).toLocaleString() : 'нет данных'}`}>
                                    {new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(ozonCardPrice)} ₽
                                  </span>
                                );
                              })()
                            ) : (
                              <span className="text-muted small">Не спарсена</span>
                            )}
                          </td>
                          {/* Рек. цена по карте - закомментировано
                          <td>
                            <div className="d-flex flex-column">
                              <span
                                className="badge badge-info"
                                title={`Цена по карте: ${recommendedPrice.competitorPriceNum || 'нет'} - 10 = ${recommendedPrice.priceByCard}`}
                              >
                                {recommendedPrice.priceByCard}
                              </span>
                            </div>
                          </td>
                          */}
                          {/* Рек. цена заливочная - закомментировано
                          <td>
                            {(() => {
                              if (!c.ozonCardPrice) {
                                return (
                                  <div className="text-muted small" title="Нет цены конкурента">
                                    Нет данных
                                  </div>
                                );
                              }

                              if (!ourDiscountPercent) {
                                return (
                                  <div className="text-warning small" title="Нет данных о соинвесте нашего товара">
                                    Нет соинвеста
                                  </div>
                                );
                              }

                              return (
                                <div className="d-flex flex-column">
                                  <span
                                    className="badge badge-warning"
                                    title={recommendedPrice.note}
                                  >
                                    {recommendedPrice.priceByCoinvest}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          */}
                          {/* 6. Заказано, шт */}
                          <td className="text-center">
                            {c.qty && c.qty !== '' && c.qty !== 0 ? (
                              <span>{c.qty}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          {/* 7. Сумма заказа */}
                          <td className="text-end">
                            {c.sum && c.sum !== '' && c.sum !== 0 ? (
                              <span>{c.sum} ₽</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Кнопка показать все/скрыть */}
                    {sortedCompetitors.length > 3 && (
                      <tr>
                        <td colSpan={7} className="text-center border-top-0">
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              setState((prev: AppState) => ({
                                ...prev,
                                expandedProducts: {
                                  ...prev.expandedProducts,
                                  [item.Артикул]: !isExpanded
                                }
                              }));
                            }}
                          >
                            {isExpanded ? (
                              <>
                                <i className="bi bi-chevron-up"></i> Скрыть ({sortedCompetitors.length - 3})
                              </>
                            ) : (
                              <>
                                <i className="bi bi-chevron-down"></i> Показать все ({sortedCompetitors.length})
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
          </div>
          {/* Средневзвешенная цена - показываем только если все цены спарсены */}
          {(() => {
            const ourParsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);
            const ourParsedPrice = ourParsedData?.price;

            // Проверяем, спарсены ли цены у ВСЕХ конкурентов
            const allCompetitorsParsed = competitors.length > 0 &&
              competitors.every((c: CompetitorRow) => c.ozonCardPrice && c.ozonCardPrice !== '');

            // Показываем только если наша цена спарсена И все конкуренты спарсены
            if (!ourParsedPrice || !allCompetitorsParsed) {
              return (
                <div className="ms-3 p-3 bg-light rounded text-center" style={{minWidth: '150px', opacity: 0.5}}>
                  <div className="small text-muted mb-1">Средневзвешенная цена</div>
                  <div className="fs-6 text-muted">
                    <i className="bi bi-hourglass-split"></i>
                    <div className="small mt-1">Ожидание парсинга</div>
                  </div>
                </div>
              );
            }

            // Все цены спарсены - рассчитываем средневзвешенную (только по конкурентам)
            // Формула: сумма(заказы в шт * цена по ozon карте) / сумма(заказы в шт)
            // Цена по Ozon Card = спарсенная цена * 0.9 (минус 10%)
            let totalQty = 0;
            let weightedSum = 0;

            competitors.forEach((c: CompetitorRow) => {
              const cQty = typeof c.qty === 'number' ? c.qty : parseFloat(String(c.qty || '0').replace(/[^\d.-]/g, '')) || 0;
              const cParsedPrice = c.ozonCardPrice
                ? parseFloat(String(c.ozonCardPrice).replace(/[^\d.,]/g, '').replace(',', '.')) || 0
                : 0;
              // Цена по Ozon Card = спарсенная цена - 10%
              const cPrice = cParsedPrice * 0.9;
              if (cQty > 0 && cPrice > 0) {
                totalQty += cQty;
                weightedSum += cQty * cPrice;
              }
            });

            if (totalQty > 0) {
              const weightedPrice = weightedSum / totalQty;
              const recommendedPrice = weightedPrice * 0.98; // минус 2%
              return (
                <div className="ms-3 p-3 bg-light rounded text-center" style={{minWidth: '180px'}}>
                  <div className="small text-muted mb-1">Средневзвешенная</div>
                  <div className="text-muted" style={{fontSize: '0.9rem'}}>
                    {new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(weightedPrice)} ₽
                  </div>
                  <div className="small text-muted mt-2 mb-1">Рекомендованная</div>
                  <div className="fw-medium" style={{fontSize: '1.25rem'}}>
                    {new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(recommendedPrice)} ₽
                  </div>
                  <div className="small text-muted mt-1" style={{opacity: 0.7}}>
                    (−2%)
                  </div>
                </div>
              );
            }

            return (
              <div className="ms-3 p-3 bg-light rounded text-center" style={{minWidth: '150px'}}>
                <div className="small text-muted mb-1">Средневзвешенная цена</div>
                <div className="fs-4 text-muted">—</div>
              </div>
            );
          })()}
        </div>
      </div>
    </td>
  </tr>
)}
                  
                  {/* Если нет конкурентов - пустая строка с сообщением */}
                  {competitors.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-0 border-0">
                        <div className="competitors-empty">
                          <i className="bi bi-people"></i>
                          <div>Конкуренты не выбраны</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Секция скрытых товаров */}
        {hiddenProducts.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-muted mb-2 p-2 bg-light rounded">
              <i className="bi bi-eye-slash me-2"></i>
              Скрытые товары ({hiddenProducts.length}) —
              {(() => {
                const hasFile = state.selectedType && state.uploadedFiles[state.selectedType];
                const hasParsedAny = hasParsedPrices(state.parsedPrices);
                if (!hasFile) return 'файл не загружен';
                if (!hasParsedAny) return 'без продаж';
                return 'без спарсенной цены, конкурентов или продаж';
              })()}
            </summary>
            <table className="product-table table-hover align-middle mt-2" style={{opacity: 0.7}}>
              <thead className="table-light">
                <tr>
                  <th style={{width: '80px'}}>Фото</th>
                  <th style={{minWidth: '200px'}}>Номенклатура</th>
                  <th>Цена по Ozon Card</th>
                  <th style={{width: '100px'}}>Заказано, шт</th>
                  <th style={{width: '120px'}}>Сумма заказа</th>
                  <th>Конкуренты</th>
                  <th>Причина скрытия</th>
                </tr>
              </thead>
              <tbody>
                {hiddenProducts.map((item: VmpItem, idx: number) => {
                  const ozonItem = state.ozonData[item.Артикул];
                  const imageUrl = ozonItem?.primary_image || ozonItem?.images?.[0];
                  const sku = ozonItem?.sku ? String(ozonItem.sku) : null;
                  const salesData = sku ? state.salesData[sku] : null;
                  const competitors = state.competitorSelections[item.Артикул] || [];
                  const parsedData = getLatestParsedPrice(state.parsedPrices, item.Артикул);

                  // Определяем причины скрытия
                  const reasons: string[] = [];
                  const hasFileLoaded = state.selectedType && state.uploadedFiles[state.selectedType];
                  const hasParsedPricesAny = hasParsedPrices(state.parsedPrices);

                  if (!hasFileLoaded) {
                    reasons.push('Файл не загружен');
                  } else if (!hasParsedPricesAny) {
                    // До парсинга - скрываем только из-за отсутствия продаж
                    if (!salesData || (salesData.qty === 0 && salesData.sum === 0)) reasons.push('Нет продаж');
                  } else {
                    // После парсинга
                    if (!parsedData) {
                      reasons.push(ozonItem?.customer_price ? 'Цена из API (не спарсена)' : 'Нет цены');
                    }
                    if (!salesData || (salesData.qty === 0 && salesData.sum === 0)) reasons.push('Нет продаж');
                    if (competitors.length === 0) reasons.push('Нет конкурентов');
                  }

                  return (
                    <tr key={`hidden-${item.Артикул}-${idx}`} className="text-muted">
                      <td>
                        {imageUrl ? (
                          <img src={imageUrl} className="product-img shadow-sm" alt={item.Номенклатура} style={{width: '40px', height: '40px'}} />
                        ) : <span className="text-muted small">—</span>}
                      </td>
                      <td>
                        <small>{item.Номенклатура}</small>
                        <div className="small">
                          {ozonItem?.sku ? (
                            <a href={`https://www.ozon.ru/product/${ozonItem.sku}`} target="_blank" rel="noreferrer"
                              className="text-decoration-none text-muted">
                              <i className="bi bi-link"></i> Ссылка
                            </a>
                          ) : (
                            <span>Арт: {item.Артикул}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const parsedPrice = parsedData?.price;
                          const calculateOzonCardPrice = (priceStr: string): string => {
                            const priceNum = parseFloat(priceStr.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                            if (priceNum <= 0) return priceStr;
                            const ozonCardPrice = priceNum * 0.9;
                            return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(ozonCardPrice)} ₽`;
                          };
                          if (parsedPrice) {
                            return <small>{calculateOzonCardPrice(parsedPrice)}</small>;
                          } else if (ozonItem?.customer_price) {
                            return <small>{calculateOzonCardPrice(ozonItem.customer_price)}</small>;
                          }
                          return <small className="text-muted">—</small>;
                        })()}
                      </td>
                      <td>
                        {salesData?.qty ? (
                          <small>{new Intl.NumberFormat('ru-RU').format(salesData.qty)}</small>
                        ) : (
                          <small className="text-muted">—</small>
                        )}
                      </td>
                      <td>
                        {salesData?.sum ? (
                          <small>{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(salesData.sum * (1 - (state.ozonPrices[item.Артикул]?.discount_percent || 0)))} ₽</small>
                        ) : (
                          <small className="text-muted">—</small>
                        )}
                      </td>
                      <td>
                        {competitors.length > 0 ? (
                          <small>{competitors.length} шт</small>
                        ) : (
                          <small className="text-muted">—</small>
                        )}
                      </td>
                      <td>
                        <small className="text-muted">
                          {reasons.join(', ')}
                        </small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        )}
      </div>

      {/* Кнопка очистки всех конкурентов для категории */}
      {state.selectedType && Object.keys(state.competitorSelections).some(sku =>
        filteredData.some((item: VmpItem) => item.Артикул === sku && state.competitorSelections[sku]?.length > 0)
      ) && (
        <div className="mb-3">
          <button
            className="btn btn-outline-danger btn-sm"
            onClick={() => {
              if (!confirm('Очистить список конкурентов для всех товаров в категории "' + state.selectedType + '"?')) {
                return;
              }
              const categorySkus = filteredData.map((item: VmpItem) => item.Артикул);
              const updatedSelections = { ...state.competitorSelections };
              categorySkus.forEach((sku: string) => {
                delete updatedSelections[sku];
              });

              saveDataToServer({
                competitorSelections: updatedSelections,
                parsedPrices: state.parsedPrices,
                uploadedFiles: state.uploadedFiles,
                lastUpdated: new Date().toISOString()
              }, selectedFile).then(() => {
                setState((prev: AppState) => ({
                  ...prev,
                  competitorSelections: updatedSelections
                }));
                alert('Список конкурентов очищен для категории "' + state.selectedType + '"');
              });
            }}
          >
            <i className="bi bi-trash"></i> Очистить всех конкурентов
          </button>
        </div>
      )}

      {modalImage && (
        <div 
          className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center" 
          style={{ backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1050 }}
          onClick={() => setModalImage(null)}
        >
          <div className="position-relative">
            <img src={modalImage} style={{ maxHeight: '90vh', maxWidth: '90vw' }} alt="Large preview" />
            <button 
              className="btn btn-close btn-close-white position-absolute top-0 end-0 m-2"
              onClick={() => setModalImage(null)}
            ></button>
          </div>
        </div>
      )}

      {/* Модальное окно истории с графиками */}
      {/* Модальное окно истории с графиками */}
{activeHistoryModal.competitor && (
  <div className="modal show d-block" style={{backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050}}>
    <div className="modal-dialog modal-xl modal-dialog-scrollable">
      <div className="modal-content">
        <div className="modal-header">
          <h5 className="modal-title">
            📊 История данных конкурента
          </h5>
          <button 
            type="button" 
            className="btn-close" 
            onClick={() => setActiveHistoryModal({competitor: null, productName: ''})}
          ></button>
        </div>
        <div className="modal-body">
          <div className="row mb-4">
            <div className="col-md-12">
              <div className="p-3 bg-light rounded">
                <h6>Информация о конкуренте:</h6>
                <div className="row">
                  <div className="col-md-6">
                    <p className="mb-1"><strong>Название:</strong> {activeHistoryModal.competitor.name}</p>
                    <p className="mb-1"><strong>Товар:</strong> {activeHistoryModal.productName}</p>
                  </div>
                  <div className="col-md-6">
                    <p className="mb-1"><strong>Бренд:</strong> {activeHistoryModal.competitor.brand}</p>
                    <p className="mb-0"><strong>Ссылка:</strong> 
                      <a href={activeHistoryModal.competitor.link} target="_blank" rel="noopener noreferrer" className="ms-2">
                        <i className="bi bi-link"></i> Перейти
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row mb-4">
            <div className="col-md-12">
              <h6 className="mb-3">📈 Графики изменений</h6>
              <HistoryChart priceHistory={activeHistoryModal.competitor.priceHistory} />
            </div>
          </div>

          <div className="row">
            <div className="col-md-12">
              <div className="card">
                <div className="card-header">
                  <h6 className="mb-0">📋 Таблица истории</h6>
                </div>
                <div className="card-body">
                  {activeHistoryModal.competitor.priceHistory && activeHistoryModal.competitor.priceHistory.length > 0 ? (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover">
                        <thead>
                          <tr>
                            <th>Дата и время</th>
                            <th>Цена по Ozon Card</th>
                            <th>Заказано, шт</th>
                            <th>Сумма заказа</th>
                            <th>Источник</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeHistoryModal.competitor.priceHistory
                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                            .map((item, index) => (
                              <tr key={index}>
                                <td>{new Date(item.date).toLocaleString('ru-RU')}</td>
                                <td>
                                  <span className="badge badge-success">{item.price || 'Нет данных'}</span>
                                </td>
                      <td>
                        {item.qty !== undefined && item.qty !== '' && item.qty !== 0 ? (
                          <span>{item.qty}</span>
                        ) : (
                          <span
                            className="text-muted"
                            title={item.qty === undefined ? "Данные не добавлялись (менее 6 дней с предыдущего обновления)" : "Нет данных"}
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td>
                        {item.sum !== undefined && item.sum !== '' && item.sum !== 0 ? (
                          <span>{item.sum} ₽</span>
                        ) : (
                          <span
                            className="text-muted"
                            title={item.sum === undefined ? "Данные не добавлялись (менее 6 дней с предыдущего обновления)" : "Нет данных"}
                          >
                            —
                          </span>
                        )}
                      </td>
                                <td>
                                  {item.qty && item.qty !== '' && item.qty !== 0 ? (
                                    <span>{item.qty}</span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                                <td>
                                  {item.sum && item.sum !== '' && item.sum !== 0 ? (
                                    <span>{item.sum} ₽</span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                                <td>
                                  <span className="badge bg-info text-dark">{item.source}</span>
                                </td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                      <div className="text-muted small mt-2">
                        Всего записей: {activeHistoryModal.competitor.priceHistory.length}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-muted py-4">
                      <i className="bi bi-clock-history fs-1 mb-3 d-block"></i>
                      <p>История данных отсутствует</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={() => setActiveHistoryModal({competitor: null, productName: ''})}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  </div>
)}
      {/* Модальное окно выбора конкурентов */}
      {state.activeModalSku && currentExtraData && (
        <div className="modal show d-block" style={{backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1040}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header border-bottom">
                <h5 className="modal-title fw-semibold">
                  Выбор конкурентов для: <span className="fw-medium">{activeItem?.Номенклатура}</span>
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseModal}></button>
              </div>
              
              <div className="p-3 border-bottom bg-light-subtle">
                {/* Облако тегов для фильтрации */}
                {(() => {
                  const topBrands = getTopBrands();
                  const isOil = isOilCategory();
                  const viscosities = (isOil && selectedBrandFilter) ? getViscosityStatsForBrand(selectedBrandFilter) : [];
                  // Для масел: объёмы показываем только после выбора вязкости
                  // Для остальных: объёмы показываем после выбора бренда
                  const volumes = selectedBrandFilter
                    ? (isOil
                        ? (selectedViscosityFilter ? getVolumeStatsForBrand(selectedBrandFilter, selectedViscosityFilter) : [])
                        : getVolumeStatsForBrand(selectedBrandFilter))
                    : [];

                  return (
                    <div className="mb-3">
                      {/* Фильтр по бренду (топ-5) */}
                      <div className="mb-3">
                        <div className="d-flex align-items-center mb-2">
                          <i className="bi bi-award me-2 text-muted"></i>
                          <span className="text-muted">Топ-5 брендов по продажам:</span>
                          {(selectedBrandFilter || selectedVolumeFilter || selectedViscosityFilter) && (
                            <button
                              className="btn btn-sm btn-link text-muted ms-2 p-0"
                              onClick={() => {
                                setSelectedVolumeFilter(null);
                                setSelectedViscosityFilter(null);
                                setSelectedBrandFilter(null);
                              }}
                            >
                              Сбросить фильтры
                            </button>
                          )}
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          {topBrands.map((brand, index) => (
                            <button
                              key={brand.name}
                              className={`btn btn-sm ${selectedBrandFilter === brand.name ? 'btn-secondary' : 'btn-outline-secondary'}`}
                              onClick={() => {
                                setSelectedBrandFilter(selectedBrandFilter === brand.name ? null : brand.name);
                                setSelectedViscosityFilter(null);
                                setSelectedVolumeFilter(null);
                              }}
                              style={{
                                fontSize: '14px',
                                fontWeight: selectedBrandFilter === brand.name ? '500' : 'normal'
                              }}
                            >
                              <span className="badge bg-light text-dark me-1">#{index + 1}</span>
                              {brand.name}
                              <span className="badge bg-light text-muted ms-1">{brand.count} поз.</span>
                              <span className="badge bg-light text-muted ms-1">
                                {new Intl.NumberFormat('ru-RU', {
                                  notation: 'compact',
                                  compactDisplay: 'short'
                                }).format(brand.totalSum)} ₽
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Фильтр по вязкости (только для масел и если выбран бренд) */}
                      {isOil && selectedBrandFilter && viscosities.length > 0 && (
                        <div className="mb-3">
                          <div className="d-flex align-items-center mb-2">
                            <i className="bi bi-droplet me-2 text-muted"></i>
                            <span className="text-muted">
                              Вязкости для бренда "{selectedBrandFilter}":
                            </span>
                          </div>
                          <div className="d-flex flex-wrap gap-2">
                            {viscosities.map((visc) => (
                              <button
                                key={visc.name}
                                className={`btn btn-sm ${selectedViscosityFilter === visc.name ? 'btn-secondary' : 'btn-outline-secondary'}`}
                                onClick={() => {
                                  setSelectedViscosityFilter(selectedViscosityFilter === visc.name ? null : visc.name);
                                  setSelectedVolumeFilter(null);
                                }}
                                style={{
                                  fontSize: '14px',
                                  fontWeight: selectedViscosityFilter === visc.name ? '500' : 'normal'
                                }}
                              >
                                {visc.name}
                                <span className="badge bg-light text-muted ms-1">{visc.count} поз.</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Фильтр по объёму (для масел: после вязкости, для остальных: после бренда) */}
                      {selectedBrandFilter && volumes.length > 0 && (!isOil || selectedViscosityFilter) && (
                        <div className="mb-3">
                          <div className="d-flex align-items-center mb-2">
                            <i className="bi bi-box-seam me-2 text-muted"></i>
                            <span className="text-muted">
                              Объёмы{isOil && selectedViscosityFilter ? ` для ${selectedViscosityFilter}` : ''} бренда "{selectedBrandFilter}":
                            </span>
                          </div>
                          <div className="d-flex flex-wrap gap-2">
                            {volumes.map((vol) => (
                              <button
                                key={vol.name}
                                className={`btn btn-sm ${selectedVolumeFilter === vol.name ? 'btn-secondary' : 'btn-outline-secondary'}`}
                                onClick={() => {
                                  setSelectedVolumeFilter(selectedVolumeFilter === vol.name ? null : vol.name);
                                }}
                                style={{
                                  fontSize: '14px',
                                  fontWeight: selectedVolumeFilter === vol.name ? '500' : 'normal'
                                }}
                              >
                                {vol.name}
                                <span className="badge bg-light text-muted ms-1">{vol.count} поз.</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="row g-3">
                  <div className="col-md-8">
                    <div className="input-group">
                      <span className="input-group-text bg-white border-end-0">
                        <i className="bi bi-search text-muted"></i>
                      </span>
                      <input
  type="text"
  className="form-control border-start-0"
  placeholder="Поиск по названию, бренду или SKU..."
  onChange={(e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    // Получаем данные Excel
    const excelData = currentExtraData as any[][];
    if (!excelData || excelData.length < 2) return;
    
    // Получаем mapping колонок
    const mapping = detectColumns(excelData);
    
    // Проверяем, что mapping валиден
    if (mapping.name === -1 || mapping.link === -1 || mapping.brand === -1 || 
        mapping.qty === -1 || mapping.sum === -1) {
      console.error('❌ Не все колонки найдены для поиска:', mapping);
      return;
    }
    
    // Если поиск пустой - показываем все строки
    if (!searchTerm.trim()) {
      setState(prev => ({
        ...prev,
        searchTerm: '',
        filteredRows: null
      }));
      return;
    }
    
    // Собираем индексы строк, которые подходят под поиск
    const filteredRows: number[] = [];
    
    // Начинаем со строки после заголовков
    for (let i = 1; i < excelData.length; i++) {
      const row = excelData[i];
      let match = false;
      
      try {
        // Проверяем название
        if (mapping.name !== -1 && row[mapping.name]) {
          const name = String(row[mapping.name]).toLowerCase();
          if (name.includes(searchTerm)) {
            match = true;
          }
        }
        
        // Проверяем бренд
        if (!match && mapping.brand !== -1 && row[mapping.brand]) {
          const brand = String(row[mapping.brand]).toLowerCase();
          if (brand.includes(searchTerm)) {
            match = true;
          }
        }
        
        // Проверяем ссылку на товар
        if (!match && mapping.link !== -1 && row[mapping.link]) {
          const link = String(row[mapping.link]);
          // Ищем SKU в ссылке
          const sku = extractSkuFromUrl(link);
          if (sku && sku.toLowerCase().includes(searchTerm)) {
            match = true;
          }
          // Или сам текст ссылки
          if (!match && link.toLowerCase().includes(searchTerm)) {
            match = true;
          }
        }
        
        // Если найдено совпадение, добавляем индекс
        if (match) {
          filteredRows.push(i);
        }
      } catch (error) {
        console.error(`Ошибка при обработке строки ${i}:`, error);
      }
    }
    
    // Обновляем выбранные индексы - оставляем только те, которые есть в отфильтрованных
    const newSelectedIndices = new Set<number>();
    tempSelectedIndices.forEach(idx => {
      if (filteredRows.includes(idx)) {
        newSelectedIndices.add(idx);
      }
    });
    
    setState(prev => ({
      ...prev,
      searchTerm: searchTerm,
      filteredRows: searchTerm ? filteredRows : null
    }));
    
    setTempSelectedIndices(newSelectedIndices);
  }}
/>
                    </div>
                  </div>
                  <div className="col-md-4 d-flex justify-content-between align-items-center">
                    <span className="badge bg-light text-dark border">
                      {(currentExtraData as any[][]).length - 1} строк
                    </span>
                    <div className="text-muted small">
                      {tempSelectedIndices.size} выбрано
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="modal-body p-0">
                <div className="table-responsive" style={{maxHeight: '50vh'}}>
                  <table className="table table-hover table-borderless mb-0">
                    <thead className="sticky-top" style={{top: 0, backgroundColor: '#f8f9fa'}}>
                      <tr className="border-bottom">
                        <th style={{width: '50px'}} className="text-center ps-4">
                          <div className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={tempSelectedIndices.size > 0 && tempSelectedIndices.size === getVisibleRows().length}
                              onChange={(e) => {
                                const visibleRows = getVisibleRows();
                                if (e.target.checked) {
                                  const allIndices = new Set(visibleRows);
                                  setTempSelectedIndices(allIndices);
                                } else {
                                  setTempSelectedIndices(new Set());
                                }
                              }}
                            />
                          </div>
                        </th>
                        <th style={{width: '100px'}} className="fw-semibold">Объём</th>
                        <th style={{minWidth: '300px'}} className="fw-semibold">Название товара</th>
                        <th style={{width: '200px'}} className="fw-semibold">Ссылка на товар</th>
                        <th style={{width: '120px'}} className="fw-semibold">Бренд</th>
                        <th style={{width: '120px'}} className="fw-semibold text-end">Заказано, штуки</th>
                        <th style={{width: '150px'}} className="fw-semibold text-end pe-4">Заказано на сумму, ₽</th>
                      </tr>
                    </thead>
                    <tbody>
{getVisibleRows().map((rowIndex: number) => {
  const row = (currentExtraData as any[][])[rowIndex];
  const isSelected = tempSelectedIndices.has(rowIndex);

  const mapping = detectColumns(currentExtraData as any[][]);

  // Проверяем, что mapping содержит все необходимые индексы
  if (mapping.name === -1 || mapping.link === -1 || mapping.brand === -1 ||
      mapping.qty === -1 || mapping.sum === -1) {
    console.error('❌ Не все колонки найдены в mapping:', mapping);
    return null;
  }

  // Получаем значения только из нужных колонок
  const productName = row[mapping.name] !== undefined ?
    String(row[mapping.name]).trim() : 'Нет названия';

  const productLink = row[mapping.link] !== undefined ?
    String(row[mapping.link]).trim() : '#';

  const brand = row[mapping.brand] !== undefined ?
    String(row[mapping.brand]).trim() : '-';

  const volume = extractVolume(productName);

  let qty = '';
  if (row[mapping.qty] !== undefined && row[mapping.qty] !== null) {
    const qtyValue = row[mapping.qty];
    if (typeof qtyValue === 'number') {
      qty = new Intl.NumberFormat('ru-RU').format(qtyValue);
    } else {
      qty = String(qtyValue).trim();
    }
  }

  let sum = '';
  if (row[mapping.sum] !== undefined && row[mapping.sum] !== null) {
    const sumValue = row[mapping.sum];
    if (typeof sumValue === 'number') {
      sum = new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(sumValue) + ' ₽';
    } else {
      const sumStr = String(sumValue).trim();
      sum = sumStr ? (sumStr.includes('₽') ? sumStr : sumStr + ' ₽') : '';
    }
  }

  const skuFromUrl = extractSkuFromUrl(productLink);

  return (
    <tr
      key={rowIndex}
      onClick={() => toggleCompetitorSelection(rowIndex)}
      className={`${isSelected ? 'selected-row' : ''} border-bottom`}
    >
      <td className="text-center align-middle ps-4">
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            checked={isSelected}
            readOnly
            style={{width: '18px', height: '18px'}}
          />
        </div>
      </td>
      <td className="align-middle">
        <span className="badge bg-light text-dark border">
          {volume}
        </span>
      </td>
      <td className="align-middle">
        <div className="d-flex flex-column">
          <div title={productName} style={{wordBreak: 'break-word'}}>
            {productName}
          </div>
          {skuFromUrl && (
            <div className="small text-muted mt-1">
              <span className="badge bg-light text-dark border">SKU: {skuFromUrl}</span>
            </div>
          )}
        </div>
      </td>
      <td className="align-middle">
        <a
          href={productLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-decoration-none d-flex align-items-center text-muted"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-truncate d-inline-block" style={{maxWidth: '180px'}} title={productLink}>
            {productLink.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || 'Ссылка'}
          </span>
          <i className="bi bi-box-arrow-up-right ms-2 small"></i>
        </a>
      </td>
      <td className="align-middle">
        <span className="badge bg-light text-dark border">{brand}</span>
      </td>
      <td className="align-middle text-end">
        {qty ? (
          <span>{qty}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="align-middle text-end pe-4">
        {sum ? (
          <span>{sum}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
})}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer border-top">
                <div className="d-flex justify-content-between align-items-center w-100">
                  <div className="text-muted small">
                    Показано: {getVisibleRows().length} из {(currentExtraData as any[][]).length - 1} строк
                  </div>
                  <div>
                    <button type="button" className="btn btn-outline-secondary me-2" onClick={handleCloseModal}>
                      Отмена
                    </button>
                    <button type="button" className="btn btn-primary" onClick={handleSaveCompetitors}>
                      Сохранить выбранное ({tempSelectedIndices.size})
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);