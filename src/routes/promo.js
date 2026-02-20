const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const promoService = require('../services/promo');

router.get('/', requireAuth, (req, res) => {
    console.log('GET /promo - user:', req.session.user ? req.session.user.email : 'none');
    try {
        res.render('promo/index', {
            title: 'Анализ затрат на продвижение'
        });
    } catch (error) {
        console.error('Render error:', error);
        res.status(500).send('Ошибка рендеринга страницы');
    }
});

router.post('/api/data', async (req, res) => {
    // Check auth manually for API to return JSON instead of redirect
    if (!req.session.user) {
        return res.status(401).json({ error: true, message: 'Unauthorized' });
    }
    try {
        const result = await promoService.getPromoData();

        if (result.success) {
            res.json({
                data: result.data,
                _cached: result.cached,
                _cacheTimestamp: result.cacheTimestamp
            });
        } else {
            res.status(result.httpCode || 500).json({
                error: true,
                message: result.error
            });
        }
    } catch (error) {
        res.status(500).json({
            error: true,
            message: error.message
        });
    }
});

router.post('/api/export', (req, res) => {
    // Check auth manually for API to return JSON instead of redirect
    if (!req.session.user) {
        return res.status(401).json({ error: true, message: 'Unauthorized' });
    }
    const data = req.body;

    if (!Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    const filename = `marketing_data_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // BOM для правильного отображения кириллицы в Excel
    res.write('\uFEFF');

    const headers = [
        'Год',
        'Месяц',
        'СтатьяЗатрат',
        'Подраздел',
        'УточняющиеДанные',
        'ТоварнаяГруппа',
        'Затраты',
        'Ответственный',
        'Комментарий'
    ];

    res.write(headers.join(';') + '\n');

    data.forEach(row => {
        const values = [
            row['Год'] || '',
            row['Месяц'] || '',
            row['СтатьяЗатрат'] || '',
            row['Подраздел'] || '',
            row['УточняющиеДанные'] || '',
            row['ТоварнаяГруппа'] || '',
            row['Затраты'] || '',
            row['Ответственный'] || '',
            row['Комментарий'] || ''
        ];
        res.write(values.join(';') + '\n');
    });

    res.end();
});

module.exports = router;
