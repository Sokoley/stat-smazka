const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { redirectIfAuth } = require('../middleware/auth');

const router = express.Router();

// GET /auth/login
router.get('/login', redirectIfAuth, (req, res) => {
  res.render('auth/login', {
    title: 'Login',
    errors: [],
    email: '',
  });
});

// POST /auth/login
router.post(
  '/login',
  redirectIfAuth,
  [
    body('email').isEmail().withMessage('Введите корректный email'),
    body('password').notEmpty().withMessage('Введите пароль'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('auth/login', {
        title: 'Login',
        errors: errors.array(),
        email: req.body.email,
      });
    }

    const { email, password } = req.body;

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

      if (!user) {
        return res.render('auth/login', {
          title: 'Login',
          errors: [{ msg: 'Неверный email или пароль' }],
          email,
        });
      }

      if (!user.is_active) {
        return res.render('auth/login', {
          title: 'Login',
          errors: [{ msg: 'Аккаунт деактивирован' }],
          email,
        });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.render('auth/login', {
          title: 'Login',
          errors: [{ msg: 'Неверный email или пароль' }],
          email,
        });
      }

      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: !!user.is_admin,
      };

      res.redirect('/');
    } catch (error) {
      console.error('Login error:', error);
      res.render('auth/login', {
        title: 'Login',
        errors: [{ msg: 'Произошла ошибка' }],
        email,
      });
    }
  }
);

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/auth/login');
  });
});

module.exports = router;
