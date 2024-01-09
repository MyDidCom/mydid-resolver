const express = require('express');
const identifierController = require('../controllers/identifierController');

const router = express.Router();

router.route('/').get(identifierController.getStatus);

module.exports = router;
