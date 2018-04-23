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

// parsing options for the OA metadata file
const csvOptions = {
  delimiter: '\t',
  skip_empty_lines: true,
  columns: true
};

function handleCatastrophicError(errorCode, res) {
  res.status(500).type('application/json').send({
    error: {
      code: 500,
      message: `Error retrieving file ${process.env.OPENADDRESSES_METADATA_FILE}: ${errorCode}`
    }
  });

}

function responseIsPlainText(headers) {
  return _.startsWith(_.get(headers, 'content-type'), 'text/plain');
}

function handlePlainTextNonCatastrophicError(r, statusCode, res) {
  // convert response to a string and log/return
  toString(r, (err, msg) => {
    const errorMessage = `Error retrieving file ${process.env.OPENADDRESSES_METADATA_FILE}: ${msg} (${statusCode})`;
    logger.info(`OpenAddresses metadata file: ${errorMessage}`);

    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: errorMessage
      }
    });

  });

}

// the error message isn't plain text, so just return the template + status code
function handleNonPlainTextNonCatastrophicError(statusCode, res) {
  const errorMessage = `Error retrieving file ${process.env.OPENADDRESSES_METADATA_FILE}: (${statusCode})`;

  logger.info(`OpenAddresses metadata file: ${errorMessage}`);

  res.status(500).type('application/json').send({
    error: {
      code: 500,
      message: errorMessage
    }
  });

}

// bail early if metadata file isn't found in the environment
function preconditionsCheck(req, res, next) {
  if (!process.env.OPENADDRESSES_METADATA_FILE) {
    // if OPENADDRESSES_METADATA_FILE isn't available, then bail immediately
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: 'OPENADDRESSES_METADATA_FILE not defined in process environment'
      }
    });

  } else {
    logger.debug({ format: req.query.format });
    next();

  }

};

// handle premature/expected end-of-file of metadata file
function metadataFileClosed(source, res) {
  return () => {
    // only be concerned with condition where file wasn't found
    if (!res.headersSent) {
      const errorMessage = `Unable to find ${source} in ${process.env.OPENADDRESSES_METADATA_FILE}`;
      logger.info(`OpenAddresses metadata file: ${errorMessage}`);

      // if the requested source was not found in the OA results metadata, respond with error 
      res.status(400).type('application/json').send({
        error: {
          code: 400,
          message: errorMessage
        }
      });
    }    
  };
}

// retrieve the metadata file and find the requested source
function getMetaData(req, res, next) {
  // save off request so it can be error-handled and piped later
  const r = request(process.env.OPENADDRESSES_METADATA_FILE);

  const source = req.baseUrl.replace('/download/', '');

  // handle catastrophic errors like "connection refused"
  r.on('error', err => handleCatastrophicError(err.code, res));

  // handle normal responses (including HTTP errors)
  r.on('response', response => {
    if (response.statusCode !== 200) {
      // if the content-type is text/plain, then use the error message text
      if (responseIsPlainText(response.headers)) {
        handlePlainTextNonCatastrophicError(r, response.statusCode, res);
      }
      else {
        handleNonPlainTextNonCatastrophicError(res);
      }
      return;
    }

    logger.debug(`OpenAddresses metadata file: successfully retrieved ${process.env.OPENADDRESSES_METADATA_FILE}`);

    // otherwise everything was fine so pipe the response to CSV and collect records
    r.pipe(csvParse(csvOptions))
    .on('error', err => {
      const errorMessage = `Error retrieving file ${source}: ${err}`;
      logger.info(`/download: ${errorMessage}`);
      res.status(400).type('text/plain').send(errorMessage);
    })
    .pipe(through2.obj(function(record, enc, callback) {
      if (record.source === source) {
        res.status(200).type('application/json').send({
          source: source,
          latest: record.processed
        });
        this.destroy();
      } else {
        callback();
      }

    }))
    .on('close', metadataFileClosed(source, res))
    .on('finish', metadataFileClosed(source, res));

  });

}

module.exports = express.Router()
  .get('/', [
    preconditionsCheck,
    getMetaData
  ]);
