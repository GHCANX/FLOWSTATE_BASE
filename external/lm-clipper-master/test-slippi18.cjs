const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/placementsTest/incorrect-winner-timeout.slp");
const { gameComplete, stocks } = game.getStats();
console.log("incorrect-winner-timeout.slp gameEnd:", game.getGameEnd(), "stocks", stocks.filter(s => s.playerIndex === 0).length, stocks.filter(s => s.playerIndex === 1).length);
