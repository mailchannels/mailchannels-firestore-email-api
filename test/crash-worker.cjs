// Runs the real claim/receipt code against the emulator; the parent kills this
// process at an explicit boundary. No HTTP or provider credentials are used.
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {processCreated}=require('../lib/core');
const operation=process.argv[2],mode=process.argv[3];
if(!process.env.FIRESTORE_EMULATOR_HOST || !operation || !['before-attempt','after-acceptance'].includes(mode))throw Error('Isolated emulator arguments required');
const db=getFirestore(initializeApp({projectId:'demo-mailchannels'}));
const config={sender:'sender@example.com',instance:'core',queue:'coreOutbox',receipts:'coreReceipts'};
(async()=>{
 const snapshot=await db.collection(config.queue).doc(operation).get();
 await processCreated({db,config,operation,createdAt:snapshot.createTime,data:snapshot.data(),key:'synthetic',transport:async()=>{
  if(mode==='after-acceptance')await db.collection('crashFixtureAttempts').doc(operation).create({state:'mock-accepted'});
  process.send({boundary:mode});
  // Keep the process alive without returning an outcome or writing a terminal receipt.
  return await new Promise(()=>{setInterval(()=>{},1000);});
 }});
 throw Error('Worker unexpectedly completed');
})().catch(()=>{console.error('CRASH_FIXTURE_FAILURE');process.exit(1);});
