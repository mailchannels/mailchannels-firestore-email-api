const {test} = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const {EventEmitter} = require('node:events');
const {send} = require('../lib/transport');
const payload={from:{email:'sender@example.com'},personalizations:[{to:[{email:'recipient@example.com'}]}],subject:'Hello',content:[{type:'text/plain',value:'Body'}]};
for(const [status,state] of [[202,'accepted'],[200,'unknown'],[302,'unknown'],[400,'rejected'],[401,'rejected'],[408,'unknown'],[429,'rejected'],[500,'unknown']])test(`single HTTP attempt: ${status} -> ${state}`,async t=>{
 let calls=0;let destroyed=0;
 t.mock.method(https,'request',(url,options,callback)=>{
  calls++;assert.equal(url,'https://api.mailchannels.net/tx/v1/send');assert.equal(options.agent,false);assert.equal(options.rejectUnauthorized,undefined);assert.equal(options.method,'POST');assert.equal(options.headers['X-Api-Key'],'synthetic');
  const req=new EventEmitter();req.destroy=()=>destroyed++;req.end=body=>{assert.deepEqual(JSON.parse(body),payload);queueMicrotask(()=>callback({statusCode:status,destroy:()=>{}}));};return req;
 });
 assert.deepEqual(await send(payload,'synthetic'),{state,httpStatus:status});assert.equal(calls,1);assert.equal(destroyed,1);
});
test('network failure never retries',async t=>{
 let calls=0;t.mock.method(https,'request',()=>{calls++;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>req.emit('error',Error('synthetic')));return req;});
 assert.deepEqual(await send(payload,'synthetic'),{state:'unknown'});assert.equal(calls,1);
});
test('total deadline destroys stalled request without retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,destroyed=0;
 t.mock.method(https,'request',()=>{calls++;const req=new EventEmitter();req.destroy=()=>destroyed++;req.end=()=>{};return req;});
 const pending=send(payload,'synthetic');t.mock.timers.tick(15001);assert.deepEqual(await pending,{state:'unknown'});assert.equal(destroyed,1);assert.equal(calls,1);
});
