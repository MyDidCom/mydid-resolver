const { toChecksumAddress } = require('ethereum-checksum-address');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getDIDDocument, didToAddress } = require('../utils/didHandler');

const didRegex =
  /^(DID|did):(SDI|sdi|MYDID|mydid):(0x[a-fA-F0-9]{40}|z[1-9A-HJ-NP-Za-km-z]{40,50})$/;

exports.getIdentifier = catchAsync(async (req, res, next) => {
  const { network, date, tag } = req.query;

  // check identifier
  const { did } = req.params;

  if (!did || !did.match(didRegex))
    return next(new AppError(`Invalid input`, 400));

    
  // get eth address
  const address = didToAddress(did);

  var checksumAddress = '';
  try {
    checksumAddress = toChecksumAddress(address);
  } catch (e) {
    return next(new AppError(`Invalid eth address : ${e}`, 400));
  }

  var didDocument = {};
  try {
    didDocument = await getDIDDocument(checksumAddress, date, network, did);
  } catch (e) {
    return next(
      new AppError(`Error while retrieving DID document : ${e}`, 400)
    );
  }

  if (tag) {
    for (key in didDocument) {
      if (typeof didDocument[key] == 'object') {
        for (method of didDocument[key]) {
          if (method.id && method.id == `${did}#${tag}`) {
            return res.status(200).json(method);
          }
        }
      }
    }
    // not found
    return res.status(200).json({ id: `${did}#${tag}` });
  }

  return res.status(200).json(didDocument);
});
