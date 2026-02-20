const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /admin/users - List all users
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, name, is_admin, is_active, created_at
    FROM users
    ORDER BY created_at DESC
  `).all();

  res.render('admin/users', {
    title: 'Пользователи',
    users,
    success: req.query.success,
    error: req.query.error,
  });
});

// GET /admin/users/new - New user form
router.get('/users/new', requireAdmin, (req, res) => {
  res.render('admin/user-form', {
    title: 'Новый пользователь',
    user: null,
    errors: [],
  });
});

// POST /admin/users - Create user
router.post(
  '/users',
  requireAdmin,
  [
    body('name').trim().notEmpty().withMessage('Имя обязательно'),
    body('email').isEmail().withMessage('Введите корректный email'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Пароль должен быть не менее 6 символов'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('admin/user-form', {
        title: 'Новый пользователь',
        user: req.body,
        errors: errors.array(),
      });
    }

    const { name, email, password, is_admin } = req.body;

    try {
      const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existingUser) {
        return res.render('admin/user-form', {
          title: 'Новый пользователь',
          user: req.body,
          errors: [{ msg: 'Email уже зарегистрирован' }],
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      db.prepare('INSERT INTO users (name, email, password, is_admin) VALUES (?, ?, ?, ?)')
        .run(name, email, hashedPassword, is_admin ? 1 : 0);

      res.redirect('/admin/users?success=Пользователь создан');
    } catch (error) {
      console.error('Create user error:', error);
      res.render('admin/user-form', {
        title: 'Новый пользователь',
        user: req.body,
        errors: [{ msg: 'Произошла ошибка' }],
      });
    }
  }
);

// GET /admin/users/:id/edit - Edit user form
router.get('/users/:id/edit', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) {
    return res.redirect('/admin/users?error=Пользователь не найден');
  }

  res.render('admin/user-form', {
    title: 'Редактирование',
    user,
    errors: [],
  });
});

// POST /admin/users/:id - Update user
router.post(
  '/users/:id',
  requireAdmin,
  [
    body('name').trim().notEmpty().withMessage('Имя обязательно'),
    body('email').isEmail().withMessage('Введите корректный email'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
      return res.redirect('/admin/users?error=Пользователь не найден');
    }

    if (!errors.isEmpty()) {
      return res.render('admin/user-form', {
        title: 'Редактирование',
        user: { ...user, ...req.body },
        errors: errors.array(),
      });
    }

    const { name, email, password, is_admin, is_active } = req.body;

    try {
      // Check email uniqueness
      const existingUser = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email, req.params.id);
      if (existingUser) {
        return res.render('admin/user-form', {
          title: 'Редактирование',
          user: { ...user, ...req.body },
          errors: [{ msg: 'Email уже используется' }],
        });
      }

      if (password && password.length >= 6) {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET name = ?, email = ?, password = ?, is_admin = ?, is_active = ? WHERE id = ?')
          .run(name, email, hashedPassword, is_admin ? 1 : 0, is_active ? 1 : 0, req.params.id);
      } else {
        db.prepare('UPDATE users SET name = ?, email = ?, is_admin = ?, is_active = ? WHERE id = ?')
          .run(name, email, is_admin ? 1 : 0, is_active ? 1 : 0, req.params.id);
      }

      res.redirect('/admin/users?success=Изменения сохранены');
    } catch (error) {
      console.error('Update user error:', error);
      res.render('admin/user-form', {
        title: 'Редактирование',
        user: { ...user, ...req.body },
        errors: [{ msg: 'Произошла ошибка' }],
      });
    }
  }
);

// POST /admin/users/:id/delete - Delete user
router.post('/users/:id/delete', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    return res.redirect('/admin/users?error=Пользователь не найден');
  }

  // Prevent deleting yourself
  if (user.id === req.session.user.id) {
    return res.redirect('/admin/users?error=Нельзя удалить свой аккаунт');
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.redirect('/admin/users?success=Пользователь удалён');
});

// GET /admin/docs - Documentation
router.get('/docs', requireAdmin, (req, res) => {
  const accounts = db.prepare('SELECT COUNT(*) as count FROM ozon_accounts WHERE is_active = 1').get();
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get();

  res.render('admin/docs', {
    title: 'Документация',
    stats: {
      activeAccounts: accounts?.count || 0,
      totalUsers: users?.count || 0,
    },
  });
});

module.exports = router;
