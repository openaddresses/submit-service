const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const archiver = require('archiver');
const ZipContentsStream = require('./ZipContentsStream');

tape('error conditions', test => {
  test.test('OPENADDRESSES_METADATA_FILE missing from environment should respond with error', t => {
    delete process.env.OPENADDRESSES_METADATA_FILE;

    // start the service with the download endpoint
    const downloadService = express().use('/download/*', require('../download')).listen();

    // make a request to the download service
    request({
      uri: `http://localhost:${downloadService.address().port}/download/rc/cc/file.json`,
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
          message: 'OPENADDRESSES_METADATA_FILE not defined in process environment'
        }
      });
    })
    .finally(() => {
      downloadService.close(() => t.end());
    });

  });

  test.test('catastrophic error occuring on OA results metadata file should return 500 and error', t => {
    // startup an server that will immediately be closed
    express().listen(function() {
      process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${this.address().port}/state.txt`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // start the service with the download endpoint
        const downloadService = express().use('/download/*', require('../download')).listen();

        // make a request to the download service
        request({
          uri: `http://localhost:${downloadService.address().port}/download/rc/cc/file.json`,
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
          downloadService.close(() => t.end());
        });

      });

    });

  });

  test.test('unable to get OA results metadata file should return 500 and error', t => {
    t.plan(3);

    // startup a HTTP server that will respond with a 404 and error message
    const sourceServer = express().get('/state.txt', (req, res, next) => {
      res.status(404).type('text/plain').send('OA results metadata file not found');
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${sourceServer.address().port}/state.txt`;

    // start the service with the download endpoint
    const downloadService = express().use('/download/*', require('../download')).listen();

    // make a request to the submit service
    request({
      uri: `http://localhost:${downloadService.address().port}/download/sources/cc/rc/source.json`,
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
      downloadService.close(() => sourceServer.close(() => t.end()));
    });

  });

  test.test('source not found in metadata should return 400 and error message', t => {
    t.plan(3);

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const sourceServer = express().get('/state.txt', (req, res, next) => {
      const outputLines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', 'data url 1'].join('\t'),
        // notably missing cc/rc/file2.json, which is the point
        ['cc/rc/file3.json', 'data url 3'].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(outputLines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${sourceServer.address().port}/state.txt`;

    // start the service with the download endpoint
    const downloadService = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${downloadService.address().port}/download/cc/rc/file2.json`,
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: `Unable to find cc/rc/file2.json in ${process.env.OPENADDRESSES_METADATA_FILE}`
        }
      });
    })
    .finally(() => {
      downloadService.close(() => sourceServer.close(() => t.end()));
    });

  });

});

tape('success conditions', test => {
  test.test('source found in metadata should return ', t => {
    t.plan(3);

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const sourceServer = express().get('/state.txt', (req, res, next) => {
      const outputLines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', 'data url 1'].join('\t'),
        ['cc/rc/file2.json', 'data url 2'].join('\t'),
        ['cc/rc/file3.json', 'data url 3'].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(outputLines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${sourceServer.address().port}/state.txt`;

    // start the service with the download endpoint
    const downloadService = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${downloadService.address().port}/download/cc/rc/file2.json`,
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        source: 'cc/rc/file2.json',
        latest: 'data url 2'
      });
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      downloadService.close(() => sourceServer.close(() => t.end()));
    });

  });

});
