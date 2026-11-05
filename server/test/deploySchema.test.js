import {describe,it,expect,vi} from 'vitest';
import schema from '../../scripts/check-tracking-schema.js';
describe('deployment schema preflight',()=>{
 const env={NETLIFY:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test'};
 it('blocks deployment if required database migration is missing',async()=>{
  await expect(schema.checkTrackingSchema(env,async()=>({ok:false}))).rejects.toThrow('012_tracking_reliability.sql');
 });
 it('allows compatible databases',async()=>{await expect(schema.checkTrackingSchema(env,async()=>({ok:true,json:async()=>12}))).resolves.toBeUndefined()});
 it('does not require production credentials for a local build',async()=>{const request=vi.fn();await schema.checkTrackingSchema({},request);expect(request).not.toHaveBeenCalled()});
});
