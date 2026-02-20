const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /admin/settings/ozon
router.get('/ozon', requireAdmin, (req, res) => {
  const accounts = db.prepare('SELECT * FROM ozon_accounts ORDER BY name').all();
  const deepseekSettings = db.prepare('SELECT * FROM api_settings WHERE service = ?').get('deepseek');

  res.render('admin/ozon-settings', {
    title: 'Настройки интеграций',
    accounts: accounts || [],
    deepseekApiKey: deepseekSettings?.api_key || '',
    success: req.query.success,
    error: req.query.error,
  });
});

// POST /admin/settings/ozon/account - Add new account
router.post(
  '/ozon/account',
  requireAdmin,
  [
    body('name').trim().notEmpty().withMessage('Название обязательно'),
    body('client_id').trim().notEmpty().withMessage('Client ID обязателен'),
    body('api_key').trim().notEmpty().withMessage('API Key обязателен'),
  ],
  (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.redirect('/admin/settings/ozon?error=' + encodeURIComponent(errors.array()[0].msg));
    }

    const { name, client_id, api_key } = req.body;

    try {
      db.prepare(`
        INSERT INTO ozon_accounts (name, client_id, api_key, is_active)
        VALUES (?, ?, ?, 1)
      `).run(name, client_id, api_key);

      res.redirect('/admin/settings/ozon?success=' + encodeURIComponent('Аккаунт добавлен'));
    } catch (error) {
      console.error('Add OZON account error:', error);
      res.redirect('/admin/settings/ozon?error=' + encodeURIComponent('Ошибка добавления аккаунта'));
    }
  }
);

// POST /admin/settings/ozon/account/:id/toggle - Toggle account active state
router.post('/ozon/account/:id/toggle', requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const account = db.prepare('SELECT is_active FROM ozon_accounts WHERE id = ?').get(id);
    if (account) {
      db.prepare('UPDATE ozon_accounts SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(account.is_active ? 0 : 1, id);
    }
    res.redirect('/admin/settings/ozon?success=' + encodeURIComponent('Статус изменён'));
  } catch (error) {
    console.error('Toggle OZON account error:', error);
    res.redirect('/admin/settings/ozon?error=' + encodeURIComponent('Ошибка изменения статуса'));
  }
});

// POST /admin/settings/ozon/account/:id/delete - Delete account
router.post('/ozon/account/:id/delete', requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    db.prepare('DELETE FROM ozon_accounts WHERE id = ?').run(id);
    res.redirect('/admin/settings/ozon?success=' + encodeURIComponent('Аккаунт удалён'));
  } catch (error) {
    console.error('Delete OZON account error:', error);
    res.redirect('/admin/settings/ozon?error=' + encodeURIComponent('Ошибка удаления аккаунта'));
  }
});

// POST /admin/settings/ozon/deepseek - Save DeepSeek API key
router.post('/ozon/deepseek', requireAdmin, (req, res) => {
  const { api_key } = req.body;

  try {
    const existing = db.prepare('SELECT id FROM api_settings WHERE service = ?').get('deepseek');
    if (existing) {
      db.prepare('UPDATE api_settings SET api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE service = ?')
        .run(api_key || '', 'deepseek');
    } else {
      db.prepare('INSERT INTO api_settings (service, api_key) VALUES (?, ?)')
        .run('deepseek', api_key || '');
    }
    res.redirect('/admin/settings/ozon?success=' + encodeURIComponent('DeepSeek API ключ сохранён'));
  } catch (error) {
    console.error('Save DeepSeek API key error:', error);
    res.redirect('/admin/settings/ozon?error=' + encodeURIComponent('Ошибка сохранения ключа'));
  }
});

module.exports = router;
