import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { collect } from './collector.mjs';
export function status(store,c){return {service:'사업비서',phase:'공고 수집 백엔드',provider:'bizinfo',configured:!!c.bizinfoKey,total:store.count(),analysis:'pending',schedulerEnabled:c.schedulerEnabled,nextSyncAt:store.setting('next_sync')?new Date(Number(store.setting('next_sync'))).toISOString():null,lastRun:store.runs()[0]||null};}
export function createApp(store,c,{sync=()=>collect(store,c)}={}){
  let active=false;
  return http.createServer(async(req,res)=>{
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    try{
      if(req.headers.host!==new URL(c.origin).host)return json(403,{error:'HOST_NOT_ALLOWED'});
      const url=new URL(req.url,c.origin),p=url.pathname;
      if(p.startsWith('/api/admin/')){
        const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(c.adminToken);
        if(!expected.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(401,{error:'ADMIN_AUTH_REQUIRED'});
        if(req.headers.origin&&req.headers.origin!==c.origin)return json(403,{error:'ORIGIN_NOT_ALLOWED'});
        if(req.method==='GET'&&p==='/api/admin/status')return json(200,{...status(store,c),runs:store.runs(),active});
        if(req.method==='POST'&&p==='/api/admin/sync'){
          if(!c.bizinfoKey)return json(503,{error:'API_KEY_MISSING'});
          if(active)return json(409,{error:'SYNC_ALREADY_RUNNING'});
          if(Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding'])return json(413,{error:'BODY_NOT_SUPPORTED'});
          active=true;json(202,{accepted:true});Promise.resolve().then(sync).catch(()=>{}).finally(()=>{active=false;});return;
        }
        return json(404,{error:'NOT_FOUND'});
      }
      if(req.method!=='GET')return json(405,{error:'METHOD_NOT_ALLOWED'});
      if(p==='/api/status'||p==='/api/health')return json(200,status(store,c));
      if(p==='/api/programs')return json(200,{items:store.feed(),meta:{...status(store,c),snapshot:store.setting('snapshot')||null,hasMore:store.count()>5000}});
      const files=new Map([['/','index.html'],['/index.html','index.html'],['/admin','admin.html'],['/admin.html','admin.html']]);
      const file=files.get(p);
      if(!file)return json(404,{error:'NOT_FOUND'});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(fs.readFileSync(path.join(c.root,file)));
    }catch{if(!res.headersSent)json(500,{error:'INTERNAL_ERROR'});else res.end();}
  });
}
