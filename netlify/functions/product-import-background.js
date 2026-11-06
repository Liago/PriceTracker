const { createClient } = require('@supabase/supabase-js');
const { processImport } = require('../../server/services/productImports');
const { verifyInvocation } = require('../../server/services/importDispatch');

module.exports.handler = async event => {
	const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
	const request = verifyInvocation(body, event.headers?.['x-import-signature']);
	if (event.httpMethod !== 'POST' || !request) return { statusCode: 401 };
	const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
	await processImport(client, request.id);
	return { statusCode: 200 };
};
