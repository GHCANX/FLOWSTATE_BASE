const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/edge-cancel-1.slp");
const { gameComplete, stocks } = game.getStats();
console.log(stocks.filter(s => s.playerIndex === 0 && s.endFrame === null).length);
