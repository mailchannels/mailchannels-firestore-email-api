const {send}=require('../../lib/transport');
const payload={from:{email:'sender@example.com'},personalizations:[{to:[{email:'recipient@example.com'}]}],subject:'Isolated TLS fixture',content:[{type:'text/plain',value:'Synthetic body'}]};
const start=Date.now();
send(payload,'synthetic-tls-key').then(outcome=>console.log(JSON.stringify({outcome,elapsedMs:Date.now()-start}))).catch(()=>{console.error('TRANSPORT_FIXTURE_FAILURE');process.exitCode=1;});
