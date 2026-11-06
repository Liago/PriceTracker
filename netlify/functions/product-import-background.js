const { createClient } = require('@supabase/supabase-js');
const { processImport } = require('../../server/services/productImports');
const { readSignedEvent } = require('../../server/services/importDispatch');

module.exports.handler = async event => {
	const request = readSignedEvent(event);
	if (!request) return { statusCode: 401 };
	const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
	await processImport(client, request.id);
	return { statusCode: 200 };
};
