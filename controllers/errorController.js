const sendError = (err, res) => {
  // Operationnal, trusted error : send message to client
  if (err.isOperationnal) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      code: err.code,
    });
  }
  else {
    console.log('ERROR : ', err);
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong',
    });
  }
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';
  err.code = err.code || -1;
  if (req.route && req.route.path.includes('/sse')) {
    return console.log(err);
  }
  let error = Object.assign(err);
  sendError(error, res);
};
