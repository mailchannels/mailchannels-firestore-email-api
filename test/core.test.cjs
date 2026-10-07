const {test} = require('node:test');
const assert = require('node:assert/strict');
const {payloadFromDocument,validateConfiguration} = require('../lib/core');
const good={to:['recipient@example.com'],subject:'Hello',text:'Body'};
test('payload has fixed sender and explicit supported content',()=>{
 const p=payloadFromDocument({...good,html:'<b>Body</b>'},'sender@example.com');
 assert.deepEqual(p.content,[{type:'text/plain',value:'Body'},{type:'text/html',value:'<b>Body</b>'}]);
 assert.equal(p.from.email,'sender@example.com');
});
test('malformed, unsupported and excessive message data fail closed',()=>{
 for(const v of [null,[],{}, {...good,from:'attacker@example.com'}, {...good,endpoint:'http://bad'}, {...good,to:[]},{...good,to:['bad\n@example.com']},{...good,to:Array(51).fill('a@example.com')},{...good,subject:'bad\r\nheader'},{...good,text:''},{...good,text:'x'.repeat(262144)},{...good,html:42},{...good,attachments:[]}]) assert.throws(()=>payloadFromDocument(v,'sender@example.com'));
});
test('invalid configuration and overlapping collections fail closed',()=>{
 const good={sender:'sender@example.com',instance:'default',queue:'outbox',receipts:'receipts'};
 validateConfiguration(good);
 for(const bad of [{sender:'bad'},{instance:'a/b'},{queue:'receipts'},{receipts:'{wildcard}'}]) assert.throws(()=>validateConfiguration({...good,...bad}));
});
