'use strict';

var characters = require('./characters.json.cjs');

const DEFAULT_COLOR = "Default";
const UnknownCharacter = {
    id: -1,
    name: "Unknown Character",
    shortName: "Unknown",
    colors: [DEFAULT_COLOR],
};
function generateCharacterInfo(id, info) {
    if (!info) {
        return UnknownCharacter;
    }
    return {
        id,
        name: info.name,
        shortName: info.shortName ?? info.name,
        colors: [DEFAULT_COLOR, ...(info.colors ?? [])],
    };
}
function getAllCharacters(mode = "playable") {
    const allCharacters = Object.entries(characters.default)
        .map(([id, data]) => generateCharacterInfo(parseInt(id, 10), data))
        .sort((a, b) => a.id - b.id);
    if (mode === "playable") {
        // Playable characters are from 0 (Falcon) to 25 (Ganondorf)
        return allCharacters.filter((character) => character.id >= 0 && character.id <= 25);
    }
    return allCharacters;
}
function getCharacterInfo(externalCharacterId) {
    const data = characters.default[externalCharacterId.toString()];
    return generateCharacterInfo(externalCharacterId, data);
}
function getCharacterShortName(externalCharacterId) {
    const character = getCharacterInfo(externalCharacterId);
    return character.shortName;
}
function getCharacterName(externalCharacterId) {
    const character = getCharacterInfo(externalCharacterId);
    return character.name;
}
// Return a human-readable color from a characterCode.
function getCharacterColorName(externalCharacterId, characterColor) {
    const character = getCharacterInfo(externalCharacterId);
    const color = character.colors[characterColor];
    if (color) {
        return color;
    }
    return DEFAULT_COLOR;
}

exports.UnknownCharacter = UnknownCharacter;
exports.getAllCharacters = getAllCharacters;
exports.getCharacterColorName = getCharacterColorName;
exports.getCharacterInfo = getCharacterInfo;
exports.getCharacterName = getCharacterName;
exports.getCharacterShortName = getCharacterShortName;
//# sourceMappingURL=characterUtils.cjs.map
