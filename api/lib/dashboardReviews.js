const BUCKET='guarantor-contracts';
const PREFIX='dashboard-reviews';
const idString=value=>/^[1-9]\d*$/.test(String(value))?String(value):null;
function validateReview(body){
 const id=idString(body.contract_id);
 if(!id)return {error:'Invalid contract'};
 if(![null,'included','excluded'].includes(body.disposition))return {error:'Invalid earnings decision'};
 if(typeof body.english_name!=='string'||body.english_name.length>240||/[\x00-\x1f<>]/.test(body.english_name))return {error:'Enter a valid English display name (up to 240 characters)'};
 return {id,value:{disposition:body.disposition,english_name:body.english_name.trim(),updated_at:new Date().toISOString()}};
}
async function listReviews(url,headers,fetcher=fetch){
 const objects=[];
 for(let offset=0;;offset+=1000){
  const res=await fetcher(`${url}/storage/v1/object/list/${BUCKET}`,{method:'POST',headers,body:JSON.stringify({prefix:PREFIX,limit:1000,offset,sortBy:{column:'name',order:'asc'}})});
  if(!res.ok)throw new Error('Could not read saved earnings reviews');
  const page=await res.json();if(!Array.isArray(page))throw new Error('Invalid review listing');
  objects.push(...page.filter(o=>/^\d+\.json$/.test(o.name)));if(page.length<1000)break;
 }
 const result={};
 // Small batches avoid overwhelming storage when there are many reviewed contracts.
 for(let i=0;i<objects.length;i+=12)await Promise.all(objects.slice(i,i+12).map(async obj=>{
  const res=await fetcher(`${url}/storage/v1/object/authenticated/${BUCKET}/${PREFIX}/${obj.name}`,{headers});
  if(!res.ok)throw new Error('Could not read a saved earnings review');
  const value=await res.json();const checked=validateReview({contract_id:obj.name.slice(0,-5),...value});
  if(checked.error)throw new Error('Invalid saved earnings review');result[checked.id]={disposition:value.disposition,english_name:value.english_name,updated_at:value.updated_at};
 }));return result;
}
async function saveReview(url,headers,body,fetcher=fetch){
 const parsed=validateReview(body);if(parsed.error)return {status:400,body:{error:parsed.error}};
 const exists=await fetcher(`${url}/rest/v1/guarantor_contracts?id=eq.${parsed.id}&select=id`,{headers});
 if(!exists.ok)throw new Error('Could not verify contract');
 const rows=await exists.json();if(!rows.length)return {status:404,body:{error:'Contract not found'}};
 const res=await fetcher(`${url}/storage/v1/object/${BUCKET}/${PREFIX}/${parsed.id}.json`,{method:'POST',headers:{...headers,'x-upsert':'true','cache-control':'no-store'},body:JSON.stringify(parsed.value)});
 if(!res.ok)throw new Error('Could not save earnings review');
 return {status:200,body:parsed.value};
}
module.exports={validateReview,listReviews,saveReview};
