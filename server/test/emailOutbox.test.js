import {describe,it,expect,vi} from 'vitest';
import service from '../services/emailOutbox.js';
function client({disabled=false}={}){
 const updates=[];return {updates,rpc:async()=>({data:[{id:'event-1',notification_id:'note-1',user_id:'user-1',lease_id:'lease-1',attempts:1,payload:{product:{name:'Phone'},oldPrice:729,newPrice:699}}]}),
 auth:{admin:{getUserById:async()=>({data:{user:{email:'test@example.com'}}})}},
 from:table=>{const chain={select:()=>chain,update:p=>{updates.push(p);return chain},eq:()=>chain,maybeSingle:async()=>({data:{email_notifications:!disabled}}),then:resolve=>resolve({error:null})};return chain;}};
}
describe('recoverable email delivery',()=>{
 it('retries failed delivery instead of simulating success',async()=>{
  const db=client(),send=vi.fn().mockRejectedValue(new Error('SMTP unavailable'));await service.deliverEmails(db,{send});
  expect(db.updates[0]).toMatchObject({status:'pending',last_error:'SMTP unavailable'});expect(db.updates[0].run_after).toBeTruthy();
 });
 it('rechecks preferences before sending a queued email',async()=>{
  const db=client({disabled:true}),send=vi.fn();await service.deliverEmails(db,{send});expect(send).not.toHaveBeenCalled();expect(db.updates[0].status).toBe('skipped');
 });
 it('marks delivery only after the mail service accepts it',async()=>{
  const db=client(),send=vi.fn().mockResolvedValue({accepted:['test@example.com']});expect((await service.deliverEmails(db,{send})).sent).toBe(1);expect(db.updates[0].status).toBe('sent');
 });
});
