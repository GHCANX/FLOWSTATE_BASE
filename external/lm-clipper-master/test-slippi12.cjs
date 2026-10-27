const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const { gameComplete } = game.getStats();
const gameEnd = game.getGameEnd();
console.log("test.slp gameEnd:", gameEnd);
