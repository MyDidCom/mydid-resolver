const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const xss = require('xss-clean');
const compression = require('compression');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');
const identifierRouter = require('./routes/identifierRoutes');

const app = express();

app.set('trust proxy', 1);

// Set CORS
app.use(cors({ origin: process.env.CORS }));

// Set security HTTP headers
app.use(helmet());

// To beautify color console output
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));
else app.use(morgan('common'));

// Allow 1000 request max in 1 hour from one IP
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!',
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '100kb' }));

// Data sanatization against XSS
app.use(xss());
app.use(mongoSanitize());

// Add compression when returning json or html responses
app.use(compression());

// ROUTES
app.use('/1.0/identifiers', identifierRouter);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl}`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
