const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const userController = require('../controllers/userController');

router.get('/profile', protect, userController.getProfile);
router.put('/profile', protect, userController.updateProfile);
router.post('/favorites', protect, userController.addFavorite);
router.delete('/favorites/:station', protect, userController.removeFavorite);

module.exports = router;
