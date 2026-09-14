import fs from 'node:fs';
import { loadConfig,setupEnvironment } from './config.mjs';
import { Store } from './store.mjs';
import { collect } from './collector.mjs';
import { extractPage } from './normalize.mjs';
import { status } from './http.mjs';
const command=process.argv[2];
if(command==='setup'){console.log(setupEnvironment()?'.env 생성 완료. BIZINFO_API_KEY를 파일에 입력하세요.':'기존 .env를 유지합니다.');}
else{const c=loadConfig(),s=new Store(c.databasePath);try{
  if(command==='status')console.log(JSON.stringify(status(s,c),null,2));
  else if(command==='sync')console.log(JSON.stringify(await collect(s,c),null,2));
  else if(command==='import'){const file=process.argv[3];if(!file||fs.statSync(file).size>c.maxBytes)throw new Error('IMPORT_FILE_REQUIRED_OR_TOO_LARGE');const records=extractPage(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))).items;console.log(JSON.stringify(await collect(s,c,{records}),null,2));}
  else throw new Error('USE_SETUP_STATUS_SYNC_OR_IMPORT');
}catch(e){console.error(e.code||'COMMAND_FAILED');process.exitCode=1;}finally{s.close();}}
