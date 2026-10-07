const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mailchannels-firebase-consumer-'));
function run(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;}
try{
 run('npm',['run','build'],root);
 const pack=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],root))[0];
 const files=pack.files.map(f=>f.path);
 if(files.some(f=>/secret|node_modules|test\/|\.env/.test(f)))throw Error('unexpected package contents');
 for(const f of ['lib/index.js','lib/index.d.ts','firestore.rules','README.md','LICENSE'])if(!files.includes(f))throw Error('missing '+f);
 fs.writeFileSync(path.join(temp,'package.json'),'{"private":true}');
 run('npm',['install','--ignore-scripts','--no-fund','--no-audit',path.join(temp,pack.filename)],temp);
 const entry=path.join(temp,'node_modules/@mailchannels/firestore-email-api');
 const exported=require(entry);const assert=require('node:assert/strict');
 assert.deepEqual(Object.keys(exported),['sendQueuedEmail']);const endpoint=exported.sendQueuedEmail.__endpoint;
 assert.equal(endpoint.platform,'gcfv2');assert.equal(endpoint.eventTrigger.eventType,'google.cloud.firestore.document.v1.created');
 assert.equal(endpoint.eventTrigger.retry,false);
 assert.deepEqual(endpoint.secretEnvironmentVariables,[{key:'MAILCHANNELS_API_KEY'}]);
 const pattern=endpoint.eventTrigger.eventFilterPathPatterns.document;
 assert.equal(pattern.toCEL(),'{{ params.MAILCHANNELS_QUEUE }}/{operation}');
 process.env.MAILCHANNELS_QUEUE='customQueue';assert.equal(pattern.value(),'customQueue/{operation}');
 console.log('FIREBASE_PACKED_CONSUMER_COMPLETE: fresh install, package contents, v2 trigger, parameter expression, secret binding, no retry');
 console.log(JSON.stringify({filename:pack.filename,sha1:pack.shasum,integrity:pack.integrity,files}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
