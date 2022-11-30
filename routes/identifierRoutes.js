const express = require('express');
const identifierController = require('../controllers/identifierController');

const router = express.Router();

router.route('/:identifier').get(identifierController.getIdentifier);

module.exports = router;
