const { SlippiGame } = require("@slippi/slippi-js");
const fs = require("fs");
const files = fs.readdirSync("../../external/slippi-js-master/slp/");
for (const file of files) {
  if (file.endsWith(".slp")) {
    const game = new SlippiGame("../../external/slippi-js-master/slp/" + file);
    const settings = game.getSettings();
    if (settings && settings.players.length >= 2) {
        const p1Start = settings.players[0].startStocks;
        const p2Start = settings.players[1].startStocks;
        if (p1Start !== 4 || p2Start !== 4) {
             console.log(file, "startStocks:", p1Start, p2Start);
        }
    }
  }
}
