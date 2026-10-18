import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

export class PayloadBuilder {
  /**
   * @param {string} [basePayloadDir] Root payload directory
   */
  constructor(basePayloadDir = './payloads') {
    this.basePayloadDir = basePayloadDir;
  }

  /**
   * Serializes and compresses a granular game payload to date-sharded gzip JSON.
   * @param {Object} payloadData 
   * @returns {string} Relative path to written .json.gz file
   */
  savePayload(payloadData) {
    const { gameId, startAt } = payloadData;
    
    // Parse date for sharded directory: YYYY/MM
    let year = '2018';
    let month = '01';
    if (startAt) {
      const d = new Date(startAt);
      if (!isNaN(d.getTime())) {
        year = String(d.getUTCFullYear());
        month = String(d.getUTCMonth() + 1).padStart(2, '0');
      }
    }

    const relDir = path.join(year, month);
    const fullDir = path.join(this.basePayloadDir, relDir);
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }

    const filename = `${gameId}.json.gz`;
    const fullPath = path.join(fullDir, filename);
    const relPath = path.join(this.basePayloadDir, relDir, filename);

    const jsonStr = JSON.stringify(payloadData);
    const compressedBuf = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'), { level: 6 });
    fs.writeFileSync(fullPath, compressedBuf);

    return relPath;
  }

  /**
   * Reads and decompresses a .json.gz payload file on demand
   * @param {string} payloadPath 
   * @returns {Object}
   */
  loadPayload(payloadPath) {
    if (!fs.existsSync(payloadPath)) {
      throw new Error(`Payload file not found: ${payloadPath}`);
    }
    const compressed = fs.readFileSync(payloadPath);
    const decompressed = zlib.gunzipSync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
  }
}
