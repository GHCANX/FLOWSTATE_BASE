const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/unranked_game1.slp");
console.log("unranked_game1.slp gameEndMethod:", game.getGameEnd().gameEndMethod);
