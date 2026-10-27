const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const { gameComplete, stocks } = game.getStats();
console.log("test.slp gameEnd:", game.getGameEnd());
const game2 = new SlippiGame("../../external/slippi-js-master/slp/unranked_game1.slp");
console.log("unranked_game1 gameEnd:", game2.getGameEnd());
