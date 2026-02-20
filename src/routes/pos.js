const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getPromotionalData, getSafeProductName, deleteOldProductImages, IMAGES_DIR } = require('../services/pos');

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
};

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure directory exists
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    cb(null, IMAGES_DIR);
  },
  filename: function (req, file, cb) {
    const safeName = req.body.safe_product_name || 'unknown';
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, safeName + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Недопустимый тип файла. Разрешены только JPEG, PNG, GIF и WebP'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  }
});

// Main page route
router.get('/', requireAuth, async (req, res) => {
  try {
    res.render('pos/index', {
      title: 'Остатки промо материалов'
    });
  } catch (error) {
    console.error('Render error:', error);
    res.status(500).send('Ошибка рендеринга страницы');
  }
});

// API endpoint to get data
router.post('/api/data', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: true, message: 'Unauthorized' });
  }

  try {
    const data = await getPromotionalData();
    res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Error fetching promotional data:', error);
    res.status(500).json({
      success: false,
      error: true,
      message: error.message
    });
  }
});

// Image upload endpoint
router.post('/api/upload', requireAuth, (req, res) => {
  // Use multer middleware
  upload.single('image')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.json({ success: false, message: 'Файл слишком большой. Максимальный размер: 5MB' });
      }
      return res.json({ success: false, message: 'Ошибка загрузки: ' + err.message });
    } else if (err) {
      return res.json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.json({ success: false, message: 'Файл не был отправлен' });
    }

    const safeName = req.body.safe_product_name;
    const productName = req.body.product_name;

    if (!safeName) {
      return res.json({ success: false, message: 'Не указано имя товара' });
    }

    // Delete old images with different extensions
    const ext = path.extname(req.file.filename);
    const formats = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    formats.forEach(format => {
      if (format !== ext) {
        const oldPath = path.join(IMAGES_DIR, safeName + format);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    });

    res.json({
      success: true,
      message: 'Файл успешно загружен',
      filename: req.file.filename,
      path: '/images/products/' + req.file.filename,
      product_name: productName
    });
  });
});

module.exports = router;
