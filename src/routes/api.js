const express = require('express');
const { requireForecastApiKey } = require('../middleware/auth');
const { generateForecastReport } = require('../services/ozon');

const router = express.Router();

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
        report: data.report,
        categories: data.categories,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: data.totalDays,
        accountsUsed: data.accountsUsed,
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
        report: data.report,
        categories: data.categories,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: data.totalDays,
        accountsUsed: data.accountsUsed,
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
