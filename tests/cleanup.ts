import {rmSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
export function cleanupTestDirectory(path:string){
 try{rmSync(path,{recursive:true,force:true});}catch(error){
  // libSQL's Windows native handles may survive close until the test process exits.
  // Only the test runner's freshly-created private root is eligible for deferred cleanup.
  const root=process.env.VALOR_TEST_ROOT,rel=root?relative(resolve(root),resolve(path)):null;
  if(process.platform==='win32'&&rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&(error as NodeJS.ErrnoException).code==='EPERM')return;
  throw error;
 }
}
