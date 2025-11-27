
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../User');
const Asset = require('../Asset');
const Transaction = require('../Transaction');

// List user's assets
router.get('/', auth, async (req, res) => {
	try {
		const assets = await Asset.find({ user: req.user });
		// Calculate portfolio summaries (using stored averagePrice as proxy for currentPrice)
		let portfolioValue = 0;
		let totalInvested = 0;
		const assetsFormatted = assets.map((a) => {
			const currentPrice = a.averagePrice || 0;
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
				unrealizedGain,
			};
		});
		res.json({ assets: assetsFormatted, portfolioValue, totalInvested, totalGain: portfolioValue - totalInvested });
	} catch (err) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Buy crypto: body { crypto, amount, price }
router.post('/buy', auth, async (req, res) => {
	const { crypto, amount, price } = req.body;
	if (!crypto || typeof amount !== 'number' || typeof price !== 'number') return res.status(400).json({ message: 'Missing or invalid fields' });
	if (amount <= 0 || price <= 0) return res.status(400).json({ message: 'Amount and price must be positive' });

	try {
		const user = await User.findById(req.user);
		const total = amount * price;
		if (user.balance < total) return res.status(422).json({ message: 'Insufficient funds' });

		// Deduct balance
		user.balance -= total;
		await user.save();

		// Add or update asset
		let asset = await Asset.findOne({ user: req.user, crypto });
		if (!asset) {
			asset = new Asset({ user: req.user, crypto, amount, averagePrice: price });
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

		const trade = {
			success: true,
			tradeId: tx._id,
			symbol: crypto,
			quantity: amount,
			price,
			totalCost: total,
			fee,
			timestamp: tx.date,
			newBalance: user.balance,
		};

		res.status(201).json(trade);
	} catch (err) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Sell crypto: body { crypto, amount, price }
router.post('/sell', auth, async (req, res) => {
	const { crypto, amount, price } = req.body;
	if (!crypto || typeof amount !== 'number' || typeof price !== 'number') return res.status(400).json({ message: 'Missing or invalid fields' });
	if (amount <= 0 || price <= 0) return res.status(400).json({ message: 'Amount and price must be positive' });
	try {
		const asset = await Asset.findOne({ user: req.user, crypto });
		if (!asset || asset.amount < amount) return res.status(422).json({ message: 'Insufficient holdings' });

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

		res.status(201).json({
			success: true,
			tradeId: tx._id,
			symbol: crypto,
			quantity: amount,
			price,
			totalProceeds: total,
			fee,
			netProceeds,
			timestamp: tx.date,
			newBalance: user.balance,
			gainLoss,
		});
	} catch (err) {
		res.status(500).json({ message: 'Server error' });
	}
});

module.exports = router;
