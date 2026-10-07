import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString, expr } from 'firebase-functions/params';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { processCreated } from './core';
import { send } from './transport';

const key = defineSecret('MAILCHANNELS_API_KEY');
const sender = defineString('MAILCHANNELS_SENDER', {description:'Authorized fixed sender email address'});
const queue = defineString('MAILCHANNELS_QUEUE', {default:'mailchannelsOutbox'});
const receipts = defineString('MAILCHANNELS_RECEIPTS', {default:'mailchannelsReceipts'});
const instance = defineString('MAILCHANNELS_INSTANCE', {default:'default'});

export const sendQueuedEmail = onDocumentCreated({
  document: expr`${queue}/{operation}`,
  secrets:[key], retry:false, timeoutSeconds:60, memory:'256MiB',
}, async event => {
  if (!event.data) return;
  const app = getApps().find(app => app.name === '[DEFAULT]') ?? initializeApp();
  try {
    const state = await processCreated({db:getFirestore(app),
      config:{sender:sender.value(),queue:queue.value(),receipts:receipts.value(),instance:instance.value()},
      operation:event.params.operation,createdAt:event.data.createTime,data:event.data.data(),key:key.value(),transport:send});
    logger.info('MailChannels outbox result',{state});
  } catch {
    // Fixed diagnostic only: dependency errors may contain credentials or document content.
    logger.error('MailChannels outbox requires operator review');
    throw new Error('MAILCHANNELS_OPERATION_REVIEW_REQUIRED');
  }
});
