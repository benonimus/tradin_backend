const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const priceUpdater = require('./services/priceUpdater');
require('./models/ConditionalOrder'); // Ensures model is registered

// Load env vars
dotenv.config();

const app = express();

// Middleware
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

// Create HTTP and WebSocket servers
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.on('close', () => console.log('Client disconnected'));
});


// DB Connect
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB Connected'))
  .catch((err) => console.log(err));

// Start price updater once mongoose connection is open
mongoose.connection.once('open', () => {
  try {
    // Pass the WebSocket server instance to the price updater
    priceUpdater.start({ wss });
  } catch (err) {
    console.error('Failed to start price updater', err);
  }
});

// Routes
app.use('/api/balance', require('./routes/balance'));
// Assuming you have these routes from your project structure
app.use('/api/auth', require('./routes/auth'));
app.use('/api/trade', require('./routes/trade'));
app.use('/api/charts', require('./routes/charts'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));