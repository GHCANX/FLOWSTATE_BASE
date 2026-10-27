const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const settings = game.getSettings();
console.log("test.slp timerType:", settings.timerType, "startStocks:", settings.players[0].startStocks, settings.players[1].startStocks);
