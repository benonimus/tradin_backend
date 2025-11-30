# Trading Backend Platform

This is the backend service for a real-time cryptocurrency trading simulation platform. It provides user authentication, portfolio management, real-time price data via WebSockets, and a RESTful API for trading, fetching chart data, and managing user balances.

A unique feature of this platform is the ability for an administrator to simulate market manipulation events for specific assets, providing a controlled environment to observe market dynamics.

## Features

- **User Authentication**: Secure user registration and login using JWT (JSON Web Tokens).
- **Real-time Price Updates**: Broadcasts live cryptocurrency prices to connected clients using WebSockets.
- **Price Feeds**: Utilizes the official Binance API for both real-time and historical cryptocurrency price data.
- **Cryptocurrency Trading**: API endpoints for buying and selling assets.
- **Portfolio & Balance Management**: Tracks user-owned assets, average buy price, and available USD balance.
- **Transaction History**: Logs all deposits, withdrawals, and trades.
- **Candlestick Chart Data**: Provides historical OHLCV (Open, High, Low, Close, Volume) data for charting libraries.
- **Admin Price Manipulation**: A special, admin-only feature to programmatically manipulate the price of an asset over a set duration.

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Real-time Communication**: WebSocket (`ws` library)
- **Authentication**: JWT (`jsonwebtoken`), `bcryptjs` for password hashing.
- **HTTP Requests**: `axios` for interacting with the Binance REST API.
- **Environment Management**: `dotenv`

---

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MongoDB (local instance or a cloud service like MongoDB Atlas)

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd tradin_backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create a `.env` file** in the root of the project by copying the example below. This file will store your environment variables.

    ```dotenv
    # Server Configuration
    PORT=5000
    FRONTEND_ORIGIN=http://localhost:8080

    # MongoDB Connection
    MONGO_URI=mongodb://localhost:27017/trading_platform

    # JWT Authentication
    JWT_SECRET=your_super_secret_jwt_key
    JWT_EXPIRES_IN=7d

    # Price Service Configuration
    LCW_API_KEY=1b0809f9-08d7-4326-9446-4e2e34150f9a
    ```

4.  **Run the server:**
    ```bash
    npm start
    ```
    The server should now be running on `http://localhost:5000` (or the port you specified).

---

## API Endpoints

All endpoints are prefixed with `/api`. Authentication is required for most endpoints and is achieved by providing a JWT in the `Authorization: Bearer <token>` header.

### Auth (`/api/auth`)

- `POST /register`
  - **Description**: Registers a new user.
  - **Body**: `{ "username": "test", "email": "test@example.com", "password": "password123" }`
  - **Response**: `{ "token": "...", "user": { ... } }`
  - **Example Request**:
    ```bash
    curl -X POST http://localhost:5000/api/auth/register \
      -H "Content-Type: application/json" \
      -d '{"username": "test", "email": "test@example.com", "password": "password123"}'
    ```

- `POST /login`
  - **Description**: Logs in an existing user.
  - **Body**: `{ "email": "test@example.com", "password": "password123" }`
  - **Response**: `{ "token": "...", "user": { ... } }`
  - **Example Request**:
    ```bash
    curl -X POST http://localhost:5000/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email": "test@example.com", "password": "password123"}'
    ```

- `GET /me`
  - **Description**: Retrieves the profile of the currently authenticated user.
  - **Auth**: Required.
  - **Response**: `{ "user": { ... } }`
  - **Example Request**:
    ```bash
    curl -X GET http://localhost:5000/api/auth/me \
      -H "Authorization: Bearer YOUR_JWT_TOKEN"
    ```

### Prices (`/api/prices`)

- `GET /`
  - **Description**: Fetches the current market prices for all tracked symbols.
  - **Response**: `{ "prices": [ ... ], "canManipulate": boolean }`
  - **Example Request**:
    ```bash
    curl -X GET http://localhost:5000/api/prices
    ```

- `POST /manipulate`
  - **Description**: **(Admin Only)** Sets a price manipulation schedule for a symbol.
  - **Auth**: Required (User must be an admin).
  - **Body**: `{ "symbol": "BTCUSDT", "startTime": "ISO_DATE_STRING", "endTime": "ISO_DATE_STRING", "endValue": 65000 }`
  - **Response**: `{ "message": "...", "manipulation": { ... } }`
  - **Example Request**:
    ```bash
    curl -X POST http://localhost:5000/api/prices/manipulate \
      -H "Authorization: Bearer YOUR_JWT_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"symbol": "BTCUSDT", "startTime": "2023-10-01T00:00:00Z", "endTime": "2023-10-01T01:00:00Z", "endValue": 65000}'
    ```

### Charts (`/api/charts`)

- `GET /klines`
  - **Description**: Provides historical candlestick data for a given symbol.
  - **Query Params**:
    - `symbol` (required): e.g., `BTCUSDT`
    - `interval` (required): e.g., `1h`, `4h`, `1d`
    - `limit` (optional): Number of candles, defaults to 100.
  - **Response**: `{ "symbol": "...", "interval": "...", "data": [ { "time": UNIX_TS, "open": ..., ... } ] }`
  - **Example Request**:
    ```bash
    curl -X GET "http://localhost:5000/api/charts/klines?symbol=BTCUSDT&interval=1h&limit=50"
    ```

### Balance (`/api/balance`)

- `GET /`
  - **Description**: Gets the current user's USD balance.
  - **Auth**: Required.
  - **Response**: `{ "balance": 10000, "currency": "USD", ... }`
 
- `POST /deposit`
  - **Description**: Deposits funds into the user's account.
  - **Auth**: Required.
  - **Body**: `{ "amount": 500 }`
  - **Response**: `{ "success": true, "newBalance": 10500, ... }`

- `POST /withdraw`
  - **Description**: Withdraws funds from the user's account.
  - **Auth**: Required.
  - **Body**: `{ "amount": 100 }`
  - **Response**: `{ "success": true, "newBalance": 10400, ... }`

### Trade (`/api/trade`)

- `GET /`
  - **Description**: Lists all assets in the user's portfolio.
  - **Auth**: Required.
  - **Response**: `{ "assets": [ ... ], "portfolioValue": ..., ... }`
  - **Example Request**:
    ```bash
    curl -X GET http://localhost:5000/api/trade \
      -H "Authorization: Bearer YOUR_JWT_TOKEN"
    ```

- `POST /buy`
  - **Description**: Executes a buy order.
  - **Auth**: Required.
  - **Body**: `{ "symbol": "BTCUSDT", "amount": 0.1, "price": 40000 }`
  - **Response**: `{ "success": true, "tradeId": "...", ... }`
  - **Example Request**:
    ```bash
    curl -X POST http://localhost:5000/api/trade/buy \
      -H "Authorization: Bearer YOUR_JWT_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"symbol": "BTCUSDT", "amount": 0.1, "price": 40000}'
    ```

- `POST /sell`
  - **Description**: Executes a sell order.
  - **Auth**: Required.
  - **Body**: `{ "symbol": "BTCUSDT", "amount": 0.05, "price": 41000 }`
  - **Response**: `{ "success": true, "tradeId": "...", ... }`
  - **Example Request**:
    ```bash
    curl -X POST http://localhost:5000/api/trade/sell \
      -H "Authorization: Bearer YOUR_JWT_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"symbol": "BTCUSDT", "amount": 0.05, "price": 41000}'
    ```

---

## WebSocket Service

The server provides a WebSocket endpoint for real-time price updates.

- **URL**: `ws://localhost:5000` (or your configured server address)
- **Protocol**: `ws`

### Subscribing to Price Updates

Simply connect a WebSocket client to the server's root URL. Once connected, the server will automatically push an array of updated price objects at regular intervals.

**Example Message (Client Receives):**

```json
[
  {
    "_id": "62c4a1b1...",
    "symbol": "BTCUSDT",
    "price": 40015.72,
    "updatedAt": "2025-11-29T23:39:49.000Z",
    "manipulation": { ... }
  },
  {
    "_id": "62c4a1b2...",
    "symbol": "ETHUSDT",
    "price": 2501.18,
    "updatedAt": "2025-11-29T23:39:49.000Z",
    "manipulation": { ... }
  }
]
```