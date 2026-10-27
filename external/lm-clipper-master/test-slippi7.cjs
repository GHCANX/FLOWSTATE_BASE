const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/placementsTest/ffa_1p2p_winner_2p.slp");
const { stocks } = game.getStats();
console.log("stocks:", stocks);
