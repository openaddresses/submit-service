const tape = require('tape');
const request = require('superagent');
const _ = require('lodash');
const archiver = require('archiver');
const ZipContentsStream = require('./ZipContentsStream');

tape('esri tests', test => {
  test.test('fields and sample results', t => {
    const mock_esri_app = require('express')();
    mock_esri_app.get('/MapServer/0/query', (req, res, next) => {
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

    const mock_esri_server = mock_esri_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_esri_server.address().port}/MapServer/0`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'ESRI',
          data: `http://localhost:${mock_esri_server.address().port}/MapServer/0`,
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
        mock_esri_server.close();
        mod_server.close();
      });

  });

  test.test('esri server returning error should return 400 w/message', t => {
    const mock_esri_app = require('express')();
    mock_esri_app.get('/MapServer/0/query', (req, res, next) => {
      res.status(404).send('page not found');
    });

    const mock_esri_server = mock_esri_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_esri_server.address().port}/MapServer/0`
      })
      .end((err, response) => {
        let error_message = 'Error connecting to ESRI server ';
        error_message += `http://localhost:${mock_esri_server.address().port}/MapServer/0`;
        error_message += ': page not found (404)';

        t.equals(response.statusCode, 400);
        t.equals(response.error.text, error_message);
        t.end();

        mock_esri_server.close();
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

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
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

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
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

});

tape('zip tests', test => {
  test.test('fields and sample results, should limit to 10', t => {

    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.geojson.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=file.geojson.zip');
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
      archive.append(JSON.stringify(data, null, 2), { name: 'file1.geojson' });
      archive.finalize();

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson.zip`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'http',
          compression: 'zip',
          data: `http://localhost:${mock_geojson_server.address().port}/file.geojson.zip`,
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
    mock_geojson_app.get('/file.geojson.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=file.geojson.zip');
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
      archive.append(JSON.stringify(data, null, 2), { name: 'file1.geojson' });
      archive.finalize();

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.geojson.zip`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'http',
          compression: 'zip',
          data: `http://localhost:${mock_geojson_server.address().port}/file.geojson.zip`,
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

  test.test('fields and sample results, should limit to 10', t => {

    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.csv.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=file.csv.zip');
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
      archive.append(data.join('\n'), { name: 'file1.csv' });
      archive.finalize();

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.csv.zip`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'http',
          compression: 'zip',
          data: `http://localhost:${mock_geojson_server.address().port}/file.csv.zip`,
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
        mock_geojson_server.close();
        mod_server.close();
      });

  });

  test.test('csv consisting of less than 10 records should return all', t => {

    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.csv.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=file.csv.zip');
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
      archive.append(data.join('\n'), { name: 'file1.csv' });
      archive.finalize();

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.csv.zip`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'http',
          compression: 'zip',
          data: `http://localhost:${mock_geojson_server.address().port}/file.csv.zip`,
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
        mock_geojson_server.close();
        mod_server.close();
      });

  });

});

tape('csv tests', test => {
  test.test('fields and sample results, should limit to 10', t => {

    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.csv', (req, res, next) => {
      const rows = _.range(20).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.csv`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'http',
          data: `http://localhost:${mock_geojson_server.address().port}/file.csv`,
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
        mock_geojson_server.close();
        mod_server.close();
      });

  });

  test.test('csv consisting of less than 10 records should return all', t => {

    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.csv', (req, res, next) => {
      const rows = _.range(2).reduce((rows, i) => {
        return rows.concat(`feature ${i} attribute 1 value,feature ${i} attribute 2 value`);
      }, ['attribute 1,attribute 2']);

      res.status(200).send(rows.join('\n'));

    });

    const mock_geojson_server = mock_geojson_app.listen();

    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.csv`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 200);
        t.deepEquals(JSON.parse(response.text), {
          coverage: {},
          type: 'http',
          data: `http://localhost:${mock_geojson_server.address().port}/file.csv`,
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
        mock_geojson_server.close();
        mod_server.close();
      });

  });

});

tape('error conditions', test => {
  test.test('missing source parameter should return 400 and message', t => {
    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .end((err, response) => {
        t.equals(response.statusCode, 400);
        t.equals(response.text, '\'source\' parameter is required');
        t.end();
        mod_server.close();
      });

  });

  test.test('empty source parameter should return 400 and message', t => {
    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: ''
      })
      .end((err, response) => {
        t.equals(response.statusCode, 400);
        t.equals(response.text, '\'source\' parameter is required');
        t.end();
        mod_server.close();
      });

  });

  test.test('unknown protocol/type should return 400 and message', t => {
    const mod_app = require('../app')();
    const mod_server = mod_app.listen();

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: 'unsupported type'
      })
      .end((err, response) => {
        t.equals(response.statusCode, 400);
        t.equals(response.text, 'Unsupported type');
        t.end();
        mod_server.close();
      });

  });

  test.test('cannot determine type from .zip file', t => {
    const mock_geojson_app = require('express')();
    mock_geojson_app.get('/file.zip', (req, res, next) => {
      const output = new ZipContentsStream();

      output.on('finish', function() {
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename=file.zip');
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

    request
      .get(`http://localhost:${mod_server.address().port}/fields`)
      .accept('json')
      .query({
        source: `http://localhost:${mock_geojson_server.address().port}/file.zip`
      })
      .end((err, response) => {
        t.equals(response.statusCode, 400);
        t.equals(response.text, 'Could not determine type from zip file');
        t.end();

        mock_geojson_server.close();
        mod_server.close();
      });

  });

});
