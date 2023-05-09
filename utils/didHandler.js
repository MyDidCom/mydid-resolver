const Web3 = require('web3');
const createKeccakHash = require('keccak');
const bs58 = require('bs58');
const { base58btc } = require('multiformats/bases/base58');
const secp256k1 = require('secp256k1');
const { toChecksumAddress } = require('ethereum-checksum-address');
const contractABI = require('../resources/bscContractABI');

const web3Mainnet = new Web3(process.env.WEB3_PROVIDER_MAINNET);
const mydidContractMainnet = new web3Mainnet.eth.Contract(
  contractABI,
  process.env.SMART_CONTRACT_ADDRESS_MAINNET
);

const web3Testnet = new Web3(process.env.WEB3_PROVIDER_TESTNET);
const mydidContractTestnet = new web3Testnet.eth.Contract(
  contractABI,
  process.env.SMART_CONTRACT_ADDRESS_TESTNET
);

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

module.exports.getDIDDocument = async function (addr, date, network, did) {
  const miniDid = await getDID(addr, network);
  const controller = addr == miniDid[0] ? did : `DID:SDI:${miniDid[0]}`;
  const service = miniDid[1];
  const authenticationKey = miniDid[2];

  if (!authenticationKey) {
    const didDocument = createDIDDocument(
      addr,
      did,
      did,
      null,
      null,
      [],
      network
    );
    return didDocument;
  }

  let blockNumber = await getAttributes(addr, network);

  const events = [];
  const revokedEvents = [];

  while (blockNumber != 0) {
    let pastEvents =
      network == 'testnet'
        ? await mydidContractTestnet.getPastEvents('DIDAttributeChanged', {
            fromBlock: blockNumber,
            toBlock: blockNumber,
          })
        : await mydidContractMainnet.getPastEvents('DIDAttributeChanged', {
            fromBlock: blockNumber,
            toBlock: blockNumber,
          });

    for (let event of pastEvents) {
      if (event.returnValues.identity != addr) continue;

      let currentBlockNumber = blockNumber; // store it for date filter if needed
      blockNumber = pastEvents[0].returnValues.previousChange;

      // filter with date
      if (date) {
        const blockTimestamp = (
          network == 'testnet'
            ? await web3Testnet.eth.getBlock(currentBlockNumber)
            : await web3Mainnet.eth.getBlock(currentBlockNumber)
        ).timestamp;
        const blockDate = new Date(0);
        blockDate.setUTCSeconds(blockTimestamp);
        if (blockDate > new Date(date)) continue;
      }

      // check date validity
      const expirationDate = new Date(0);
      expirationDate.setUTCSeconds(event.returnValues.validTo);
      if (event.returnValues.validTo == 0) {
        revokedEvents.push({
          name: web3Mainnet.utils.hexToString(event.returnValues.name),
          value: event.returnValues.value,
        });
      } else if (new Date() > expirationDate) {
        events.push({
          name: web3Mainnet.utils.hexToString(event.returnValues.name),
          value: 'expired',
        });
      } else {
        if (
          revokedEvents.filter(
            (el) =>
              el.name ==
                web3Mainnet.utils.hexToString(event.returnValues.name) &&
              el.value == event.returnValues.value
          ).length > 0
        ) {
          events.push({
            name: web3Mainnet.utils.hexToString(event.returnValues.name),
            value: 'expired',
          });
        } else {
          events.push({
            name: web3Mainnet.utils.hexToString(event.returnValues.name),
            value: event.returnValues.value,
          });
        }
      }
    }
  }

  const didDocument = createDIDDocument(
    addr,
    did,
    controller,
    service,
    authenticationKey,
    events.reverse(),
    network
  );

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

async function getDID(addr, network) {
  return network == 'testnet'
    ? mydidContractTestnet.methods.getDID(addr).call()
    : mydidContractMainnet.methods.getDID(addr).call();
}

async function getAttributes(addr, network) {
  return network == 'testnet'
    ? mydidContractTestnet.methods.changedDidDocuments(addr).call()
    : mydidContractMainnet.methods.changedDidDocuments(addr).call();
}

async function isIssuer(addr, network) {
  return network == 'testnet'
    ? mydidContractTestnet.methods
        .hasRole(
          createKeccakHash('keccak256').update('ISSUER_ROLE').digest(),
          addr
        )
        .call()
    : mydidContractMainnet.methods
        .hasRole(
          createKeccakHash('keccak256').update('ISSUER_ROLE').digest(),
          addr
        )
        .call();
}

async function isVerifier(addr, network) {
  return network == 'testnet'
    ? mydidContractTestnet.methods
        .hasRole(
          createKeccakHash('keccak256').update('VERIFIER_ROLE').digest(),
          addr
        )
        .call()
    : mydidContractMainnet.methods
        .hasRole(
          createKeccakHash('keccak256').update('VERIFIER_ROLE').digest(),
          addr
        )
        .call();
}

async function createDIDDocument(
  addr,
  did,
  controller,
  service,
  authenticationKey,
  events,
  network
) {
  const authenticationList = [];
  const assertionMethodList = [];
  const capabilityInvocationList = [];
  const capabilityDelegationList = [];
  const keyAgreementList = [];
  const serviceList = [];
  let authenticationCount = 0;
  let assertionMethodCount = 0;
  let capabilityInvocationCount = 0;
  let capabilityDelegationCount = 0;
  let keyAgreementCount = 0;
  let serviceCount = 0;

  const chainId =
    network == 'testnet'
      ? process.env.CHAIN_ID_TESNET
      : process.env.CHAIN_ID_MAINNET;

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
      publicKeyMultibase: `z${hexToBase58(authenticationKey)}`,
    };
    authenticationList.push(defaultAuthentication);
  }

  const identityIsIssuer = await isIssuer(addr, network);
  const identityIsVerifier = await isVerifier(addr, network);
  if (identityIsIssuer || identityIsVerifier) {
    const defaultService = {
      id: `${did}#SERV_${++serviceCount}`,
      type: 'Public Profile',
      serviceEndpoint:
        'https://myntfsid.mypinata.cloud/ipfs/' + hashToCID(service),
    };
    serviceList.push(defaultService);
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
        const newService = {
          id: `${did}#${event.name.split(',')[0]}_${++serviceCount}`,
          type: event.name.split(',')[1],
          serviceEndpoint: event.value,
        };
        serviceList.push(newService);
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

function hexToBase58(hex) {
  const cleanHex = (hex + '').replace('0x', '');
  const bytes = Buffer.from(cleanHex, 'hex');
  const base58 = bs58.encode(bytes);
  return base58;
}
