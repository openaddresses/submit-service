const express = require('express');
const router = require('express').Router();
const { URL } = require('url');
const _ = require('lodash');
const request = require('request');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');
const oboe = require('oboe');
const unzip = require('unzip-stream');
const morgan = require('morgan');
const toString = require('stream-to-string');
const dbfstream = require('dbfstream');
const JSFtp = require('jsftp');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// matches:
// - MapServer/0
// - FeatureServer/13
// - MapServer/1/
const arcgisRegexp = /(Map|Feature)Server\/\d+\/?$/;

// if no source parameter was supplied, bail immediately
const preconditionsCheck = (req, res, next) => {
  if (!req.query.source) {
    logger.debug('rejecting request due to lack of `source` parameter');
    res.status(400).type('text/plain').send('\'source\' parameter is required');
  } else {
    logger.debug({ source: req.query.source });
    next();
  }

};

function getProtocol(protocol) {
  if ('http:' === protocol || 'https:' === protocol) {
    return 'http';
  } else if ('ftp:' === protocol) {
    return 'ftp';
  }
}

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

// determine the protocol, type, and compression to make decisions easier later on
const determineType = (req, res, next) => {
  try {
    const source = new URL(req.query.source);

    // setup a working context
    res.locals.source = {
      coverage: {},
      note: '',
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
      res.locals.source.type = getProtocol(source.protocol);
      res.locals.source.conform.type = 'geojson';
    } else if (_.endsWith(source.pathname, '.csv')) {
      res.locals.source.type = getProtocol(source.protocol);
      res.locals.source.conform.type = 'csv';
    } else if (_.endsWith(source.pathname, '.zip')) {
      res.locals.source.type = getProtocol(source.protocol);
      res.locals.source.compression = 'zip';
    } else {
      res.status(400).type('text/plain').send('Unsupported type');
    }

  } catch (err) {
    logger.info(`Unable to parse URL from '${req.query.source}'`);
    res.status(400).type('text/plain').send(`Unable to parse URL from '${req.query.source}'`);

  }

  // only call next() if no response was previously sent (due to error or unsupported type)
  if (!res.headersSent) {
    next();
  }

};

// if the request protocol, type, and compression match, continue on this route
// otherwise move on to the next route
const typecheck = (protocol, type, compression) => (req, res, next) => {
  logger.debug({
    protocol: res.locals.source.protocol,
    type: res.locals.source.type,
    compression: res.locals.source.compression
  });

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
const isFtpZip = typecheck.bind(null, 'ftp', undefined, 'zip')();
const isFtpGeojson = typecheck.bind(null, 'ftp', 'geojson')();
const isFtpCsv = typecheck.bind(null, 'ftp', 'csv')();

// middleware that queries an Arcgis server for the first 10 records
const sampleArcgis = (req, res, next) => {
  logger.debug(`using arcgis sampler for ${res.locals.source.data}`);

  // build up a URL for querying an Arcgis server
  const url = new URL(`${res.locals.source.data}/query`);
  url.searchParams.append('outFields', '*');
  url.searchParams.append('where', '1=1');
  url.searchParams.append('resultRecordCount', '10');
  url.searchParams.append('resultOffset', '0');
  url.searchParams.append('f', 'json');

  oboe(url.href)
    .node('error', err => {
      const msg = `Error connecting to Arcgis server ${res.locals.source.data}: ${err.message} (${err.code})`;
      logger.info(`ARCGIS: ${msg}`);
      res.status(400).type('text/plain').send(msg);
    })
    .node('fields.*.name', name => {
      logger.debug(`ARCGIS: field name: '${name}'`);
      res.locals.source.source_data.fields.push(name);
    })
    .node('features.*.attributes', feature => {
      logger.debug(`ARCGIS: feature: ${JSON.stringify(feature)}`);
      res.locals.source.source_data.results.push(feature);
    })
    .fail(err => {
      let error_message = `Error connecting to Arcgis server ${res.locals.source.data}: `;

      if (_.has(err, 'thrown.code')) {
        // connection refused, etc
        error_message += err.thrown.code;
      } else if (err.thrown) {
        // unparseable JSON (but no code)
        error_message += 'Could not parse as JSON';
      } else {
        error_message += `${err.body} (${err.statusCode})`;
      }

      logger.info(`ARCGIS: ${error_message}`);

      res.status(400).type('text/plain').send(error_message);

    })
    .done(() => {
      if (!res.headersSent) {
        // this will happen when the list of results has been processed and
        // iteration still has no reached the 11th result, which is very unlikely
        next();
      }
    });

};

// middleware that requests and streams a .geojson file, returning up to the first
// 10 records
const sampleHttpGeojson = (req, res, next) => {
  logger.debug(`HTTP GEOJSON: ${res.locals.source.data}`);

  oboe(res.locals.source.data)
    .node('features[*].properties', properties => {
      if (_.isEmpty(res.locals.source.source_data.fields)) {
        logger.debug(`HTTP GEOJSON: fields: ${JSON.stringify(_.keys(properties))}`);
        res.locals.source.source_data.fields = _.keys(properties);
      }

      logger.debug(`HTTP GEOJSON: feature: ${JSON.stringify(properties)}`);
      res.locals.source.source_data.results.push(properties);

    })
    .node('features[9]', function() {
      // bail after the 10th result.  'done' does not get called after .abort()
      //  so next() must be called explicitly
      // must use full function() syntax for "this" reference
      logger.debug('HTTP GEOJSON: found 10 results, exiting');
      this.abort();
      next();
    })
    .fail(err => {
      let error_message = `Error retrieving file ${res.locals.source.data}: `;

      if (_.has(err, 'thrown.code')) {
        // connection refused, etc
        error_message += err.thrown.code;
      } else if (err.thrown) {
        // unparseable JSON (but no code)
        error_message += 'Could not parse as JSON';
      } else {
        // something like a 404
        error_message += `${err.body} (${err.statusCode})`;
      }
      logger.info(`HTTP GEOJSON: ${error_message}`);

      res.status(400).type('text/plain').send(error_message);

    })
    .done(() => {
      // this will happen when the list of results has been processed and
      // iteration still has no reached the 11th result, which is very unlikely
      if (!res.headersSent) {
        next();
      }
    });

};

// middleware that requests and streams a .csv file, returning up to the first
// 10 records
const sampleHttpCsv = (req, res, next) => {
  logger.debug(`HTTP CSV: ${res.locals.source.data}`);

  // save off request so it can be error-handled and piped later
  const r = request(res.locals.source.data);

  // handle catastrophic errors like "connection refused"
  r.on('error', err => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err.code}`;

    logger.info(`HTTP CSV: ${error_message}`);

    res.status(400).type('text/plain').send(error_message);

  });

  // handle normal responses (including HTTP errors)
  r.on('response', response => {
    if (response.statusCode !== 200) {
      // something went wrong so optionally save up the response text and return an error
      let error_message = `Error retrieving file ${res.locals.source.data}`;

      // if the content type is text/plain, then use the error message text
      if (_.startsWith(_.get(response.headers, 'content-type'), 'text/plain')) {
        toString(r, (err, msg) => {
          error_message += `: ${msg} (${response.statusCode})`;
          logger.info(`HTTP CSV: ${error_message}`);

          res.status(400).type('text/plain').send(error_message);

        });
      }
      else {
        // otherwise just respond with the code
        error_message += `: (${response.statusCode})`;
        logger.info(`HTTP CSV: ${error_message}`);

        res.status(400).type('text/plain').send(error_message);

      }

    } else {
      logger.debug(`HTTP CSV: successfully retrieved ${res.locals.source.data}`);

      // otherwise everything was fine so pipe the response to CSV and collect records
      r.pipe(csvParse({
        // DO NOT USE `from` and `to` to limit records since it downloads the entire
        // file whereas this way simply stops the download after 10 records
        skip_empty_lines: true,
        columns: true
      }))
      .on('error', err => {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
        logger.info(`HTTP CSV: ${error_message}`);
        res.status(400).type('text/plain').send(error_message);
      })
      .pipe(through2.obj(function(record, enc, callback) {
        if (res.locals.source.source_data.results.length < 10) {
          if (_.isEmpty(res.locals.source.source_data.fields)) {
            logger.debug(`HTTP CSV: fields: ${JSON.stringify(_.keys(record))}`);
            res.locals.source.source_data.fields = _.keys(record);
          }

          logger.debug(`HTTP CSV: record: ${JSON.stringify(record)}`);
          res.locals.source.source_data.results.push(record);

          callback();

        } else {
          // there are enough records so end the stream prematurely, handle in 'close' event
          logger.debug('HTTP CSV: found 10 results, exiting');
          this.destroy();

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

};

// middleware that requests and streams a compressed .zip file, returning up
// to the first 10 records
const sampleHttpZip = (req, res, next) => {
  logger.debug(`HTTP ZIP: ${res.locals.source.data}`);

  const r = request(res.locals.source.data);

  // handle catastrophic errors like "connection refused"
  r.on('error', err => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err.code}`;
    logger.info(`HTTP ZIP: ${error_message}`);

    res.status(400).type('text/plain').send(error_message);

  });

  // handle normal responses (including HTTP errors)
  r.on('response', response => {
    if (response.statusCode !== 200) {
      // something went wrong so optionally save up the response text and return an error
      let error_message = `Error retrieving file ${res.locals.source.data}`;

      // if the content type is text/plain, then use the error message text
      if (_.startsWith(_.get(response.headers, 'content-type'), 'text/plain')) {
        toString(r, (err, msg) => {
          error_message += `: ${msg} (${response.statusCode})`;
          logger.info(`HTTP ZIP: ${error_message}`);
          res.status(400).type('text/plain').send(error_message);

        });

      }
      else {
        error_message += `: (${response.statusCode})`;
        logger.info(`HTTP ZIP: ${error_message}`);
        res.status(400).type('text/plain').send(error_message);

      }

    } else {
      logger.debug(`HTTP ZIP: successfully retrieved ${res.locals.source.data}`);

      // otherwise everything was fine so pipe the response to CSV and collect records
      r.pipe(unzip.Parse())
      .on('error', err => {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
        logger.info(`HTTP ZIP: ${error_message}`);
        res.status(400).type('text/plain').send(error_message);
      })
      .on('entry', entry => {
        // handle errors before inspecting entry
        // there appears to be an error with unzip-stream where an unsupported
        // version error is thrown for each entry instead of the stream in general
        // so it must be handled separately.
        // https://github.com/mhr3/unzip-stream/issues/9
        entry.on('error', err => {
          if (!res.headersSent) {
            const error_message = `Error processing file ${res.locals.source.data}: ${err}`;
            logger.error(`HTTP ZIP: ${error_message}`);
            res.status(400).type('text/plain').send(error_message);
          }
        });

        if (_.endsWith(entry.path, '.csv')) {
          logger.debug(`HTTP ZIP CSV: ${entry.path}`);
          res.locals.source.conform.type = 'csv';

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
            // must use full function() syntax for "this" reference
            if (res.locals.source.source_data.results.length < 10) {
              if (_.isEmpty(res.locals.source.source_data.fields)) {
                logger.debug(`HTTP ZIP CSV: fields: ${JSON.stringify(_.keys(record))}`);
                res.locals.source.source_data.fields = _.keys(record);
              }

              logger.debug(`HTTP ZIP CSV: record: ${JSON.stringify(record)}`);
              res.locals.source.source_data.results.push(record);

              callback();

            } else {
              logger.debug('HTTP ZIP CSV: found 10 results, exiting');

              // there are enough records so end the stream prematurely, handle in 'close' event
              this.destroy();
            }

          }))
          .on('close', () => {
            logger.debug('HTTP ZIP CSV: stream ended prematurely');
            next();
          })
          .on('finish', () => {
            logger.debug('HTTP ZIP CSV: stream ended normally');
            next();
          });

        }
        else if (_.endsWith(entry.path, '.geojson')) {
          logger.debug(`HTTP ZIP GEOJSON: ${entry.path}`);

          res.locals.source.conform.type = 'geojson';

          oboe(entry)
            .node('features.*.properties', properties => {
              if (_.isEmpty(res.locals.source.source_data.fields)) {
                logger.debug(`HTTP ZIP GEOJSON: fields: ${JSON.stringify(_.keys(properties))}`);
                res.locals.source.source_data.fields = _.keys(properties);
              }

              logger.debug(`HTTP ZIP GEOJSON: feature: ${JSON.stringify(properties)}`);
              res.locals.source.source_data.results.push(properties);

            })
            .node('features[9]', function() {
              // bail after the 10th result.  'done' does not get called after .abort()
              //  so next() must be called explicitly
              // must use full function() syntax for "this" reference
              logger.debug('HTTP ZIP GEOJSON: found 10 results, exiting');
              this.abort();
              next();
            })
            .fail(err => {
              let error_message = `Error retrieving file ${res.locals.source.data}: `;
              error_message += 'Could not parse as JSON';
              logger.info(`HTTP ZIP GEOJSON: ${error_message}`);

              res.status(400).type('text/plain').send(error_message);

            })
            .done(() => {
              if (!res.headersSent) {
                // this will happen when the list of results has been processed and
                // iteration still has no reached the 11th result, which is very unlikely
                next();
              }
            });

        }
        else if (_.endsWith(entry.path, '.dbf')) {
          logger.debug(`HTTP ZIP DBF: ${entry.path}`);

          // in the case of a DBF file, because there's no DBF parser that takes a stream,
          // write to a temporary file and read in that way
          res.locals.source.conform.type = 'shapefile';

          res.locals.source.source_data.results = [];

          // pipe the dbf contents from the .zip file to a stream
          dbfstream(entry)
          .on('error', err => {
            let error_message = `Error parsing file ${entry.path} from ${res.locals.source.data}: `;
            error_message += 'Could not parse as shapefile';
            logger.info(`HTTP ZIP DBF: ${error_message}`);

            res.status(400).type('text/plain').send(error_message);

          })
          .on('header', header => {
            // there's a header so pull the field names from it
            res.locals.source.source_data.fields = header.listOfFields.map(f => f.name);

            logger.debug(`HTTP ZIP DBF: fields: ${JSON.stringify(res.locals.source.source_data.fields)}`);

          })
          .on('data', record => {
            // if there aren't 10 records in the array yet and the record isn't deleted, then add it
            if (res.locals.source.source_data.results.length < 10) {
              if (!record['@deleted']) {
                // find all the non-@ attributes
                const attributes = _.pickBy(record, (value, key) => !_.startsWith(key, '@'));

                logger.debug(`HTTP ZIP GEOJSON: attributes: ${JSON.stringify(attributes)}`);

                res.locals.source.source_data.results.push(attributes);

              }

            } else if (record['@numOfRecord'] === 11) {
              // don't use a plain `else` condition other this will fire multiple times
              logger.debug('HTTP ZIP DBF: found 10 results, exiting');

              // discard the remains of the .dbf file
              entry.autodrain();

              // there are 10 records, so call next()
              return next();

            }

          })
          .on('end', () => {
            // ran out of records before 10, so call next()
            if (!res.headersSent) {
              return next();
            }
          });

        }
        else {
          // this is a file that's currently unsupported so drain it so memory doesn't get full
          logger.debug(`HTTP ZIP: skipping ${entry.path}`);
          entry.autodrain();

        }

      })
      .on('finish', () => {
        if (!res.locals.source.conform.type) {
          logger.info('HTTP ZIP: Could not determine type from zip file');
          res.status(400).type('text/plain').send('Could not determine type from zip file');
        }

      });
    }

  });

};

// middleware that requests and streams a compressed .zip file, returning up
// to the first 10 records
const sampleFtpGeojson = (req, res, next) => {
  logger.debug(`FTP GEOJSON: ${res.locals.source.data}`);

  const url = new URL(res.locals.source.data);

  const options = {
    host: url.hostname,
    port: url.port,
    user: url.username,
    pass: url.password
  };

  const ftp = new JSFtp(options);

  // handle errors like "connection refused"
  ftp.on('error', (err) => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
    logger.info(`FTP ZIP: ${error_message}`);
    res.status(400).type('text/plain').send(error_message);
  });

  ftp.auth(options.user, options.pass, (auth_err) => {
    if (auth_err) {
      const error_message = `Error retrieving file ${res.locals.source.data}: Authentication error`;

      logger.info(`FTP GEOJSON: ${error_message}`);
      res.status(400).type('text/plain').send(error_message);
      return;
    }

    ftp.get(url.pathname, (get_err, geojson_stream) => {
      // bail early if there's an error, such as non-existent file
      if (get_err) {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${get_err}`;
        logger.info(`FTP GEOJSON: ${error_message}`);

        res.status(400).type('text/plain').send(error_message);
        return;
      }

      // get() returns a paused stream, so resume it
      geojson_stream.resume();

      oboe(geojson_stream)
        .node('features.*.properties', properties => {
          if (_.isEmpty(res.locals.source.source_data.fields)) {
            logger.debug(`FTP GEOJSON: fields: ${JSON.stringify(_.keys(properties))}`);
            res.locals.source.source_data.fields = _.keys(properties);
          }

          logger.debug(`FTP GEOJSON: feature: ${JSON.stringify(properties)}`);
          res.locals.source.source_data.results.push(properties);

        })
        .node('features[9]', function() {
          // bail after the 10th result.  'done' does not get called after .abort()
          //  so next() must be called explicitly
          // must use full function() syntax for "this" reference
          logger.debug('FTP GEOJSON: found 10 results, exiting');
          this.abort();
          ftp.raw('quit', (quit_err, data) => {
            return next();
          });

        })
        .fail(parse_err => {
          let error_message = `Error retrieving file ${res.locals.source.data}: `;
          error_message += 'Could not parse as JSON';
          logger.info(`FTP GEOJSON: ${error_message}`);

          res.status(400).type('text/plain').send(error_message);

        })
        .done(() => {
          // this will happen when the list of results has been processed and
          // iteration still has no reached the 11th result, which is very unlikely
          ftp.raw('quit', (quit_err, data) => {
            if (!res.headersSent) {
              return next();
            }
          });
        });

    });

  });

};

// middleware that requests and streams a compressed .zip file, returning up
// to the first 10 records
const sampleFtpCsv = (req, res, next) => {
  logger.debug(`FTP CSV: ${res.locals.source.data}`);

  const url = new URL(res.locals.source.data);

  const options = {
    host: url.hostname,
    port: url.port,
    user: url.username,
    pass: url.password
  };

  const ftp = new JSFtp(options);

  // handle errors like "connection refused"
  ftp.on('error', (err) => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
    logger.info(`FTP ZIP: ${error_message}`);
    res.status(400).type('text/plain').send(error_message);
  });

  ftp.auth(options.user, options.pass, (auth_err) => {
    if (auth_err) {
      const error_message = `Error retrieving file ${res.locals.source.data}: Authentication error`;

      logger.info(`FTP CSV: ${error_message}`);
      res.status(400).type('text/plain').send(error_message);
      return;
    }

    ftp.get(url.pathname, (get_err, csv_stream) => {
      // bail early if there's an error, such as non-existent file
      if (get_err) {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${get_err}`;
        logger.info(`FTP CSV: ${error_message}`);

        res.status(400).type('text/plain').send(error_message);
        return;
      }

      // get() returns a paused stream, so resume it
      csv_stream.resume();

      // otherwise everything was fine so pipe the response to CSV and collect records
      csv_stream.pipe(csvParse({
        // DO NOT USE `from` and `to` to limit records since it downloads the entire
        // file whereas this way simply stops the download after 10 records
        skip_empty_lines: true,
        columns: true
      }))
      .on('error', err => {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
        logger.info(`FTP CSV: ${error_message}`);
        res.status(400).type('text/plain').send(error_message);
      })
      .pipe(through2.obj(function(record, enc, callback) {
        if (res.locals.source.source_data.results.length < 10) {
          if (_.isEmpty(res.locals.source.source_data.fields)) {
            logger.debug(`FTP CSV: fields: ${JSON.stringify(_.keys(record))}`);
            res.locals.source.source_data.fields = _.keys(record);
          }

          logger.debug(`FTP CSV: record: ${JSON.stringify(record)}`);
          res.locals.source.source_data.results.push(record);

          callback();

        } else {
          // there are enough records so end the stream prematurely, handle in 'close' event
          logger.debug('FTP CSV: found 10 results, exiting');
          this.destroy();
        }

      }))
      .on('close', () => {
        logger.debug('FTP CSV: stream ended prematurely');
        ftp.raw('quit', (err, data) => {
          return next();
        });
      })
      .on('finish', () => {
        logger.debug('FTP CSV: stream ended normally');
        ftp.raw('quit', (err, data) => {
          return next();
        });
      });

    });

  });

};

// middleware that requests and streams a compressed .zip file, returning up
// to the first 10 records
const sampleFtpZip = (req, res, next) => {
  logger.debug(`FTP ZIP: ${res.locals.source.data}`);

  const url = new URL(res.locals.source.data);

  const options = {
    host: url.hostname,
    port: url.port,
    user: url.username,
    pass: url.password,
    debugMode: true
  };

  const ftp = new JSFtp(options);

  // handle errors like "connection refused"
  ftp.on('error', (err) => {
    const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
    logger.info(`FTP ZIP: ${error_message}`);
    res.status(400).type('text/plain').send(error_message);
  });

  ftp.auth(options.user, options.pass, (auth_err) => {
    if (auth_err) {
      const error_message = `Error retrieving file ${res.locals.source.data}: Authentication error`;

      logger.info(`FTP ZIP: ${error_message}`);
      res.status(400).type('text/plain').send(error_message);
      return;
    }

    ftp.get(url.pathname, function(get_err, zipfile) {
      if (get_err) {
        const error_message = `Error retrieving file ${res.locals.source.data}: ${get_err}`;
        logger.info(`FTP ZIP: ${error_message}`);

        res.status(400).type('text/plain').send(error_message);
        return;

      } else {
        zipfile.pipe(unzip.Parse())
        .on('error', err => {
          const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
          logger.info(`FTP ZIP: ${error_message}`);
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
            logger.error(`FTP ZIP: ${error_message}`);
            res.status(400).type('text/plain').send(error_message);
          });

          if (_.endsWith(entry.path, '.csv')) {
            logger.debug(`FTP ZIP: treating ${entry.path} as csv`);
            res.locals.source.conform.type = 'csv';

            // process the .csv file
            entry.pipe(csvParse({
              // DO NOT USE `from` and `to` to limit records since it downloads the entire
              // file whereas this way simply stops the download after 10 records
              skip_empty_lines: true,
              columns: true
            }))
            .on('error', err => {
              const error_message = `Error retrieving file ${res.locals.source.data}: ${err}`;
              logger.info(`FTP ZIP CSV: ${error_message}`);
              res.status(400).type('text/plain').send(error_message);
            })
            .pipe(through2.obj(function(record, enc, callback) {
              // must use full function() syntax for "this" reference
              if (res.locals.source.source_data.results.length < 10) {
                if (_.isEmpty(res.locals.source.source_data.fields)) {
                  logger.debug(`FTP ZIP CSV: fields: ${JSON.stringify(_.keys(record))}`);
                  res.locals.source.source_data.fields = _.keys(record);
                }

                logger.debug(`FTP ZIP CSV: record: ${JSON.stringify(record)}`);
                res.locals.source.source_data.results.push(record);

                callback();

              } else {
                // there are enough records so end the stream prematurely, handle in 'close' event
                logger.debug('FTP ZIP CSV: found 10 results, exiting');
                this.destroy();
              }

            }))
            .on('close', () => {
              logger.debug('FTP ZIP CSV: stream ended prematurely');
              ftp.raw('quit', (err, data) => {
                return next();
              });
            })
            .on('finish', () => {
              logger.debug('FTP ZIP CSV: stream ended normally');
              ftp.raw('quit', (err, data) => {
                return next();
              });
            });

          }
          else if (_.endsWith(entry.path, '.geojson')) {
            logger.debug(`FTP ZIP: treating ${entry.path} as geojson`);
            res.locals.source.conform.type = 'geojson';

            oboe(entry)
              .node('features.*.properties', properties => {
                if (_.isEmpty(res.locals.source.source_data.fields)) {
                  logger.debug(`FTP ZIP GEOJSON: fields: ${JSON.stringify(_.keys(properties))}`);
                  res.locals.source.source_data.fields = _.keys(properties);
                }

                logger.debug(`FTP ZIP GEOJSON: feature: ${JSON.stringify(properties)}`);
                res.locals.source.source_data.results.push(properties);

              })
              .node('features[9]', function() {
                // bail after the 10th result.  'done' does not get called after .abort()
                //  so next() must be called explicitly
                // must use full function() syntax for "this" reference
                logger.debug('FTP ZIP GEOJSON: found 10 results, exiting');
                this.abort();
                ftp.raw('quit', (err, data) => {
                  return next();
                });

              })
              .fail(err => {
                let error_message = `Error retrieving file ${res.locals.source.data}: `;
                error_message += 'Could not parse as JSON';
                logger.info(`FTP ZIP GEOJSON: ${error_message}`);

                res.status(400).type('text/plain').send(error_message);

              })
              .done(() => {
                // this will happen when the list of results has been processed and
                // iteration still has no reached the 11th result, which is very unlikely
                ftp.raw('quit', (err, data) => {
                  if (!res.headersSent) {
                    return next();
                  }
                });
              });

          }
          else if (_.endsWith(entry.path, '.dbf')) {
            logger.debug(`FTP ZIP: treating ${entry.path} as dbf`);

            // in the case of a DBF file, because there's no DBF parser that takes a stream,
            // write to a temporary file and read in that way
            res.locals.source.conform.type = 'shapefile';

            res.locals.source.source_data.results = [];

            // pipe the dbf contents from the .zip file to a stream
            const dbf = dbfstream(entry)
            .on('error', err => {
              let error_message = `Error parsing file ${entry.path} from ${res.locals.source.data}: `;
              error_message += 'Could not parse as shapefile';
              logger.info(`FTP ZIP DBF: ${error_message}`);

              res.status(400).type('text/plain').send(error_message);

            })
            .on('header', header => {
              // there's a header so pull the field names from it
              res.locals.source.source_data.fields = header.listOfFields.map(f => f.name);

              logger.debug(`FTP ZIP DBF: fields: ${JSON.stringify(res.locals.source.source_data.fields)}`);

            })
            .on('data', record => {
              // if there aren't 10 records in the array yet and the record isn't deleted, then add it
              if (res.locals.source.source_data.results.length < 10) {
                if (!record['@deleted']) {
                  // find all the non-@ attributes
                  const attributes = _.pickBy(record, (value, key) => !_.startsWith(key, '@'));

                  logger.debug(`FTP ZIP GEOJSON: attributes: ${JSON.stringify(attributes)}`);

                  res.locals.source.source_data.results.push(attributes);

                }

              } else if (record['@numOfRecord'] === 11) {
                // don't use a plain `else` condition other this will fire multiple times
                logger.debug('HTTP ZIP DBF: found 10 results, exiting');

                // discard the remains of the .dbf file
                entry.autodrain();

                // there are 10 records, so bail now
                ftp.raw('quit', (err, data) => next());

              }

            })
            .on('end', () => {
              if (!res.headersSent) {
                // ran out of records before 10, so call next()
                ftp.raw('quit', (err, data) => next());
              }
            });

          }
          else {
            // this is a file that's currently unsupported so drain it so memory doesn't get full
            logger.debug(`FTP ZIP: skipping ${entry.path}`);
            entry.autodrain();

          }

        })
        .on('finish', () => {
          if (!res.locals.source.conform.type) {
            logger.info('HTTP ZIP: Could not determine type from zip file');
            res.status(400).type('text/plain').send('Could not determine type from zip file');
          }

        });

      }

    });

  });
};

// middleware that cleans up any temp files that were created in the course
// of the request
const cleanupTemp = (req, res, next) => {
  res.locals.temp.cleanup((err, stats) => {
    logger.debug(`temp clean up: ${JSON.stringify(stats)}`);
    next();
  });
};

// middleware that outputs the accumulated metadata, fields, and sample results
const output = (req, res, next) => {
  if (!res.headersSent) {
    res.status(200).send(res.locals.source);
  }
};


// setup a router that only handles Arcgis sources
const arcgisRouter = express.Router();
arcgisRouter.get('/', isArcgis, sampleArcgis);

// setup a router that only handles HTTP .geojson files
const httpGeojsonRouter = express.Router();
httpGeojsonRouter.get('/', isHttpGeojson, sampleHttpGeojson);

// setup a router that only handles FTP .geojson files
const ftpGeojsonRouter = express.Router();
ftpGeojsonRouter.get('/', isFtpGeojson, sampleFtpGeojson);

// setup a router that only handles HTTP .csv files
const httpCsvRouter = express.Router();
httpCsvRouter.get('/', isHttpCsv, sampleHttpCsv);

// setup a router that only handles FTP .csv files via
const ftpCsvRouter = express.Router();
ftpCsvRouter.get('/', isFtpCsv, sampleFtpCsv);

// setup a router that only handles HTTP .zip files
const httpZipRouter = express.Router();
httpZipRouter.get('/', isHttpZip, sampleHttpZip);

// setup a router that only handles FTP .zip files
const ftpZipRouter = express.Router();
ftpZipRouter.get('/', isFtpZip, sampleFtpZip);

router.get('/',
  preconditionsCheck,
  determineType,
  setupTemp,
  arcgisRouter,
  httpGeojsonRouter,
  ftpGeojsonRouter,
  httpCsvRouter,
  ftpCsvRouter,
  httpZipRouter,
  ftpZipRouter,
  cleanupTemp,
  output
);

module.exports = router;
