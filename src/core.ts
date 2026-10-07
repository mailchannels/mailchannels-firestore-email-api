import { createHash } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';

export interface Configuration { sender: string; instance: string; queue: string; receipts: string; }
export interface Payload { from: {email: string}; personalizations: {to: {email: string}[]}[]; subject: string; content: {type: string; value: string}[]; }
export type Outcome = {state: 'accepted' | 'rejected' | 'unknown'; httpStatus?: number};
export type Transport = (payload: Payload, key: string) => Promise<Outcome>;
const address = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const identifier = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export function validateConfiguration(c: Configuration): void {
  if (!address.test(c.sender) || c.sender.length > 254 ||
      ![c.instance,c.queue,c.receipts].every(x => identifier.test(x)) || c.queue === c.receipts)
    throw new Error('INVALID_CONFIGURATION');
}
// The intentionally small document schema rejects unsupported fields rather than dropping them.
export function payloadFromDocument(value: unknown, sender: string): Payload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MESSAGE');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['to','subject','text','html'].includes(k)) ||
      !Array.isArray(v.to) || !v.to.length || v.to.length > 50 ||
      v.to.some(x => typeof x !== 'string' || x.length > 254 || !address.test(x)) ||
      typeof v.subject !== 'string' || v.subject.length > 998 || /[\r\n\0]/.test(v.subject) ||
      (v.text === undefined && v.html === undefined)) throw new Error('INVALID_MESSAGE');
  const content = [];
  for (const field of ['text','html']) {
    if (v[field] !== undefined) {
      if (typeof v[field] !== 'string' || !(v[field] as string).length) throw new Error('INVALID_MESSAGE');
      content.push({type: field === 'text' ? 'text/plain' : 'text/html', value: v[field] as string});
    }
  }
  const result = {from:{email:sender},personalizations:[{to:(v.to as string[]).map(email=>({email}))}],subject:v.subject,content};
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error('MESSAGE_TOO_LARGE');
  return result;
}
export function fingerprint(p: Payload): string { return createHash('sha256').update(JSON.stringify(p)).digest('hex'); }
export type ProcessingResult = 'accepted' | 'rejected' | 'unknown' | 'duplicate' | 'conflict' | 'stale' | 'invalid' | 'unconfigured';

export async function processCreated(options: {
  db: Firestore; config: Configuration; operation: string; createdAt: Timestamp;
  data: unknown; key: string; transport: Transport;
}): Promise<ProcessingResult> {
  const {db,config,operation,createdAt,data,key,transport} = options;
  validateConfiguration(config);
  if (!operation || operation.includes('/') || Buffer.byteLength(operation)>1500) throw new Error('INVALID_OPERATION');
  let payload: Payload;
  try { payload = payloadFromDocument(data,config.sender); } catch { return 'invalid'; }
  // Missing/invalid credentials never consume the operation claim.
  if (!key || /[\r\n\0]/.test(key)) return 'unconfigured';
  const digest = fingerprint(payload);
  const queued = db.collection(config.queue).doc(operation);
  const receipt = db.collection(config.receipts).doc(config.instance).collection('operations').doc(operation);
  const claim = await db.runTransaction(async tx => {
    const [old,current] = await Promise.all([tx.get(receipt),tx.get(queued)]);
    if (old.exists) return old.get('payloadHash') === digest ? 'duplicate' as const : 'conflict' as const;
    if (!current.exists || !current.createTime?.isEqual(createdAt)) return 'stale' as const;
    try { if (fingerprint(payloadFromDocument(current.data(),config.sender)) !== digest) return 'conflict' as const; }
    catch { return 'conflict' as const; }
    tx.create(receipt,{version:1,state:'claimed',payloadHash:digest,claimedAt:Timestamp.now(),sourceCreatedAt:createdAt});
    return 'claimed' as const;
  });
  if (claim !== 'claimed') return claim;
  // Never send inside a retryable transaction. A crash from here onward leaves a claim
  // requiring reconciliation; replay must not cause another HTTP attempt.
  let outcome: Outcome;
  try { outcome = await transport(payload,key); }
  catch { outcome = {state:'unknown'}; }
  await receipt.update({state:outcome.state,...(outcome.httpStatus === undefined ? {} : {httpStatus:outcome.httpStatus}),finishedAt:Timestamp.now()});
  return outcome.state;
}
