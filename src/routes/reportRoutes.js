const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const reportController = require('../controllers/reportController');

router.route('/')
  .get(protect, reportController.getReports)
  .post(protect, reportController.createReport);

router.delete('/:id', protect, reportController.deleteReport);

module.exports = router;
