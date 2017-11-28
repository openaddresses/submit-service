const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const _ = require('lodash');
const archiver = require('archiver');
const ZipContentsStream = require('./ZipContentsStream');
const io = require('indian-ocean');
const temp = require('temp');
const {FtpSrv, FileSystem} = require('ftp-srv');
const fs = require('fs');
const Duplex = require('stream').Duplex;
const getPort = require('get-port');
const string2stream = require('string-to-stream');

class MockFileSystem extends FileSystem {
  constructor(stream) {
    super(...arguments);
    this.stream = stream;
  }

  read(filename) {
    return this.stream;
  }

}

tape('arcgis tests', test => {
  test.test('fields and sample results', t => {
    // startup an ArcGIS server that will respond with a 200 and valid JSON
    const source_server = express().get('/MapServer/0/query', (req, res, next) => {
      t.equals(req.query.outFields, '*');
      t.equals(req.query.where, '1=1');
      t.equals(req.query.resultRecordCount, '10');
      t.equals(req.query.resultOffset, '0');

      res.status(200).send({
        fields: [
          { name: 'attribute1' },
          { name: 'attribute2' }
        ],
        features: [
          {
            attributes: {
              attribute1: 'feature 1 attribute 1 value',
              attribute2: 'feature 1 attribute 2 value'
            }
          },
          {
            attributes: {
              attribute1: 'feature 2 attribute 1 value',
              attribute2: 'feature 2 attribute 2 value'
            }
          }
        ]
      });

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/MapServer/0`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'ESRI',
        data: source,
        source_data: {
          fields: ['attribute1', 'attribute2'],
          results: [
            {
              attribute1: 'feature 1 attribute 1 value',
              attribute2: 'feature 1 attribute 2 value'
            },
            {
              attribute1: 'feature 2 attribute 1 value',
              attribute2: 'feature 2 attribute 2 value'
            }
          ]
        },
        conform: {
          type: 'geojson'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('arcgis server returning 200 non-JSON response should return error', t => {
    // startup an ArcGIS server that will respond with a 200 and invalid JSON
    const source_server = express().get('/MapServer/0/query', (req, res, next) => {
      t.equals(req.query.outFields, '*');
      t.equals(req.query.where, '1=1');
      t.equals(req.query.resultRecordCount, '10');
      t.equals(req.query.resultOffset, '0');

      res.status(200).send('this is not parseable as JSON');

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/MapServer/0`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error connecting to Arcgis server ${source}: Could not parse as JSON`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('arcgis server returning error should return 400 w/message', t => {
    // startup an ArcGIS server that will respond with a non-200
    const source_server = express().get('/MapServer/0/query', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/MapServer/0`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error connecting to Arcgis server ${source}: page not found (404)`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic arcgis errors should be handled', t => {
    // startup an ArcGIS server that will immediately be closed
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/MapServer/0`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // start the submit service
        const submit_service = require('../app')().listen();

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error connecting to Arcgis server ${source}: ECONNREFUSED`);
        })
        .finally(() => {
          submit_service.close(() => t.end());
        });

      });

    });

  });

});

tape('http geojson tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid JSON
    const source_server = express().get('/file.geojson', (req, res, next) => {
      res.status(200).send({
        type: 'FeatureCollection',
        features: _.range(11).reduce((features, i) => {
          features.push({
            type: 'Feature',
            properties: {
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            }
          });
          return features;
        }, [])
      });

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.geojson`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(10).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'geojson'
        }
      });

    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('geojson consisting of less than 10 records should return all', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid JSON
    const source_server = express().get('/file.geojson', (req, res, next) => {
      res.status(200).send({
        type: 'FeatureCollection',
        features: _.range(2).reduce((features, i) => {
          features.push({
            type: 'Feature',
            properties: {
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            }
          });
          return features;
        }, [])
      });

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.geojson`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(2).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'geojson'
        }
      });

    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('extra parameters in source should be ignored', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid JSON
    const source_server = express().get('/file.geojson', (req, res, next) => {
      // verify that any extra parameters supplied were actually passed to the source
      t.deepEquals(req.query, {
        parameter: 'value'
      });

      res.status(200).send({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              'attribute 1': `feature 1 attribute 1 value`,
              'attribute 2': `feature 1 attribute 2 value`
            }
          }
        ]
      });

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.geojson?parameter=value`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: [
            {
              'attribute 1': `feature 1 attribute 1 value`,
              'attribute 2': `feature 1 attribute 2 value`
            }
          ]
        },
        conform: {
          type: 'geojson'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('response unparseable as json should response with message', t => {
    // startup an HTTP server that will respond to file.geojson requests with invalid JSON
    const source_server = express().get('/file.geojson', (req, res, next) => {
      res.status(200).send('this is not parseable as JSON');
    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.geojson`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: Could not parse as JSON`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('geojson file returning error should return 400 w/message', t => {
    // startup an HTTP server that will respond to file.geojson requests with a 404
    const source_server = express().get('/file.geojson', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.geojson`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: page not found (404)`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic errors should be handled', t => {
    // startup an HTTP server that will immediately be closed
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/file.geojson`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // start the submit service
        const submit_service = require('../app')().listen();

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: ECONNREFUSED`);
        })
        .finally(() => {
          submit_service.close(() => t.end());
        });

      });

    });

  });

});

tape('http csv tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid CSV
    const source_server = express().get('/file.csv', (req, res, next) => {
      const rows = _.range(20).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.csv`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(10).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'csv'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('csv consisting of less than 10 records should return all', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid CSV
    const source_server = express().get('/file.csv', (req, res, next) => {
      const rows = _.range(2).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.csv`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(2).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'csv'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('extra parameters in source should be ignored', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid CSV
    const source_server = express().get('/file.csv', (req, res, next) => {
      // verify that any extra parameters supplied were actually passed to the source
      t.deepEquals(req.query, {
        parameter: 'value'
      });

      const rows = _.range(1).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    // source has extra parameters
    const source = `http://localhost:${source_server.address().port}/file.csv?parameter=value`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(1).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'csv'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('response unparseable as csv should respond with error', t => {
    // startup an HTTP server that will respond to file.geojson requests with valid CSV
    const source_server = express().get('/file.csv', (req, res, next) => {
      // generate invalid CSV (not enough columns)
      const data = [
        'attribute 1',
        'feature 1 attribute 1 value,feature 1 attribute 2 value'
      ].join('\n');

      res.status(200).send(data);

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.csv`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: Error: Number of columns on line 2 does not match header`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('csv file returning error should return 400 w/message', t => {
    // startup an HTTP server that will respond to file.geojson requests with a 404
    const source_server = express().get('/file.csv', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.csv`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: page not found (404)`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic errors should be handled', t => {
    // startup an HTTP server that will immediately be closed
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/file.csv`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // start the submit service
        const submit_service = require('../app')().listen();

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: ECONNREFUSED`);
        })
        .finally(() => {
          submit_service.close(() => t.end());
        });

      });

    });

  });

});

tape('http zip tests', test => {
  test.test('geojson.zip: fields and sample results, should limit to 10', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing a valid .geojson file
    const source_server = express().get('/data.zip', (req, res, next) => {
      // create an output stream that will contain the zip file contents
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const data = {
        type: 'FeatureCollection',
        features: _.range(11).reduce((features, i) => {
          features.push({
            type: 'Feature',
            properties: {
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            }
          });
          return features;
        }, [])
      };

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(JSON.stringify(data), { name: 'file.geojson' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(10).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'geojson'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('geojson.zip: file consisting of less than 10 records should return all', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing a valid .geojson file
    const source_server = express().get('/data.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const data = {
        type: 'FeatureCollection',
        features: _.range(2).reduce((features, i) => {
          features.push({
            type: 'Feature',
            properties: {
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            }
          });
          return features;
        }, [])
      };

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(JSON.stringify(data), { name: 'file.geojson' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(2).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'geojson'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('geojson.zip: response unparseable as json should response with message', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing an unparseable .geojson file
    const source_server = express().get('/data.zip', (req, res, next) => {
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
      archive.append('this is not parseable as JSON', { name: 'file.geojson' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: Could not parse as JSON`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('csv.zip: fields and sample results, should limit to 10', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing an parseable .csv file
    const source_server = express().get('/data.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const data = _.range(20).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(data.join('\n'), { name: 'file.csv' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(10).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'csv'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('csv.zip: file consisting of less than 10 records should return all', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing an parseable .csv file
    const source_server = express().get('/data.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const data = _.range(2).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(data.join('\n'), { name: 'file.csv' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: _.range(2).reduce((features, i) => {
            features.push({
              'attribute 1': `feature ${i} attribute 1 value`,
              'attribute 2': `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'csv'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('csv.zip: response unparseable as csv should respond with error', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing an parseable .csv file
    const source_server = express().get('/data.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      // generate invalid CSV (not enough columns)
      const data = [
        'attribute 1',
        'feature 1 attribute 1 value,feature 1 attribute 2 value'
      ].join('\n');

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(data, { name: 'file.csv' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: Error: Number of columns on line 2 does not match header`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('dbf.zip: fields and sample results, should limit to 10', t => {
    // THIS TEST IS SO MUCH COMPLICATED
    // mainly because there apparently are no DBF parsers for node that take a stream, they all take files

    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing an parseable .dbf file
    const source_server = express().get('/data.zip', (req, res, next) => {
      const records = _.range(11).reduce((features, i) => {
        features.push(
          {
            'attribute1': `feature ${i} attribute 1 value`,
            'attribute2': `feature ${i} attribute 2 value`
          }
        );
        return features;
      }, []);

      // create a stream wrapped around a temporary file with .dbf extension
      const stream = temp.createWriteStream({ suffix: '.dbf' });

      // write out the records to the temporary file
      io.writeData(stream.path, records, {
        columns: ['attribute1', 'attribute2']
      }, (err, dataString) => {

        // once the data has been written, create a stream of zip data from it
        //  and write out to the response
        const output = new ZipContentsStream();

        output.on('finish', function() {
          temp.cleanup(() => {
            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', 'attachment; filename=data.zip');
            res.set('Content-Length', this.buffer.length);
            res.end(this.buffer, 'binary');
          });
        });

        const archive = archiver('zip', {
          zlib: { level: 9 } // Sets the compression level.
        });
        archive.pipe(output);
        archive.append('this is the README', { name: 'README.md' });
        archive.file(stream.path, { name: 'file.dbf' });
        archive.finalize();

      });

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute1', 'attribute2'],
          results: _.range(10).reduce((features, i) => {
            features.push({
              attribute1: `feature ${i} attribute 1 value`,
              attribute2: `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'shapefile'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('dbf.zip: file consisting of less than 10 records should return all', t => {
    // THIS TEST IS SO MUCH COMPLICATED
    // mainly because there apparently are no DBF parsers for node that take a stream, they all take files

    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing an parseable .dbf file
    const source_server = express().get('/data.zip', (req, res, next) => {
      const records = _.range(2).reduce((features, i) => {
        features.push(
          {
            'attribute1': `feature ${i} attribute 1 value`,
            'attribute2': `feature ${i} attribute 2 value`
          }
        );
        return features;
      }, []);

      // create a stream wrapped around a temporary file with .dbf extension
      const stream = temp.createWriteStream({ suffix: '.dbf' });

      // write out the records to the temporary file
      io.writeData(stream.path, records, {
        columns: ['attribute1', 'attribute2']
      }, (err, dataString) => {

        // once the data has been written, create a stream of zip data from it
        //  and write out to the response
        const output = new ZipContentsStream();

        output.on('finish', function() {
          temp.cleanup(() => {
            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', 'attachment; filename=data.zip');
            res.set('Content-Length', this.buffer.length);
            res.end(this.buffer, 'binary');
          });
        });

        const archive = archiver('zip', {
          zlib: { level: 9 } // Sets the compression level.
        });
        archive.pipe(output);
        archive.append('this is the README', { name: 'README.md' });
        archive.file(stream.path, { name: 'file.dbf' });
        archive.finalize();

      });

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute1', 'attribute2'],
          results: _.range(2).reduce((features, i) => {
            features.push({
              attribute1: `feature ${i} attribute 1 value`,
              attribute2: `feature ${i} attribute 2 value`
            });
            return features;
          }, [])
        },
        conform: {
          type: 'shapefile'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('zip file returning error should return 400 w/message', t => {
    // startup an HTTP server that will respond to file.zip requests with a 404
    const source_server = express().get('/file.zip', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/file.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: page not found (404)`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('non-zip file returned should respond with error', t => {
    const source_server = express().get('/data.zip', (req, res, next) => {
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename=data.zip');
      res.set('Content-Length', 'this is not a zip file'.length);
      res.end('this is not a zip file', 'binary');

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, `Error retrieving file ${source}: Error: Invalid signature in zip file`);
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic errors should be handled', t => {
    // startup an HTTP server that will immediately be closed
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/file.zip`;

      this.close(() => {
        // start the submit service
        const submit_service = require('../app')().listen();

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: ECONNREFUSED`);
        })
        .finally(() => {
          submit_service.close(() => t.end());
        });

      });

    });

  });

  test.test('extra parameters in source should be ignored', t => {
    // startup an HTTP server that will respond to data.zip requests with .zip
    // file containing a valid .geojson file
    const source_server = express().get('/data.zip', (req, res, next) => {
      // verify that any extra parameters supplied were actually passed to the source
      t.deepEquals(req.query, {
        parameter: 'value'
      });

      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=data.zip');
        res.set('Content-Length', this.buffer.length);
        res.end(this.buffer, 'binary');
      });

      const data = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              'attribute 1': 'feature 1 attribute 1 value',
              'attribute 2': 'feature 1 attribute 2 value'
            }
          }
        ]
      };

      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
      archive.pipe(output);
      archive.append('this is the README', { name: 'README.md' });
      archive.append(JSON.stringify(data, null, 2), { name: 'file.geojson' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    const source = `http://localhost:${source_server.address().port}/data.zip?parameter=value`;

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: source
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: source,
        source_data: {
          fields: ['attribute 1', 'attribute 2'],
          results: [
            {
              'attribute 1': 'feature 1 attribute 1 value',
              'attribute 2': 'feature 1 attribute 2 value'
            }
          ]
        },
        conform: {
          type: 'geojson'
        }
      });
    })
    .catch(err => t.fail(err))
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

  test.test('cannot determine type from .zip file', t => {
    const source_server = express().get('/data.zip', (req, res, next) => {
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
      archive.append('this is an HTML file', { name: 'index.html' });
      archive.append('this is another file', { name: 'random_file.txt' });
      archive.finalize();

    }).listen();

    // start the submit service
    const submit_service = require('../app')().listen();

    // make a request to the submit service
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: `http://localhost:${source_server.address().port}/data.zip`
      },
      json: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, 'Could not determine type from zip file');
    })
    .finally(() => {
      submit_service.close(() => source_server.close(() => t.end()));
    });

  });

});

tape('ftp geojson tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          // generate 11 features to serve back via FTP
          const features = {
            type: 'FeatureCollection',
            features: _.range(11).reduce((features, i) => {
              features.push({
                type: 'Feature',
                properties: {
                  'attribute 1': `feature ${i} attribute 1 value`,
                  'attribute 2': `feature ${i} attribute 2 value`
                }
              });
              return features;
            }, [])
          };

          resolve( { fs: new MockFileSystem(string2stream(JSON.stringify(features))) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.geojson`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => {
          t.equals(response.statusCode, 200);
          t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(response.body, {
            coverage: {},
            type: 'ftp',
            data: source,
            source_data: {
              fields: ['attribute 1', 'attribute 2'],
              results: _.range(10).reduce((features, i) => {
                features.push({
                  'attribute 1': `feature ${i} attribute 1 value`,
                  'attribute 2': `feature ${i} attribute 2 value`
                });
                return features;
              }, [])
            },
            conform: {
              type: 'geojson'
            }
          });
        })
        .catch(err => t.fail(err))
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('geojson consisting of less than 10 records should return all', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          // generate 3 features to serve back via FTP
          const features = {
            type: 'FeatureCollection',
            features: _.range(3).reduce((features, i) => {
              features.push({
                type: 'Feature',
                properties: {
                  'attribute 1': `feature ${i} attribute 1 value`,
                  'attribute 2': `feature ${i} attribute 2 value`
                }
              });
              return features;
            }, [])
          };

          resolve( { fs: new MockFileSystem(string2stream(JSON.stringify(features))) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.geojson`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => {
          t.equals(response.statusCode, 200);
          t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(response.body, {
            coverage: {},
            type: 'ftp',
            data: source,
            source_data: {
              fields: ['attribute 1', 'attribute 2'],
              results: _.range(3).reduce((features, i) => {
                features.push({
                  'attribute 1': `feature ${i} attribute 1 value`,
                  'attribute 2': `feature ${i} attribute 2 value`
                });
                return features;
              }, [])
            },
            conform: {
              type: 'geojson'
            }
          });
        })
        .catch(err => t.fail(err))
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('response unparseable as json should response with message', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          resolve( { fs: new MockFileSystem(string2stream('this is not parseable as JSON')) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.geojson`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: Could not parse as JSON`);
        })
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('username and password should be passed to FTP server', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          t.equals(credentials.username, 'UsErNaMe');
          t.equals(credentials.password, 'pAsSwOrD');

          // generate 11 features to serve back via FTP
          const features = {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  'attribute 1': 'feature 1 attribute 1 value',
                  'attribute 2': 'feature 1 attribute 2 value'
                }
              }
            ]
          };

          resolve( { fs: new MockFileSystem(string2stream(JSON.stringify(features))) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://UsErNaMe:pAsSwOrD@127.0.0.1:${port}/file.geojson`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => {
          t.equals(response.statusCode, 200);
          t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(response.body, {
            coverage: {},
            type: 'ftp',
            data: source,
            source_data: {
              fields: ['attribute 1', 'attribute 2'],
              results: [
                {
                  'attribute 1': 'feature 1 attribute 1 value',
                  'attribute 2': 'feature 1 attribute 2 value'
                }
              ]
            },
            conform: {
              type: 'geojson'
            }
          });
        })
        .catch(err => t.fail(err))
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('invalid login credentials should return error', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp server that will fail authentication
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve, reject) => {
          reject( { message: 'Invalid username/password'} );
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.geojson`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: Authentication error`);
        })
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

});

tape('ftp csv tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          // generate 11 features to serve back via FTP
          const rows = _.range(11).reduce((rows, i) => {
            return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
          }, ['attribute 1,attribute 2']);

          resolve( { fs: new MockFileSystem(string2stream(rows.join('\n'))) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.csv`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => {
          t.equals(response.statusCode, 200);
          t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(response.body, {
            coverage: {},
            type: 'ftp',
            data: source,
            source_data: {
              fields: ['attribute 1', 'attribute 2'],
              results: _.range(10).reduce((features, i) => {
                features.push({
                  'attribute 1': `feature ${i} attribute 1 value`,
                  'attribute 2': `feature ${i} attribute 2 value`
                });
                return features;
              }, [])
            },
            conform: {
              type: 'csv'
            }
          });
        })
        .catch(err => t.fail(err))
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('csv consisting of less than 10 records should return all', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          // generate 11 features to serve back via FTP
          const rows = _.range(5).reduce((rows, i) => {
            return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
          }, ['attribute 1,attribute 2']);

          resolve( { fs: new MockFileSystem(string2stream(rows.join('\n'))) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.csv`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => {
          t.equals(response.statusCode, 200);
          t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(response.body, {
            coverage: {},
            type: 'ftp',
            data: source,
            source_data: {
              fields: ['attribute 1', 'attribute 2'],
              results: _.range(5).reduce((features, i) => {
                features.push({
                  'attribute 1': `feature ${i} attribute 1 value`,
                  'attribute 2': `feature ${i} attribute 2 value`
                });
                return features;
              }, [])
            },
            conform: {
              type: 'csv'
            }
          });
        })
        .catch(err => t.fail(err))
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('response unparseable as csv should respond with error', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          // generate invalid CSV (not enough columns)
          const data = [
            'attribute 1',
            'feature 1 attribute 1 value,feature 1 attribute 2 value'
          ].join('\n');

          resolve( { fs: new MockFileSystem(string2stream(data)) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.csv`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: Error: Number of columns on line 2 does not match header`);
        })
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('username and password should be passed to FTP server', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp and submit-service servers and make the request
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve) => {
          t.equals(credentials.username, 'UsErNaMe');
          t.equals(credentials.password, 'pAsSwOrD');

          const data = [
            'attribute 1,attribute 2',
            'feature 1 attribute 1 value,feature 1 attribute 2 value'
          ].join('\n');

          resolve( { fs: new MockFileSystem(string2stream(data)) });
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://UsErNaMe:pAsSwOrD@127.0.0.1:${port}/file.csv`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => {
          t.equals(response.statusCode, 200);
          t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
          t.deepEquals(response.body, {
            coverage: {},
            type: 'ftp',
            data: source,
            source_data: {
              fields: ['attribute 1', 'attribute 2'],
              results: [
                {
                  'attribute 1': 'feature 1 attribute 1 value',
                  'attribute 2': 'feature 1 attribute 2 value'
                }
              ]
            },
            conform: {
              type: 'csv'
            }
          });
        })
        .catch(err => t.fail(err))
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('invalid login credentials should return error', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp server that will fail authentication
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve, reject) => {
          reject( { message: 'Invalid username/password'} );
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.csv`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: Authentication error`);
        })
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

});

tape('ftp zip tests', test => {
  test.test('dbf.zip: fields and sample results, should limit to 10', t => {
    // generate 11 features
    const records = _.range(11).reduce((features, i) => {
      features.push(
        {
          'attribute1': `feature ${i} attribute 1 value`,
          'attribute2': `feature ${i} attribute 2 value`
        }
      );
      return features;
    }, []);

    // create a stream wrapped around a temporary file with .dbf extension
    const stream = temp.createWriteStream({ suffix: '.dbf' });

    // write out the records to the temporary file
    io.writeDataSync(stream.path, records, {
      columns: ['attribute1', 'attribute2']
    });

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.file(stream.path, { name: 'file.dbf' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          // verify that the login was anonymous
          ftp_server.on('login', (credentials, resolve) => {
            t.equals(credentials.username, 'anonymous');
            t.equals(credentials.password, '@anonymous');
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then((response, body) => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute1', 'attribute2'],
                results: _.range(10).reduce((features, i) => {
                  features.push({
                    attribute1: `feature ${i} attribute 1 value`,
                    attribute2: `feature ${i} attribute 2 value`
                  });
                  return features;
                }, [])
              },
              conform: {
                type: 'shapefile'
              }
            });

          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('dbf.zip: file consisting of less than 10 records should return all', t => {
    // generate 2 features
    const records = _.range(2).reduce((features, i) => {
      features.push(
        {
          'attribute1': `feature ${i} attribute 1 value`,
          'attribute2': `feature ${i} attribute 2 value`
        }
      );
      return features;
    }, []);

    // create a stream wrapped around a temporary file with .dbf extension
    const stream = temp.createWriteStream({ suffix: '.dbf' });

    // write out the records to the temporary file
    io.writeDataSync(stream.path, records, {
      columns: ['attribute1', 'attribute2']
    });

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.file(stream.path, { name: 'file.dbf' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', (data, resolve) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then((response, body) => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute1', 'attribute2'],
                results: _.range(2).reduce((features, i) => {
                  features.push({
                    attribute1: `feature ${i} attribute 1 value`,
                    attribute2: `feature ${i} attribute 2 value`
                  });
                  return features;
                }, [])
              },
              conform: {
                type: 'shapefile'
              }
            });

          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('geojson.zip: fields and sample results, should limit to 10', t => {
    // generate 11 features
    const data = {
      type: 'FeatureCollection',
      features: _.range(11).reduce((features, i) => {
        features.push({
          type: 'Feature',
          properties: {
            'attribute 1': `feature ${i} attribute 1 value`,
            'attribute 2': `feature ${i} attribute 2 value`
          }
        });
        return features;
      }, [])
    };

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append(JSON.stringify(data, null, 2), { name: 'file.geojson' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', (data, resolve) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then((response, body) => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute 1', 'attribute 2'],
                results: _.range(10).reduce((features, i) => {
                  features.push({
                    'attribute 1': `feature ${i} attribute 1 value`,
                    'attribute 2': `feature ${i} attribute 2 value`
                  });
                  return features;
                }, [])
              },
              conform: {
                type: 'geojson'
              }
            });
          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('geojson.zip: file consisting of less than 10 records should return all', t => {
    // generate 11 features
    const data = {
      type: 'FeatureCollection',
      features: _.range(7).reduce((features, i) => {
        features.push({
          type: 'Feature',
          properties: {
            'attribute 1': `feature ${i} attribute 1 value`,
            'attribute 2': `feature ${i} attribute 2 value`
          }
        });
        return features;
      }, [])
    };

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append(JSON.stringify(data, null, 2), { name: 'file.geojson' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          }).then(response => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute 1', 'attribute 2'],
                results: _.range(7).reduce((features, i) => {
                  features.push({
                    'attribute 1': `feature ${i} attribute 1 value`,
                    'attribute 2': `feature ${i} attribute 2 value`
                  });
                  return features;
                }, [])
              },
              conform: {
                type: 'geojson'
              }
            });

          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('geojson.zip: response unparseable as json should response with message', t => {
    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append('this is not parseable as JSON', { name: 'file.geojson' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', (data, resolve) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then(response => t.fail('request should not have been successful'))
          .catch(err => {
            t.equals(err.statusCode, 400);
            t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
            t.equals(err.error, `Error retrieving file ${source}: Could not parse as JSON`);
          })
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('csv.zip: fields and sample results, should limit to 10', t => {
    // generate 11 features
    const data = _.range(20).reduce((rows, i) => {
      return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
    }, ['attribute 1,attribute 2']);

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append(data.join('\n'), { name: 'file.csv' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then(response => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute 1', 'attribute 2'],
                results: _.range(10).reduce((features, i) => {
                  features.push({
                    'attribute 1': `feature ${i} attribute 1 value`,
                    'attribute 2': `feature ${i} attribute 2 value`
                  });
                  return features;
                }, [])
              },
              conform: {
                type: 'csv'
              }
            });

          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('csv.zip: file consisting of less than 10 records should return all', t => {
    // generate 11 features
    const data = _.range(6).reduce((rows, i) => {
      return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
    }, ['attribute 1,attribute 2']);

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append(data.join('\n'), { name: 'file.csv' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then(response => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute 1', 'attribute 2'],
                results: _.range(6).reduce((features, i) => {
                  features.push({
                    'attribute 1': `feature ${i} attribute 1 value`,
                    'attribute 2': `feature ${i} attribute 2 value`
                  });
                  return features;
                }, [])
              },
              conform: {
                type: 'csv'
              }
            });

          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });
          });

        });

      });

    });

  });

  test.test('csv.zip: response unparseable as csv should respond with error', t => {
    // generate invalid CSV (not enough columns)
    const data = [
      'attribute 1',
      'feature 1 attribute 1 value,feature 1 attribute 2 value'
    ].join('\n');

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append(data, { name: 'file.csv' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then(response => t.fail('request should not have been successful'))
          .catch(err => {
            t.equals(err.statusCode, 400);
            t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
            t.equals(err.error, `Error retrieving file ${source}: Error: Number of columns on line 2 does not match header`);
          })
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('username and password should be passed to FTP server', t => {
    // generate 1 feature
    const data = [
      'attribute 1,attribute 2',
      'feature 1 attribute 1 value,feature 1 attribute 2 value'
    ];

    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append(data.join('\n'), { name: 'file.csv' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          // also verify the username/password
          ftp_server.on('login', ( credentials , resolve, reject) => {
            t.equals(credentials.username, 'UsErNaMe');
            t.equals(credentials.password, 'pAsSwOrD');
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          const source = `ftp://UsErNaMe:pAsSwOrD@127.0.0.1:${port}/file.zip`;

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: source
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then(response => {
            t.equals(response.statusCode, 200);
            t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
            t.deepEquals(response.body, {
              coverage: {},
              type: 'ftp',
              data: source,
              compression: 'zip',
              source_data: {
                fields: ['attribute 1', 'attribute 2'],
                results: [
                  {
                    'attribute 1': `feature 1 attribute 1 value`,
                    'attribute 2': `feature 1 attribute 2 value`
                  }
                ]
              },
              conform: {
                type: 'csv'
              }
            });

          })
          .catch(err => t.fail(err))
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });
          });

        });

      });

    });

  });

  test.test('invalid login credentials should return error', t => {
    // get a random port for the FTP server
    getPort().then(port => {
      const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

      // fire up the ftp server that will fail authentication
      ftp_server.listen().then(() => {
        ftp_server.on('login', (credentials, resolve, reject) => {
          reject( { message: 'Invalid username/password'} );
        });

        // start the submit service
        const submit_service = require('../app')().listen();

        const source = `ftp://127.0.0.1:${port}/file.zip`;

        // make a request to the submit service
        request({
          uri: `http://localhost:${submit_service.address().port}/fields`,
          qs: {
            source: source
          },
          json: true,
          resolveWithFullResponse: true
        })
        .then(response => t.fail('request should not have been successful'))
        .catch(err => {
          t.equals(err.statusCode, 400);
          t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
          t.equals(err.error, `Error retrieving file ${source}: Authentication error`);
        })
        .finally(() => {
          // close ftp server -> app server -> tape
          ftp_server.close().then(() => {
            submit_service.close(() => {
              t.end();
            });
          });

        });

      });

    });

  });

  test.test('cannot determine type from .zip file', t => {
    // once the data has been written, create a stream of zip data from it
    //  and write out to the response
    const output = new ZipContentsStream();

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    archive.pipe(output);
    archive.append('this is the README', { name: 'README.md' });
    archive.append('this is an HTML file', { name: 'index.html' });
    archive.append('this is another file', { name: 'random_file.txt' });
    archive.finalize();

    // when the zip stream has been written, proceed
    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      // get a random port for the FTP server
      getPort().then(port => {
        const ftp_server = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftp_server.listen().then(() => {
          // when a login is attempted on the FTP server, respond with a mock filesystem
          ftp_server.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          // start the submit service
          const submit_service = require('../app')().listen();

          // make a request to the submit service
          request({
            uri: `http://localhost:${submit_service.address().port}/fields`,
            qs: {
              source: `ftp://127.0.0.1:${port}/file.zip`
            },
            json: true,
            resolveWithFullResponse: true
          })
          .then(response => t.fail('request should not have been successful'))
          .catch(err => {
            t.equals(err.statusCode, 400);
            t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
            t.equals(err.error, 'Could not determine type from zip file');
          })
          .finally(() => {
            // close ftp server -> app server -> tape
            ftp_server.close().then(() => {
              submit_service.close(() => {
                t.end();
              });
            });
          });

        });

      });

    });

  });

});

tape('error conditions', test => {
  test.test('missing source parameter should return 400 and message', t => {
    // start the submit service
    const submit_service = require('../app')().listen();

    // make a request to the submit service without a 'source' parameter
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, '\'source\' parameter is required');
    })
    .finally(() => {
      submit_service.close(() => t.end());
    });

  });

  test.test('empty source parameter should return 400 and message', t => {
    // start the submit service
    const submit_service = require('../app')().listen();

    // make a request to the submit service with an empty 'source' parameter
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: ''
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, '\'source\' parameter is required');
    })
    .finally(() => {
      submit_service.close(() => t.end());
    });

  });

  test.test('unknown protocol/type should return 400 and message', t => {
    // start the submit service
    const submit_service = require('../app')().listen();

    // make a request to the submit service with an unsupported type
    request({
      uri: `http://localhost:${submit_service.address().port}/fields`,
      qs: {
        source: 'unsupported type'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => t.fail('request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(err.error, 'Unable to parse URL from \'unsupported type\'');
    })
    .finally(() => {
      submit_service.close(() => t.end());
    });

  });

});
