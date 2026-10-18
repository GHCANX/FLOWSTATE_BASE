import fs from 'node:fs';
import path from 'node:path';

export class FileCleaner {
  /**
   * Safely delete a single file if it exists.
   * @param {string} filePath 
   */
  static deleteFile(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err) {
        console.warn(`[FileCleaner] Warning: could not delete ${filePath}: ${err.message}`);
        return false;
      }
    }
    return false;
  }

  /**
   * Purge an entire array of temporary files.
   * @param {string[]} filePaths 
   * @returns {number} Count of successfully deleted files
   */
  static purgeBatch(filePaths) {
    let count = 0;
    for (const p of filePaths) {
      if (this.deleteFile(p)) count++;
    }
    return count;
  }

  /**
   * Purge all files in a directory (e.g. ./temp_slp)
   * @param {string} dir 
   */
  static cleanDirectory(dir) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        try {
          if (fs.statSync(full).isFile()) {
            fs.unlinkSync(full);
          }
        } catch (_) {}
      }
    }
  }
}
