const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fixtures=process.env.TLS_FIXTURE_DIR;
if(!fixtures)throw Error('TLS fixture directory required');
const cases=[
 {name:'trusted-202',cert:'valid',status:202,state:'accepted',requests:1},
 {name:'hostname-mismatch',cert:'wrong-host',status:202,state:'unknown',requests:0},
 {name:'expired-certificate',cert:'expired',status:202,state:'unknown',requests:0},
 {name:'untrusted-certificate',cert:'untrusted',status:202,state:'unknown',requests:0},
 {name:'redirect-no-follow',cert:'valid',status:302,state:'unknown',requests:1},
 {name:'rate-limit-no-retry',cert:'valid',status:429,state:'rejected',requests:1},
 {name:'server-error-no-retry',cert:'valid',status:503,state:'unknown',requests:1},
 {name:'unbounded-error-body',cert:'valid',status:500,state:'unknown',requests:1,stream:true},
 {name:'preheader-deadline',cert:'valid',state:'unknown',requests:1,stall:true},
];
async function scenario(c){
 let requests=0,connections=0;const sockets=new Set();const timers=new Set();
 const server=https.createServer({key:fs.readFileSync(path.join(fixtures,c.cert+'.key')),cert:fs.readFileSync(path.join(fixtures,c.cert+'.crt'))},(req,res)=>{
  requests++;assert.equal(req.url,'/tx/v1/send');assert.equal(req.method,'POST');assert.equal(req.headers['x-api-key'],'synthetic-tls-key');assert.equal(req.headers.host,'api.mailchannels.net');
  let data='';req.on('data',chunk=>data+=chunk);req.on('end',()=>{
   const payload=JSON.parse(data);assert.equal(payload.from.email,'sender@example.com');assert.equal(payload.subject,'Isolated TLS fixture');
   if(c.stall)return;
   if(c.status===302)res.setHeader('Location','https://api.mailchannels.net/redirect-must-not-be-requested');
   res.writeHead(c.status);if(!c.stream){res.end('synthetic response');return;}
   res.flushHeaders();const interval=setInterval(()=>res.write('x'.repeat(65536)),5);timers.add(interval);res.on('close',()=>{clearInterval(interval);timers.delete(interval);});
  });
 });
 server.on('connection',socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('tlsClientError',()=>{});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(443,'127.0.0.1',resolve);});
 try{
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[path.join(__dirname,'worker.cjs')],{env:{...process.env,NODE_EXTRA_CA_CERTS:path.join(fixtures,'ca.crt')},stdio:['ignore','pipe','pipe']});let output='',errors='';
   const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('worker exceeded fixture deadline'));},20000);
   child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
   child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);if(code!==0)reject(Error('worker failed: '+errors));else resolve(JSON.parse(output));});
  });
  assert.equal(result.outcome.state,c.state);assert.equal(requests,c.requests);assert.equal(connections,1);
  if(c.requests && !c.stall)assert.equal(result.outcome.httpStatus,c.status);
  if(c.stall)assert.ok(result.elapsedMs>=14500 && result.elapsedMs<18500,result.elapsedMs);
  else assert.ok(result.elapsedMs<3000,result.elapsedMs);
  const end=Date.now()+1000;while(sockets.size && Date.now()<end)await new Promise(r=>setTimeout(r,10));
  assert.equal(sockets.size,0,'peer sockets must close');
  console.log(JSON.stringify({scenario:c.name,...result,requests,connections,peerSocketsRemaining:sockets.size}));
 }finally{for(const timer of timers)clearInterval(timer);for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
}
(async()=>{for(const c of cases)await scenario(c);console.log(`FIREBASE_TLS_COMPLETE ${cases.length} actual TLS scenarios; network none; synthetic credentials only`);})().catch(e=>{console.error(e);process.exitCode=1;});
