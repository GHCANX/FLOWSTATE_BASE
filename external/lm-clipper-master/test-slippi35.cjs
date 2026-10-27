const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/unranked_game1.slp");
const { gameComplete, stocks } = game.getStats();
console.log(stocks.filter(s => s.playerIndex === 0 && s.endFrame));
console.log(stocks.filter(s => s.playerIndex === 1 && s.endFrame));
