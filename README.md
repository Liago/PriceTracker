# Price Tracker

A full-stack web application that tracks product prices from various online stores. Monitor price changes, set up alerts, and never miss a deal.

## Features

- **Product Tracking**: Add products by URL and automatically scrape product information
- **Price Monitoring**: Track price changes over time with automatic updates
- **User Authentication**: Secure sign-up and login with Supabase
- **Dashboard**: View all tracked products in one place
- **Product Details**: See detailed price history and trends for each product
- **Real-time Data**: Powered by Supabase for real-time database synchronization

## Tech Stack

### Frontend
- **React 19** - Modern UI library
- **Vite** - Fast build tool and dev server
- **React Router** - Client-side routing
- **TailwindCSS** - Utility-first styling
- **React Query** - Server state management
- **Supabase** - Authentication and database
- **Lucide React** - Icon library

### Backend
- **Node.js & Express** - Server framework
- **Puppeteer** - Web scraping engine
- **Supabase** - Database and authentication
- **CORS** - Cross-origin resource sharing

## Project Structure

```
PriceTracker/
├── client/          # React frontend application
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components (Dashboard, Login, etc.)
│   │   ├── context/      # React context (Auth)
│   │   ├── lib/          # Utility functions and API calls
│   │   └── App.jsx       # Main app component
│   └── package.json
│
└── server/          # Express backend API
    ├── index.js     # Main server file with scraping logic
    └── package.json
```

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Supabase account (free tier available)

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd PriceTracker
```

### 2. Install dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 3. Environment Setup

Create `.env` files in both `client` and `server` directories:

**server/.env:**
```env
PORT=3000
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

**client/.env:**
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_URL=http://localhost:3000
```

> [!CAUTION]
> **Refusal to leak secrets**: Never add the `SUPABASE_SERVICE_ROLE_KEY` to the client-side `.env` file or any `VITE_*` variable. It bypasses all RLS policies and gives full administrative access to your database. Use it ONLY in the server environment.

### 4. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Get your project URL and anon key from Project Settings > API
3. Set up your database schema (you'll need tables for users and products)

## Running the Application

### Development Mode

**Start the backend server:**
```bash
cd server
npm run dev
```
Server runs on `http://localhost:3000`

**Start the frontend development server:**
```bash
cd client
npm run dev
```
Client runs on `http://localhost:5173` (or next available port)

### Production Build

**Build the frontend:**
```bash
cd client
npm run build
```

**Start the backend:**
```bash
cd server
npm start
```

## API Endpoints

### POST `/api/scrape`
Scrapes product information from a given URL.

**Request body:**
```json
{
  "url": "https://example.com/product"
}
```

**Response:**
```json
{
  "title": "Product Name",
  "image": "https://example.com/image.jpg",
  "description": "Product description",
  "price": "99.99",
  "currency": "EUR"
}
```

## Usage

1. **Sign Up / Login**: Create an account or log in to your existing account
2. **Add Product**: Click "Add Product" and paste the URL of the product you want to track
3. **View Dashboard**: See all your tracked products with current prices
4. **Check Details**: Click on any product to view its price history and trends

## Supported Websites

The scraper uses generic selectors and Open Graph meta tags to extract product information. It works best with e-commerce sites that follow standard meta tag conventions.

## Development

### Code Style
- ESLint configured for React
- Follow existing code patterns
- Use functional components with hooks

### Adding New Features
1. Create feature branch from main
2. Implement changes in appropriate directory (client/server)
3. Test thoroughly
4. Submit pull request

## Troubleshooting

### Puppeteer Issues
If you encounter Puppeteer installation issues:
```bash
# Linux dependencies
sudo apt-get install -y chromium-browser

# Or use Chrome instead
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

### Port Already in Use
Change the port in `server/.env`:
```env
PORT=3001
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Acknowledgments

- Built with React, Vite, and Express
- Web scraping powered by Puppeteer
- Database and auth by Supabase
