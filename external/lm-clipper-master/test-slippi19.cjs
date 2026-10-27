const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const { stocks } = game.getStats();
console.log("test.slp stocks p0:", stocks.filter(s => s.playerIndex === 0).length, "p1:", stocks.filter(s => s.playerIndex === 1).length);
