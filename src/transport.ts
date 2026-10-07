import { request } from 'node:https';
import type { Payload, Outcome } from './core';

/** One HTTP attempt, fixed endpoint, normal TLS verification; no redirects/retries. */
export function send(payload: Payload, key: string): Promise<Outcome> {
  return new Promise(resolve => {
    let finished = false;
    const finish = (outcome: Outcome) => { if (!finished) { finished=true; clearTimeout(timer); resolve(outcome); } };
    const body = JSON.stringify(payload);
    const req = request('https://api.mailchannels.net/tx/v1/send', {
      method:'POST', agent:false,
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'X-Api-Key':key},
    }, res => {
      // Do not retain/log error bodies. Acceptance is determined only by documented 202.
      const status = res.statusCode ?? 0;
      const outcome: Outcome = status === 202 ? {state:'accepted',httpStatus:status}
        : status >= 400 && status < 500 && status !== 408 ? {state:'rejected',httpStatus:status}
        : {state:'unknown',...(status ? {httpStatus:status} : {})};
      finish(outcome);
      res.destroy();
      req.destroy();
    });
    const timer = setTimeout(()=>{ finish({state:'unknown'}); req.destroy(); },15_000);
    req.on('error',()=>finish({state:'unknown'}));
    req.end(body);
  });
}
