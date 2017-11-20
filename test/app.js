const tape = require('tape');
const request = require('request');
const _ = require('lodash');
const archiver = require('archiver');
const ZipContentsStream = require('./ZipContentsStream');

tape('arcgis tests', test => {
  test.test('fields and sample results', t => {
    const mock_arcgis_app = require('express')();
    mock_arcgis_app.get('/MapServer/0/query', (req, res, next) => {
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

    });

    const mock_arcgis_server = mock_arcgis_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_arcgis_server.address().port}/MapServer/0`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'ESRI',
        data: `http://localhost:${mock_arcgis_server.address().port}/MapServer/0`,
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

      t.end();
      mock_arcgis_server.close();
      mod_server.close();

    });

  });

  test.test('arcgis server returning error should return 400 w/message', t => {
    const mock_arcgis_app = require('express')();
    mock_arcgis_app.get('/MapServer/0/query', (req, res, next) => {
      res.status(404).send('page not found');
    });

    const mock_arcgis_server = mock_arcgis_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_arcgis_server.address().port}/MapServer/0`
      },
      json: true
    }, (err, response, body) => {
      let error_message = 'Error connecting to Arcgis server ';
      error_message += `http://localhost:${mock_arcgis_server.address().port}/MapServer/0`;
      error_message += ': page not found (404)';

      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, error_message);
      t.end();
      mock_arcgis_server.close();
      mod_server.close();

    });

  });

});

tape('geojson tests', test => {
  test.test('fields and sample results, should limit to 10', t => {

    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.geojson', (req, res, next) => {
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

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson`
      },
      json: true
    }, (error, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        data: `http://localhost:${mock_geojson_server.address().port}/file.geojson`,
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

      t.end();
      mock_geojson_server.close();
      mod_server.close();

    });

  });

  test.test('geojson consisting of less than 10 records should return all', t => {
    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.geojson', (req, res, next) => {
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

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        data: `http://localhost:${mock_geojson_server.address().port}/file.geojson`,
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

      t.end();
      mock_geojson_server.close();
      mod_server.close();

    });

  });

  test.test('geojson file returning error should return 400 w/message', t => {
    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.geojson', (req, res, next) => {
      res.status(404).send('page not found');
    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson`
      },
      json: true
    }, (err, response, body) => {
      let error_message = 'Error retrieving file ';
      error_message += `http://localhost:${mock_geojson_server.address().port}/file.geojson`;
      error_message += ': page not found (404)';

      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, error_message);
      t.end();

      mock_geojson_server.close();
      mod_server.close();

    });

  });

});

tape('csv tests', test => {
  test.test('fields and sample results, should limit to 10', t => {
    const mock_csv_app = require('express')();
    mock_csv_app.get('/file.csv', (req, res, next) => {
      const rows = _.range(20).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    });

    const mock_csv_server = mock_csv_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_csv_server.address().port}/file.csv`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        data: `http://localhost:${mock_csv_server.address().port}/file.csv`,
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

      t.end();
      mock_csv_server.close();
      mod_server.close();

    });

  });

  test.test('csv consisting of less than 10 records should return all', t => {

    const mock_csv_app = require('express')();
    mock_csv_app.get('/file.csv', (req, res, next) => {
      const rows = _.range(2).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    });

    const mock_csv_server = mock_csv_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_csv_server.address().port}/file.csv`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        data: `http://localhost:${mock_csv_server.address().port}/file.csv`,
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

      t.end();
      mock_csv_server.close();
      mod_server.close();

    });

  });

  test.test('csv file returning error should return 400 w/message', t => {
    const mock_cvs_app = require('express')();
    mock_cvs_app.get('/file.csv', (req, res, next) => {
      res.status(404).send('page not found');
    });

    const mock_csv_server = mock_cvs_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_csv_server.address().port}/file.csv`
      },
      json: true
    }, (err, response, body) => {
      let error_message = 'Error retrieving file ';
      error_message += `http://localhost:${mock_csv_server.address().port}/file.csv`;
      error_message += ': page not found (404)';

      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, error_message);
      t.end();

      mock_csv_server.close();
      mod_server.close();

    });

  });

  test.test('catastrophic errors should be handled', t => {
    const mock_cvs_app = require('express')();
    mock_cvs_app.get('/file.csv', (req, res, next) => {
      res.status(404).send('page not found');
    });

    const mock_csv_server = mock_cvs_app.listen();
    const mock_csv_server_port = mock_csv_server.address().port;

    // stop the express server to cause a connection-refused error
    mock_csv_server.close(() => {
      // once the server
      const mod_app = require('../app')();
      const mod_server = mod_app.listen();

      request.get(`http://localhost:${mod_server.address().port}/fields`, {
        qs: {
          source: `http://localhost:${mock_csv_server_port}/file.csv`
        },
        json: true
      }, (err, response, body) => {
        let error_message = 'Error retrieving file ';
        error_message += `http://localhost:${mock_csv_server_port}/file.csv: ECONNREFUSED`;

        t.equals(response.statusCode, 400);
        t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
        t.equals(body, error_message);
        t.end();

        mock_csv_server.close();
        mod_server.close();

      });

    });

  });

});

tape('zip tests', test => {
  test.test('geojson.zip: fields and sample results, should limit to 10', t => {
    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/data.zip', (req, res, next) => {
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
      archive.append(JSON.stringify(data, null, 2), { name: 'file.geojson' });
      archive.finalize();

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_geojson_server.address().port}/data.zip`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: `http://localhost:${mock_geojson_server.address().port}/data.zip`,
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

      t.end();
      mock_geojson_server.close();
      mod_server.close();

    });

  });

  test.test('geojson.zip: file consisting of less than 10 records should return all', t => {
    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/data.zip', (req, res, next) => {
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
      archive.append(JSON.stringify(data, null, 2), { name: 'file.geojson' });
      archive.finalize();

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_geojson_server.address().port}/data.zip`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: `http://localhost:${mock_geojson_server.address().port}/data.zip`,
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

      t.end();
      mock_geojson_server.close();
      mod_server.close();

    });

  });

  test.test('csv.zip: fields and sample results, should limit to 10', t => {
    const mock_csv_app = require('express')();
    mock_csv_app.get('/data.zip', (req, res, next) => {
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

    });

    const mock_csv_server = mock_csv_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_csv_server.address().port}/data.zip`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: `http://localhost:${mock_csv_server.address().port}/data.zip`,
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

      t.end();
      mock_csv_server.close();
      mod_server.close();

    });

  });

  test.test('csv.zip: file consisting of less than 10 records should return all', t => {
    const mock_csv_app = require('express')();
    mock_csv_app.get('/data.zip', (req, res, next) => {
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

    });

    const mock_csv_server = mock_csv_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_csv_server.address().port}/data.zip`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(body, {
        coverage: {},
        type: 'http',
        compression: 'zip',
        data: `http://localhost:${mock_csv_server.address().port}/data.zip`,
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

      t.end();
      mock_csv_server.close();
      mod_server.close();

    });

  });

});

tape('error conditions', test => {
  test.test('missing source parameter should return 400 and message', t => {
    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, '\'source\' parameter is required');
      t.end();
      mod_server.close();

    });

  });

  test.test('empty source parameter should return 400 and message', t => {
    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: ''
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, '\'source\' parameter is required');
      t.end();
      mod_server.close();

    });

  });

  test.test('unknown protocol/type should return 400 and message', t => {
    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: 'unsupported type'
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, 'Unsupported type');
      t.end();
      mod_server.close();

    });

  });

  test.test('cannot determine type from .zip file', t => {
    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/data.zip', (req, res, next) => {
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

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request.get(`http://localhost:${mod_server.address().port}/fields`, {
      qs: {
        source: `http://localhost:${mock_geojson_server.address().port}/data.zip`
      },
      json: true
    }, (err, response, body) => {
      t.equals(response.statusCode, 400);
      t.equals(response.headers['content-type'], 'text/plain; charset=utf-8');
      t.equals(body, 'Could not determine type from zip file');
      t.end();

      mock_geojson_server.close();
      mod_server.close();

    });

  });

});
