const express = require('express');
const request = require('request');
const _ = require('lodash');
const toString = require('stream-to-string');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

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

// retrieve sources (files or directories) on a path
function getMetaData(req, res, next) {
  // save off request so it can be error-handled and piped later
  const r = request(process.env.OPENADDRESSES_METADATA_FILE);

  res.locals.source = req.baseUrl.replace('/download', '');

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
        logger.debug('HTTP CSV: stream ended prematurely');
        next();
      })
      .on('finish', () => {
        logger.debug('HTTP CSV: stream ended normally');
        next();
      });

    }

  });

}

// retrieve sources (files or directories) on a path
function getData(req, res, next) {
  if (!res.locals.datafile) {
    const error_message = `Unable to find ${res.locals.source} in ${process.env.OPENADDRESSES_METADATA_FILE}`;
    logger.info(`OpenAddresses metadata file: ${error_message}`);

    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: error_message
      }
    });

  } else {
    console.error(res.locals.datafile);
    const r = request(res.locals.datafile);

    // handle catastrophic errors like "connection refused"
    r.on('error', err => handleCatastrophicError(err.code, res, res.locals.source));

    // handle normal responses (including HTTP errors)
    r.on('response', response => {
      if (response.statusCode !== 200) {
        // if the content type is text/plain, then use the error message text
        handlePlainTextNonCatastrophicError(r, response.statusCode, res, res.locals.datafile);

      } else {
        res.status(200).type('text/plain').send(res.locals.datafile);

      }

    });

  }

}

module.exports = express.Router()
  .get('/', [getMetaData, getData]);
