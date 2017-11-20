const express = require('express');
const Router = require('express').Router;
const _ = require('lodash');
const request = require('request');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');
const oboe = require('oboe');
const unzip = require('unzip-stream');
const morgan = require('morgan');
const toString = require('stream-to-string');
const { URL } = require('url');

// matches:
// - MapServer/0
// - FeatureServer/13
// - MapServer/1/
const arcgisRegexp = /(Map|Feature)Server\/\d+\/?$/;

// if no source parameter was supplied, bail immediately
const preconditionsCheck = (req, res, next) => {
  if (!req.query.source) {
    res.status(400).type('text/plain').send('\'source\' parameter is required');
  } else {
    next();
  }

};

// determine the protocol, type, and compression to make decisions easier later on
const determineType = (req, res, next) => {
  try {
    const source = new URL(req.query.source);

    // setup a working context
    res.locals.source = {
      coverage: {},
      data: source.href,
      source_data: {
        fields: [],
        results: []
      },
      conform: {}
    };

    if (arcgisRegexp.test(source.pathname)) {
      res.locals.source.type = 'ESRI';
      res.locals.source.conform.type = 'geojson';
    } else if (_.endsWith(source.pathname, '.geojson')) {
      res.locals.source.type = 'http';
      res.locals.source.conform.type = 'geojson';
    } else if (_.endsWith(source.pathname, '.csv')) {
      res.locals.source.type = 'http';
      res.locals.source.conform.type = 'csv';
    } else if (_.endsWith(source.pathname, '.zip')) {
      res.locals.source.type = 'http';
      res.locals.source.compression = 'zip';
    } else {
      res.status(400).type('text/plain').send('Unsupported type');
    }

  } catch (err) {
    res.status(400).type('text/plain').send(`Unable to parse URL from '${req.query.source}'`);

  }

  if (!res.headersSent) {
    next();
  }

};

// if the request protocol, type, and compression match, continue on this route
// otherwise move on to the next route
const typecheck = (protocol, type, compression) => (req, res, next) => {
  if (res.locals.source.type === protocol &&
      res.locals.source.conform.type === type &&
      res.locals.source.compression === compression) {
    next();
  } else {
    next('route');
  }

};

// helper functions bound to typecheck with specific parameters
const isArcgis = typecheck.bind(null, 'ESRI', 'geojson')();
const isHttpGeojson = typecheck.bind(null, 'http', 'geojson')();
const isHttpCsv = typecheck.bind(null, 'http', 'csv')();
const isHttpZip = typecheck.bind(null, 'http', undefined, 'zip')();

// middleware that queries an Arcgis server for the first 10 records
const sampleArcgis = (req, res, next) => {
  // build up a URL for querying an Arcgis server
  const url = new URL(`${res.locals.source.data}/query`);
  url.searchParams.append('outFields', '*');
  url.searchParams.append('where', '1=1');
  url.searchParams.append('resultRecordCount', '10');
  url.searchParams.append('resultOffset', '0');
  url.searchParams.append('f', 'json');

  oboe(url.href)
    .node('fields.*.name', name => {
      res.locals.source.source_data.fields.push(name);
    })
    .node('features.*.attributes', attributes => {
      res.locals.source.source_data.results.push(attributes);
    })
    .fail((err) => {
      let error_message = `Error connecting to Arcgis server ${res.locals.source.data}: `;

      if (err.thrown) {
        error_message += err.thrown.code;
      } else {
        error_message += `${err.body} (${err.statusCode})`;
      }

      res.status(400).type('text/plain').send(error_message);

    })
    .done(() => {
      // this will happen when the list of results has been processed and
      // iteration still has no reached the 11th result, which is very unlikely
      next();
    });

};

// middleware that requests and streams a .geojson file, returning up to the first
// 10 records
const sampleGeojson = (req, res, next) => {
  console.log(`requesting ${res.locals.source.data}`);

  oboe(res.locals.source.data)
    .node('features[*].properties', properties => {
      res.locals.source.source_data.fields = _.keys(properties);
      res.locals.source.source_data.results.push(properties);
    })
    .node('features[9]', function() {
      // bail after the 10th result.  'done' does not get called after .abort()
      //  so next() must be called explicitly
      // must use full function() syntax for "this" reference
      this.abort();
      next();
    })
    .fail((err) => {
      let error_message = `Error retrieving file ${res.locals.source.data}: `;

      if (err.thrown) {
        error_message += err.thrown.code;
      } else {
        error_message += `${err.body} (${err.statusCode})`;
      }

      res.status(400).type('text/plain').send(error_message);

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
  console.log(`requesting ${res.locals.source.data}`);

  // save off request so it can be error-handled and piped later
  const r = request(res.locals.source.data);

  // handle catastrophic errors like "connection refused"
  r.on('error', (err) => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err.code}`;

    res.status(400).type('text/plain').send(error_message);

  });

  // handle normal responses (including HTTP errors)
  r.on('response', (response) => {
    if (response.statusCode !== 200) {
      // something went wrong so save up the response text and return an error
      toString(r, (err, msg) => {
        let error_message = `Error retrieving file ${res.locals.source.data}`;
        error_message += `: ${msg} (${response.statusCode})`;

        res.status(400).type('text/plain').send(error_message);

      });

    } else {
      // otherwise everything was fine so pipe the response to CSV and collect records
      r.pipe(csvParse({
        skip_empty_lines: true,
        columns: true
      }))
      .pipe(through2.obj(function(record, enc, callback) {
        if (res.locals.source.source_data.results.length < 10) {
          res.locals.source.source_data.fields = _.keys(record);
          res.locals.source.source_data.results.push(record);
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

  });

};

// middleware that requests and streams a compressed .csv file, returning up
// to the first 10 records
const sampleZip = (req, res, next) => {
  console.log(`requesting ${res.locals.source.data}`);

  const r = request(res.locals.source.data);

  // handle catastrophic errors like "connection refused"
  r.on('error', (err) => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err.code}`;

    res.status(400).type('text/plain').send(error_message);

  });

  // handle normal responses (including HTTP errors)
  r.on('response', (response) => {
    if (response.statusCode !== 200) {
      // something went wrong so save up the response text and return an error
      toString(r, (err, msg) => {
        let error_message = `Error retrieving file ${res.locals.source.data}`;
        error_message += `: ${msg} (${response.statusCode})`;

        res.status(400).type('text/plain').send(error_message);

      });

    } else {
      // otherwise everything was fine so pipe the response to CSV and collect records
      r.pipe(unzip.Parse())
      .on('entry', entry => {
        if (_.endsWith(entry.path, '.csv')) {
          res.locals.source.conform.type = 'csv';

          // process the .csv file
          entry.pipe(csvParse({
            skip_empty_lines: true,
            columns: true
          }))
          .pipe(through2.obj(function(record, enc, callback) {
            // must use full function() syntax for "this" reference
            if (res.locals.source.source_data.results.length < 10) {
              res.locals.source.source_data.fields = _.keys(record);
              res.locals.source.source_data.results.push(record);
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
          res.locals.source.conform.type = 'geojson';

          oboe(entry)
            .node('features.*.properties', properties => {
              res.locals.source.source_data.fields = _.keys(properties);
              res.locals.source.source_data.results.push(properties);
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
          // we're not interested in this file, so dispose of its contents
          entry.autodrain();
        }

      })
      .on('finish', () => {
        if (!res.locals.source.conform.type) {
          res.status(400).type('text/plain').send('Could not determine type from zip file');
        }
      });
    }

  });

};

// middleware that outputs the accumulated metadata, fields, and sample results
const output = (req, res, next) => {
  res.status(200).send(res.locals.source);

  next();
};

module.exports = () => {
  const app = express();
  app.use(morgan('combined'));

  // setup a router that only handles Arcgis sources
  const arcgisRouter = express.Router();
  arcgisRouter.get('/fields', isArcgis, sampleArcgis);

  // setup a router that only handles .geojson files
  const geojsonRouter = express.Router();
  geojsonRouter.get('/fields', isHttpGeojson, sampleGeojson);

  // setup a router that only handles .csv files
  const csvRouter = express.Router();
  csvRouter.get('/fields', isHttpCsv, sampleCsv);

  // setup a router that only handles .zip files
  const zipRouter = express.Router();
  zipRouter.get('/fields', isHttpZip, sampleZip);

  app.get('/fields',
    preconditionsCheck,
    determineType,
    arcgisRouter,
    geojsonRouter,
    csvRouter,
    zipRouter,
    output
  );

  // expose testing UI
  app.use(express.static(__dirname + '/public'));

  return app;

};
