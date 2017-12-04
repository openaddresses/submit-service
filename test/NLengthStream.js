const Readable = require('stream').Readable;
const _ = require('lodash');

class NLengthStream extends Readable {
  constructor(options, requestedSize) {
    super(options);
    this.requestedSize = requestedSize;
    this.bytesRead = 0;
  }

  _read(size = 1024) {
    if (this.bytesRead >= this.requestedSize) {
      this.push(null);
      return;
    }

    if (this.bytesRead + size > this.requestedSize) {
      this.push(_.repeat('0', this.requestedSize - this.bytesRead));
      this.bytesRead += this.requestedSize - this.bytesRead;
    } else {
      this.push(_.repeat('0', size));
      this.bytesRead += size;
    }

  }

}

module.exports = NLengthStream;
