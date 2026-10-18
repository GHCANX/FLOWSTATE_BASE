import fs from 'fs';

class SlpFileInputRef {
    filePath;
    fileDescriptor;
    constructor(filePath) {
        this.filePath = filePath;
    }
    open() {
        if (this.fileDescriptor) {
            // File is already open so do nothing
            return;
        }
        this.fileDescriptor = fs.openSync(this.filePath, "r");
    }
    size() {
        if (!this.fileDescriptor) {
            throw new Error("Tried to get the size of a closed SLP file");
        }
        return fs.fstatSync(this.fileDescriptor).size;
    }
    close() {
        if (this.fileDescriptor) {
            fs.closeSync(this.fileDescriptor);
            this.fileDescriptor = undefined;
        }
    }
    read(targetBuffer, offset, length, position) {
        if (!this.fileDescriptor) {
            throw new Error("Tried to read from a closed SLP file");
        }
        return fs.readSync(this.fileDescriptor, targetBuffer, offset, length, position);
    }
}

export { SlpFileInputRef };
//# sourceMappingURL=slpFileInputRef.esm.js.map
