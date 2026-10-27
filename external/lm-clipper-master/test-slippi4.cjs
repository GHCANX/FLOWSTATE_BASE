const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/placementsTest/incorrect-winner-timeout.slp");
const gameEnd = game.getGameEnd();
console.log("incorrect-winner-timeout gameEnd:", gameEnd);
