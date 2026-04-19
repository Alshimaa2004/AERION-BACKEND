const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const alertController = require('../controllers/alertController');

router.route('/')
  .get(protect, alertController.getAlerts)
  .post(protect, alertController.createAlert);

router.delete('/:id', protect, alertController.deleteAlert);
router.patch('/:id/toggle', protect, alertController.toggleAlert);

module.exports = router;
