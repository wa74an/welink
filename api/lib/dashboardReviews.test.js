import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {validateReview,listReviews,saveReview}=require('./dashboardReviews');
describe('saved dashboard reviews',()=>{
 it('rejects arbitrary storage paths, invalid decisions and HTML in names',()=>{expect(validateReview({contract_id:'../private',disposition:null,english_name:'Name'}).error).toBeTruthy();expect(validateReview({contract_id:1,disposition:'paid',english_name:'Name'}).error).toBeTruthy();expect(validateReview({contract_id:1,disposition:null,english_name:'<script>'}).error).toBeTruthy()});
 it('saves only against an existing contract and one object per ID',async()=>{const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>[{id:42}]}).mockResolvedValueOnce({ok:true});const r=await saveReview('https://example.test',{}, {contract_id:42,disposition:'excluded',english_name:'Noor'},fetcher);expect(r.status).toBe(200);expect(fetcher.mock.calls[1][0].endsWith('/dashboard-reviews/42.json')).toBe(true);expect(JSON.parse(fetcher.mock.calls[1][1].body).english_name).toBe('Noor')});
 it('returns not found without writing when the contract does not exist',async()=>{const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>[]});expect((await saveReview('https://example.test',{}, {contract_id:42,disposition:null,english_name:''},fetcher)).status).toBe(404);expect(fetcher).toHaveBeenCalledTimes(1)});
 it('fails closed when a saved decision cannot be loaded',async()=>{const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>[{name:'42.json'}]}).mockResolvedValueOnce({ok:false});await expect(listReviews('https://example.test',{},fetcher)).rejects.toThrow('Could not read a saved earnings review')});
});

describe('workspace preferences',()=>{
 it('uses explicit defaults only when the preferences object is missing',async()=>{const {readSettings}=require('./dashboardReviews');expect(await readSettings('https://example.test',{},async()=>({status:400,ok:false,json:async()=>({statusCode:'404'})}))).toEqual({display_name:'Mentor',timezone:'Asia/Kuwait'})});
 it('validates the name and timezone before saving',()=>{const {validateSettings}=require('./dashboardReviews');expect(validateSettings({display_name:'<b>Mentor</b>',timezone:'Asia/Kuwait'}).error).toBeTruthy();expect(validateSettings({display_name:'Mentor',timezone:'unknown'}).error).toBeTruthy();expect(validateSettings({display_name:'Mentor',timezone:'Europe/London'}).value.timezone).toBe('Europe/London')});
});
