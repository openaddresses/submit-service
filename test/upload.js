const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const fs = require('fs');
const _ = require('lodash');
const Readable = require('stream').Readable;
const sha1 = require('sha1');

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

tape('/upload tests', test => {
  test.test('zip/csv/geojson extensions: successful upload should respond with tmp filename', t => {
    t.plan(3 + 3 + 3); // 3 assertions for each file type

    ['zip', 'csv', 'geojson'].forEach(extension => {
      // start the service with the upload endpoint
      const upload_service = express()
        .use('/', require('../upload'))
        .listen();

      // make a request to the submit service without a 'source' parameter
      request({
        uri: `http://localhost:${upload_service.address().port}/`,
        method: 'POST',
        formData: {
          datafile: {
            value: fs.createReadStream('./LICENSE'),
            options: {
              filename: `file.${extension}`,
              contentType: 'text/plain'
            }
          }
        },
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        resolveWithFullResponse: true
      })
      .then(response => {
        t.equals(response.statusCode, 200);
        t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
        t.equals(response.body, sha1(fs.readFileSync('./LICENSE')));
      })
      .catch(err => t.fail(err))
      .finally(() => {
        // don't call t.end() here because the test will be closed multiple times
        upload_service.close();
      });

    });

  });

  test.test('request without dataFile parameter should return 400', t => {
    // start the service with the upload endpoint
    const upload_service = express()
      .use('/', require('../upload'))
      .listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${upload_service.address().port}/`,
      method: 'POST',
      formData: {},
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, '\'datafile\' parameter is required');
    })
    .finally(() => {
      upload_service.close(() => t.end());
    });

  });

  test.test('non-zip/geojson/csv file extension should return error', t => {
    // start the service with the upload endpoint
    const upload_service = express()
      .use('/', require('../upload'))
      .listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${upload_service.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          value: fs.createReadStream('./LICENSE'),
          options: {
            filename: `file.txt`,
            contentType: 'text/plain'
          }
        }
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, 'supported extensions are .zip, .csv, and .geojson');
    })
    .finally(() => {
      upload_service.close(() => t.end());
    });

  });

  test.test('file upload size greater than 50MB should return error', t => {
    // start the service with the upload endpoint
    const upload_service = express()
      .use('/', require('../upload'))
      .listen();

    const size = 50*1024*1024+1;

    request({
      uri: `http://localhost:${upload_service.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          value: new NLengthStream({}, size),
          options: {
            filename: 'file.zip',
            contentType: 'text/plain',
            knownLength: size
          }
        }
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, 'max upload size is blah');
    })
    .finally(() => {
      upload_service.close(() => t.end());
    });

  });

});
