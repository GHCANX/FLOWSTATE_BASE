const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const { gameComplete, stocks } = game.getStats();
console.log("test.slp gameComplete:", gameComplete, "stocks:", stocks.filter(s => s.playerIndex === 0).length, stocks.filter(s => s.playerIndex === 1).length);
