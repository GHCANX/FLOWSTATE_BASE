const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/incomplete.slp");
const gameEnd = game.getGameEnd();
console.log("incomplete.slp gameEnd:", gameEnd);
const metadata = game.getMetadata();
console.log("incomplete.slp metadata:", metadata?.lastFrame);
