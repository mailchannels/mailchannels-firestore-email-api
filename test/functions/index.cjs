// Fixture only: exercise the actual exported v2 function with an injected transport.
// Synthetic key and fixed payload never leave the emulator.
const {getApps,initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const transport = require('../../lib/transport');
transport.send = async (payload,key) => {
  if (key !== 'synthetic-emulator-only') throw Error('unexpected credential');
  const app = getApps().find(app => app.name === '[DEFAULT]') ?? initializeApp();
  await getFirestore(app).collection('fixtureAttempts').add({subject:payload.subject});
  return {state:'accepted',httpStatus:202};
};
module.exports = require('../../lib');
