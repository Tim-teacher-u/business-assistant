import { randomUUID } from 'node:crypto';
import { normalizeBizinfo, sanitizeRaw } from './normalize.mjs';
import { BizinfoProvider,CollectionError } from './provider.mjs';
export async function collect(store,config,{provider=new BizinfoProvider(config),records=null}={}){
  const token=randomUUID(),origin=records===null?'api':'import';
  if(!store.lock(token))throw new CollectionError('SYNC_ALREADY_RUNNING');
  const id=store.begin(origin);
  try{
    const result=records===null?await provider.collect({onPage:()=>store.renew(token)}):{records,pages:0,complete:false};
    if(!result.records.length&&store.count())throw new CollectionError('EMPTY_SNAPSHOT');
    const rows=[],rejected=[],seen=new Set();let duplicates=0;
    for(const item of result.records){
      const raw=sanitizeRaw(item,config.bizinfoKey);
      try{const record=normalizeBizinfo(raw);if(seen.has(record.sourceId)){duplicates++;continue;}seen.add(record.sourceId);rows.push({record,raw});}
      catch{rejected.push({reason:'INVALID_NOTICE',raw});}
    }
    if(result.records.length&&!rows.length)throw new CollectionError('NO_VALID_RECORDS');
    store.renew(token);
    const detail={pages:result.pages,fetched:result.records.length,duplicates,...store.publish(rows,rejected,id,origin,origin==='api'&&result.complete&&!rejected.length&&!duplicates)};
    const status=rejected.length||duplicates?'partial':'success';store.finish(id,status,detail);
    if(origin==='api')store.setting('next_sync',Date.now()+(status==='success'?config.intervalMs:config.retryMs));
    return {id,status,...detail};
  }catch(e){const code=e instanceof CollectionError?e.code:'COLLECTION_FAILED';store.finish(id,'failed',{code});if(origin==='api')store.setting('next_sync',Date.now()+config.retryMs);throw new CollectionError(code);}
  finally{store.unlock(token);}
}
