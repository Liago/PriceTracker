const { cleanEnv, str, email, url, port, num } = require('envalid');
const dotenv = require('dotenv');

// Load .env file
dotenv.config();

const env = cleanEnv(process.env, {
	PORT: port({ default: 3000 }),
	SUPABASE_URL: url({ desc: 'The Supabase project URL' }),
	SUPABASE_SERVICE_ROLE_KEY: str({ desc: 'The Supabase service role key' }),

	// Email configuration (Optional - will simulate if missing)
	EMAIL_USER: email({ default: '', desc: 'Email address for sending notifications' }),
	EMAIL_PASS: str({ default: '', desc: 'Password or App Password for the email account' }),

	// Client URL for CORS
	CLIENT_URL: url({ default: 'http://localhost:5173', desc: 'The frontend client URL' }),

	// Advanced Scraping Configuration
	PROXY_LIST: str({ default: '', desc: 'Comma-separated list of proxies (format: host:port or host:port:user:pass)' }),
	SCRAPER_MAX_RETRIES: num({ default: 3, desc: 'Maximum number of retry attempts for failed scrapes' }),
	SCRAPER_RETRY_DELAY: num({ default: 1000, desc: 'Base delay in ms for retry backoff' }),
});

module.exports = env;

