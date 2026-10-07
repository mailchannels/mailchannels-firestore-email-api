const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const fixtures={
 'test/functions/.env.demo-mailchannels':'MAILCHANNELS_SENDER=sender@example.com\nMAILCHANNELS_QUEUE=mailchannelsOutbox\nMAILCHANNELS_RECEIPTS=mailchannelsReceipts\nMAILCHANNELS_INSTANCE=default\n',
 'test/functions/.secret.local':'MAILCHANNELS_API_KEY=synthetic-emulator-only\n',
};
for(const [file,data] of Object.entries(fixtures)) if(fs.existsSync(path.join(root,file)) && fs.readFileSync(path.join(root,file),'utf8')!==data) throw Error('Refusing to overwrite non-fixture configuration');
try {
 for(const [file,data] of Object.entries(fixtures)) fs.writeFileSync(path.join(root,file),data,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),'emulators:exec','--only','firestore,functions','--project','demo-mailchannels','node test/emulator.cjs'],{cwd:root,stdio:'inherit',env:{...process.env,FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true'}});
 if(result.error)throw result.error;process.exitCode=result.status??1;
}finally{for(const file of Object.keys(fixtures))fs.rmSync(path.join(root,file),{force:true});}
