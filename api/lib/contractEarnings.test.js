import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const E=require('../../assets/dashboard-core');
const record=(id,overrides={})=>({sourceRow:id,tenant_name:'Tenant Person',guarantor_name:'Parent Person',rent_amount_gbp:'1200',period:'2026-10-01 → 2027-09-30',generated_by:'Mentor',date:'2026-11-03',...overrides});
describe('guarantor earnings',()=>{
 it('uses each exact threshold including pence, without inventing an upper band',()=>{expect([0,1199.99,1200,1599.99,1600,1799.99,1800,2099.99,2100,2399.99,2400,2699.99,2700,-1,'',null].map(E.fee)).toEqual([300,300,350,350,400,400,450,450,500,500,600,600,null,null,null,null])});
 it('counts a corrected contract once using its first generation month',()=>{const rows=E.prepare([record(2,{rent_amount_gbp:'1600'}),record(1,{date:'2026-10-30'})]);const t=E.totals(rows,'2026-10','2026-11-03');expect(t.monthly).toBe(400);expect(t.ytd).toBe(400);expect(t.included).toHaveLength(1)});
 it('does not double count an explicitly selected older duplicate',()=>{const rows=E.prepare([record(2),record(1)]);expect(E.totals(rows,'2026-11','2026-11-03',{1:'included'}).included).toHaveLength(1)});
 it('holds tests, overlapping agreements and invalid terms outside the totals',()=>{const rows=E.prepare([record(1,{generated_by:'SYSTEM TEST'}),record(2),record(3,{period:'2026-10-02 → 2027-10-01'}),record(4,{tenant_name:'Another',period:'2026-10-10 → 2026-10-01'})]);expect(E.totals(rows,'2026-11','2026-11-03').ytd).toBe(0);expect(rows.map(r=>r.disposition)).toEqual(['test','review-overlap','review-overlap','review-term'])});
 it('keeps prior years and future generation dates out of YTD and monthly totals',()=>{const rows=E.prepare([record(1,{tenant_name:'Prior',date:'2025-11-03'}),record(2,{tenant_name:'Future',date:'2026-11-04'}),record(3)]);const t=E.totals(rows,'2026-11','2026-11-03');expect(t.ytd).toBe(350);expect(t.monthly).toBe(350)});
});
