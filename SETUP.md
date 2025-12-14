# Environment Setup Guide

This guide explains how to set up the environment variables for the PriceTracker application.

## 🔐 Security Notice

**IMPORTANT**: Never commit `.env` files to git! These files contain sensitive credentials and API keys.

The `.env` files are already added to `.gitignore` to prevent accidental commits.

## 📋 Required Setup Steps

### 1. Server Environment Variables

Copy the example file and fill in your values:

```bash
cp server/.env.example server/.env
```

Then edit `server/.env` with your actual values:

```env
# Server Configuration
PORT=3000

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-here

# Price Tracking Configuration
PRICE_CHECK_INTERVAL=6      # Hours between automatic price checks
SCRAPE_DELAY=2000           # Milliseconds between scraping requests
MAX_RETRIES=1               # Max retries for failed requests
```

### 2. Client Environment Variables

Copy the example file and fill in your values:

```bash
cp client/.env.example client/.env
```

Then edit `client/.env` with your actual values:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_KEY=your-supabase-anon-public-key-here
```

## 🔑 Getting Supabase Credentials

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. You'll find:
   - **Project URL**: Use this for `SUPABASE_URL` and `VITE_SUPABASE_URL`
   - **anon/public key**: Use this for `SUPABASE_KEY` and `VITE_SUPABASE_KEY`
   - **service_role key**: Use this for `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep this secret!)

## ⚠️ Important Security Notes

### Service Role Key

The `SUPABASE_SERVICE_ROLE_KEY` is **extremely sensitive** and should:
- ✅ Only be used in server-side code
- ✅ Never be exposed to the client
- ✅ Never be committed to git
- ✅ Be rotated periodically
- ❌ Never be shared publicly

### Environment Variables Validation

The server automatically validates all required environment variables on startup. If any are missing or invalid, the server will:
1. Display a clear error message
2. Refuse to start
3. Indicate which variables need attention

This fail-fast approach prevents runtime errors due to misconfiguration.

## 🧪 Testing Your Setup

After creating your `.env` files, test the setup:

### Server
```bash
cd server
npm install
npm start
```

You should see:
```
✅ Environment variables validated successfully
[Server] Price tracking cron scheduled: * * * * * (every minute)
Server is running on port 3000
```

### Client
```bash
cd client
npm install
npm run dev
```

The client should start without errors and connect to Supabase.

## 🔧 Troubleshooting

### "Missing required environment variable" error

**Problem**: The server shows an error about missing environment variables.

**Solution**:
1. Make sure you created the `.env` file in the `server/` directory
2. Check that all required variables are present
3. Verify there are no typos in variable names
4. Ensure values are not empty

### "Invalid value for SUPABASE_URL" error

**Problem**: The SUPABASE_URL validation failed.

**Solution**:
- Make sure the URL starts with `https://`
- Check that you copied the full URL from Supabase dashboard
- Example format: `https://abcdefghijklmnop.supabase.co`

### Client can't connect to Supabase

**Problem**: The client shows authentication or connection errors.

**Solution**:
1. Verify `client/.env` exists and contains the correct values
2. Check that `VITE_SUPABASE_URL` matches your Supabase project URL
3. Verify `VITE_SUPABASE_KEY` is the anon/public key (not the service role key!)
4. Restart the Vite dev server after changing `.env` values

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Environment Variables Best Practices](https://12factor.net/config)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)

## 🆘 Need Help?

If you're still having issues after following this guide:
1. Check the [main README](./README.md) for general setup instructions
2. Review the error messages carefully - they usually indicate what's wrong
3. Open an issue on GitHub with details about your problem
