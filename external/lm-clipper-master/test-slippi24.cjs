const { SlippiGame } = require("@slippi/slippi-js");
const fs = require("fs");
const files = fs.readdirSync("../../external/slippi-js-master/slp/");
for (const file of files) {
  if (file.endsWith(".slp")) {
    const game = new SlippiGame("../../external/slippi-js-master/slp/" + file);
    const gameEnd = game.getGameEnd();
    if (gameEnd && gameEnd.placements) {
        const winner = gameEnd.placements.find(p => p.position === 0);
        const { stocks } = game.getStats();
        const p1Stocks = stocks.filter(s => s.playerIndex === 0).length;
        const p2Stocks = stocks.filter(s => s.playerIndex === 1).length;
        if (p1Stocks < 4 && p2Stocks < 4 && winner) {
            console.log(file, "p1Stocks:", p1Stocks, "p2Stocks:", p2Stocks, "winner:", winner.playerIndex);
        }
    }
  }
}
