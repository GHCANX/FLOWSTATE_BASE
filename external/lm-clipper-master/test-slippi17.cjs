const { SlippiGame } = require("@slippi/slippi-js");
const game = new SlippiGame("../../external/slippi-js-master/slp/test.slp");
const settings = game.getSettings();
console.log(settings.timerType);
