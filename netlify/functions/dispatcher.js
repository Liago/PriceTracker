const { createClient } = require('@supabase/supabase-js');
const { enqueueDueChecks } = require('../../server/services/priceTracker');
module.exports.handler = async () => {
	try {
		const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
		return { statusCode: 200, body: JSON.stringify(await enqueueDueChecks({ client })) };
	} catch (error) {
		console.error('[Dispatcher]', error.message);
		return { statusCode: 500, body: JSON.stringify({ error: 'Accodamento non completato' }) };
	}
};
