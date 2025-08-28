const Web3 = require('web3');
const createKeccakHash = require('keccak');
const bs58 = require('bs58');
const { base58btc } = require('multiformats/bases/base58');
const secp256k1 = require('secp256k1');
const { toChecksumAddress } = require('ethereum-checksum-address');
const contractABI = require('../resources/contractABI');
const DidEntry = require('../models/didEntryModel');

const blockchainInstances = {};

const providers = process.env.WEB3_PROVIDERS.split(',');
const contractsAddresses = process.env.SMART_CONTRACT_ADDRESSES.split(',');
const didLog = [];
const didLogBoot = new Date().toISOString();

const promises = providers.map(async (provider, index) => {
  const web3 = new Web3(provider);
  const contract = new web3.eth.Contract(
    contractABI,
    contractsAddresses[index]
  );
  const chainId = await web3.eth.getChainId();

  blockchainInstances[chainId] = {
    web3,
    contract,
  };
});

Promise.all(promises).then(() => {
  console.log(
    'Resolver initialized for following chain ids :',
    Object.keys(blockchainInstances).join(', ')
  );
});

const attributeConversionMap = {
  // type
  AUTH: 'authentication',
  ASSR: 'assertionMethod',
  KEYA: 'keyAgreement',
  CAPI: 'capabilityInvocation',
  CAPD: 'capabilityDelegation',
  SERV: 'service',
  // method
  ED19_VR18: 'Ed25519VerificationKey2018',
  ECK1_VR19: 'EcdsaSecp256k1VerificationKey2019',
  ECK1_RM20: 'EcdsaSecp256k1RecoveryMethod2020',
  PGPK_VR21: 'PgpVerificationKey2021',
  // encoding
  PUBM: 'publicKeyMultibase',
  BCAC: 'blockchainAccountId',
};

module.exports.getActiveChainIds = function () {
  return Object.keys(blockchainInstances);
};

module.exports.getDidLog = function () {
  return {
    data: didLog,
    boot: didLogBoot,
  };
};

module.exports.getDIDDocument = async function (addr, date, chainId, did) {
  if (Object.keys(blockchainInstances).indexOf(chainId) == -1)
    throw 'Blockchain not supported';

  let lastBlockNumber = await getAttributes(addr, chainId);
  let blockNumber = lastBlockNumber;
  let didEntry;

  // add logic for cache system
  if (!date) {
    didEntry = await DidEntry.findOne({
      did,
      chainId,
      active: true,
    });

    if (didEntry && didEntry.lastBlockNumber == lastBlockNumber) {
      return JSON.parse(didEntry.didDocument);
    }
  }

  if (!didLog.find((entry) => entry.did == did && entry.chainId == chainId)) {
    didLog.push({
      did,
      chainId,
      ethCall_contractGetDid: 0,
      ethCall_contractGetAttributes: 0,
      eth_getLogs: 0,
      ethCall_contractIsIssuer: 0,
      ethCall_contractIsVerifier: 0,
      getBlock: 0,
    });
  }

  const miniDid = await getDID(addr, chainId);

  // LOG PURPOSE
  didLog.find(
    (entry) => entry.did == did && entry.chainId == chainId
  ).ethCall_contractGetDid += 1;

  const noController =
    miniDid[0].toLowerCase() == '0xffffffffffffffffffffffffffffffffffffffff';

  const controller =
    addr == miniDid[0]
      ? did
      : noController
      ? 'did:mydid:zFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      : miniDid[0];
  const service = miniDid[1];
  const authenticationKey = miniDid[2];

  if (!authenticationKey) {
    const didDocument = await computeDIDDocument(
      addr,
      did,
      did,
      null,
      null,
      [],
      chainId
    );

    if (didEntry) {
      didEntry.didDocument = JSON.stringify(didDocument);
      didEntry.lastBlockNumber = lastBlockNumber;
      await didEntry.save();
    } else {
      await DidEntry.create({
        did,
        chainId,
        didDocument: JSON.stringify(didDocument),
        lastBlockNumber,
      });
    }
    return didDocument;
  }

  // LOG PURPOSE
  didLog.find(
    (entry) => entry.did == did && entry.chainId == chainId
  ).ethCall_contractGetAttributes += 1;

  const events = [];
  const revokedEvents = [];

  while (blockNumber != 0) {
    let pastEvents = await blockchainInstances[chainId].contract.getPastEvents(
      'DIDAttributeChanged',
      {
        fromBlock: blockNumber,
        toBlock: blockNumber,
      }
    );

    // LOG PURPOSE
    didLog.find(
      (entry) => entry.did == did && entry.chainId == chainId
    ).eth_getLogs += 1;

    for (let event of pastEvents) {
      if (event.returnValues.identity != addr) continue;

      let currentBlockNumber = blockNumber; // store it for date filter if needed
      blockNumber = pastEvents[0].returnValues.previousChange;

      // filter with date
      if (date) {
        const blockTimestamp = (
          await blockchainInstances[chainId].web3.eth.getBlock(
            currentBlockNumber
          )
        ).timestamp;

        // LOG PURPOSE
        didLog.find(
          (entry) => entry.did == did && entry.chainId == chainId
        ).getBlock += 1;

        const blockDate = new Date(0);
        blockDate.setUTCSeconds(blockTimestamp);
        if (blockDate > new Date(date)) continue;
      }

      // check date validity
      const expirationDate = new Date(0);
      expirationDate.setUTCSeconds(event.returnValues.validTo);
      if (event.returnValues.validTo == 0) {
        revokedEvents.push({
          name: blockchainInstances[chainId].web3.utils.hexToString(
            event.returnValues.name
          ),
          value: event.returnValues.value,
        });
      } else if (new Date() > expirationDate) {
        events.push({
          name: blockchainInstances[chainId].web3.utils.hexToString(
            event.returnValues.name
          ),
          value: 'expired',
        });
      } else {
        if (
          revokedEvents.filter(
            (el) =>
              el.name ==
                blockchainInstances[chainId].web3.utils.hexToString(
                  event.returnValues.name
                ) && el.value == event.returnValues.value
          ).length > 0
        ) {
          events.push({
            name: blockchainInstances[chainId].web3.utils.hexToString(
              event.returnValues.name
            ),
            value: 'expired',
          });
        } else {
          events.push({
            name: blockchainInstances[chainId].web3.utils.hexToString(
              event.returnValues.name
            ),
            value: event.returnValues.value,
          });
        }
      }
    }
  }

  const didDocument = await computeDIDDocument(
    addr,
    did,
    controller,
    service,
    authenticationKey,
    events.reverse(),
    chainId
  );

  if (didEntry) {
    didEntry.didDocument = JSON.stringify(didDocument);
    didEntry.lastBlockNumber = lastBlockNumber;
    await didEntry.save();
  } else {
    await DidEntry.create({
      did,
      chainId,
      didDocument: JSON.stringify(didDocument),
      lastBlockNumber,
    });
  }

  return didDocument;
};

module.exports.didToAddress = function (did) {
  const didValue = did.split(':')[2];
  try {
    const publicKeyUintArray = base58btc.decode(didValue);
    const compressedPublicKey = Buffer.from(publicKeyUintArray).toString('hex');
    const decompressedBuffer = secp256k1.publicKeyConvert(
      Buffer.from(compressedPublicKey, 'hex'),
      false
    );
    const hash = createKeccakHash('keccak256')
      .update(Buffer.from(decompressedBuffer).slice(1))
      .digest();
    const address = toChecksumAddress(hash.slice(-20).toString('hex'));
    return address;
  } catch (e) {
    return didValue;
  }
};

async function getDID(addr, chainId) {
  return blockchainInstances[chainId].contract.methods.getDID(addr).call();
}

async function getAttributes(addr, chainId) {
  return blockchainInstances[chainId].contract.methods
    .changedDidDocuments(addr)
    .call();
}

async function isIssuer(addr, chainId) {
  return blockchainInstances[chainId].contract.methods
    .hasRole(createKeccakHash('keccak256').update('ISSUER_ROLE').digest(), addr)
    .call();
}

async function isVerifier(addr, chainId) {
  return blockchainInstances[chainId].contract.methods
    .hasRole(
      createKeccakHash('keccak256').update('VERIFIER_ROLE').digest(),
      addr
    )
    .call();
}

async function computeDIDDocument(
  addr,
  did,
  controller,
  service,
  authenticationKey,
  events,
  chainId
) {
  const authenticationList = [];
  const assertionMethodList = [];
  const capabilityInvocationList = [];
  const capabilityDelegationList = [];
  const keyAgreementList = [];
  let serviceList = [];
  let authenticationCount = 0;
  let assertionMethodCount = 0;
  let capabilityInvocationCount = 0;
  let capabilityDelegationCount = 0;
  let keyAgreementCount = 0;
  let serviceCount = 0;

  const defaultAssertionMethod = {
    id: `${did}#ASSR_${++assertionMethodCount}`,
    type: 'EcdsaSecp256k1RecoveryMethod2020',
    controller: `${controller}`,
    blockchainAccountId: `eip155:${parseInt(chainId)}:${addr}`,
  };
  assertionMethodList.push(defaultAssertionMethod);

  if (authenticationKey) {
    const defaultAuthentication = {
      id: `${did}#AUTH_${++authenticationCount}`,
      type: 'EcdsaSecp256k1VerificationKey2019',
      controller: `${controller}`,
      publicKeyMultibase: hexToBase58btc(authenticationKey),
    };
    authenticationList.push(defaultAuthentication);
  }

  if (service) {
    const identityIsIssuer = await isIssuer(addr, chainId);

    // LOG PURPOSE
    didLog.find(
      (entry) => entry.did == did && entry.chainId == chainId
    ).ethCall_contractIsIssuer += 1;

    const identityIsVerifier = await isVerifier(addr, chainId);

    // LOG PURPOSE
    didLog.find(
      (entry) => entry.did == did && entry.chainId == chainId
    ).ethCall_contractIsVerifier += 1;

    if (identityIsIssuer || identityIsVerifier) {
      const defaultService = {
        id: `${did}#SERV_${++serviceCount}`,
        type: 'Public Profile',
        serviceEndpoint:
          'https://myntfsid.mypinata.cloud/ipfs/' + hashToCID(service),
      };
      serviceList.push(defaultService);
    }
  }

  for (let event of events) {
    if (event.name.split(',')[0] != 'SERV' && event.name.split(',').length != 3)
      continue;
    if (event.name.split(',')[0] == 'SERV' && event.name.split(',').length != 2)
      continue;

    const type = attributeConversionMap[event.name.split(',')[0]] ?? null;
    const method = attributeConversionMap[event.name.split(',')[1]] ?? null;
    const encoding = attributeConversionMap[event.name.split(',')[2]] ?? null;
    if (event.name.split(',')[0] != 'SERV' && (!type || !method || !encoding))
      continue;

    switch (type) {
      case 'authentication':
        if (event.value == 'expired') {
          authenticationCount++;
          break;
        }
        const newAuthentication = {
          id: `${did}#${event.name.split(',')[0]}_${++authenticationCount}`,
          type: method,
          controller: `${controller}`,
        };
        newAuthentication[encoding] = event.value;
        authenticationList.push(newAuthentication);
        break;
      case 'assertionMethod':
        if (event.value == 'expired') {
          assertionMethodCount++;
          break;
        }
        const newAssertionMethod = {
          id: `${did}#${event.name.split(',')[0]}_${++assertionMethodCount}`,
          type: method,
          controller: `${controller}`,
        };
        newAssertionMethod[encoding] = event.value;
        assertionMethodList.push(newAssertionMethod);
        break;
      case 'keyAgreement':
        if (event.value == 'expired') {
          keyAgreementCount++;
          break;
        }
        const newKeyAgreement = {
          id: `${did}#${event.name.split(',')[0]}_${++keyAgreementCount}`,
          type: method,
          controller: `${controller}`,
        };
        newKeyAgreement[encoding] = event.value;
        keyAgreementList.push(newKeyAgreement);
        break;
      case 'capabilityInvocation':
        if (event.value == 'expired') {
          capabilityInvocationCount++;
          break;
        }
        const newCapabilityInvocation = {
          id: `${did}#${
            event.name.split(',')[0]
          }_${++capabilityInvocationCount}`,
          type: method,
          controller: `${controller}`,
        };
        newCapabilityInvocation[encoding] = event.value;
        capabilityInvocationList.push(newCapabilityInvocation);
        break;
      case 'capabilityDelegation':
        if (event.value == 'expired') {
          capabilityDelegationCount++;
          break;
        }
        const newCapabilityDelegation = {
          id: `${did}#${
            event.name.split(',')[0]
          }_${++capabilityDelegationCount}`,
          type: method,
          controller: `${controller}`,
        };
        newCapabilityDelegation[encoding] = event.value;
        capabilityDelegationList.push(newCapabilityDelegation);
        break;
      case 'service':
        if (event.value == 'expired') {
          serviceCount++;
          break;
        }
        // only keep last service
        const newService = {
          id: `${did}#${event.name.split(',')[0]}_1`,
          type: event.name.split(',')[1],
          serviceEndpoint: event.value,
        };
        serviceList = [newService];
        break;
      default:
        break;
    }
  }

  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/v1',
    ],
    id: `${did}`,
    controller: `${controller}`,
    ...(authenticationList.length > 0 && {
      authentication: authenticationList,
    }),
    ...(assertionMethodList.length > 0 && {
      assertionMethod: assertionMethodList,
    }),
    ...(keyAgreementList.length > 0 && {
      keyAgreement: keyAgreementList,
    }),
    ...(capabilityInvocationList.length > 0 && {
      capabilityInvocation: capabilityInvocationList,
    }),
    ...(capabilityDelegationList.length > 0 && {
      capabilityDelegation: capabilityDelegationList,
    }),
    ...(serviceList.length > 0 && {
      service: serviceList,
    }),
  };
  return didDocument;
}

function hashToCID(hash) {
  const cleanHash = (hash + '').replace('0x', '');
  const bytes = Buffer.from('1220' + cleanHash, 'hex');
  const cid = bs58.encode(bytes);
  return cid;
}

function hexToBase58btc(value) {
  try {
    const byteArray = Uint8Array.from(
      Buffer.from(value.replace('0x', ''), 'hex')
    );
    return base58btc.encode(byteArray);
  } catch (e) {
    console.log(e);
    return value;
  }
}
