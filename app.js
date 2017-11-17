const express = require('express');
const Router = require('express').Router;
const _ = require('lodash');
const request = require('superagent');
const binaryParser = require('superagent-binary-parser');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');
const oboe = require('oboe');
const unzip = require('unzip-stream');

const arcgisRegexp = /(Map|Feature)Server\/\d+\/?$/;

// if no source parameter was supplied, bail immediately
const preconditionsCheck = (req, res, next) => {
  if (!req.query.source) {
    res.status(400).send('\'source\' parameter is required');
  } else {
    next();
  }

};

// determine the protocol, type, and compression to make decisions easier later on
const determineType = (req, res, next) => {
  const source = req.query.source;

  if (arcgisRegexp.test(source)) {
    req.query.protocol = 'ESRI';
    req.query.type = 'geojson';
  } else if (_.endsWith(source, '.geojson')) {
    req.query.protocol = 'http';
    req.query.type = 'geojson';
  } else if (_.endsWith(source, '.csv')) {
    req.query.protocol = 'http';
    req.query.type = 'csv';
  } else if (_.endsWith(source, '.zip')) {
    req.query.protocol = 'http';
    req.query.compression = 'zip';
  } else {
    req.query.protocol = 'unknown';
  }

  // if protocol is unknown, return a 400
  if (req.query.protocol === 'unknown') {
    res.status(400).send('Unsupported type');
  } else {
    next();
  }

};

// if the request protocol, type, and compression match, continue on this route
// otherwise move on to the next route
const typecheck = (protocol, type, compression) => (req, res, next) => {
  if (req.query.protocol === protocol && req.query.type === type && req.query.compression === compression) {
    next();
  } else {
    next('route');
  }

};

// middleware that queries an Esri server for the first 10 records
const sampleEsri = (req, res, next) => {
  request
    .get(`${req.query.source}/query`)
    .accept('json')
    .query({
      outFields: '*',
      where: '1=1',
      resultRecordCount: 10,
      resultOffset: 0,
      f: 'json'
    })
    .on('error', (err) => {
      return next();
    })
    .end((err, response) => {
      // bail early if there's an error (shouldn't happen since it was already handled above)
      if (err) {
        return next();
      }

      req.query.fields = JSON.parse(response.text).fields.map(_.property('name'));
      req.query.results = JSON.parse(response.text).features.map( _.property('attributes') );
      return next();

    });

};

// middleware that requests and streams a .geojson file, returning up to the first
// 10 records
const sampleGeojson = (req, res, next) => {
  console.log(`requesting ${req.query.source}`);

  req.query.results = [];

  oboe(req.query.source)
    .node('features[*]', feature => {
      req.query.fields = _.keys(feature.properties);
      req.query.results.push(feature.properties);
    })
    .node('features[9]', function() {
      // bail after the 10th result.  'done' does not get called after .abort()
      //  so next() must be called explicitly
      // must use full function() syntax for "this" reference
      this.abort();
      next();
    })
    .done(() => {
      // this will happen when the list of results has been processed and
      // iteration still has no reached the 11th result, which is very unlikely
      next();
    });

};

// middleware that requests and streams a .csv file, returning up to the first
// 10 records
const sampleCsv = (req, res, next) => {
  console.log(`requesting ${req.query.source}`);

  req.query.results = [];

  request.get(req.query.source).pipe(csvParse({
    skip_empty_lines: true,
    columns: true
  }))
  .pipe(through2.obj(function(record, enc, callback) {
    if (req.query.results.length < 10) {
      req.query.fields = _.keys(record);
      req.query.results.push(record);
      callback();
    } else {
      // there are enough records so end the stream prematurely, handle in 'close' event
      this.destroy();
    }

  }))
  .on('close', () => {
    // stream was closed prematurely
    next();
  })
  .on('finish', () => {
    // stream was ended normally
    next();
  });

};

// middleware that requests and streams a compressed .csv file, returning up
// to the first 10 records
const sampleZip = (req, res, next) => {
  console.log(`requesting ${req.query.source}`);

  request.get(req.query.source)
  .pipe(unzip.Parse())
  .on('entry', entry => {
    if (_.endsWith(entry.path, '.csv')) {
      req.query.type = 'csv';
      req.query.results = [];

      // process the .csv file
      entry.pipe(csvParse({
        skip_empty_lines: true,
        columns: true
      }))
      .pipe(through2.obj(function(record, enc, callback) {
        // must use full function() syntax for "this" reference
        if (req.query.results.length < 10) {
          req.query.fields = _.keys(record);
          req.query.results.push(record);
          callback();
        } else {
          // there are enough records so end the stream prematurely, handle in 'close' event
          this.destroy();
        }

      }))
      .on('close', () => {
        // stream was closed prematurely
        next();
      })
      .on('finish', () => {
        // stream was ended normally
        next();
      });

    }
    else if (_.endsWith(entry.path, '.geojson')) {
      req.query.type = 'geojson';
      req.query.results = [];

      oboe(entry)
        .node('features[*]', feature => {
          req.query.fields = _.keys(feature.properties);
          req.query.results.push(feature.properties);
        })
        .node('features[9]', function() {
          // bail after the 10th result.  'done' does not get called after .abort()
          //  so next() must be called explicitly
          // must use full function() syntax for "this" reference
          this.abort();
          next();
        })
        .done(() => {
          // this will happen when the list of results has been processed and
          // iteration still has no reached the 11th result, which is very unlikely
          next();
        });

    }
    else {
      entry.autodrain();
    }

  })
  .on('finish', () => {
    if (!req.query.type) {
      res.status(400).send('Could not determine type from zip file');
    }
  });

};

// middleware that outputs the accumulated metadata, fields, and sample results
const output = (req, res, next) => {
  res.status(200).send({
    coverage: {},
    type: req.query.protocol,
    compression: req.query.compression,
    data: req.query.source,
    source_data: {
      fields: req.query.fields,
      results: req.query.results
    },
    conform: {
      type: req.query.type
    }
  });

  next();
};

module.exports = () => {
  const app = express();

  // setup a router that only handles ESRI sources
  const esriRouter = express.Router();
  esriRouter.get('/fields', typecheck('ESRI', 'geojson'), sampleEsri);

  // setup a router that only handles geojson files
  const geojsonRouter = express.Router();
  geojsonRouter.get('/fields', typecheck('http', 'geojson'), sampleGeojson);

  // setup a router that only handles csv files
  const csvRouter = express.Router();
  csvRouter.get('/fields', typecheck('http', 'csv'), sampleCsv);

  const zipRouter = express.Router();
  zipRouter.get('/fields', typecheck('http', undefined, 'zip'), sampleZip);

  app.get('/fields',
    preconditionsCheck,
    determineType,
    esriRouter,
    geojsonRouter,
    csvRouter,
    zipRouter,
    output
  );

  // expose testing UI
  app.use(express.static(__dirname + '/public'));

  return app;

};
