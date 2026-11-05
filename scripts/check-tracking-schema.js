/** Prevent an automatic deployment from switching to code whose database RPCs are missing. */
async function checkTrackingSchema(env = process.env, request = fetch) {
 if (!env.NETLIFY) return;
 const key=env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
 if (!env.SUPABASE_URL || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY richieste per verificare lo schema.');
 const response=await request(`${env.SUPABASE_URL}/rest/v1/rpc/tracking_schema_version`,{
  method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)
 });
 if (!response.ok || await response.json() !== 12) throw new Error('Prima del deploy applicare 012_tracking_reliability.sql: cd server && npm run migrate. Il deploy attuale resta utilizzabile.');
}
if (require.main === module) checkTrackingSchema().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={checkTrackingSchema};
