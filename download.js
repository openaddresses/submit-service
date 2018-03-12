const express = require('express');
const request = require('request');
const _ = require('lodash');
const toString = require('stream-to-string');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');
const yauzl = require('yauzl');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// make temp scoped to individual requests so that calls to cleanup affect only
// the files created in the request.  temp.track() cleans up on process exit
// but that could lead to lots of file laying around needlessly until the
// service eventually stops.  Initialize with .track() anyway in the case
// where the service errored out before manual cleanup in middleware fires.
// Additionally, don't make temp global and cleanup on each request since it
// may delete files that are currently being used by other requests.
const setupTemp = (req, res, next) => {
  res.locals.temp = require('temp').track();
  next();
};

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
function respondWithCsv(res, entry, next) {
  // response object functions are chainable, so inline
  entry.pipe(res.
    status(200).
    type('text/csv').
    set('Content-Disposition', 'attachment; filename=data.csv')).on('finish', next);

}

// return the processed file contents as GeoJSON
function respondWithGeojson(res, entry, next) {
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
    logger.info(`/download: ${error_message}`);
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
    res.
      status(200).
      type('application/json').
      set('Content-Disposition', 'attachment: filename=data.geojson').
      send(JSON.stringify(o));

    next();

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
        logger.info(`/download: ${error_message}`);
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
        const tmpZipStream = res.locals.temp.createWriteStream();

        // write the response to a temporary file
        r.pipe(tmpZipStream).on('close', (err) => {
          logger.debug(`wrote ${tmpZipStream.bytesWritten} bytes to ${tmpZipStream.path}`);

          yauzl.open(tmpZipStream.path, {lazyEntries: true}, (err, zipfile) => {
            if (err) {
              const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
              logger.info(`/download: ${error_message}`);
              res.status(400).type('text/plain').send(error_message);

            } else {
              // read first entry
              zipfile.readEntry();

              zipfile.on('entry', (entry) => {
                zipfile.readEntry();

                // output the first .csv file found (there should only ever be 1)
                if (_.endsWith(entry.fileName, '.csv') && !csv_file_found) {
                  zipfile.openReadStream(entry, (err, stream) => {
                    // the CSV file has been found so just pipe the contents to response
                    csv_file_found = true;

                    // call the response handler according to output format
                    // defaulting to csv 
                    outputHandlers[_.defaultTo(req.query.format, 'csv')](res, stream, next);

                  });

                } else {
                  // this is a file that's currently unsupported so drain it so memory doesn't get full
                  logger.debug(`/download: skipping ${entry.fileName}`);

                }

              });

              // handle end of .zip file
              zipfile.on('end', () => {
                if (!csv_file_found) {
                  logger.info(`/download: ${res.locals.datafile} does not contain .csv file`);
                  res.status(500).type('application/json').send({
                    error: {
                      code: 500,
                      message: `${res.locals.datafile} does not contain .csv file`
                    }
                  });
                }

                next();
              });

            }

          });

        });

      }
    });

  }

}

// middleware that cleans up any temp files that were created in the course
// of the request
function cleanupTemp(req, res, next) {
  if (!res.headersSent) {
    res.locals.temp.cleanup((err, stats) => {
      logger.debug(`temp clean up: ${JSON.stringify(stats)}`);
    });
  }
};

module.exports = express.Router()
  .get('/', [
    preconditionsCheck,
    setupTemp,
    getMetaData, 
    getData,
    cleanupTemp
  ]);
