import {createClient} from '@libsql/client';
import type {Client,InValue,Transaction,InStatement} from '@libsql/client';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,readFileSync,readdirSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {Config} from './config.ts';

const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
type SchemaRow={type:string;name:string;sql:string};
export class LibsqlStore {
  static fromConfig(settings:Config){return new LibsqlStore(settings.tursoDatabaseUrl?{url:settings.tursoDatabaseUrl,authToken:settings.tursoAuthToken}:settings.databasePath);}
  readonly path:string;
  readonly remote:boolean;
  private client:Client;
  private context=new AsyncLocalStorage<{tx:Transaction;mode:'write'|'read'}>();
  private queue:Promise<unknown>=Promise.resolve();
  private ready:Promise<void>|undefined;
  constructor(source:string|{url:string;authToken?:string}){
    this.remote=typeof source!=='string'&&!source.url.startsWith('file:')&&source.url!==':memory:';
    this.path=typeof source==='string'?source:source.url.startsWith('file:')?fileURLToPath(source.url):source.url;
    if(!this.remote&&this.path!==':memory:')mkdirSync(dirname(resolve(this.path)),{recursive:true,mode:0o700});
    this.client=createClient(typeof source==='string'?{url:source===':memory:'?source:pathToFileURL(resolve(source)).href}:source);
  }
  private initialize(){
    return this.ready??= (async()=>{
      await this.client.execute('PRAGMA foreign_keys=ON');
      if(!this.remote){await this.client.execute('PRAGMA journal_mode=WAL');await this.client.execute('PRAGMA synchronous=FULL');await this.client.execute('PRAGMA busy_timeout=5000');
        if(this.path!==':memory:'&&process.platform!=='win32')chmodSync(this.path,0o600);
      }
    })();
  }
  private exclusive<T>(fn:()=>Promise<T>):Promise<T>{
    const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;
  }
  private async use<T>(fn:(executor:Client|Transaction)=>Promise<T>):Promise<T>{
    const current=this.context.getStore();
    if(current){if(current.tx.closed)throw new Error('Transaction already closed');return fn(current.tx);}
    return this.exclusive(async()=>{await this.initialize();return fn(this.client);});
  }
  async get<T>(sql:string,...args:InValue[]):Promise<T|undefined>{return this.use(async db=>{const result=await db.execute({sql,args});return result.rows[0] as T|undefined;});}
  async all<T>(sql:string,...args:InValue[]):Promise<T[]>{return this.use(async db=>(await db.execute({sql,args})).rows as T[]);}
  async run(sql:string,...args:InValue[]){return this.use(db=>db.execute({sql,args}));}
  async exec(sql:string){await this.use(db=>db.executeMultiple(sql));}
  async batch(statements:InStatement[]){if(!statements.length)return;await this.use(async db=>{await db.batch(statements);});}
  async transaction<T>(fn:()=>T|Promise<T>,mode:'write'|'read'='write'):Promise<T>{
    const current=this.context.getStore();
    if(current){if(current.tx.closed)throw new Error('Transaction already closed');if(mode==='write'&&current.mode==='read')throw new Error('Cannot write inside a read transaction');return fn();}
    return this.exclusive(async()=>{
      await this.initialize();const tx=await this.client.transaction(mode);
      try{
        const check=await tx.execute('PRAGMA foreign_keys');if(check.rows[0]?.foreign_keys!==1)throw new Error('Foreign key enforcement unavailable');
        const result=await this.context.run({tx,mode},fn);
        await tx.commit();return result;
      }catch(error){if(!tx.closed)await tx.rollback().catch(()=>{});throw error;}finally{tx.close();}
    });
  }
  async migrate(through=Number.MAX_SAFE_INTEGER){
    await this.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    const directory=fileURLToPath(new URL('../migrations/',import.meta.url));
    const files=readdirSync(directory).filter(name=>/^\d+_.*\.sql$/.test(name)).sort();
    const known=new Set(files.map(name=>Number(name.split('_')[0])));
    for(const row of await this.all<{version:number}>('SELECT version FROM schema_migrations'))if(!known.has(row.version))throw new Error('Database schema is newer than this application');
    for(const name of files){
      const version=Number(name.split('_')[0]),sql=readFileSync(resolve(directory,name),'utf8').replace(/\r\n/g,'\n'),checksum=createHash('sha256').update(sql).digest('hex');
      await this.transaction(async()=>{
        const applied=await this.get<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE version=?',version);
        if(applied&&applied.checksum!==checksum)throw new Error('Applied migration checksum mismatch');
        if(applied||version>through)return;
        await this.exec(sql);
        await this.run('INSERT INTO schema_migrations VALUES (?,?,?,?)',version,name,checksum,new Date().toISOString());
      });
    }
  }
  close(){this.client.close();}
  // Copy complete SQLite schema and rows; install immutable-history triggers after data.
  async copyToEmpty(target:LibsqlStore){
    if(target===this)throw new Error('Backup destination must be new');
    const snapshot=await this.transaction(async()=>{
      const schema=await this.all<SchemaRow>("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name");
      const tables=[];
      for(const table of schema.filter(x=>x.type==='table'))tables.push({name:table.name,rows:await this.all<Record<string,InValue>>('SELECT rowid AS __valor_rowid__,* FROM '+quote(table.name)+' ORDER BY rowid')});
      return {schema,tables};
    },'read');
    await target.transaction(async()=>{
      if((await target.all("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).length)throw new Error('Import destination must be empty');
      await target.run('PRAGMA defer_foreign_keys=ON');
      for(const entry of snapshot.schema.filter(x=>x.type==='table'))await target.exec(entry.sql);
      for(const table of snapshot.tables){
        const statements=table.rows.map(row=>{const keys=Object.keys(row);return {sql:'INSERT INTO '+quote(table.name)+' ('+keys.map(k=>quote(k==='__valor_rowid__'?'rowid':k)).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',args:keys.map(k=>row[k]!)};});
        for(let i=0;i<statements.length;i+=100)await target.batch(statements.slice(i,i+100));
      }
      for(const entry of snapshot.schema.filter(x=>x.type!=='table'))await target.exec(entry.sql);
      if((await target.get<{integrity_check:string}>('PRAGMA integrity_check'))?.integrity_check!=='ok'||(await target.all('PRAGMA foreign_key_check')).length)throw new Error('Backup validation failed');
    });
  }
  async backupTo(destination:string){
    if(existsSync(destination)||!this.remote&&resolve(destination)===resolve(this.path))throw new Error('Backup destination must be new');
    mkdirSync(dirname(resolve(destination)),{recursive:true,mode:0o700});closeSync(openSync(destination,'wx',0o600));
    const copy=new LibsqlStore(destination);try{await this.copyToEmpty(copy);}finally{copy.close();}
  }
}
