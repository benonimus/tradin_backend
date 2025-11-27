# Crypto Trading Backend

A comprehensive backend API for a crypto trading platform. Features user authentication, balance management, asset tracking, trading functionality, real-time market data, and advanced price manipulation capabilities. Built with Node.js, Express, and MongoDB (Mongoose).

**Highlights (new/updated features)**
- JWT authentication with configurable expiration (`JWT_EXPIRES_IN`)
- Rate limiting on auth endpoints to mitigate brute-force attacks
- Deposit/withdraw endpoints with transaction records
- Per-user assets with `averagePrice` tracking and portfolio summary
- Buy/sell trades with fee calculation, gain/loss reporting
- Market klines endpoint returning OHLCV data with ISO timestamps
- **NEW:** Price manipulation system for simulating market movements
- **NEW:** Real-time price updates with API integration
- **NEW:** Advanced portfolio analytics and performance tracking
- **NEW:** Trading Analyst Agent for automated strategy generation

**Requirements**
- Node.js >= 16
- npm
- MongoDB (local or hosted)

**Installation**

1. Clone the repo and install dependencies:

```powershell
cd C:\Users\user\Documents\dev\tradin_backend
npm install
```

2. Create a `.env` file in the project root with the following variables (required):

```
MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/dbname?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
FRONTEND_ORIGIN=http://localhost:8080
PORT=5000
```

3. Start the server:

```powershell
npm start
# or for development with auto-reload
npm run dev
```

The server listens on the port defined in `PORT` (default `5000`).

**Scripts**
- `npm start` — run `node server.js`
- `npm run dev` — run `nodemon server.js` (requires `nodemon`)

**API Endpoints (detailed)**

**Authentication**
- `POST /api/auth/register` — register new user
  - Body (JSON): `{ "username": "alice", "email": "alice@example.com", "password": "secret", "isAdmin": false }`
  - Response (201):
    ```json
    {
      "token": "<jwt>",
      "user": { "id": "<id>", "username": "alice", "email": "alice@example.com", "isAdmin": false }
    }
    ```
  - Errors: 400 (invalid input, email exists), 500 (server error)
  - Note: `isAdmin` field is optional (defaults to false). Admin creation is restricted for security.

- `POST /api/auth/login` — login
  - Body (JSON): `{ "email": "alice@example.com", "password": "secret" }`
  - Response (200):
    ```json
    {
      "token": "<jwt>",
      "user": { "id": "<id>", "username": "alice", "email": "alice@example.com" }
    }
    ```
  - Errors: 400 (invalid input), 401 (invalid credentials), 404 (user not found)

- `GET /api/auth/me` — get current user (auth required)
  - Header: `Authorization: Bearer <token>`
  - Response (200):
    ```json
    { "user": { "id": "<id>", "username": "alice", "email": "alice@example.com", "createdAt": "ISO8601" } }
    ```

**Balance & Transactions**
- `GET /api/balance` — get user balance (auth required)
  - Response (200):
    ```json
    { "balance": 5000.5, "currency": "USD", "availableBalance": 5000.5, "lockedBalance": 0 }
    ```

- `POST /api/balance/deposit` — deposit funds
  - Body: `{ "amount": 1000.0 }`
  - Response (201):
    ```json
    { "success": true, "newBalance": 6000.5, "transactionId": "<id>", "timestamp": "ISO8601" }
    ```
  - Errors: 400 (invalid amount), 401 (unauthorized), 500 (server error)

- `POST /api/balance/withdraw` — withdraw funds
  - Body: `{ "amount": 500.0 }`
  - Response (201):
    ```json
    { "success": true, "newBalance": 5500.5, "transactionId": "<id>", "timestamp": "ISO8601" }
    ```
  - Errors: 400 (invalid amount), 422 (insufficient balance), 401, 500

**Assets / Trading**
- `GET /api/trade` — list user's assets + portfolio summary (auth required)
  - Response (200):
    ```json
    {
      "assets": [
        { "symbol":"BTC","quantity":0.5,"averagePrice":45000,"currentPrice":45000,"totalValue":22500,"unrealizedGain":0 }
      ],
      "portfolioValue":22500,
      "totalInvested":22500,
      "totalGain":0
    }
    ```

- `POST /api/trade/buy` — buy crypto
  - Body: `{ "crypto": "BTC", "amount": 0.1, "price": 47000 }`
  - Response (201):
    ```json
    {
      "success": true,
      "tradeId": "<id>",
      "symbol": "BTC",
      "quantity": 0.1,
      "price": 47000,
      "totalCost": 4700,
      "fee": 47,
      "timestamp": "ISO8601",
      "newBalance": 5300.5
    }
    ```
  - Errors: 400 (invalid input), 422 (insufficient funds), 401, 500

- `POST /api/trade/sell` — sell crypto
  - Body: `{ "crypto": "BTC", "amount": 0.05, "price": 47500 }`
  - Response (201):
    ```json
    {
      "success": true,
      "tradeId": "<id>",
      "symbol": "BTC",
      "quantity": 0.05,
      "price": 47500,
      "totalProceeds": 2375,
      "fee": 23.75,
      "netProceeds": 2351.25,
      "timestamp": "ISO8601",
      "newBalance": 5651.5,
      "gainLoss": 50
    }
    ```
  - Errors: 400 (invalid input), 422 (insufficient holdings), 401, 500

**Market Data / Charts**
- `GET /api/charts/klines` — fetch candlestick (OHLCV) data from Binance (no auth required)
  - Query parameters:
    - `symbol` (required, e.g. `BTCUSDT`)
    - `interval` (required: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w`)
    - `limit` (optional, default 100)
  - Response (200):
    ```json
    {
      "symbol":"BTCUSDT",
      "interval":"1h",
      "data":[
        { "time":1703001600, "timestamp":"2024-02-18T00:00:00.000Z", "open":46800, "high":47200, "low":46700, "close":47100, "volume":2500 },
        ...
      ]
    }
    ```

**Real-time Price Updates (WebSocket)**

To receive real-time price updates, connect to the WebSocket server.

- **URL**: `ws://<server-address>` (e.g., `ws://localhost:5000`)
- **Functionality**: The server broadcasts price updates for all tracked symbols at the interval defined by `PRICE_UPDATE_INTERVAL_MS`.
- **Message Format**: Each message is a JSON string representing an array of updated price objects.

**Example Message:**
```json
[
  {
    "_id": "63a0c6a0b8f0b8f0b8f0b8f0",
    "symbol": "BTCUSDT",
    "price": 40021.5,
    "updatedAt": "2025-11-27T18:00:00.000Z",
    "manipulation": {
      "isActive": false
    }
  },
  {
    "_id": "63a0c6a0b8f0b8f0b8f0b8f1",
    "symbol": "ETHUSDT",
    "price": 2501.7,
    "updatedAt": "2025-11-27T18:00:00.000Z",
    "manipulation": {
      "isActive": false
    }
  }
]
```

**Chart API Manipulation**

- **What changed:** The `/api/charts/klines` endpoint now properly integrates with the internal price manipulation system. Symbol inputs are normalized (accepts `BTCUSDT` or `BTC/USDT`), and the route applies safe fallbacks when manipulation fields are missing or malformed.
- **Expected manipulation fields (stored on `MarketPrice`):** `startTime`, `endTime`, `endValue`, `originalPrice`, `isActive`.
- **Behavior:**
  - If a manipulation is active and the current time is within the manipulation window, the endpoint computes the manipulation progress and scales the returned OHLCV candles so the chart smoothly leads to the current manipulated price.
  - If fields like `originalPrice` or `endValue` are missing, the code falls back to the stored `MarketPrice.price` or the last candle's close price to avoid NaNs and unexpected behavior.
  - The endpoint accepts both Date strings and numeric timestamps for `startTime`/`endTime`.

- **Example request:**

```bash
curl -X GET "http://localhost:5000/api/charts/klines?symbol=BTCUSDT&interval=15m&limit=100"
```

- **How to set a manipulation (admin/demo):** POST to `/api/prices/manipulate` with body like:

```json
{
  "symbol": "BTCUSDT",
  "startTime": "2025-11-27T18:00:00.000Z",
  "endTime": "2025-11-27T18:10:00.000Z",
  "endValue": 50000
}
```

- **Troubleshooting:**
  - If charts don't reflect manipulation, ensure the `MarketPrice` document for the symbol contains a `manipulation` object and `isActive: true`.
  - Check server logs; the charts route now logs normalized symbols and manipulation progress to help debug timing/values.


**Price Management (NEW)**
- `GET /api/prices` — get current market prices for all symbols (no auth required)
  - Response (200):
    ```json
    {
      "prices": [
        {
          "symbol": "BTC",
          "price": 45000.50,
          "updatedAt": "2024-01-15T10:30:00.000Z",
          "manipulation": {
            "isActive": false
          }
        },
        ...
      ]
    }
    ```

- `POST /api/prices/manipulate` — set price manipulation for a symbol (admin/demo use)
  - Body (JSON): `{ "symbol": "BTC", "startTime": "2024-01-15T10:35:00.000Z", "endTime": "2024-01-15T10:40:00.000Z", "endValue": 50000 }`
  - Response (200):
    ```json
    {
      "message": "Price manipulation set successfully",
      "manipulation": {
        "startTime": "2024-01-15T10:35:00.000Z",
        "endTime": "2024-01-15T10:40:00.000Z",
        "endValue": 50000,
        "originalPrice": 45000.50,
        "isActive": true
      }
    }
    ```

**Examples (curl)**

Register:
```bash
curl -X POST http://localhost:5000/api/auth/register \\
  -H "Content-Type: application/json" \\ 
  -d '{"username":"alice","email":"alice@example.com","password":"secret"}'
```

Login:
```bash
curl -X POST http://localhost:5000/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"alice@example.com","password":"secret"}'
```

Buy (authenticated):
```bash
curl -X POST http://localhost:5000/api/trade/buy \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <token>" \\
  -d '{"crypto":"BTC","amount":0.01,"price":30000}'
```

Klines:
```bash
curl -X GET "http://localhost:5000/api/charts/klines?symbol=BTCUSDT&interval=15m&limit=100"
```

**Price Updater**

- **Purpose:** Background service that simulates live market prices for a small set of coins and persists them in the database.
- **Algorithm:** A simple random-walk (small percent change per tick) that updates each symbol's `price` and `updatedAt`.
- **Endpoint:** `GET /api/prices` — returns the current stored market prices.
- **Default symbols seeded:** `BTC`, `ETH`, `LTC` with reasonable starting prices.
- **Configuration (env vars):**
  - `PRICE_UPDATE_INTERVAL_MS` — update interval in milliseconds (default `10000` — 10s).
  - `PRICE_VOLATILITY` — max percentage move per tick (default `0.02` — 2%).

This updater is intended for demo/testing and not for production price feeds. To use real market prices, replace the service logic with a connector to a market data provider.

**Trading Analyst Agent**

Develops trading strategies based on market analysis and user preferences. Identifies optimal execution and generates actionable trading insights. This directory contains the trading analyst agent, responsible for proposing and executing trading strategies. The agent leverages large language models to analyze financial data and user-defined risk tolerance/investment horizons. The core logic in prompt.py ensures market data availability before generating at least five distinct, detailed trading strategies. agent.py defines the agent's responsibility for identifying optimal execution strategies, while __init__.py integrates analytical tools to provide actionable insights.

**Security & Operational Notes**
- Passwords are hashed with `bcryptjs` and JWTs are signed with `JWT_SECRET`.
- Auth endpoints use rate limiting to reduce brute-force attempts. 
- Authorization: all balance/asset/trade endpoints require a Bearer token and only operate on the authenticated user's data.
- Fees are currently a simple 1% placeholder. Replace with your desired fee model.
- Portfolio values use the stored `averagePrice` as a proxy for `currentPrice`. For live valuations, integrate a market price lookup when computing portfolio summaries.

**Testing Checklist**
- [ ] User registration with validation
- [ ] User login with correct credentials
- [ ] User login with wrong credentials
- [ ] Token authentication on protected routes
- [ ] Deposit funds
- [ ] Withdraw funds (with sufficient balance)
- [ ] Withdraw funds (insufficient balance)
- [ ] Buy crypto (with sufficient balance)
- [ ] Buy crypto (insufficient balance)
- [ ] Sell crypto (with holdings)
- [ ] Sell crypto (insufficient holdings)
- [ ] Get user assets
- [ ] Get market data/klines
- [ ] All endpoints return proper error codes

**Next steps / Recommendations**
- Add integration tests (supertest / jest) for the endpoints.
- Add a `LICENSE` file and update `package.json` author/repo fields.
- Add stricter request validation (e.g., Joi) and centralized error handling.
- Add live-market price lookups for accurate portfolio valuations.

**License**
This project is currently set to `MIT` in `package.json`. Add a `LICENSE` file to confirm.

If you'd like, I can run the server now and capture runtime output or add tests for core endpoints.

#   t r a d i n _ b a c k e n d 
 
 #   a p e x _ b a c k e n d 
 
 