const dovenv = require('dotenv');
const mongoose = require('mongoose');


process.on('uncaughtException', (err) => {
  console.log('[SERVER] UNCAUGHT EXCEPTION! Shutting down...');
  console.log(err.name, err.message, err.stack);
  process.exit(1);
});

dovenv.config({ path: './config.env' });
const app = require('./app');

mongoose.set('strictQuery', false);
mongoose
  .connect(process.env.DATABASE_LOCAL, {})
  .then(() => console.log('DB connection successful !'));

const port = process.env.PORT;
const server = app.listen(port, () => {
  console.log(`[SERVER] App running on port ${port}`);
});

process.on('unhandledRejection', (err) => {
  console.log('[SERVER] UNHANDLER REJECTION! Shutting down...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    console.log('Process terminated !');
  });
});
