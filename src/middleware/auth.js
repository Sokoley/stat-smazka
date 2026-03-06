const db = require('../db/database');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

/** Check API key for external forecast report API (Bearer, X-API-Key, or ?api_key=). */
function requireForecastApiKey(req, res, next) {
  const raw =
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null) ||
    req.headers['x-api-key'] ||
    req.query.api_key ||
    (req.body && req.body.api_key) ||
    '';
  const key = String(raw).trim();

  const envKey = process.env.FORECAST_API_KEY;
  const row = db.prepare("SELECT api_key FROM api_settings WHERE service = 'forecast_api'").get();
  const storedKey = (row && row.api_key) ? String(row.api_key).trim() : '';

  const expected = envKey || storedKey;
  if (!expected) {
    return res.status(503).json({
      success: false,
      error: 'Forecast API key not configured. Set FORECAST_API_KEY or configure in admin settings.',
    });
  }
  if (key !== expected) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (!req.session.user.isAdmin) {
    return res.status(403).send('Access denied');
  }
  next();
}

function redirectIfAuth(req, res, next) {
  if (req.session.user) {
    return res.redirect('/');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, redirectIfAuth, requireForecastApiKey };
