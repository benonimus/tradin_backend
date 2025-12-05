const ConditionalOrder = require('../ConditionalOrder');
const MarketPrice = require('../models/MarketPrice');
const User =require('../models/User');
const Asset = require('../models/Asset');
const Transaction = require('../models/Transaction');

/**
 * Executes a trade based on a triggered conditional order.
 * This function is simplified and mirrors the logic in your trade route.
 * @param {object} order - The conditional order document from MongoDB.
 */
async function executeTrade(order) {
  const { user: userId, symbol, side, amount, limitPrice } = order;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    const executionPrice = limitPrice; // For STOP_LIMIT, we execute at the limit price
    const total = amount * executionPrice;

    if (side === 'BUY') {
      if (user.balance < total) throw new Error('Insufficient funds');
      user.balance -= total;

      let asset = await Asset.findOne({ user: userId, crypto: symbol }).session(session);
      if (!asset) {
        asset = new Asset({ user: userId, crypto: symbol, amount, averagePrice: executionPrice });
      } else {
        const prevAmount = asset.amount;
        const newAmount = prevAmount + amount;
        asset.averagePrice = ((prevAmount * asset.averagePrice) + (amount * executionPrice)) / newAmount;
        asset.amount = newAmount;
      }
      await asset.save({ session });
    } else { // SELL
      const asset = await Asset.findOne({ user: userId, crypto: symbol }).session(session);
      if (!asset || asset.amount < amount) throw new Error('Insufficient holdings');

      asset.amount -= amount;
      user.balance += total;

      if (asset.amount > 0) {
        await asset.save({ session });
      } else {
        await asset.remove({ session });
      }
    }

    await user.save({ session });

    const tx = new Transaction({ user: userId, type: 'trade', amount: side === 'BUY' ? -total : total });
    await tx.save({ session });

    order.status = 'COMPLETED';
    order.completedAt = new Date();
    order.executedTradeId = tx._id;
    await order.save({ session });

    await session.commitTransaction();
    console.log(`[OrderExecutor] Successfully executed ${side} order ${order._id} for ${amount} ${symbol}`);

    // If it was an OCO order, cancel the other one
    if (order.ocoPair && order.ocoPair.stopOrderId) {
        const otherOrderId = order.type === 'STOP_LIMIT' ? order.ocoPair.limitOrderId : order.ocoPair.stopOrderId;
        await ConditionalOrder.findByIdAndUpdate(otherOrderId, { status: 'CANCELED', canceledAt: new Date() });
        console.log(`[OrderExecutor] Canceled paired OCO order ${otherOrderId}`);
    }

  } catch (error) {
    await session.abortTransaction();
    console.error(`[OrderExecutor] Failed to execute trade for order ${order._id}:`, error.message);
    // Optionally, revert order status if execution fails
    order.status = 'ACTIVE'; 
    await order.save();
  } finally {
    session.endSession();
  }
}

/**
 * Processes a price update for a single symbol.
 * @param {string} symbol - The symbol that has a new price (e.g., 'BTCUSDT').
 * @param {number} currentPrice - The new market price.
 */
async function processPriceUpdate(symbol, currentPrice) {
  const activeOrders = await ConditionalOrder.find({ symbol, status: 'ACTIVE' });

  for (const order of activeOrders) {
    let trigger = false;

    if (order.type === 'TRAILING_STOP') {
      // Update trailing reference price and calculate new stop price
      if (order.side === 'SELL') {
        // For a sell, we track the peak price.
        const newRefPrice = Math.max(order.trailingReferencePrice || 0, currentPrice);
        if (newRefPrice > order.trailingReferencePrice) {
          order.trailingReferencePrice = newRefPrice;
          // Stop price is dynamically calculated
          const delta = order.trailingDelta.type === 'PERCENTAGE' ? newRefPrice * (order.trailingDelta.value / 100) : order.trailingDelta.value;
          order.stopPrice = newRefPrice - delta;
          await order.save();
        }
        // Check for trigger
        if (currentPrice <= order.stopPrice) trigger = true;

      } else { // BUY
        // For a buy, we track the trough price.
        const newRefPrice = Math.min(order.trailingReferencePrice || Infinity, currentPrice);
        if (newRefPrice < order.trailingReferencePrice) {
            order.trailingReferencePrice = newRefPrice;
            const delta = order.trailingDelta.type === 'PERCENTAGE' ? newRefPrice * (order.trailingDelta.value / 100) : order.trailingDelta.value;
            order.stopPrice = newRefPrice + delta;
            await order.save();
        }
        // Check for trigger
        if (currentPrice >= order.stopPrice) trigger = true;
      }
    } else if (order.type === 'STOP_LIMIT' || order.type === 'OCO') {
      // Standard stop price check
      if (order.side === 'SELL' && currentPrice <= order.stopPrice) {
        trigger = true;
      } else if (order.side === 'BUY' && currentPrice >= order.stopPrice) {
        trigger = true;
      }
    }

    if (trigger) {
      console.log(`[OrderExecutor] Triggering order ${order._id} for ${symbol} at price ${currentPrice}`);
      order.status = 'TRIGGERED';
      order.triggeredAt = new Date();
      await order.save();
      // In this simulation, we can execute the trade immediately upon trigger.
      // A real system might place it in a queue for the limit order to be matched.
      await executeTrade(order);
    }
  }
}

module.exports = { processPriceUpdate };