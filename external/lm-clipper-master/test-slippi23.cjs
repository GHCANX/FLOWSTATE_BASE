const { SlippiGame } = require("@slippi/slippi-js");
const fs = require("fs");
const files = fs.readdirSync("../../external/slippi-js-master/slp/");
for (const file of files) {
  if (file.endsWith(".slp")) {
    const game = new SlippiGame("../../external/slippi-js-master/slp/" + file);
    const gameEnd = game.getGameEnd();
    if (gameEnd && gameEnd.placements) {
        const winner = gameEnd.placements.find(p => p.position === 0);
        console.log(file, "lras:", gameEnd.lrasInitiatorIndex, "winner:", winner ? winner.playerIndex : null);
    }
  }
}
