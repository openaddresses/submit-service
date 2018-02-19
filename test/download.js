const tape = require('tape');
const express = require('express');
const request = require('request-promise');

tape('error conditions', test => {
  test.test('catastrophic error occuring on OA results metadata file should return 500 and error', t => {
    // startup an ArcGIS server that will immediately be closed
    express().listen(function() {
      process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${this.address().port}/state.txt`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // start the service with the download endpoint
        const download_service = express().use('/', require('../download')).listen();

        // make a request to the submit service
        request({
          uri: `http://localhost:${download_service.address().port}/`,
          qs: {},
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 500);
          t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(err.error, {
            error: {
              code: 500,
              message: `Error retrieving file ${process.env.OPENADDRESSES_METADATA_FILE}: ECONNREFUSED`
            }
          });
        })
        .finally(() => {
          download_service.close(() => t.end());
        });

      });

    });

  });

  test.test('unable to get OA results metadata file should return 500 and error', t => {
    t.plan(3);

    // startup a HTTP server that will respond with a 404 and error message
    const source_server = express().get('/state.txt', (req, res, next) => {
      res.status(404).type('text/plain').send('OA results metadata file not found');
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/', require('../download')).listen();

    // make a request to the submit service
    request({
      uri: `http://localhost:${download_service.address().port}/`,
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 500);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 500,
          message: `Error retrieving file ${process.env.OPENADDRESSES_METADATA_FILE}: OA results metadata file not found (404)`
        }
      });
    })
    .finally(() => {
      download_service.close(() => source_server.close(() => t.end()));
    });

  });

});
