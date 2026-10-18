'use strict';

var animationUtils = require('../common/melee/animationUtils.cjs');
var characterUtils = require('../common/melee/characterUtils.cjs');
var framedataUtils = require('../common/melee/framedataUtils.cjs');
var moveUtils = require('../common/melee/moveUtils.cjs');
var stageUtils = require('../common/melee/stageUtils.cjs');
var types = require('../common/melee/types.cjs');
var actions = require('../common/stats/actions.cjs');
var combos = require('../common/stats/combos.cjs');
var common = require('../common/stats/common.cjs');
var conversions = require('../common/stats/conversions.cjs');
var inputs = require('../common/stats/inputs.cjs');
var overall = require('../common/stats/overall.cjs');
var stats = require('../common/stats/stats.cjs');
var stocks = require('../common/stats/stocks.cjs');
var targets = require('../common/stats/targets.cjs');
var types$1 = require('../common/types.cjs');
var gameTimer = require('../common/utils/gameTimer.cjs');
var slpParser = require('../common/utils/slpParser.cjs');
var slpStream = require('../common/utils/slpStream.cjs');
var communication = require('./console/communication.cjs');
var consoleConnection = require('./console/consoleConnection.cjs');
var dolphinConnection = require('./console/dolphinConnection.cjs');
var types$2 = require('./console/types.cjs');
var SlippiGameNode = require('./SlippiGameNode.cjs');
var slpFile = require('./utils/slpFile.cjs');
var slpFileWriter = require('./utils/slpFileWriter.cjs');



exports.animations = animationUtils;
exports.characters = characterUtils;
exports.framedata = framedataUtils;
exports.moves = moveUtils;
exports.stages = stageUtils;
Object.defineProperty(exports, "Character", {
	enumerable: true,
	get: function () { return types.Character; }
});
Object.defineProperty(exports, "MoveId", {
	enumerable: true,
	get: function () { return types.MoveId; }
});
Object.defineProperty(exports, "Stage", {
	enumerable: true,
	get: function () { return types.Stage; }
});
exports.ActionsComputer = actions.ActionsComputer;
exports.ComboComputer = combos.ComboComputer;
exports.State = common.State;
exports.Timers = common.Timers;
exports.calcDamageTaken = common.calcDamageTaken;
exports.didLoseStock = common.didLoseStock;
exports.getSinglesPlayerPermutationsFromSettings = common.getSinglesPlayerPermutationsFromSettings;
exports.isCommandGrabbed = common.isCommandGrabbed;
exports.isDamaged = common.isDamaged;
exports.isDead = common.isDead;
exports.isDown = common.isDown;
exports.isGrabbed = common.isGrabbed;
exports.isInControl = common.isInControl;
exports.isTeching = common.isTeching;
exports.ConversionComputer = conversions.ConversionComputer;
exports.InputComputer = inputs.InputComputer;
exports.generateOverallStats = overall.generateOverallStats;
exports.Stats = stats.Stats;
exports.StockComputer = stocks.StockComputer;
exports.TargetBreakComputer = targets.TargetBreakComputer;
Object.defineProperty(exports, "Command", {
	enumerable: true,
	get: function () { return types$1.Command; }
});
Object.defineProperty(exports, "EnabledItemType", {
	enumerable: true,
	get: function () { return types$1.EnabledItemType; }
});
Object.defineProperty(exports, "FodPlatformSide", {
	enumerable: true,
	get: function () { return types$1.FodPlatformSide; }
});
Object.defineProperty(exports, "Frames", {
	enumerable: true,
	get: function () { return types$1.Frames; }
});
Object.defineProperty(exports, "GameEndMethod", {
	enumerable: true,
	get: function () { return types$1.GameEndMethod; }
});
Object.defineProperty(exports, "GameMode", {
	enumerable: true,
	get: function () { return types$1.GameMode; }
});
Object.defineProperty(exports, "ItemSpawnType", {
	enumerable: true,
	get: function () { return types$1.ItemSpawnType; }
});
Object.defineProperty(exports, "Language", {
	enumerable: true,
	get: function () { return types$1.Language; }
});
Object.defineProperty(exports, "StadiumTransformation", {
	enumerable: true,
	get: function () { return types$1.StadiumTransformation; }
});
Object.defineProperty(exports, "StadiumTransformationEvent", {
	enumerable: true,
	get: function () { return types$1.StadiumTransformationEvent; }
});
Object.defineProperty(exports, "TimerType", {
	enumerable: true,
	get: function () { return types$1.TimerType; }
});
Object.defineProperty(exports, "WhispyBlowDirection", {
	enumerable: true,
	get: function () { return types$1.WhispyBlowDirection; }
});
exports.frameToGameTimer = gameTimer.frameToGameTimer;
exports.MAX_ROLLBACK_FRAMES = slpParser.MAX_ROLLBACK_FRAMES;
exports.SlpParser = slpParser.SlpParser;
exports.SlpParserEvent = slpParser.SlpParserEvent;
exports.NETWORK_MESSAGE = slpStream.NETWORK_MESSAGE;
exports.SlpStream = slpStream.SlpStream;
exports.SlpStreamEvent = slpStream.SlpStreamEvent;
Object.defineProperty(exports, "SlpStreamMode", {
	enumerable: true,
	get: function () { return slpStream.SlpStreamMode; }
});
Object.defineProperty(exports, "CommunicationType", {
	enumerable: true,
	get: function () { return communication.CommunicationType; }
});
exports.ConsoleCommunication = communication.ConsoleCommunication;
exports.ConsoleConnection = consoleConnection.ConsoleConnection;
exports.DolphinConnection = dolphinConnection.DolphinConnection;
exports.DolphinMessageType = dolphinConnection.DolphinMessageType;
exports.ConnectionEvent = types$2.ConnectionEvent;
Object.defineProperty(exports, "ConnectionStatus", {
	enumerable: true,
	get: function () { return types$2.ConnectionStatus; }
});
Object.defineProperty(exports, "Ports", {
	enumerable: true,
	get: function () { return types$2.Ports; }
});
exports.SlippiGame = SlippiGameNode.SlippiGameNode;
exports.SlpFile = slpFile.SlpFile;
exports.SlpFileWriter = slpFileWriter.SlpFileWriter;
Object.defineProperty(exports, "SlpFileWriterEvent", {
	enumerable: true,
	get: function () { return slpFileWriter.SlpFileWriterEvent; }
});
//# sourceMappingURL=index.cjs.map
