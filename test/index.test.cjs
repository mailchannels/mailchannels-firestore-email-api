const {test} = require('node:test');
const assert = require('node:assert/strict');

test('both outbox log paths identify the operation and namespace without the error', async () => {
  Object.assign(process.env, {GCLOUD_PROJECT:'demo-test', MAILCHANNELS_API_KEY:'secret-key',
    MAILCHANNELS_SENDER:'sender@example.com', MAILCHANNELS_QUEUE:'outboxQ', MAILCHANNELS_INSTANCE:'nsA'});
  const core = require('../lib/core');
  const {logger} = require('firebase-functions');
  const logs = [];
  logger.info = (msg, data) => logs.push(['info', msg, data]);
  logger.error = (msg, data) => logs.push(['error', msg, data]);
  const {sendQueuedEmail} = require('../lib');
  const event = {params:{operation:'op-1'}, data:{createTime:null, data:() => ({subject:'private body'})}};
  const context = {queue:'outboxQ', instance:'nsA', operation:'op-1'};

  core.processCreated = async () => 'sent';
  await sendQueuedEmail.run(event);
  assert.deepEqual(logs.pop(), ['info', 'MailChannels outbox result', {...context, state:'sent'}]);

  core.processCreated = async () => { throw new Error('secret-key private body'); };
  await assert.rejects(sendQueuedEmail.run(event), /MAILCHANNELS_OPERATION_REVIEW_REQUIRED/);
  const entry = logs.pop();
  assert.deepEqual(entry, ['error', 'MailChannels outbox requires operator review', context]);
  assert.doesNotMatch(JSON.stringify(entry), /secret-key|private body/);
});
