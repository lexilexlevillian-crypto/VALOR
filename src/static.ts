import {readFileSync} from 'node:fs';
import type {FastifyInstance} from 'fastify';
const files:Record<string,[string,string]>={
 '/app':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],
 '/style.css':['style.css','text/css; charset=utf-8'],
 '/theme.js':['theme.js','text/javascript; charset=utf-8'],'/sw.js':['sw.js','text/javascript; charset=utf-8'],
 '/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],'/icon.svg':['icon.svg','image/svg+xml']
};
export const publicAssets=new Set(Object.keys(files));
export const shell=()=>readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
export const shellPolicy="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
export function staticRoutes(app:FastifyInstance){for(const[path,[file,type]]of Object.entries(files))app.get(path,async(_r,reply)=>{reply.header('Content-Security-Policy',shellPolicy);reply.type(type);return readFileSync(new URL('../public/'+file,import.meta.url));});}
