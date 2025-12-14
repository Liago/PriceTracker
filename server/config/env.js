/**
 * Environment Variables Validation Module
 *
 * This module validates that all required environment variables are present
 * and have valid values. It should be imported and called early in the
 * application startup to fail-fast if configuration is invalid.
 */

/**
 * List of required environment variables with their validation rules
 */
const requiredEnvVars = [
  {
    name: 'SUPABASE_URL',
    validator: (value) => value && value.startsWith('https://'),
    errorMessage: 'SUPABASE_URL must be a valid HTTPS URL'
  },
  {
    name: 'SUPABASE_KEY',
    validator: (value) => value && value.length > 20,
    errorMessage: 'SUPABASE_KEY must be a valid Supabase anon key'
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    validator: (value) => value && value.length > 20,
    errorMessage: 'SUPABASE_SERVICE_ROLE_KEY must be a valid Supabase service role key'
  }
];

/**
 * Optional environment variables with default values
 */
const optionalEnvVars = [
  { name: 'PORT', defaultValue: '3000' },
  { name: 'PRICE_CHECK_INTERVAL', defaultValue: '6' },
  { name: 'SCRAPE_DELAY', defaultValue: '2000' },
  { name: 'MAX_RETRIES', defaultValue: '1' }
];

/**
 * Validates all required environment variables
 * @throws {Error} If any required variable is missing or invalid
 */
function validateEnv() {
  const errors = [];

  // Check required variables
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar.name];

    if (!value) {
      errors.push(`Missing required environment variable: ${envVar.name}`);
    } else if (envVar.validator && !envVar.validator(value)) {
      errors.push(envVar.errorMessage || `Invalid value for ${envVar.name}`);
    }
  }

  // Set defaults for optional variables
  for (const envVar of optionalEnvVars) {
    if (!process.env[envVar.name]) {
      process.env[envVar.name] = envVar.defaultValue;
      console.log(`[Config] Using default value for ${envVar.name}: ${envVar.defaultValue}`);
    }
  }

  // If there are errors, throw and prevent application startup
  if (errors.length > 0) {
    const errorMessage = [
      '\n❌ Environment Configuration Error:',
      '',
      ...errors.map(err => `  • ${err}`),
      '',
      '💡 Please check your .env file and ensure all required variables are set.',
      '   You can use .env.example as a reference.',
      ''
    ].join('\n');

    throw new Error(errorMessage);
  }

  console.log('✅ Environment variables validated successfully');
}

/**
 * Gets a validated environment variable value
 * @param {string} name - The name of the environment variable
 * @returns {string} The value of the environment variable
 */
function getEnv(name) {
  return process.env[name];
}

/**
 * Gets a validated environment variable as a number
 * @param {string} name - The name of the environment variable
 * @returns {number} The numeric value of the environment variable
 */
function getEnvNumber(name) {
  const value = process.env[name];
  const num = parseInt(value, 10);

  if (isNaN(num)) {
    throw new Error(`Environment variable ${name} must be a valid number, got: ${value}`);
  }

  return num;
}

module.exports = {
  validateEnv,
  getEnv,
  getEnvNumber
};
