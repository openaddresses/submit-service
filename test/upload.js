const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const fs = require('fs');
const _ = require('lodash');
const Readable = require('stream').Readable;
const proxyquire = require('proxyquire');
const toString = require('stream-to-string');

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
  test.test('zip/csv/geojson extensions: successful upload should redirect with source', t => {
    const tests_per_extension = 6;
    const extensions = ['zip', 'csv', 'geojson'];

    t.plan(tests_per_extension * extensions.length);

    extensions.forEach(extension => {
      const upload = proxyquire('../upload', {
        'aws-sdk/clients/s3': function S3(options) {
          t.deepEquals(options, { apiVersion: '2006-03-01' });

          return {
            upload(params, callback) {
              t.equals(params.Bucket, 'data.openaddresses.io');
              t.equals(params.Key, `cache/uploads/submit-service/199c38/file.${extension}`);

              // verify that the file contents being passed is the same as what was posted
              toString(params.Body, (err, body) => {
                t.equals(body, fs.readFileSync('./package.json').toString());
                callback(null, {
                  Location: 'this is the upload s3 object URL'
                });
              });

            }
          };

        },
        'lodash': {
          random: (start, end) => 1678392
        }
      });

      // start the service with the upload endpoint
      const upload_service = express().use('/', upload).listen();

      // make a request to the submit service without a 'source' parameter
      request({
        uri: `http://localhost:${upload_service.address().port}/`,
        method: 'POST',
        formData: {
          datafile: {
            value: fs.createReadStream('./package.json'),
            options: {
              filename: `file.${extension}`,
              contentType: 'text/plain'
            }
          }
        },
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        }
      })
      .then(response => t.fail('request should not have been successful'))
      .catch(err => {
        t.equals(err.statusCode, 302);
        t.equals(err.response.headers.location, `/sample?source=this%20is%20the%20upload%20s3%20object%20URL`);
      })
      .finally(() => {
        // don't call t.end() here because the test will be closed multiple times
        upload_service.close();
      });

    });

  });

  test.test('failed upload should respond with 500 and error message', t => {
    const upload = proxyquire('../upload', {
      'aws-sdk/clients/s3': function S3(options) {
        t.deepEquals(options, { apiVersion: '2006-03-01' });

        return {
          upload(params, callback) {
            t.equals(params.Bucket, 'data.openaddresses.io');
            t.equals(params.Key, `cache/uploads/submit-service/80b6e1/file.zip`);

            // verify that the file contents being passed is the same as what was posted
            toString(params.Body, (err, body) => {
              t.equals(body, fs.readFileSync('./package.json').toString());
              callback('error message returned from s3');
            });

          }
        };

      },
      'lodash': {
        random: (start, end) => 8435425
      }
    });

    // start the service with the upload endpoint
    const upload_service = express().use('/', upload).listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${upload_service.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          value: fs.createReadStream('./package.json'),
          options: {
            filename: `file.zip`,
            contentType: 'text/plain'
          }
        }
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 500);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, 'error message returned from s3');
    })
    .finally(() => {
      // don't call t.end() here because the test will be closed multiple times
      upload_service.close();
      t.end();
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
