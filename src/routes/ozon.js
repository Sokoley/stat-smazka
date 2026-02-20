const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { getCredentials, getOzonAccounts, fetchBalanceByDays, fetchBalanceByDaysForAccount, formatCurrency, generateForecastReport, getSupplyOrders } = require('../services/ozon');

const router = express.Router();

function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
  };
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function formatDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ADVERTISING_SERVICES = [
  'review_pinning',
  'seller_bonuses_mailing',
  'seller_bonuses',
  'other_electronic_services',
  'premium_membership',
  'points_for_reviews',
  'brand_promotion',
  'premium_plus_subscription',
  'ozon_installment',
  'internet_advertising_on_site',
  'promotion_with_cost_per_order',
  'pay_per_click',
  'premium_pro_subscription',
];

const LOGISTICS_SERVICES = [
  'drop_off_processing',
  'logistics',
  'reverse_logistics',
];

const FBO_SERVICES = [
  'star_products',
  'temporary_placement_agent',
  'packing_by_agents',
  'partner_returns_cancellations_processing',
  'courier_client_reinvoice',
  'acquiring',
  'processing_of_identified_surpluses',
  'processing_of_unidentified_surpluses',
  'defect_processing',
  'booking_space_and_staff_for_incomplete_delivery',
  'goods_processing_in_shipment',
  'goods_shelf_life_processing',
  'booking_space_and_staff_for_partial_shipment',
  'processing_of_identified_surpluses_in_shipment',
  'product_placement_in_ozon_warehouses',
  'cross_docking',
];

function calculateExpenses(data) {
  // Commission
  const salesFee = data?.cashflows?.sales?.fee?.value || 0;
  const returnsFee = data?.cashflows?.returns?.fee?.value || 0;
  const commission = salesFee + returnsFee;

  // Services breakdown
  const services = data?.cashflows?.services || [];
  let advertising = 0;
  let logistics = 0;
  let fbo = 0;

  services.forEach(s => {
    const value = s.amount?.value || 0;
    if (ADVERTISING_SERVICES.includes(s.name)) {
      advertising += value;
    } else if (LOGISTICS_SERVICES.includes(s.name)) {
      logistics += value;
    } else if (FBO_SERVICES.includes(s.name)) {
      fbo += value;
    }
  });

  return {
    commission: Math.abs(commission),
    advertising: Math.abs(advertising),
    logistics: Math.abs(logistics),
    fbo: Math.abs(fbo),
    total: Math.abs(commission) + Math.abs(advertising) + Math.abs(logistics) + Math.abs(fbo),
  };
}

// GET /ozon/coinvest
router.get('/coinvest', requireAuth, async (req, res) => {
  // Get all active OZON accounts
  const accounts = getOzonAccounts();

  if (accounts.length === 0) {
    return res.render('ozon/coinvest', {
      title: 'Соинвест',
      error: 'Нет активных аккаунтов OZON. Добавьте аккаунты в настройках интеграции.',
      chartData: null,
      dateFrom: null,
      dateTo: null,
      viewMode: 'days',
      accounts: [],
      selectedAccountId: null,
    });
  }

  // Get selected account (default to first)
  const selectedAccountId = req.query.account ? parseInt(req.query.account) : accounts[0].id;
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || accounts[0];

  // Default date ranges by view mode
  const now = new Date();
  const viewMode = req.query.view || 'days';

  let defaultFrom, defaultTo;
  if (viewMode === 'months') {
    // Last 3 calendar months
    defaultFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    defaultTo = now;
  } else if (viewMode === 'weeks') {
    // Last 5 calendar weeks including current week
    const currentMonday = getMondayOfWeek(now);
    defaultFrom = new Date(currentMonday);
    defaultFrom.setDate(defaultFrom.getDate() - 28); // Go back 4 weeks to get 5 total weeks
    defaultTo = now;
  } else {
    // Last 7 days
    defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 6);
    defaultTo = now;
  }

  const dateFrom = req.query.date_from || formatDateLocal(defaultFrom);
  const dateTo = req.query.date_to || formatDateLocal(defaultTo);

  try {
    const dailyData = await fetchBalanceByDaysForAccount(selectedAccount.id, dateFrom, dateTo);

    let chartData;

    if (viewMode === 'months') {
      // Aggregate by calendar months
      const monthlyData = {};

      dailyData.forEach(d => {
        // Parse date string directly to avoid timezone issues
        const [year, month] = d.date.split('-');
        const monthKey = `${year}-${month}`;

        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { sales: 0, expenses: 0, coinvest: 0, expensesDetail: { commission: 0, advertising: 0, logistics: 0, fbo: 0 } };
        }

        monthlyData[monthKey].sales += d.data?.cashflows?.sales?.amount?.value || 0;

        const exp = calculateExpenses(d.data);
        monthlyData[monthKey].expenses += exp.total;
        monthlyData[monthKey].expensesDetail.commission += exp.commission;
        monthlyData[monthKey].expensesDetail.advertising += exp.advertising;
        monthlyData[monthKey].expensesDetail.logistics += exp.logistics;
        monthlyData[monthKey].expensesDetail.fbo += exp.fbo;

        const salesPoints = d.data?.cashflows?.sales?.amount_details?.points_for_discounts;
        const returnsPoints = d.data?.cashflows?.returns?.amount_details?.points_for_discounts;
        monthlyData[monthKey].coinvest += (salesPoints ? parseFloat(salesPoints) || 0 : 0) +
                                          (returnsPoints ? parseFloat(returnsPoints) || 0 : 0);
      });

      // Sort months chronologically
      const monthKeys = Object.keys(monthlyData).sort();

      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                          'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

      const labels = monthKeys.map(key => {
        const [year, month] = key.split('-');
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      });
      const salesData = monthKeys.map(k => monthlyData[k].sales);
      const expensesData = monthKeys.map(k => monthlyData[k].expenses);
      const coinvestData = monthKeys.map(k => monthlyData[k].coinvest);

      chartData = {
        labels,
        sales: salesData,
        expenses: expensesData,
        coinvest: coinvestData,
        percent: salesData.map((sale, i) => sale > 0 ? ((coinvestData[i] / sale) * 100).toFixed(1) : '0'),
        expensesDetail: monthKeys.map(k => monthlyData[k].expensesDetail),
      };
    } else if (viewMode === 'weeks') {
      // Aggregate by ISO calendar weeks
      const weeklyData = {};
      const weekDates = {};

      dailyData.forEach(d => {
        const date = new Date(d.date);
        const isoWeek = getISOWeekNumber(date);
        const weekKey = `${isoWeek.year}-W${isoWeek.week}`;

        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { sales: 0, expenses: 0, coinvest: 0, expensesDetail: { commission: 0, advertising: 0, logistics: 0, fbo: 0 } };
          weekDates[weekKey] = { start: new Date(date), end: new Date(date) };
        } else {
          if (date < weekDates[weekKey].start) weekDates[weekKey].start = new Date(date);
          if (date > weekDates[weekKey].end) weekDates[weekKey].end = new Date(date);
        }

        weeklyData[weekKey].sales += d.data?.cashflows?.sales?.amount?.value || 0;

        const exp = calculateExpenses(d.data);
        weeklyData[weekKey].expenses += exp.total;
        weeklyData[weekKey].expensesDetail.commission += exp.commission;
        weeklyData[weekKey].expensesDetail.advertising += exp.advertising;
        weeklyData[weekKey].expensesDetail.logistics += exp.logistics;
        weeklyData[weekKey].expensesDetail.fbo += exp.fbo;

        const salesPoints = d.data?.cashflows?.sales?.amount_details?.points_for_discounts;
        const returnsPoints = d.data?.cashflows?.returns?.amount_details?.points_for_discounts;
        weeklyData[weekKey].coinvest += (salesPoints ? parseFloat(salesPoints) || 0 : 0) +
                                        (returnsPoints ? parseFloat(returnsPoints) || 0 : 0);
      });

      // Sort weeks chronologically
      const weekKeys = Object.keys(weeklyData).sort((a, b) => {
        const [yearA, weekA] = a.split('-W').map(Number);
        const [yearB, weekB] = b.split('-W').map(Number);
        return yearA !== yearB ? yearA - yearB : weekA - weekB;
      });

      const labels = weekKeys.map(key => {
        const start = weekDates[key].start;
        const end = weekDates[key].end;
        const startStr = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        const endStr = end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        return `${startStr} – ${endStr}`;
      });
      const salesData = weekKeys.map(k => weeklyData[k].sales);
      const expensesData = weekKeys.map(k => weeklyData[k].expenses);
      const coinvestData = weekKeys.map(k => weeklyData[k].coinvest);

      chartData = {
        labels,
        sales: salesData,
        expenses: expensesData,
        coinvest: coinvestData,
        percent: salesData.map((sale, i) => sale > 0 ? ((coinvestData[i] / sale) * 100).toFixed(1) : '0'),
        expensesDetail: weekKeys.map(k => weeklyData[k].expensesDetail),
      };
    } else {
      // Daily view
      const salesData = dailyData.map(d => d.data?.cashflows?.sales?.amount?.value || 0);
      const expensesData = dailyData.map(d => calculateExpenses(d.data).total);
      const expensesDetailData = dailyData.map(d => calculateExpenses(d.data));
      const coinvestData = dailyData.map(d => {
        const salesPoints = d.data?.cashflows?.sales?.amount_details?.points_for_discounts;
        const returnsPoints = d.data?.cashflows?.returns?.amount_details?.points_for_discounts;
        const salesValue = salesPoints ? parseFloat(salesPoints) || 0 : 0;
        const returnsValue = returnsPoints ? parseFloat(returnsPoints) || 0 : 0;
        return salesValue + returnsValue;
      });

      chartData = {
        labels: dailyData.map(d => {
          const date = new Date(d.date);
          return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }),
        sales: salesData,
        expenses: expensesData,
        coinvest: coinvestData,
        percent: salesData.map((sale, i) => sale > 0 ? ((coinvestData[i] / sale) * 100).toFixed(1) : '0'),
        expensesDetail: expensesDetailData,
      };
    }

    // Calculate totals
    const totalExpenses = chartData.expensesDetail.reduce((acc, e) => ({
      commission: acc.commission + e.commission,
      advertising: acc.advertising + e.advertising,
      logistics: acc.logistics + e.logistics,
      fbo: acc.fbo + e.fbo,
    }), { commission: 0, advertising: 0, logistics: 0, fbo: 0 });

    const totals = {
      sales: chartData.sales.reduce((a, b) => a + b, 0),
      expenses: chartData.expenses.reduce((a, b) => a + b, 0),
      coinvest: chartData.coinvest.reduce((a, b) => a + b, 0),
      expensesDetail: totalExpenses,
    };

    res.render('ozon/coinvest', {
      title: 'Соинвест',
      error: null,
      chartData,
      totals,
      dateFrom,
      dateTo,
      viewMode,
      formatCurrency,
      accounts,
      selectedAccountId: selectedAccount.id,
    });
  } catch (error) {
    console.error('OZON API error:', error);
    res.render('ozon/coinvest', {
      title: 'Соинвест',
      error: error.message,
      chartData: null,
      totals: null,
      dateFrom,
      dateTo,
      viewMode,
      accounts,
      selectedAccountId: selectedAccount.id,
    });
  }
});

// GET /ozon/forecast
router.get('/forecast', requireAuth, async (req, res) => {
  const accounts = getOzonAccounts();

  if (accounts.length === 0) {
    return res.render('ozon/forecast', {
      title: 'Прогнозная потребность',
      error: 'Нет активных аккаунтов OZON. Добавьте аккаунты в настройках интеграции.',
      accounts: [],
    });
  }

  res.render('ozon/forecast', {
    title: 'Прогнозная потребность',
    error: null,
    accounts: accounts.map(a => a.name),
  });
});

// POST /ozon/forecast/generate - API endpoint for generating report
router.post('/forecast/generate', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.body.days) || 28;
    const data = await generateForecastReport(days);
    res.json({ status: 'success', data });
  } catch (error) {
    console.error('Forecast generation error:', error);
    res.json({ status: 'error', message: error.message });
  }
});

// GET /ozon/postavki - Supply orders page
router.get('/postavki', requireAuth, (req, res) => {
  res.render('ozon/postavki', {
    title: 'Поставки',
  });
});

// GET /ozon/postavki/api - API endpoint for fetching supply orders
router.get('/postavki/api', requireAuth, async (req, res) => {
  try {
    const data = await getSupplyOrders();
    res.json(data);
  } catch (error) {
    console.error('Supply orders error:', error);
    res.json({ error: error.message });
  }
});

// ==============
// OZON REVIEWS
// ==============

// Путь к JSON-файлу с отзывами (используем существующий reviews/reviews_data.json)
const REVIEWS_DATA_PATH = path.join(__dirname, '..', '..', 'reviews', 'reviews_data.json');

// GET /ozon/reviews - страница отзывов
router.get('/reviews', requireAuth, (req, res) => {
  res.render('ozon/reviews', {
    title: 'Отзывы OZON',
  });
});

// GET /ozon/reviews/update_reviews.php - вернуть сохранённые отзывы (аналог PHP GET)
router.get('/reviews/update_reviews.php', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(REVIEWS_DATA_PATH)) {
      return res.json({
        success: false,
        message: 'Файл reviews_data.json не найден',
      });
    }

    const fileContent = fs.readFileSync(REVIEWS_DATA_PATH, 'utf8');
    const data = JSON.parse(fileContent);

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Ошибка чтения файла отзывов:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка чтения файла отзывов: ' + error.message,
    });
  }
});

// POST /ozon/reviews/update_reviews.php - обновить отзывы через OZON API и сохранить в файл
router.post('/reviews/update_reviews.php', requireAuth, async (req, res) => {
  try {
    const credentials = getCredentials();
    if (!credentials) {
      return res.status(500).json({
        success: false,
        message: 'OZON API не настроен или неактивен',
      });
    }

    const apiUrl = 'https://api-seller.ozon.ru/v1/review/list';
    const allReviews = [];
    let lastId = '';
    let hasNext = true;
    let iteration = 0;
    const maxIterations = 10000;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 60);

    while (hasNext && iteration < maxIterations) {
      iteration += 1;

      const requestBody = {
        last_id: lastId,
        limit: 100,
        sort_dir: 'DESC',
      };

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Client-Id': credentials.clientId,
            'Api-Key': credentials.apiKey,
            'User-Agent': 'OZON-Reviews-Client/1.0',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP error ${response.status}. Response: ${text.substring(0, 500)}`);
        }

        const data = await response.json();

        if (!data.reviews || data.reviews.length === 0) {
          break;
        }

        const batchReviews = [];
        for (const review of data.reviews) {
          if (!review.published_at) continue;
          try {
            const reviewDate = new Date(review.published_at);
            if (reviewDate >= thirtyDaysAgo) {
              batchReviews.push(review);
            } else {
              hasNext = false;
              break;
            }
          } catch (e) {
            console.warn('Date parsing error for review:', e.message);
            continue;
          }
        }

        allReviews.push(...batchReviews);

        hasNext = data.has_next ?? false;
        lastId = data.last_id ?? '';

        if (!hasNext || batchReviews.length < 50) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`Error in reviews batch ${iteration}:`, err.message);
        break;
      }
    }

    // фильтр только отзывов с текстом
    const filteredReviews = allReviews.filter(r => r.text && String(r.text).trim().length > 0);

    const resultData = {
      reviews: filteredReviews,
      lastUpdated: new Date().toISOString(),
      totalCount: filteredReviews.length,
      success: true,
    };

    // гарантируем существование директории
    const dir = path.dirname(REVIEWS_DATA_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(REVIEWS_DATA_PATH, JSON.stringify(resultData, null, 2), 'utf8');

    return res.json({
      success: true,
      message: 'Отзывы успешно обновлены',
      data: resultData,
    });
  } catch (error) {
    console.error('Fatal error while updating reviews:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка: ' + error.message,
    });
  }
});

// OPTIONS и POST /ozon/reviews/api-proxy.php - прокси к DeepSeek API
router.options('/reviews/api-proxy.php', requireAuth, (req, res) => {
  res.sendStatus(200);
});

router.post('/reviews/api-proxy.php', requireAuth, async (req, res) => {
  try {
    // Get DeepSeek API key from database
    const db = require('../db/database');
    const deepseekSettings = db.prepare('SELECT api_key FROM api_settings WHERE service = ?').get('deepseek');
    const apiKey = deepseekSettings?.api_key || process.env.DEEPSEEK_API_KEY || 'sk-d7bf4a415dfb4cc4a04a68a5a7a6d78b';

    if (!apiKey) {
      return res.status(500).json({
        error: 'DeepSeek API ключ не настроен. Добавьте его в настройках интеграций.',
      });
    }

    const payload = req.body;
    if (!payload) {
      return res.status(400).json({ error: 'Invalid JSON data' });
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'DeepSeek API error: ' + response.status,
        response: text,
      });
    }

    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch (e) {
      // если DeepSeek вернул невалидный JSON — пробрасываем как текст
      return res.json({ raw: text });
    }
  } catch (error) {
    console.error('DeepSeek proxy error:', error);
    return res.status(500).json({
      error: 'CURL Error: ' + error.message,
    });
  }
});

module.exports = router;
