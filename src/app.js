const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase } = require('./db/init');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const settingsRoutes = require('./routes/settings');
const ozonRoutes = require('./routes/ozon');
const promoRoutes = require('./routes/promo');
const posRoutes = require('./routes/pos');
const pricecheckRoutes = require('./routes/pricecheck');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for secure cookies behind Apache/Nginx)
app.set('trust proxy', 1);

// Initialize database
initDatabase();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Session (must be before any route that renders layout with sidebar)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'marketplace-dashboard-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Make user available in all views (sidebar needs user)
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} - Session ID: ${req.sessionID ? req.sessionID.substring(0, 8) : 'none'}, User: ${req.session.user ? req.session.user.email : 'none'}`);
  res.locals.user = req.session.user || null;
  next();
});

// Pricecheck before static so /pricecheck uses layout+iframe (static would serve public/pricecheck/index.html)
app.use('/pricecheck', pricecheckRoutes);
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/settings', settingsRoutes);
app.use('/ozon', ozonRoutes);
app.use('/promo', promoRoutes);
app.use('/pos', posRoutes);
app.use('/', dashboardRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('layouts/main', {
    title: '404 - Not Found',
    body: '<div class="flex items-center justify-center h-full"><h1 class="text-2xl text-gray-600 dark:text-gray-400">Page not found</h1></div>',
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
