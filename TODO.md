# TODO: Remove all ccxt calls

## Tasks
- [x] Remove ccxt usage in routes/charts.js: Replace binance instantiation and fetchOHLCV with direct axios call to Binance klines API
- [ ] Remove unused binance.close() in services/priceUpdater.js
- [ ] Test /charts/klines endpoint to ensure functionality remains intact
