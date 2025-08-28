const mongoose = require('mongoose');

const didEntrySchema = new mongoose.Schema(
  {
    did: {
      type: String,
      require: [true, 'Missing DID'],
    },
    chainId: {
      type: String,
      require: [true, 'Missing chainId'],
    },
    didDocument: {
      type: String,
    },
    lastBlockNumber: {
      type: Number,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const DidEntry = mongoose.model('DidEntry', didEntrySchema);

module.exports = DidEntry;
