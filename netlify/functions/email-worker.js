const { createClient } = require('@supabase/supabase-js');
const { deliverEmails } = require('../../server/services/emailOutbox');
module.exports.handler = async () => {
	try {
		const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
		return { statusCode: 200, body: JSON.stringify(await deliverEmails(client)) };
	} catch (error) { console.error('[Email worker]', error.message); return { statusCode: 500, body: JSON.stringify({ error: 'Consegna email non completata' }) }; }
};
