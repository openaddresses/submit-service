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
    const mock_source_server = express().get('/MapServer/0/query', (req, res, next) => {
      t.equals(req.query.outFields, '*');
      t.equals(req.query.where, '1=1');
      t.equals(req.query.resultRecordCount, '10');
      t.equals(req.query.resultOffset, '0');

      res.status(200).send({
        fields: [
          {
            name: 'attribute1'
          },
          {
            name: 'attribute2'
          }
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/MapServer/0`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('arcgis server returning error should return 400 w/message', t => {
    const mock_source_server = express().get('/MapServer/0/query', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();
    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/MapServer/0`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic arcgis errors should be handled', t => {
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/MapServer/0`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // once the server has stopped, make a request that will fail
        const mod_server = require('../app')().listen();

        request({
          uri: `http://localhost:${mod_server.address().port}/fields`,
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
          mod_server.close(() => t.end());
        });

      });

    });

  });

});

tape('geojson tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    const mock_source_server = express().get('/file.geojson', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.geojson`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('geojson consisting of less than 10 records should return all', t => {
    const mock_source_server = express().get('/file.geojson', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.geojson`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('extra parameters in source should be ignored', t => {
    const mock_source_server = express().get('/file.geojson', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.geojson?param=value`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('geojson file returning error should return 400 w/message', t => {
    const mock_source_server = express().get('/file.geojson', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.geojson`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic errors should be handled', t => {
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/file.geojson`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // once the server has stopped, make a request that will fail
        const mod_server = require('../app')().listen();

        request({
          uri: `http://localhost:${mod_server.address().port}/fields`,
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
          mod_server.close(() => t.end());
        });

      });

    });

  });

});

tape('csv tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    const mock_source_server = express().get('/file.csv', (req, res, next) => {
      const rows = _.range(20).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    }).listen();

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.csv`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('csv consisting of less than 10 records should return all', t => {
    const mock_source_server = express().get('/file.csv', (req, res, next) => {
      const rows = _.range(2).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    }).listen();

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.csv`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('extra parameters in source should be ignored', t => {
    const mock_source_server = express().get('/file.csv', (req, res, next) => {
      const rows = _.range(1).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    }).listen();

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.csv?parameter=value`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('csv file returning error should return 400 w/message', t => {
    const mock_source_server = express().get('/file.csv', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.csv`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic errors should be handled', t => {
    express().listen(function() {
      const source = `http://localhost:${this.address().port}/file.csv`;

      // stop the express server to cause a connection-refused error
      this.close(() => {
        // once the server has stopped, make a request that will fail
        const mod_server = require('../app')().listen();

        request({
          uri: `http://localhost:${mod_server.address().port}/fields`,
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
          mod_server.close(() => t.end());
        });

      });

    });

  });

});

tape('zip tests', test => {
  test.test('geojson.zip: fields and sample results, should limit to 10', t => {
    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('geojson.zip: file consisting of less than 10 records should return all', t => {
    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('csv.zip: fields and sample results, should limit to 10', t => {
    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('csv.zip: file consisting of less than 10 records should return all', t => {
    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('dbf.zip: fields and sample results, should limit to 10', t => {
    // THIS TEST IS SO MUCH COMPLICATED
    // mainly because there apparently are no DBF parsers for node that take a stream, they all take files

    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('dbf.zip: file consisting of less than 10 records should return all', t => {
    // THIS TEST IS SO MUCH COMPLICATED
    // mainly because there apparently are no DBF parsers for node that take a stream, they all take files

    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('zip file returning error should return 400 w/message', t => {
    const mock_source_server = express().get('/file.zip', (req, res, next) => {
      res.status(404).send('page not found');
    }).listen();

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.zip`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('catastrophic errors should be handled', t => {
    const mock_source_server = express().listen();

    const source = `http://localhost:${mock_source_server.address().port}/file.zip`;

    mock_source_server.close(() => {
      const mod_server = require('../app')().listen();

      request({
        uri: `http://localhost:${mod_server.address().port}/fields`,
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
        mod_server.close(() => mock_source_server.close(() => t.end()));
      });

    });

  });

  test.test('extra parameters in source should be ignored', t => {
    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    const source = `http://localhost:${mock_source_server.address().port}/data.zip?parameter=value`;

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

  test.test('cannot determine type from .zip file', t => {
    const mock_source_server = express().get('/data.zip', (req, res, next) => {
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

    const mod_server = require('../app')().listen();

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
      qs: {
        source: `http://localhost:${mock_source_server.address().port}/data.zip`
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
      mod_server.close(() => mock_source_server.close(() => t.end()));
    });

  });

});

tape('error conditions', test => {
  test.test('missing source parameter should return 400 and message', t => {
    const mod_server = require('../app')().listen();

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => t.end());
    });

  });

  test.test('empty source parameter should return 400 and message', t => {
    const mod_server = require('../app')().listen();

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => t.end());
    });

  });

  test.test('unknown protocol/type should return 400 and message', t => {
    const mod_server = require('../app')().listen();

    request({
      uri: `http://localhost:${mod_server.address().port}/fields`,
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
      mod_server.close(() => t.end());
    });

  });

});

tape('ftp tests', test => {
  test.test('dbf.zip: fields and sample results, should limit to 10', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', (data, resolve) => {
            t.equals(data.username, 'anonymous');
            t.equals(data.password, '@anonymous');
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('dbf.zip: file consisting of less than 10 records should return all', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', (data, resolve) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('geojson.zip: fields and sample results, should limit to 10', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', (data, resolve) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('geojson.zip: file consisting of less than 10 records should return all', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('csv.zip: fields and sample results, should limit to 10', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });

          });

        });

      });

    });

  });

  test.test('csv.zip: fields and sample results, should limit to 10', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });
          });

        });

      });

    });

  });

  test.test('username and password should be passed to FTP server', t => {
    const mod_server = require('../app')().listen();

    // generate 1 feature
    const data = _.range(1).reduce((rows, i) => {
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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', ( data , resolve, reject) => {
            t.equals(data.username, 'UsErNaMe');
            t.equals(data.password, 'pAsSwOrD');
            resolve( { fs: new MockFileSystem(stream) });
          });

          const source = `ftp://UsErNaMe:pAsSwOrD@127.0.0.1:${port}/file.zip`;

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            // close ftp server -> app server -> tape
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });
          });

        });

      });

    });

  });

  test.test('cannot determine type from .zip file', t => {
    const mod_server = require('../app')().listen();

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

    output.on('finish', function() {
      // convert the buffer to a stream
      const stream = new Duplex();
      stream.push(this.buffer);
      stream.push(null);

      getPort().then(port => {
        const ftpServer = new FtpSrv(`ftp://127.0.0.1:${port}`);

        // fire up the ftp and submit-service servers and make the request
        ftpServer.listen().then(() => {
          ftpServer.on('login', ( data , resolve, reject) => {
            resolve( { fs: new MockFileSystem(stream) });
          });

          request({
            uri: `http://localhost:${mod_server.address().port}/fields`,
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
            ftpServer.close().then(() => {
              mod_server.close(() => {
                t.end();
              });
            });
          });

        });

      });

    });

  });

});
