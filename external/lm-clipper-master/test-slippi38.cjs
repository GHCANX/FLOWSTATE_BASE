const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const { gameComplete, stocks } = game.getStats();
console.log(stocks);
