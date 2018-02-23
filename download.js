const express = require('express');
const request = require('request');
const _ = require('lodash');
const toString = require('stream-to-string');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');
const unzip = require('unzip-stream');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const outputHandlers = {
  csv: respondWithCsv,
  geojson: respondWithGeojson
};

function handleCatastrophicError(errorCode, res, file) {
  res.status(500).type('application/json').send({
    error: {
      code: 500,
      message: `Error retrieving file ${file}: ${errorCode}`
    }
  });

}

function responseIsPlainText(headers) {
  return _.startsWith(_.get(headers, 'content-type'), 'text/plain');
}

function handlePlainTextNonCatastrophicError(r, statusCode, res, file) {
  // convert response to a string and log/return
  toString(r, (err, msg) => {
    const error_message = `Error retrieving file ${file}: ${msg} (${statusCode})`;
    logger.info(`OpenAddresses metadata file: ${error_message}`);

    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: error_message
      }
    });

  });

}

// the error message isn't plain text, so just return the template + status code
function handleNonPlainTextNonCatastrophicError(statusCode, res) {
  const error_message = `Error retrieving file ${process.env.OPENADDRESSES_METADATA_FILE}: (${statusCode})`;

  logger.info(`OpenAddresses metadata file: ${error_message}`);

  res.status(500).type('application/json').send({
    error: {
      code: 500,
      message: error_message
    }
  });

}

// return the processed file contents as CSV
function respondWithCsv(res, entry) {
  // response object functions are chainable, so inline
  entry.pipe(res.
    status(200).
    type('text/csv').
    set('Content-Disposition', 'attachment; filename=data.csv'));

}

// return the processed file contents as GeoJSON
function respondWithGeojson(res, entry) {
  const o = {
    type: 'FeatureCollection',
    features: []
  };

  // process the .csv file
  entry
  .pipe(csvParse({
    // DO NOT USE `from` and `to` to limit records since it downloads the entire
    // file whereas this way simply stops the download after 10 records
    skip_empty_lines: true,
    columns: true
  }))
  .on('error', err => {
    const error_message = `Error parsing file ${entry.path}: ${err}`;
    logger.info(`HTTP ZIP CSV: ${error_message}`);
    res.status(400).type('text/plain').send(error_message);
  })
  .pipe(through2.obj(function(record, enc, callback) {
    o.features.push({
      geometry: {
        type: 'Point',
        coordinates: [
          parseFloat(record.LON),
          parseFloat(record.LAT)
        ]
      },
      properties: _.omit(record, ['LON', 'LAT'])
    });


    callback();

  }))
  .on('finish', () => {
    logger.debug('/download: stream ended normally');

    res.
      status(200).
      type('application/json').
      set('Content-Disposition', 'attachment: filename=data.geojson').
      send(JSON.stringify(o));

  });

}

// if no source parameter was supplied, bail immediately
const preconditionsCheck = (req, res, next) => {
  if (req.query.format && ['csv', 'geojson'].indexOf(req.query.format) < 0) {
    logger.debug('rejecting request due to invalid `format` parameter');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: `Unsupported output format: ${req.query.format}`
      }
    });

  } else {
    logger.debug({ format: req.query.format });
    next();

  }

};

// retrieve sources (files or directories) on a path
function getMetaData(req, res, next) {
  // save off request so it can be error-handled and piped later
  const r = request(process.env.OPENADDRESSES_METADATA_FILE);

  res.locals.source = req.baseUrl.replace('/download/', '');

  // handle catastrophic errors like "connection refused"
  r.on('error', err => handleCatastrophicError(err.code, res, process.env.OPENADDRESSES_METADATA_FILE));

  // handle normal responses (including HTTP errors)
  r.on('response', response => {
    if (response.statusCode !== 200) {
      // if the content type is text/plain, then use the error message text
      if (responseIsPlainText(response.headers)) {
        handlePlainTextNonCatastrophicError(r, response.statusCode, res, process.env.OPENADDRESSES_METADATA_FILE);
      }
      else {
        handleNonPlainTextNonCatastrophicError(res);
      }

    } else {
      logger.debug(`OpenAddresses metadata file: successfully retrieved ${process.env.OPENADDRESSES_METADATA_FILE}`);

      // otherwise everything was fine so pipe the response to CSV and collect records
      r.pipe(csvParse({
        delimiter: '\t',
        skip_empty_lines: true,
        columns: true
      }))
      .on('error', err => {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
        logger.info(`HTTP CSV: ${error_message}`);
        res.status(400).type('text/plain').send(error_message);
      })
      .pipe(through2.obj(function(record, enc, callback) {
        if (record.source === res.locals.source) {
          res.locals.datafile = record.processed;
          this.destroy();
        } else {
          callback();
        }

      }))
      .on('close', () => {
        logger.debug('/download: stream ended prematurely');
        next();
      })
      .on('finish', () => {
        logger.debug('/download: stream ended normally');
        next();
      });

    }

  });

}

// retrieve latest run for source as .zip file
function getData(req, res, next) {
  if (!res.locals.datafile) {
    const error_message = `Unable to find ${res.locals.source} in ${process.env.OPENADDRESSES_METADATA_FILE}`;
    logger.info(`OpenAddresses metadata file: ${error_message}`);

    // if the requested source was not found in the OA results metadata, respond with error 
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: error_message
      }
    });

  } else {
    const r = request(res.locals.datafile);
    let csv_file_found = false;

    // handle catastrophic errors like "connection refused"
    r.on('error', err => handleCatastrophicError(err.code, res, res.locals.datafile));

    // handle normal responses (including HTTP errors)
    r.on('response', response => {
      if (response.statusCode !== 200) {
        // if the content type is text/plain, then use the error message text
        handlePlainTextNonCatastrophicError(r, response.statusCode, res, res.locals.datafile);

      } else {
        // open the zipfile and extract the first CSV
        r.pipe(unzip.Parse())
        .on('error', err => {
          const error_message = `Error retrieving file ${res.locals.datafile}: ${err}`;
          logger.info(`/download: ${error_message}`);
          res.status(400).type('text/plain').send(error_message);
        })
        .on('entry', entry => {
          // handle errors before inspecting entry
          // there appears to be an error with unzip-stream where an unsupported
          // version error is thrown for each entry instead of the stream in general
          // so it must be handled separately.
          // https://github.com/mhr3/unzip-stream/issues/9
          entry.on('error', err => {
            const error_message = `Error processing file ${res.locals.source.data}: ${err}`;
            logger.error(`/download: ${error_message}`);
            res.status(400).type('text/plain').send(error_message);
          });

          // output the first .csv file found (there should only ever be 1)
          if (_.endsWith(entry.path, '.csv') && !csv_file_found) {
            // the CSV file has been found so just pipe the contents to response
            csv_file_found = true;

            // call the response handler according to output format
            // defaulting to csv 
            outputHandlers[_.defaultTo(req.query.format, 'csv')](res, entry);

          }
          else {
            // this is a file that's currently unsupported so drain it so memory doesn't get full
            logger.debug(`/download: skipping ${entry.path}`);
            entry.autodrain();

          }

        })
        .on('finish', () => {
          if (!csv_file_found) {
            logger.info(`/download: ${res.locals.datafile} does not contain .csv file`);
            res.status(500).type('application/json').send({
              error: {
                code: 500,
                message: `${res.locals.datafile} does not contain .csv file`
              }
            });
          }

        });

      }

    });

  }

}

module.exports = express.Router()
  .get('/', [
    preconditionsCheck,
    getMetaData, 
    getData
  ]);
