'use strict';

exports.Command = void 0;
(function (Command) {
    Command[Command["SPLIT_MESSAGE"] = 16] = "SPLIT_MESSAGE";
    Command[Command["MESSAGE_SIZES"] = 53] = "MESSAGE_SIZES";
    Command[Command["GAME_START"] = 54] = "GAME_START";
    Command[Command["PRE_FRAME_UPDATE"] = 55] = "PRE_FRAME_UPDATE";
    Command[Command["POST_FRAME_UPDATE"] = 56] = "POST_FRAME_UPDATE";
    Command[Command["GAME_END"] = 57] = "GAME_END";
    Command[Command["FRAME_START"] = 58] = "FRAME_START";
    Command[Command["ITEM_UPDATE"] = 59] = "ITEM_UPDATE";
    Command[Command["FRAME_BOOKEND"] = 60] = "FRAME_BOOKEND";
    Command[Command["GECKO_LIST"] = 61] = "GECKO_LIST";
    Command[Command["FOD_PLATFORM"] = 63] = "FOD_PLATFORM";
    Command[Command["WHISPY"] = 64] = "WHISPY";
    Command[Command["STADIUM_TRANSFORMATION"] = 65] = "STADIUM_TRANSFORMATION";
})(exports.Command || (exports.Command = {}));
exports.GameMode = void 0;
(function (GameMode) {
    GameMode[GameMode["VS"] = 2] = "VS";
    GameMode[GameMode["ONLINE"] = 8] = "ONLINE";
    GameMode[GameMode["TARGET_TEST"] = 15] = "TARGET_TEST";
    GameMode[GameMode["HOME_RUN_CONTEST"] = 32] = "HOME_RUN_CONTEST";
})(exports.GameMode || (exports.GameMode = {}));
exports.Language = void 0;
(function (Language) {
    Language[Language["JAPANESE"] = 0] = "JAPANESE";
    Language[Language["ENGLISH"] = 1] = "ENGLISH";
})(exports.Language || (exports.Language = {}));
exports.TimerType = void 0;
(function (TimerType) {
    TimerType[TimerType["NONE"] = 0] = "NONE";
    TimerType[TimerType["DECREASING"] = 2] = "DECREASING";
    TimerType[TimerType["INCREASING"] = 3] = "INCREASING";
})(exports.TimerType || (exports.TimerType = {}));
exports.ItemSpawnType = void 0;
(function (ItemSpawnType) {
    ItemSpawnType[ItemSpawnType["OFF"] = 255] = "OFF";
    ItemSpawnType[ItemSpawnType["VERY_LOW"] = 0] = "VERY_LOW";
    ItemSpawnType[ItemSpawnType["LOW"] = 1] = "LOW";
    ItemSpawnType[ItemSpawnType["MEDIUM"] = 2] = "MEDIUM";
    ItemSpawnType[ItemSpawnType["HIGH"] = 3] = "HIGH";
    ItemSpawnType[ItemSpawnType["VERY_HIGH"] = 4] = "VERY_HIGH";
})(exports.ItemSpawnType || (exports.ItemSpawnType = {}));
exports.EnabledItemType = void 0;
(function (EnabledItemType) {
    EnabledItemType[EnabledItemType["METAL_BOX"] = 1] = "METAL_BOX";
    EnabledItemType[EnabledItemType["CLOAKING_DEVICE"] = 2] = "CLOAKING_DEVICE";
    EnabledItemType[EnabledItemType["POKEBALL"] = 4] = "POKEBALL";
    // Bits 4 through 8 of item bitfield 1 are unknown
    EnabledItemType[EnabledItemType["UNKNOWN_ITEM_BIT_4"] = 8] = "UNKNOWN_ITEM_BIT_4";
    EnabledItemType[EnabledItemType["UNKNOWN_ITEM_BIT_5"] = 16] = "UNKNOWN_ITEM_BIT_5";
    EnabledItemType[EnabledItemType["UNKNOWN_ITEM_BIT_6"] = 32] = "UNKNOWN_ITEM_BIT_6";
    EnabledItemType[EnabledItemType["UNKNOWN_ITEM_BIT_7"] = 64] = "UNKNOWN_ITEM_BIT_7";
    EnabledItemType[EnabledItemType["UNKNOWN_ITEM_BIT_8"] = 128] = "UNKNOWN_ITEM_BIT_8";
    EnabledItemType[EnabledItemType["FAN"] = 256] = "FAN";
    EnabledItemType[EnabledItemType["FIRE_FLOWER"] = 512] = "FIRE_FLOWER";
    EnabledItemType[EnabledItemType["SUPER_MUSHROOM"] = 1024] = "SUPER_MUSHROOM";
    EnabledItemType[EnabledItemType["POISON_MUSHROOM"] = 2048] = "POISON_MUSHROOM";
    EnabledItemType[EnabledItemType["HAMMER"] = 4096] = "HAMMER";
    EnabledItemType[EnabledItemType["WARP_STAR"] = 8192] = "WARP_STAR";
    EnabledItemType[EnabledItemType["SCREW_ATTACK"] = 16384] = "SCREW_ATTACK";
    EnabledItemType[EnabledItemType["BUNNY_HOOD"] = 32768] = "BUNNY_HOOD";
    EnabledItemType[EnabledItemType["RAY_GUN"] = 65536] = "RAY_GUN";
    EnabledItemType[EnabledItemType["FREEZIE"] = 131072] = "FREEZIE";
    EnabledItemType[EnabledItemType["FOOD"] = 262144] = "FOOD";
    EnabledItemType[EnabledItemType["MOTION_SENSOR_BOMB"] = 524288] = "MOTION_SENSOR_BOMB";
    EnabledItemType[EnabledItemType["FLIPPER"] = 1048576] = "FLIPPER";
    EnabledItemType[EnabledItemType["SUPER_SCOPE"] = 2097152] = "SUPER_SCOPE";
    EnabledItemType[EnabledItemType["STAR_ROD"] = 4194304] = "STAR_ROD";
    EnabledItemType[EnabledItemType["LIPS_STICK"] = 8388608] = "LIPS_STICK";
    EnabledItemType[EnabledItemType["HEART_CONTAINER"] = 16777216] = "HEART_CONTAINER";
    EnabledItemType[EnabledItemType["MAXIM_TOMATO"] = 33554432] = "MAXIM_TOMATO";
    EnabledItemType[EnabledItemType["STARMAN"] = 67108864] = "STARMAN";
    EnabledItemType[EnabledItemType["HOME_RUN_BAT"] = 134217728] = "HOME_RUN_BAT";
    EnabledItemType[EnabledItemType["BEAM_SWORD"] = 268435456] = "BEAM_SWORD";
    EnabledItemType[EnabledItemType["PARASOL"] = 536870912] = "PARASOL";
    EnabledItemType[EnabledItemType["GREEN_SHELL"] = 1073741824] = "GREEN_SHELL";
    EnabledItemType[EnabledItemType["RED_SHELL"] = 2147483648] = "RED_SHELL";
    EnabledItemType[EnabledItemType["CAPSULE"] = 4294967296] = "CAPSULE";
    EnabledItemType[EnabledItemType["BOX"] = 8589934592] = "BOX";
    EnabledItemType[EnabledItemType["BARREL"] = 17179869184] = "BARREL";
    EnabledItemType[EnabledItemType["EGG"] = 34359738368] = "EGG";
    EnabledItemType[EnabledItemType["PARTY_BALL"] = 68719476736] = "PARTY_BALL";
    EnabledItemType[EnabledItemType["BARREL_CANNON"] = 137438953472] = "BARREL_CANNON";
    EnabledItemType[EnabledItemType["BOMB_OMB"] = 274877906944] = "BOMB_OMB";
    EnabledItemType[EnabledItemType["MR_SATURN"] = 549755813888] = "MR_SATURN";
})(exports.EnabledItemType || (exports.EnabledItemType = {}));
exports.GameEndMethod = void 0;
(function (GameEndMethod) {
    GameEndMethod[GameEndMethod["UNRESOLVED"] = 0] = "UNRESOLVED";
    GameEndMethod[GameEndMethod["RESOLVED"] = 3] = "RESOLVED";
    // The following options are only returned in version 2.0.0 onwards
    GameEndMethod[GameEndMethod["TIME"] = 1] = "TIME";
    GameEndMethod[GameEndMethod["GAME"] = 2] = "GAME";
    GameEndMethod[GameEndMethod["NO_CONTEST"] = 7] = "NO_CONTEST";
})(exports.GameEndMethod || (exports.GameEndMethod = {}));
exports.FodPlatformSide = void 0;
(function (FodPlatformSide) {
    FodPlatformSide[FodPlatformSide["RIGHT"] = 0] = "RIGHT";
    FodPlatformSide[FodPlatformSide["LEFT"] = 1] = "LEFT";
})(exports.FodPlatformSide || (exports.FodPlatformSide = {}));
exports.WhispyBlowDirection = void 0;
(function (WhispyBlowDirection) {
    WhispyBlowDirection[WhispyBlowDirection["NONE"] = 0] = "NONE";
    WhispyBlowDirection[WhispyBlowDirection["LEFT"] = 1] = "LEFT";
    WhispyBlowDirection[WhispyBlowDirection["RIGHT"] = 2] = "RIGHT";
})(exports.WhispyBlowDirection || (exports.WhispyBlowDirection = {}));
exports.StadiumTransformation = void 0;
(function (StadiumTransformation) {
    StadiumTransformation[StadiumTransformation["FIRE"] = 3] = "FIRE";
    StadiumTransformation[StadiumTransformation["GRASS"] = 4] = "GRASS";
    StadiumTransformation[StadiumTransformation["NORMAL"] = 5] = "NORMAL";
    StadiumTransformation[StadiumTransformation["ROCK"] = 6] = "ROCK";
    StadiumTransformation[StadiumTransformation["WATER"] = 9] = "WATER";
})(exports.StadiumTransformation || (exports.StadiumTransformation = {}));
exports.StadiumTransformationEvent = void 0;
(function (StadiumTransformationEvent) {
    StadiumTransformationEvent[StadiumTransformationEvent["INITIATE"] = 2] = "INITIATE";
    StadiumTransformationEvent[StadiumTransformationEvent["ON_MONITOR"] = 3] = "ON_MONITOR";
    StadiumTransformationEvent[StadiumTransformationEvent["RECEDING"] = 4] = "RECEDING";
    StadiumTransformationEvent[StadiumTransformationEvent["RISING"] = 5] = "RISING";
    StadiumTransformationEvent[StadiumTransformationEvent["FINISH"] = 6] = "FINISH";
})(exports.StadiumTransformationEvent || (exports.StadiumTransformationEvent = {}));
exports.Frames = void 0;
(function (Frames) {
    Frames[Frames["FIRST"] = -123] = "FIRST";
    Frames[Frames["FIRST_PLAYABLE"] = -39] = "FIRST_PLAYABLE";
})(exports.Frames || (exports.Frames = {}));
//# sourceMappingURL=types.cjs.map
