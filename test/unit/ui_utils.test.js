import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  escapeHtml,
  ansiToHtml,
  getCharacterPortraitUrl,
  getCharacterInitials,
  getStageDetails,
  formatYmd,
  isValidConnectCode,
  formatBytesToMB
} from '../../src/ui/utils.js';

describe('UI Utilities', () => {
  describe('escapeHtml', () => {
    test('handles empty or null inputs gracefully', () => {
      assert.strictEqual(escapeHtml(null), '');
      assert.strictEqual(escapeHtml(undefined), '');
      assert.strictEqual(escapeHtml(''), '');
    });

    test('escapes HTML special characters correctly', () => {
      assert.strictEqual(escapeHtml('Normal string'), 'Normal string');
      assert.strictEqual(escapeHtml('<div>Hello & Welcome</div>'), '&lt;div&gt;Hello &amp; Welcome&lt;/div&gt;');
      assert.strictEqual(escapeHtml('He said "Hi"'), 'He said &quot;Hi&quot;');
      assert.strictEqual(escapeHtml("It's a test"), 'It&#039;s a test');
    });

    test('handles non-string inputs', () => {
      assert.strictEqual(escapeHtml(123), '123');
    });
  });

  describe('ansiToHtml', () => {
    test('converts basic text correctly without colors', () => {
      assert.strictEqual(ansiToHtml('Hello World'), 'Hello World');
    });

    test('converts ANSI color codes to HTML spans', () => {
      assert.strictEqual(ansiToHtml('\x1b[31mRed Text\x1b[0m'), '<span class="t-red">Red Text</span>');
      assert.strictEqual(ansiToHtml('\x1b[32mGreen Text\x1b[0m'), '<span class="t-green">Green Text</span>');
    });

    test('strips unknown ANSI codes', () => {
      assert.strictEqual(ansiToHtml('\x1b[38;5;123mUnknown Text\x1b[0m'), 'Unknown Text</span>'); // Should replace [0m, the rest should be stripped
    });

    test('escapes HTML before parsing ANSI', () => {
      assert.strictEqual(ansiToHtml('\x1b[31m<Test>\x1b[0m'), '<span class="t-red">&lt;Test&gt;</span>');
    });
  });

  describe('getCharacterPortraitUrl', () => {
    test('resolves default character portrait url', () => {
      assert.strictEqual(getCharacterPortraitUrl(2), '/assets/character-icons/fox/Default.png'); // Fox default
    });

    test('resolves specific costume url', () => {
      assert.strictEqual(getCharacterPortraitUrl(9, 1), '/assets/character-icons/marth/Red.png'); // Marth red
    });

    test('falls back to default if costume index is out of bounds', () => {
      assert.strictEqual(getCharacterPortraitUrl(9, 99), '/assets/character-icons/marth/Default.png');
    });

    test('falls back to fox default if character ID is unknown', () => {
      assert.strictEqual(getCharacterPortraitUrl(999), '/assets/character-icons/fox/Default.png');
    });
  });

  describe('getCharacterInitials', () => {
    test('returns correct initials for known characters', () => {
      assert.strictEqual(getCharacterInitials(2), 'FX'); // Fox
      assert.strictEqual(getCharacterInitials(9), 'MA'); // Marth
    });

    test('returns P for unknown characters', () => {
      assert.strictEqual(getCharacterInitials(999), 'P');
    });
  });

  describe('getStageDetails', () => {
    test('returns correct details for known stages', () => {
      assert.deepStrictEqual(getStageDetails(2), { name: 'Fountain of Dreams', file: 'fountain.jpg', legal: true });
      assert.deepStrictEqual(getStageDetails(31), { name: 'Battlefield', file: 'battlefield.jpg', legal: true });
    });

    test('returns fallback details for unknown stages', () => {
      assert.deepStrictEqual(getStageDetails(999), { name: 'Unknown Stage', file: 'nonlegal.jpg', legal: false });
      assert.deepStrictEqual(getStageDetails(999, 'Mute City'), { name: 'Mute City', file: 'nonlegal.jpg', legal: false });
    });
  });

  describe('formatYmd', () => {
    test('formats dates correctly to YYYY-MM-DD', () => {
      const d1 = new Date(2023, 0, 5); // Jan 5, 2023
      assert.strictEqual(formatYmd(d1), '2023-01-05');

      const d2 = new Date(2022, 11, 25); // Dec 25, 2022
      assert.strictEqual(formatYmd(d2), '2022-12-25');
    });
  });

  describe('isValidConnectCode', () => {
    test('returns true for valid connect codes', () => {
      assert.strictEqual(isValidConnectCode('TAG#123'), true);
      assert.strictEqual(isValidConnectCode('MANG#0'), true);
      assert.strictEqual(isValidConnectCode('A#1234'), true);
    });

    test('returns false for invalid connect codes', () => {
      assert.strictEqual(isValidConnectCode('TAG123'), false);
      assert.strictEqual(isValidConnectCode('#123'), false);
      assert.strictEqual(isValidConnectCode('TOOLONGTAG#123'), false);
      assert.strictEqual(isValidConnectCode('TAG#12345'), false);
      assert.strictEqual(isValidConnectCode(''), false);
      assert.strictEqual(isValidConnectCode(null), false);
      assert.strictEqual(isValidConnectCode(undefined), false);
    });
  });

  describe('formatBytesToMB', () => {
    test('formats byte counts into MB strings', () => {
      assert.strictEqual(formatBytesToMB(1048576), '1.00 MB');
      assert.strictEqual(formatBytesToMB(2621440), '2.50 MB');
    });

    test('handles 0, null, or undefined correctly', () => {
      assert.strictEqual(formatBytesToMB(0), '0 MB');
      assert.strictEqual(formatBytesToMB(null), '0 MB');
      assert.strictEqual(formatBytesToMB(undefined), '0 MB');
    });
  });
});