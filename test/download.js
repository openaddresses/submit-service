const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const archiver = require('archiver');
const ZipContentsStream = require('./ZipContentsStream');

tape('error conditions', test => {
  test.test('invalid format value should return 400 and error message', t => {
    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download service
    request({
      uri: `http://localhost:${download_service.address().port}/download/rc/cc/file.json`,
      qs: {
        format: 'blah'
      },
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
          message: 'Unsupported output format: blah'
        }
      });
    })
    .finally(() => {
      download_service.close(() => t.end());
    });

  });

  test.test('catastrophic error occuring on OA results metadata file should return 500 and error', t => {
    // startup an server that will immediately be closed
    express().listen(function() {
      process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${this.address().port}/state.txt`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // start the service with the download endpoint
        const download_service = express().use('/download/*', require('../download')).listen();

        // make a request to the download service
        request({
          uri: `http://localhost:${download_service.address().port}/download/rc/cc/file.json`,
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
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the submit service
    request({
      uri: `http://localhost:${download_service.address().port}/download/sources/cc/rc/source.json`,
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

  test.test('source not found in metadata should return 400 and error message', t => {
    t.plan(3);

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const source_server = express().get('/state.txt', (req, res, next) => {
      const output_lines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', 'data url 1'].join('\t'),
        // notably missing cc/rc/file2.json, which is the point
        ['cc/rc/file3.json', 'data url 3'].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(output_lines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
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
      download_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic error on data file request should return 500 and error message', t => {
    t.plan(3);

    // startup a server that will immediately be closed
    express().listen(function() {
      const zip_file_port = this.address().port;

      this.close(() => {
        // startup a HTTP server that will respond with a 200 and tab-separated value file
        const source_server = express().get('/state.txt', (req, res, next) => {
          const output_lines = [
            ['source', 'processed'].join('\t'),
            ['cc/rc/file1.json', `http://localhost:${zip_file_port}/file1.zip`].join('\t'),
            ['cc/rc/file2.json', `http://localhost:${zip_file_port}/file2.zip`].join('\t'),
            ['cc/rc/file3.json', `http://localhost:${zip_file_port}/file3.zip`].join('\t')
          ].join('\n');

          res.status(200).type('text/plain').send(output_lines);
        }).listen();

        process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

        // start the service with the download endpoint
        const download_service = express().use('/download/*', require('../download')).listen();

        // make a request to the /download endpoint
        request({
          uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
          qs: {},
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail.bind(null, 'request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 500);
          t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(err.error, {
            error: {
              code: 500,
              message: `Error retrieving file http://localhost:${zip_file_port}/file2.zip: ECONNREFUSED`
            }
          });
        })
        .finally(() => {
          download_service.close(() => source_server.close(() => t.end()));
        });

      });

    });

  });

  test.test('data file not found should return 500 and error message', t => {
    t.plan(3);

    const datafile_server = express().get('/file2.zip', (req, res, next) => {
      res.status(404).type('text/plain').send('not found');
    }).listen();

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const source_server = express().get('/state.txt', (req, res, next) => {
      const output_lines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', `http://localhost:${datafile_server.address().port}/file1.zip`].join('\t'),
        ['cc/rc/file2.json', `http://localhost:${datafile_server.address().port}/file2.zip`].join('\t'),
        ['cc/rc/file3.json', `http://localhost:${datafile_server.address().port}/file3.zip`].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(output_lines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 500);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 500,
          message: `Error retrieving file http://localhost:${datafile_server.address().port}/file2.zip: not found (404)`
        }
      });
    })
    .finally(() => {
      download_service.close(() => source_server.close(() => datafile_server.close(() => t.end())));
    });

  });

  test.test('.csv file not found in zipped data file should return 500 and error message', t => {
    t.plan(3);

    const datafile_server = express().get('/file2.zip', (req, res, next) => {
      // create an output stream that will contain the zip file contents
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.finalize();

    }).listen();

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const source_server = express().get('/state.txt', (req, res, next) => {
      const output_lines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', `http://localhost:${datafile_server.address().port}/file1.zip`].join('\t'),
        ['cc/rc/file2.json', `http://localhost:${datafile_server.address().port}/file2.zip`].join('\t'),
        ['cc/rc/file3.json', `http://localhost:${datafile_server.address().port}/file3.zip`].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(output_lines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
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
          message: `http://localhost:${datafile_server.address().port}/file2.zip does not contain .csv file`
        }
      });
    })
    .finally(() => {
      download_service.close(() => source_server.close(() => datafile_server.close(() => t.end())));
    });

  });

});

tape('success conditions', test => {
  test.test('format=csv should return first .csv file in CSV format', t => {
    t.plan(3);

    const rows = [
      ['LON','LAT','NUMBER','STREET'].join(','),
      [21.212121, 12.121212, '123', 'Main Street'].join(','),
      [31.313131, 13.131313, '456', 'Maple Avenue'].join(',')
    ];

    const datafile_server = express().get('/file2.zip', (req, res, next) => {
      // create an output stream that will contain the zip file contents
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(rows.join('\n'), { name: 'cc/rc/place.csv' });
      // add another .csv file with just the header row, should not be output
      // this shows that only the first .csv file is output
      archive.append(rows[0], { name: 'cc/rc/unrelated_file.csv'});
      archive.finalize();

    }).listen();

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const source_server = express().get('/state.txt', (req, res, next) => {
      const output_lines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', `http://localhost:${datafile_server.address().port}/file1.zip`].join('\t'),
        ['cc/rc/file2.json', `http://localhost:${datafile_server.address().port}/file2.zip`].join('\t'),
        ['cc/rc/file3.json', `http://localhost:${datafile_server.address().port}/file3.zip`].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(output_lines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'text/csv; charset=utf-8');
      t.equals(response.body, rows.join('\n'));
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      download_service.close(() => source_server.close(() => datafile_server.close(() => t.end())));
    });

  });

  test.test('no format specified should return first .csv file in CSV format', t => {
    t.plan(3);

    const rows = [
      ['LON','LAT','NUMBER','STREET'].join(','),
      [21.212121, 12.121212, '123', 'Main Street'].join(','),
      [31.313131, 13.131313, '456', 'Maple Avenue'].join(',')
    ];

    const datafile_server = express().get('/file2.zip', (req, res, next) => {
      // create an output stream that will contain the zip file contents
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(rows.join('\n'), { name: 'cc/rc/place.csv' });
      // add another .csv file with just the header row, should not be output
      // this shows that only the first .csv file is output
      archive.append(rows[0], { name: 'cc/rc/unrelated_file.csv'});
      archive.finalize();

    }).listen();

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const source_server = express().get('/state.txt', (req, res, next) => {
      const output_lines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', `http://localhost:${datafile_server.address().port}/file1.zip`].join('\t'),
        ['cc/rc/file2.json', `http://localhost:${datafile_server.address().port}/file2.zip`].join('\t'),
        ['cc/rc/file3.json', `http://localhost:${datafile_server.address().port}/file3.zip`].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(output_lines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
      // format has not been specified
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'text/csv; charset=utf-8');
      t.equals(response.body, rows.join('\n'));
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      download_service.close(() => source_server.close(() => datafile_server.close(() => t.end())));
    });

  });

  test.test('format=geojson should return first .csv file in GeoJSON format', t => {
    t.plan(3);

    const rows = [
      ['LON','LAT','NUMBER','STREET'].join(','),
      [21.212121, 12.121212, '123', 'Main Street'].join(','),
      [31.313131, 13.131313, '456', 'Maple Avenue'].join(',')
    ];

    const datafile_server = express().get('/file2.zip', (req, res, next) => {
      // create an output stream that will contain the zip file contents
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(rows.join('\n'), { name: 'cc/rc/place.csv' });
      // add another .csv file with just the header row, should not be output
      // this shows that only the first .csv file is output
      archive.append(rows[0], { name: 'cc/rc/unrelated_file.csv'});
      archive.finalize();

    }).listen();

    // startup a HTTP server that will respond with a 200 and tab-separated value file
    const source_server = express().get('/state.txt', (req, res, next) => {
      const output_lines = [
        ['source', 'processed'].join('\t'),
        ['cc/rc/file1.json', `http://localhost:${datafile_server.address().port}/file1.zip`].join('\t'),
        ['cc/rc/file2.json', `http://localhost:${datafile_server.address().port}/file2.zip`].join('\t'),
        ['cc/rc/file3.json', `http://localhost:${datafile_server.address().port}/file3.zip`].join('\t')
      ].join('\n');

      res.status(200).type('text/plain').send(output_lines);
    }).listen();

    process.env.OPENADDRESSES_METADATA_FILE = `http://localhost:${source_server.address().port}/state.txt`;

    // start the service with the download endpoint
    const download_service = express().use('/download/*', require('../download')).listen();

    // make a request to the download endpoint
    request({
      uri: `http://localhost:${download_service.address().port}/download/cc/rc/file2.json`,
      qs: {
        format: 'geojson'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        type: 'FeatureCollection',
        features: [
          {
            geometry: {
              type: 'Point',
              coordinates: [
                21.212121,
                12.121212              
              ] 
            },
            properties: {
              NUMBER: '123',
              STREET: 'Main Street'
            }
          },
          {
            geometry: {
              type: 'Point',
              coordinates: [
                31.313131,
                13.131313              
              ] 
            },
            properties: {
              NUMBER: '456',
              STREET: 'Maple Avenue'
            }
          }
        ]
      });
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      download_service.close(() => source_server.close(() => datafile_server.close(() => t.end())));
    });

  });

});
