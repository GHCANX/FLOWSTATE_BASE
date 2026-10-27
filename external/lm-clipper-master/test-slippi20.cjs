const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
console.log("test.slp gameEndMethod:", game.getGameEnd().gameEndMethod);
