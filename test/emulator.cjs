const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc}=require('firebase/firestore');
const {processCreated}=require('../lib/core');
const projectId='demo-mailchannels';
const app=initializeApp({projectId});const db=getFirestore(app);
let checks=0;function check(value){assert.ok(value);checks++;}
const config={sender:'sender@example.com',instance:'core',queue:'coreOutbox',receipts:'coreReceipts'};
const message={to:['recipient@example.com'],subject:'Example',text:'Body'};
async function event(id,data=message){const ref=db.collection(config.queue).doc(id);await ref.create(data);const snap=await ref.get();return {db,config,operation:id,data,createdAt:snap.createTime,key:'synthetic',transport:async()=>({state:'accepted',httpStatus:202})};}
async function receipt(id){return (await db.collection(config.receipts).doc(config.instance).collection('operations').doc(id).get()).data();}
async function waitFor(fn){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('fixture timeout');}
(async()=>{
 let attempts=0;
 const e=await event('concurrent');e.transport=async()=>{attempts++;return {state:'accepted',httpStatus:202};};
 const results=await Promise.all(Array.from({length:12},()=>processCreated(e)));
 check(attempts===1);check(results.filter(x=>x==='accepted').length===1);check(results.filter(x=>x==='duplicate').length===11);
 check((await receipt('concurrent')).state==='accepted');
 check(await processCreated({...e,data:{...message,text:'changed'}})==='conflict');check(attempts===1);
 const mutated=await event('mutated');await db.collection(config.queue).doc('mutated').update({text:'mutated'});check(await processCreated(mutated)==='conflict');check(await receipt('mutated')===undefined);
 const recreated=await event('recreated');await db.collection(config.queue).doc('recreated').delete();await db.collection(config.queue).doc('recreated').create(message);check(await processCreated(recreated)==='stale');
 await db.collection(config.queue).doc('concurrent').delete();await db.collection(config.queue).doc('concurrent').create(message);const snap=await db.collection(config.queue).doc('concurrent').get();check(await processCreated({...e,createdAt:snap.createTime})==='duplicate');check(attempts===1);
 for(const state of ['accepted','rejected','unknown']) {const item=await event(state);item.transport=async()=>({state,httpStatus:state==='accepted'?202:state==='rejected'?429:503});check(await processCreated(item)===state);check((await receipt(state)).state===state);check(await processCreated(item)==='duplicate');}
 const thrown=await event('transport-error');thrown.transport=async()=>{throw Error('synthetic timeout');};check(await processCreated(thrown)==='unknown');check(await processCreated(thrown)==='duplicate');
 const noKey=await event('missing-key');check(await processCreated({...noKey,key:''})==='unconfigured');check(await receipt('missing-key')===undefined);check(await processCreated(noKey)==='accepted');
 const invalid=await event('invalid',{...message,from:'attacker@example.com'});check(await processCreated(invalid)==='invalid');check(await receipt('invalid')===undefined);
 const crash=await event('crash');const realRef=db.collection(config.receipts).doc(config.instance).collection('operations').doc('crash');await realRef.create({state:'claimed',payloadHash:require('../lib/core').fingerprint(require('../lib/core').payloadFromDocument(message,config.sender))});check(await processCreated(crash)==='duplicate');check((await receipt('crash')).state==='claimed');
 // Fault injected after actual Firestore claim and HTTP acceptance: receipt stays claimed.
 const failed=await event('receipt-failure');let sends=0;const actualCollection=db.collection.bind(db);
 const wrapped={runTransaction:db.runTransaction.bind(db),collection(name){if(name!==config.receipts)return actualCollection(name);return {doc(instance){return {collection(n){return {doc(id){const real=actualCollection(name).doc(instance).collection(n).doc(id);return new Proxy(real,{get(target,prop){if(prop==='update')return async()=>{throw Error('injected receipt storage fault');};const v=Reflect.get(target,prop);return typeof v==='function'?v.bind(target):v;}});}};}};}};}};
 failed.db=wrapped;failed.transport=async()=>{sends++;return {state:'accepted',httpStatus:202};};await assert.rejects(processCreated(failed));checks++;check(sends===1);check((await receipt('receipt-failure')).state==='claimed');check(await processCreated({...failed,db})==='duplicate');check(sends===1);
 const claimFailure=await event('claim-failure');let forbiddenSends=0;claimFailure.transport=async()=>{forbiddenSends++;return {state:'accepted',httpStatus:202};};claimFailure.db={collection:db.collection.bind(db),runTransaction:async()=>{throw Error('injected claim storage fault');}};await assert.rejects(processCreated(claimFailure));checks++;check(forbiddenSends===0);check(await receipt('claim-failure')===undefined);
 const missing=await event('deleted');await db.collection(config.queue).doc('deleted').delete();check(await processCreated(missing)==='stale');
 const second={...config,instance:'second',queue:'secondOutbox'};await db.collection(second.queue).doc('concurrent').create(message);const secondSnap=await db.collection(second.queue).doc('concurrent').get();check(await processCreated({...e,config:second,createdAt:secondSnap.createTime})==='accepted');check(attempts===2);
 const saved=await receipt('concurrent');check(Object.keys(saved).sort().join(',')==='claimedAt,finishedAt,httpStatus,payloadHash,sourceCreatedAt,state,version');check(!JSON.stringify(saved).includes('recipient@example.com'));
 // Actual process death after the durable claim, on either side of the simulated side effect.
 for(const mode of ['before-attempt','after-acceptance']){
  const operation='killed-'+mode;const crashEvent=await event(operation);
  const {fork}=require('node:child_process');const path=require('node:path');
  await new Promise((resolve,reject)=>{
   const child=fork(path.join(__dirname,'crash-worker.cjs'),[operation,mode],{stdio:['ignore','ignore','pipe','ipc']});
   let reached=false;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('crash boundary not reached'));},20000);
   child.on('error',reject);
   child.on('message',message=>{if(message.boundary===mode){reached=true;child.kill('SIGKILL');}});
   child.on('exit',(code,signal)=>{clearTimeout(timer);if(reached && signal==='SIGKILL')resolve();else reject(Error('unexpected worker exit'));});
  });checks++;
  check((await receipt(operation)).state==='claimed');
  check((await db.collection('crashFixtureAttempts').doc(operation).get()).exists===(mode==='after-acceptance'));
  let replays=0;crashEvent.transport=async()=>{replays++;return {state:'accepted',httpStatus:202};};
  check(await processCreated(crashEvent)==='duplicate');check(await processCreated(crashEvent)==='duplicate');check(replays===0);check((await receipt(operation)).state==='claimed');
  console.log('FIREBASE_PROCESS_KILL '+mode+': SIGKILL verified; durable claim retained; replay attempts=0');
 }
 // Real rules engine denies both unauthenticated and authenticated clients.
 const rules=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:18080,rules:fs.readFileSync('firestore.rules','utf8')}});
 for(const context of [rules.unauthenticatedContext(),rules.authenticatedContext('user')])for(const path of ['mailchannelsOutbox/forbidden','mailchannelsReceipts/default/operations/forbidden']){await assertFails(setDoc(doc(context.firestore(),path),message));checks++;await assertFails(getDoc(doc(context.firestore(),path)));checks++;}
 await rules.cleanup();
 // Trigger creation through Firestore; actual functions emulator discovers/runs exported v2 function.
 await db.collection('mailchannelsOutbox').doc('native').create({...message,subject:'Native trigger'});
 await waitFor(async()=> (await db.doc('mailchannelsReceipts/default/operations/native').get()).get('state')==='accepted');checks++;
 check((await db.collection('fixtureAttempts').get()).size===1);
 await db.collection('mailchannelsOutbox').doc('native').update({subject:'Must not send on update'});
 await new Promise(r=>setTimeout(r,500));check((await db.collection('fixtureAttempts').get()).size===1);
 await db.collection('mailchannelsOutbox').doc('native').delete();await db.collection('mailchannelsOutbox').doc('native').create({...message,subject:'Native trigger'});
 await new Promise(r=>setTimeout(r,1000));check((await db.collection('fixtureAttempts').get()).size===1);
 console.log(`FIREBASE_EMULATOR_COMPLETE ${checks} checks; no provider requests`);
})().finally(async()=>{await db.terminate();await deleteApp(app);}).catch(e=>{console.error(e);process.exitCode=1;});
