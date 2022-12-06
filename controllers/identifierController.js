const { toChecksumAddress } = require('ethereum-checksum-address');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getDIDDocument } = require('../utils/didHandler');

const didRegex = /^(DID|did):(SDI|sdi):0x[a-fA-F0-9]{40}$/;

exports.getIdentifier = catchAsync(async (req, res, next) => {
  const { network, date, tag } = req.query;

  // check identifier
  const { identifier } = req.params;

  if (!identifier || !identifier.match(didRegex))
    return next(new AppError(`Invalid input`, 400));

  var checksumAddress = '';
  try {
    checksumAddress = toChecksumAddress(identifier.split(':')[2]);
  } catch (e) {
    return next(new AppError(`Invalid eth address : ${e}`, 400));
  }

  var didDocument = {};
  try {
    didDocument = await getDIDDocument(identifier.split(':')[2], date, network);
  } catch (e) {
    return next(
      new AppError(`Error while retrieving DID document : ${e}`, 400)
    );
  }

  if (tag) {
    for (key in didDocument) {
      if (typeof didDocument[key] == 'object') {
        for (method of didDocument[key]) {
          if (method.id && method.id == `DID:SDI:${checksumAddress}#${tag}`) {
            return res.status(200).json(method);
          }
        }
      }
    }
  }

  return res.status(200).json(didDocument);
});
