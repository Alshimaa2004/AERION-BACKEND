const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');

router.get('/nearby', dataController.getNearby);
router.get('/governorates', dataController.getGovernorates);
router.get('/governorate/:name', dataController.getGovernorate);
router.get('/forecast/:governorate', dataController.getForecast);

module.exports = router;
