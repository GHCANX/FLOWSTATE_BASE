const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/nametags.slp");
const gameEnd = game.getGameEnd();
console.log("nametags.slp gameEnd:", gameEnd);
