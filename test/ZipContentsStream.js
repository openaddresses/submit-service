const Writable = require('stream').Writable;

// helper class that builds up the contents to be written to a .zip file but
// without needing an actual on-disk file
class ZipContentsStream extends Writable {
  constructor(options) {
    super(options);
    this.buffer = new Buffer('');
  }

  write(chunk, enc) {
    const buffer = (Buffer.isBuffer(chunk)) ? chunk : new Buffer(chunk, enc);
    this.buffer = Buffer.concat([this.buffer, buffer]);
  }

}

module.exports = ZipContentsStream;
