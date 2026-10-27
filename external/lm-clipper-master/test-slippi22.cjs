const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/unranked_game1.slp");
const { gameComplete, stocks } = game.getStats();
console.log("unranked_game1 gameEnd:", game.getGameEnd(), "stocks", stocks.filter(s => s.playerIndex === 0).length, stocks.filter(s => s.playerIndex === 1).length);
