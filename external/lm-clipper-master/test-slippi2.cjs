const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/incomplete.slp");
const gameEnd = game.getGameEnd();
console.log("gameEnd:", gameEnd);
