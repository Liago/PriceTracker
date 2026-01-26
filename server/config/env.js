const { cleanEnv, str, email, url, port } = require('envalid');
const dotenv = require('dotenv');

// Load .env file
dotenv.config();

const env = cleanEnv(process.env, {
	PORT: port({ default: 3000 }),
	SUPABASE_URL: url({ desc: 'The Supabase project URL' }),
	SUPABASE_SERVICE_ROLE_KEY: str({ desc: 'The Supabase service role key' }),

	// Email configuration
	// Email configuration (Optional - will simulate if missing)
	EMAIL_USER: email({ default: '', desc: 'Email address for sending notifications' }),
	EMAIL_PASS: str({ default: '', desc: 'Password or App Password for the email account' }),

	// Client URL for CORS
	CLIENT_URL: url({ default: 'http://localhost:5173', desc: 'The frontend client URL' }),
});

module.exports = env;
