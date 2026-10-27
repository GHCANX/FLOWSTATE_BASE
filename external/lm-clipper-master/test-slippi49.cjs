const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/edge-cancel-1.slp");
const { gameComplete, stocks } = game.getStats();
console.log(stocks);
const p1Stocks = stocks.filter(stock => stock.playerIndex === game.getSettings().players[0].playerIndex);
console.log(p1Stocks);
