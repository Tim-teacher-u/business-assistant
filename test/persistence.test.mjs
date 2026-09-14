import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { collect } from '../server/collector.mjs';
import { configFrom } from '../server/config.mjs';
test('DB 재시작 후 공고와 수집 이력 유지',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'business-db-test-')),file=path.join(dir,'test.sqlite');
 let s=new Store(file);
 try{await collect(s,configFrom({}),{records:[{pblancId:'PBLN_persist',pblancNm:'보관 테스트',pblancUrl:'https://www.bizinfo.go.kr/test'}]});s.close();s=new Store(file);assert.equal(s.count(),1);assert.equal(s.runs()[0].status,'success');assert.equal(s.feed()[0].origin,'import');}
 finally{s.close();for(const suffix of ['','-wal','-shm'])if(fs.existsSync(file+suffix))fs.unlinkSync(file+suffix);fs.rmdirSync(dir);}
});
