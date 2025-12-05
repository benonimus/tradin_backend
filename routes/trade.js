
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Asset = require('../models/Asset');
const Transaction = require('../models/Transaction');
const MarketPrice = require('../models/MarketPrice');
const ConditionalOrder = require('../models/ConditionalOrder');

/**
 * Creates Take Profit and/or Stop Loss conditional orders after a trade.
 * @param {object} params - The parameters for creating the orders.
 * @param {string} params.user - The user ID.
 * @param {string} params.symbol - The trading symbol.
 * @param {number} params.amount - The amount of the asset.
 * @param {string} params.side - The side of the conditional orders ('BUY' or 'SELL').
 * @param {number} [params.takeProfit] - The take-profit price.
 * @param {number} [params.stopLoss] - The stop-loss price.
 * @returns {Promise<Array>} A promise that resolves to an array of created orders.
 */
async function createConditionalOrders({ user, symbol, amount, side, takeProfit, stopLoss }) {
  const createdOrders = [];
  const orderBase = { user, symbol, amount, side, type: 'STOP_LIMIT' };

  // Create a Take-Profit order (acts as a stop-limit order in reverse)
  if (takeProfit && typeof takeProfit === 'number' && takeProfit > 0) {
    const tpOrder = new ConditionalOrder({ ...orderBase, stopPrice: takeProfit, limitPrice: takeProfit });
    await tpOrder.save();
    createdOrders.push(tpOrder);
  }

  // Create a Stop-Loss order
  if (stopLoss && typeof stopLoss === 'number' && stopLoss > 0) {
    const slOrder = new ConditionalOrder({ ...orderBase, stopPrice: stopLoss, limitPrice: stopLoss });
    await slOrder.save();
    createdOrders.push(slOrder);
  }

  return createdOrders;
}

// List user's assets
router.get('/', auth, async (req, res) => {
	try {
		const assets = await Asset.find({ user: req.user });
		const prices = await MarketPrice.find({});
		const priceMap = prices.reduce((map, p) => {
			map[p.symbol] = p.price;
			return map;
		}, {});

		let portfolioValue = 0;
		let totalInvested = 0;

		const assetsFormatted = assets.map((a) => {
			const currentPrice = priceMap[a.crypto] || a.averagePrice || 0;
			const totalValue = (a.amount || 0) * currentPrice;
			const totalCost = (a.amount || 0) * (a.averagePrice || 0);
			const unrealizedGain = totalValue - totalCost;
			portfolioValue += totalValue;
			totalInvested += totalCost;

			return {
				symbol: a.crypto,
				quantity: a.amount,
				averagePrice: a.averagePrice,
				currentPrice,
				totalValue,
				totalCost,
				unrealizedGain: unrealizedGain,
			};
		});
		res.json({ assets: assetsFormatted, portfolioValue, totalInvested, totalGain: portfolioValue - totalInvested });
	} catch (err) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Buy crypto: body { crypto, amount, price }
router.post('/buy', auth, async (req, res) => {
	const { symbol, amount, takeProfit, stopLoss } = req.body;
	if (!symbol || typeof amount !== 'number') return res.status(400).json({ message: 'Missing or invalid fields (symbol, amount).' });
	if (amount <= 0) return res.status(400).json({ message: 'Amount must be positive' });

	try {
		// Fetch current market price to execute trade, preventing use of stale client-side price
		const marketPrice = await MarketPrice.findOne({ symbol });
		if (!marketPrice) return res.status(404).json({ message: 'Symbol not found' });
		const price = marketPrice.price;

		const user = await User.findById(req.user);
		if (!user) return res.status(404).json({ message: 'User not found' });
		const total = amount * price;
		if (user.balance < total) return res.status(400).json({ message: 'Insufficient funds' });

		// Deduct balance
		user.balance -= total;
		await user.save();

		// Add or update asset
		let asset = await Asset.findOne({ user: req.user, crypto: symbol });
		if (!asset) {
			asset = new Asset({ user: req.user, crypto: symbol, amount, averagePrice: price });
		} else {
			// Recalculate average price
			const prevAmount = asset.amount || 0;
			const prevAvg = asset.averagePrice || 0;
			const newAmount = prevAmount + amount;
			const newAvg = ((prevAmount * prevAvg) + (amount * price)) / newAmount;
			asset.amount = newAmount;
			asset.averagePrice = newAvg;
		}
		await asset.save();

		// Fee placeholder (1%)
		const fee = +(total * 0.01).toFixed(2);
		const tx = new Transaction({ user: req.user, type: 'trade', amount: -total });
		await tx.save();

		// Create Take-Profit and/or Stop-Loss orders if specified
		const conditionalOrders = await createConditionalOrders({
			user: req.user,
			symbol,
			amount,
			side: 'SELL', // TP/SL for a buy is a sell
			takeProfit,
			stopLoss,
		});

		const trade = {
			success: true,
			tradeId: tx._id,
			symbol: symbol,
			quantity: amount,
			price,
			totalCost: total,
			fee,
			timestamp: tx.date,
			newBalance: user.balance,
			conditionalOrders: conditionalOrders.map(o => o._id),
		};

		res.status(201).json(trade);
	} catch (err) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Sell crypto: body { crypto, amount, price }
router.post('/sell', auth, async (req, res) => {
	const { symbol, amount, takeProfit, stopLoss } = req.body;
	if (!symbol || typeof amount !== 'number') return res.status(400).json({ message: 'Missing or invalid fields (symbol, amount).' });
	if (amount <= 0) return res.status(400).json({ message: 'Amount must be positive' });
	try {
		// Fetch current market price to execute trade
		const marketPrice = await MarketPrice.findOne({ symbol });
		if (!marketPrice) return res.status(404).json({ message: 'Symbol not found' });
		const price = marketPrice.price;

		const asset = await Asset.findOne({ user: req.user, crypto: symbol });
		if (!asset || asset.amount < amount) return res.status(400).json({ message: 'Insufficient holdings' });


		const total = amount * price;
		// Calculate gain/loss vs averagePrice
		const avg = asset.averagePrice || 0;
		const gainLoss = +(amount * (price - avg)).toFixed(2);
		asset.amount -= amount;
		if (asset.amount <= 0) await asset.remove();
		else await asset.save();

		const user = await User.findById(req.user);
		user.balance += total;
		await user.save();

		const fee = +(total * 0.01).toFixed(2);
		const netProceeds = +(total - fee).toFixed(2);

		const tx = new Transaction({ user: req.user, type: 'trade', amount: total });
		await tx.save();

		// Create Take-Profit and/or Stop-Loss orders if specified
		const conditionalOrders = await createConditionalOrders({
			user: req.user,
			symbol,
			amount,
			side: 'BUY', // TP/SL for a sell is a buy
			takeProfit,
			stopLoss,
		});

		res.status(201).json({
			success: true,
			tradeId: tx._id,
			symbol: symbol,
			quantity: amount,
			price,
			totalProceeds: total,
			fee,
			netProceeds,
			timestamp: tx.date,
			newBalance: user.balance,
			gainLoss,
			conditionalOrders: conditionalOrders.map(o => o._id),
		});
	} catch (err) {
		res.status(500).json({ message: 'Server error' });
	}
});

// --- Advanced Order Routes ---

// Place a Stop-Limit Order
router.post('/stop-limit', auth, async (req, res) => {
  const { symbol, side, amount, stopPrice, limitPrice } = req.body;
  if (!symbol || !side || !amount || !stopPrice || !limitPrice) {
    return res.status(400).json({ message: 'symbol, side, amount, stopPrice, and limitPrice are required.' });
  }
  if (amount <= 0) return res.status(400).json({ message: 'Amount must be positive' });

  try {
    // Basic validation
    if (side === 'BUY' && stopPrice >= limitPrice) {
        return res.status(400).json({ message: 'For BUY orders, stopPrice must be less than limitPrice.' });
    }
    if (side === 'SELL' && stopPrice <= limitPrice) {
        return res.status(400).json({ message: 'For SELL orders, stopPrice must be greater than limitPrice.' });
    }

    const order = new ConditionalOrder({
      user: req.user,
      symbol,
      side,
      type: 'STOP_LIMIT',
      amount,
      stopPrice,
      limitPrice,
    });
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: 'Server error placing stop-limit order.' });
  }
});

// Place a Trailing Stop Order
router.post('/trailing-stop', auth, async (req, res) => {
    const { symbol, side, amount, trailingDelta } = req.body;
    if (!symbol || !side || !amount || !trailingDelta || !trailingDelta.value || !trailingDelta.type) {
        return res.status(400).json({ message: 'symbol, side, amount, and a valid trailingDelta object are required.' });
    }
    if (trailingDelta.value <= 0) return res.status(400).json({ message: 'Trailing delta value must be positive.' });

    try {
        const marketPrice = await MarketPrice.findOne({ symbol });
        if (!marketPrice) return res.status(404).json({ message: 'Symbol not found' });

        const order = new ConditionalOrder({
            user: req.user,
            symbol,
            side,
            type: 'TRAILING_STOP',
            amount,
            trailingDelta: {
                type: trailingDelta.type, // 'PERCENTAGE' or 'ABSOLUTE'
                value: trailingDelta.value,
            },
            // Set the initial reference price to the current market price
            trailingReferencePrice: marketPrice.price,
        });
        await order.save();
        res.status(201).json(order);
    } catch (err) {
        res.status(500).json({ message: 'Server error placing trailing-stop order.' });
    }
});

// Get all open conditional orders for the user
router.get('/orders', auth, async (req, res) => {
    try {
        const openOrders = await ConditionalOrder.find({
            user: req.user,
            status: 'ACTIVE'
        }).sort({ createdAt: -1 });
        res.json(openOrders);
    } catch (err) {
        res.status(500).json({ message: 'Server error fetching open orders.' });
    }
});

// Cancel an open conditional order
router.delete('/orders/:id', auth, async (req, res) => {
    try {
        const order = await ConditionalOrder.findOne({
            _id: req.params.id,
            user: req.user,
        });

        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (order.status !== 'ACTIVE') return res.status(400).json({ message: 'Only active orders can be canceled.' });

        order.status = 'CANCELED';
        order.canceledAt = new Date();
        await order.save();

        res.json({ message: 'Order canceled successfully.', order });
    } catch (err) {
        res.status(500).json({ message: 'Server error canceling order.' });
    }
});

module.exports = router;
