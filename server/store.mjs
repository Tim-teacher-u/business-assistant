import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export class Store {
  constructor(filename) {
    if(filename!==':memory:') fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS programs(id TEXT PRIMARY KEY, hash TEXT NOT NULL, document TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, revision INTEGER NOT NULL, observation TEXT NOT NULL, origin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(id TEXT, revision INTEGER, captured_at TEXT, document TEXT, raw TEXT, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, origin TEXT, detail TEXT);
      CREATE TABLE IF NOT EXISTS quarantine(run_id INTEGER, reason TEXT, raw TEXT);
      CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY, token TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT);`);
  }
  close(){this.db.close();}
  lock(token){const r=this.db.prepare(`INSERT INTO locks VALUES('bizinfo',?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE locks.expires<?`).run(token,Date.now()+900000,Date.now());return r.changes===1;}
  renew(token){if(!this.db.prepare("UPDATE locks SET expires=? WHERE name='bizinfo' AND token=?").run(Date.now()+900000,token).changes)throw new Error('LOCK_LOST');}
  unlock(token){this.db.prepare('DELETE FROM locks WHERE token=?').run(token);}
  begin(origin){return Number(this.db.prepare("INSERT INTO runs(started_at,status,origin,detail) VALUES(?,'running',?,'{}')").run(new Date().toISOString(),origin).lastInsertRowid);}
  finish(id,status,detail){this.db.prepare('UPDATE runs SET finished_at=?,status=?,detail=? WHERE id=?').run(new Date().toISOString(),status,JSON.stringify(detail),id);}
  runs(){return this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 30').all().map(x=>({...x,detail:JSON.parse(x.detail)}));}
  count(){return this.db.prepare('SELECT count(*) n FROM programs').get().n;}
  setting(name,value){if(value!==undefined)this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(name,String(value));return this.db.prepare('SELECT value FROM settings WHERE name=?').get(name)?.value;}
  publish(rows,rejected,run,origin,full){
    const now=new Date().toISOString(),counts={added:0,updated:0,unchanged:0,rejected:rejected.length};
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(full)this.db.prepare("UPDATE programs SET observation='not_seen_in_latest' WHERE origin='api'").run();
      for(const {record,raw} of rows){
        const old=this.db.prepare('SELECT hash,revision,first_seen FROM programs WHERE id=?').get(record.sourceId);
        const changed=!old||old.hash!==record.contentHash,revision=old?(old.revision+(changed?1:0)):1;
        counts[!old?'added':changed?'updated':'unchanged']++;
        this.db.prepare('INSERT OR REPLACE INTO programs VALUES(?,?,?,?,?,?,?,?)').run(record.sourceId,record.contentHash,JSON.stringify(record),old?.first_seen||now,now,revision,'seen',origin);
        if(changed)this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run(record.sourceId,revision,now,JSON.stringify(record),JSON.stringify(raw));
      }
      for(const x of rejected)this.db.prepare('INSERT INTO quarantine VALUES(?,?,?)').run(run,x.reason,JSON.stringify(x.raw));
      this.setting('snapshot',`${run}:${now}`);
      this.db.exec('COMMIT');return counts;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  feed(){return this.db.prepare('SELECT * FROM programs ORDER BY last_seen DESC,id LIMIT 5000').all().map(x=>({...JSON.parse(x.document),lastObservedAt:x.last_seen,revision:x.revision,observation:x.observation,origin:x.origin}));}
}
