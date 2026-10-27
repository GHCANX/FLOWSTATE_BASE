const { default: SlippiGame } = require("@slippi/slippi-js");
const fs = require("fs");
const files = fs.readdirSync("./external/slippi-js-master/slp/placementsTest");
for (const file of files) {
  if (file.endsWith(".slp")) {
    const game = new SlippiGame("./external/slippi-js-master/slp/placementsTest/" + file);
    const stats = game.getStats();
    const gameEnd = game.getGameEnd();
    console.log(file, "gameEnd:", gameEnd);
  }
}
