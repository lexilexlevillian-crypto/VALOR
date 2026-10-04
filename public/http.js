// Never retry here: a lost response does not mean a mutation failed to save.
function responseFailure(response,method){
 const status=response.status?` (HTTP ${response.status})`:'';
 const advice=['GET','HEAD'].includes(method.toUpperCase())?'Reload the page and try again.':'Reload your life and check whether the action saved before trying again.';
 return new Error(`The server returned an empty or incomplete response${status}. ${advice}`);
}
export async function readJsonResponse(response,{method='GET',labels={}}={}){
 let result;
 try{const text=await response.text();if(!text.trim())throw new Error('empty');result=JSON.parse(text);}
 catch{throw responseFailure(response,method);}
 if(!response.ok){const code=result?.error;throw new Error(labels[code]??(typeof code==='string'?code.replaceAll('_',' '):`Request failed (HTTP ${response.status}). Please try again later.`));}
 return result;
}
export async function requestJson(path,options={},labels={}){
 const method=options.method??'GET';let response;
 try{response=await fetch(path,options);}catch(error){
  if(error?.name==='AbortError')throw error;
  const advice=['GET','HEAD'].includes(method.toUpperCase())?'Check your connection and reload.':'Reload your life and check whether the action saved before trying again.';
  throw new Error(`The connection to VALOR was interrupted. ${advice}`);
 }
 return readJsonResponse(response,{method,labels});
}
