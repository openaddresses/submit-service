const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const _ = require('lodash');
const proxyquire = require('proxyquire');
const toString = require('stream-to-string');
const string2stream = require('string-to-stream');

tape('/upload tests', test => {
  test.test('MAX_UPLOAD_SIZE missing from environment should respond with error', t => {
    process.env.MAX_UPLOAD_SIZE = undefined;

    const upload = proxyquire('../upload', {
      'aws-sdk/clients/s3': function S3(options) {
        return {
          upload(params, callback) {
            t.fail('upload should not have been called');
          }
        };

      },
      'lodash': {
        random: (start, end) => 8435425
      }
    });

    // start the service with the upload endpoint
    const uploadService = express().use('/', upload).listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${uploadService.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          value: string2stream(_.repeat('0', 1024)),
          options: {
            filename: 'file.zip',
            contentType: 'text/plain',
            knownLength: 1024
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
      t.equals(err.error, 'MAX_UPLOAD_SIZE not defined in process environment');
    })
    .finally(() => {
      // don't call t.end() here because the test will be closed multiple times
      uploadService.close();
      t.end();
    });

  });

  test.test('zip/csv/geojson extensions: successful upload should redirect with source', t => {
    const testsPerExtension = 6;
    const extensions = ['zip', 'csv', 'geojson'];

    t.plan(testsPerExtension * extensions.length);

    process.env.MAX_UPLOAD_SIZE = 1024;

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
                t.equals(body, _.repeat('0', process.env.MAX_UPLOAD_SIZE));
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
      const uploadService = express().use('/', upload).listen();

      // make a request to the submit service without a 'source' parameter
      request({
        uri: `http://localhost:${uploadService.address().port}/`,
        method: 'POST',
        formData: {
          datafile: {
            // value: fs.createReadStream('./package.json'),
            value: string2stream(_.repeat('0', process.env.MAX_UPLOAD_SIZE)),
            options: {
              filename: `file.${extension}`,
              contentType: 'text/plain',
              knownLength: process.env.MAX_UPLOAD_SIZE
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
        t.equals(err.response.headers.location, '/sample?source=this%20is%20the%20upload%20s3%20object%20URL');
      })
      .finally(() => {
        // don't call t.end() here because the test will be closed multiple times
        uploadService.close();
      });

    });

  });

  test.test('failed upload should respond with 500 and error message', t => {
    process.env.MAX_UPLOAD_SIZE = 1024;

    const upload = proxyquire('../upload', {
      'aws-sdk/clients/s3': function S3(options) {
        t.deepEquals(options, { apiVersion: '2006-03-01' });

        return {
          upload(params, callback) {
            t.equals(params.Bucket, 'data.openaddresses.io');
            t.equals(params.Key, 'cache/uploads/submit-service/80b6e1/file.zip');

            // verify that the file contents being passed is the same as what was posted
            toString(params.Body, (err, body) => {
              t.equals(body, _.repeat('0', process.env.MAX_UPLOAD_SIZE));
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
    const uploadService = express().use('/', upload).listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${uploadService.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          value: string2stream(_.repeat('0', process.env.MAX_UPLOAD_SIZE)),
          options: {
            filename: 'file.zip',
            contentType: 'text/plain',
            knownLength: process.env.MAX_UPLOAD_SIZE
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
      uploadService.close();
      t.end();
    });

  });

  test.test('request without dataFile parameter should return 400', t => {
    process.env.MAX_UPLOAD_SIZE = 1024;

    // start the service with the upload endpoint
    const uploadService = express()
      .use('/', require('../upload'))
      .listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${uploadService.address().port}/`,
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
      uploadService.close(() => t.end());
    });

  });

  test.test('non-zip/geojson/csv file extension should return error', t => {
    process.env.MAX_UPLOAD_SIZE = 1024;

    // start the service with the upload endpoint
    const uploadService = express()
      .use('/', require('../upload'))
      .listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${uploadService.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          value: string2stream(_.repeat('0', process.env.MAX_UPLOAD_SIZE)),
          options: {
            filename: 'file.txt',
            contentType: 'text/plain',
            knownLength: process.env.MAX_UPLOAD_SIZE
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
      uploadService.close(() => t.end());
    });

  });

  test.test('file upload size greater than MAX_UPLOAD_SIZE should return error', t => {
    process.env.MAX_UPLOAD_SIZE = 1024;

    // start the service with the upload endpoint
    const uploadService = express()
      .use('/', require('../upload'))
      .listen();

    request({
      uri: `http://localhost:${uploadService.address().port}/`,
      method: 'POST',
      formData: {
        datafile: {
          // create one more byte than the max supported
          value: string2stream(_.repeat('0', process.env.MAX_UPLOAD_SIZE+1)),
          options: {
            filename: 'file.zip',
            contentType: 'text/plain',
            knownLength: process.env.MAX_UPLOAD_SIZE+1
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
      t.equals(err.error, `max upload size is ${process.env.MAX_UPLOAD_SIZE}`);
    })
    .finally(() => {
      uploadService.close(() => t.end());
    });

  });

});
