import { describe,it,expect,vi } from 'vitest';
import routes from '../../api/routes.js';
function setup(scraped,{writeError=false}={}){
 const handlers={},rpc=vi.fn(async(name)=>({data:{id:'new-product'},error:writeError?{message:'transaction failed'}:null}));
 const chain={select:()=>chain,eq:()=>chain,then:resolve=>resolve({data:[],error:null})};
 const client={auth:{getUser:async()=>({data:{user:{id:'user-1'}}})},from:()=>chain,rpc};
 routes.registerRoutes({getClient:()=>client,scrapeImpl:async()=>scraped,checkUrlImpl:async url=>({allowed:true,url})})({use:()=>{},post:(path,handler)=>handlers[path]=handler,get:()=>{}});
 const res={statusCode:200,status(code){this.statusCode=code;return this},json(payload){this.payload=payload;return this}};
 return {handler:handlers['/products'],rpc,res,req:{headers:{authorization:'Bearer token'},body:{url:'https://shop.example/item'}}};
}
describe('initial product validation',()=>{
 it('never persists an ambiguous first price as healthy',async()=>{
  const ctx=setup({price:79.99,confidence:.35,currency:'EUR'});await ctx.handler(ctx.req,ctx.res);expect(ctx.res.statusCode).toBe(422);expect(ctx.rpc).not.toHaveBeenCalled();
 });
 it('requires corroborated confidence before starting a price history',async()=>{
  const ctx=setup({price:99,confidence:.70,currency:'EUR'});await ctx.handler(ctx.req,ctx.res);expect(ctx.res.statusCode).toBe(422);expect(ctx.rpc).not.toHaveBeenCalled();
 });
 it('rejects incomplete results even when they contain a number',async()=>{
  const ctx=setup({price:99,confidence:.95,debug:{degraded:'budget_esaurito'}});await ctx.handler(ctx.req,ctx.res);expect(ctx.res.statusCode).toBe(504);expect(ctx.rpc).not.toHaveBeenCalled();
 });
 it('writes a trusted initial reading through one atomic RPC',async()=>{
  const ctx=setup({price:99,confidence:.95,currency:'EUR'});await ctx.handler(ctx.req,ctx.res);expect(ctx.res.statusCode).toBe(201);expect(ctx.rpc).toHaveBeenCalledWith('create_tracked_product',expect.objectContaining({p_product:expect.objectContaining({current_price:99})}));
 });
 it('does not report success when persistence fails',async()=>{
  const ctx=setup({price:99,confidence:.95,currency:'EUR'},{writeError:true});await ctx.handler(ctx.req,ctx.res);expect(ctx.res.statusCode).toBe(500);
 });
});
