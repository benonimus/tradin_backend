# TODO: Remove all ccxt calls

## Tasks
- [x] Remove ccxt usage in routes/charts.js: Replace binance instantiation and fetchOHLCV with direct axios call to Binance klines API
- [x] Remove unused binance.close() in services/priceUpdater.js
- [x] Test /charts/klines endpoint to ensure functionality remains intact

# TODO List for Price Manipulation Enhancement

- [x] Create Manipulation.js model to record all manipulations in database
- [x] Update MarketPrice.js schema to include adminUserId and adminUsername in manipulation
- [x] Update routes/prices.js to extract adminUserId and adminUsername from request body
- [x] Update routes/prices.js to set adminUserId and adminUsername in manipulation object
- [x] Update routes/prices.js to record manipulation in Manipulation collection
- [x] Test the endpoint with the provided request format (server starts without errors)
