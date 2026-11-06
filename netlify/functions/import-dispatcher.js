const { createClient } = require('@supabase/supabase-js');
const { requireResult } = require('../../server/services/trackingRepository');
const { dispatchImport } = require('../../server/services/importDispatch');

module.exports.handler = async () => {
	const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
	const stale = new Date(Date.now() - 180000).toISOString();
	const jobs = requireResult(await client.from('product_import_jobs').select('id').or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stale})`).order('created_at').limit(10), 'Aggiunte in attesa');
	const results = await Promise.allSettled(jobs.map(job => dispatchImport(job.id)));
	for (const result of results) if (result.status === 'rejected') console.warn('[Import dispatch]', result.reason.message);
	return { statusCode: 200, body: JSON.stringify({ dispatched: results.filter(r => r.status === 'fulfilled').length }) };
};
