import {describe,it,expect,vi} from 'vitest';
import checker from '../services/productChecker.js';
const product={id:'p1',url:'https://swappie.com/it/modello/ipad-pro-6-2022-12.9/',current_price:689,currency:'EUR',sku:'TBAP90VD',consecutive_failures:1};
async function failure(extra){
 const error=Object.assign(new Error('SCRAPE_BUDGET_EXCEEDED'),{code:'SCRAPE_BUDGET_EXCEEDED',...extra});
 const commitCheck=vi.fn().mockResolvedValue({priceChanged:false,notified:false});
 const out=await checker.checkProduct({product,scrape:async()=>{throw error},repo:{getReference:async()=>({history:[],offer:{offer_key:'original',variant:{},sku:product.sku}}),commitCheck}});
 return {out,saved:commitCheck.mock.calls[0][0]};
}
describe('failure attribution and diagnostics',()=>{
 it('does not classify a failed browser budget as a confirmed website block',async()=>{
  const {out,saved}=await failure({reason:'budget_insufficiente',antiBotSuspected:true,tier:0,tier0Skipped:'bloccato_dal_sito_403',totalMs:800,evidence:{httpStatus:403}});
  expect(out.health).not.toBe('blocked');expect(out.reasons).toEqual(['budget_insufficiente']);
  expect(saved.run.result.diagnostics).toMatchObject({reason:'budget_insufficiente',tier:0,httpStatus:403,totalMs:800});
  expect(saved.patch).not.toHaveProperty('current_price');expect(saved.run.error_message).toContain('budget_insufficiente');
 });
 it('retains an actual challenge as a blocked reading',async()=>{
  const {out,saved}=await failure({reason:'pagina_di_sfida',tier:1,antiBotSuspected:true,evidence:{challengeType:'Cloudflare'}});
  expect(out.health).toBe('blocked');expect(saved.run.result.diagnostics.challengeType).toBe('Cloudflare');
 });
 it('a navigation timeout after an HTTP denial is still a timeout',async()=>{
  const {out}=await failure({reason:'navigazione_troncata',antiBotSuspected:true,tier:1});expect(out.health).not.toBe('blocked');
 });
});
