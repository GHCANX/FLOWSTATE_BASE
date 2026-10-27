const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/ranked_game1_tiebreak.slp");
const { gameComplete, stocks } = game.getStats();
console.log(stocks);
