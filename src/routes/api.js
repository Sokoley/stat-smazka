const express = require('express');
const { requireForecastApiKey } = require('../middleware/auth');
const { generateForecastReport } = require('../services/ozon');

const router = express.Router();

const FORECAST_REPORT_KEYS = [
  'offer_id',
  'product_name',
  'category',
  'total_quantity',
  'avg_daily_sales',
  'available_stock_count',
  'transit_stock_count',
  'free_stock',
  'turnover',
  'forecast_need',
  'forecastNeedProizvodstvo',
];

function formatReportForApi(report) {
  return report.map((row) => {
    const out = {};
    FORECAST_REPORT_KEYS.forEach((key) => {
      if (row[key] !== undefined) out[key] = row[key];
    });
    return out;
  });
}

/**
 * GET /api/forecast
 * Query: days (optional, default 28) — период в днях для расчёта.
 *
 * Возвращает отчёт "Прогнозная потребность" в JSON.
 * Авторизация: API-ключ в заголовке Authorization: Bearer <key>, X-API-Key: <key> или ?api_key=<key>.
 *
 * Пример: GET https://stat.smazka.ru/api/forecast?days=28
 *         Header: X-API-Key: your-secret-key
 */
router.get('/forecast', requireForecastApiKey, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 28));
    const data = await generateForecastReport(days);
    res.json({
      success: true,
      data: {
        report: formatReportForApi(data.report),
      },
    });
  } catch (error) {
    console.error('Forecast API error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Ошибка формирования отчёта',
    });
  }
});

/**
 * POST /api/forecast
 * Body: { "days": 28 } (optional). API key in header or body.api_key.
 */
router.post('/forecast', requireForecastApiKey, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.body.days, 10) || 28));
    const data = await generateForecastReport(days);
    res.json({
      success: true,
      data: {
        report: formatReportForApi(data.report),
      },
    });
  } catch (error) {
    console.error('Forecast API error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Ошибка формирования отчёта',
    });
  }
});

module.exports = router;
