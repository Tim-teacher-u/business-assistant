import { loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { collect } from './collector.mjs';
import { createApp } from './http.mjs';
const config=loadConfig(),store=new Store(config.databasePath),app=createApp(store,config);
let running=false;
async function tick(){if(running||!config.schedulerEnabled||!config.bizinfoKey||Number(store.setting('next_sync')||0)>Date.now())return;running=true;try{console.log('Collection:',JSON.stringify(await collect(store,config)));}catch(e){console.error('Collection:',e.code||'FAILED');}finally{running=false;}}
app.listen(config.port,config.host,()=>{console.log(`사업비서: ${config.origin}\n관리자: ${config.origin}/admin\n기업마당: ${config.bizinfoKey?'연결 설정됨':'API 키 설정 대기'}`);tick();});
const timer=setInterval(tick,30000);timer.unref();
process.on('SIGINT',()=>{clearInterval(timer);app.close(()=>process.exit(0));});
