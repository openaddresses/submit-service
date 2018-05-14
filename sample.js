const express = require('express');
const router = require('express').Router();
const { URL } = require('url');
const _ = require('lodash');
const request = require('request');
const csvParse = require( 'csv-parse' );
const through2 = require('through2');
const oboe = require('oboe');
const morgan = require('morgan');
const toString = require('stream-to-string');
const dbfstream = require('dbfstream');
const JSFtp = require('jsftp');
const yauzl = require('yauzl');
const byline = require('byline');
const fs = require('fs');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// don't reject minor SSL errors
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

// matches:
// - MapServer/0
// - FeatureServer/13
// - MapServer/1/
const arcgisRegexp = /(Map|Feature)Server\/\d+\/?$/;

// matches:
// - file.csv
// - file.TsV
// - file.PSV
const delimitedFileRegexp = /\.[cpt]sv$/i;

// if no source parameter was supplied, bail immediately
function preconditionsCheck(req, res, next) {
  if (!req.query.source) {
    logger.debug('rejecting request due to lack of `source` parameter');
    res.status(400).type('text/plain').send('\'source\' parameter is required');
  } else {
    logger.debug({ source: req.query.source });
    next();
  }

}

function getProtocol(protocol) {
  if ('http:' === protocol || 'https:' === protocol) {
    return 'http';
  } else if ('ftp:' === protocol) {
    return 'ftp';
  }
}

function isDelimitedFile(filename) {
  return delimitedFileRegexp.test(filename);
}

// make temp scoped to individual requests so that calls to cleanup affect only
// the files created in the request.  temp.track() cleans up on process exit
// but that could lead to lots of file laying around needlessly until the
// service eventually stops.  Initialize with .track() anyway in the case
// where the service errored out before manual cleanup in middleware fires.
// Additionally, don't make temp global and cleanup on each request since it
// may delete files that are currently being used by other requests.
function setupTemp(req, res, next) {
  res.locals.temp = require('temp').track();
  next();
}

// determine the protocol, type, and compression to make decisions easier later on
function determineType(req, res, next) {
  let source;

  try {
    source = new URL(req.query.source);
  } catch (err) {
    logger.info(`Unable to parse URL from '${req.query.source}'`);
    res.status(400).type('text/plain').send(`Unable to parse URL from '${req.query.source}'`);
    return;
  }

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
  } else if (!source.protocol) {
    logger.info(`Unable to parse URL from '${req.query.source}'`);
    res.status(400).type('text/plain').send(`Unable to parse URL from '${req.query.source}'`);
  } else if (_.endsWith(source.pathname, '.geojson')) {
    res.locals.source.type = getProtocol(source.protocol);
    res.locals.source.conform.type = 'geojson';
  } else if (isDelimitedFile(source.pathname)) {
    res.locals.source.type = getProtocol(source.protocol);
    res.locals.source.conform.type = 'csv';
  } else if (_.endsWith(source.pathname, '.zip')) {
    res.locals.source.type = getProtocol(source.protocol);
    res.locals.source.compression = 'zip';
  } else {
    res.status(400).type('text/plain').send('Unsupported type');
  }

  // only call next() if no response was previously sent (due to error or unsupported type)
  if (!res.headersSent) {
    next();
  }

}

function protocolCheck(protocol, req, res, next) {
  if (res.locals.source.type === protocol) {
    next();
  } else {
    next('route');
  }    
}

const isArcgisSource = protocolCheck.bind(null, 'ESRI');
const isHttpSource = protocolCheck.bind(null, 'http');
const isFtpSource = protocolCheck.bind(null, 'ftp');

// middleware that queries an Arcgis server for the first 10 records
function sampleArcgis(req, res, next) {
  logger.debug(`using arcgis sampler for ${res.locals.source.data}`);

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
      let errorMessage = `Error connecting to Arcgis server ${res.locals.source.data}: `;

      if (_.has(err, 'thrown.code')) {
        // connection refused, etc
        errorMessage += err.thrown.code;
      } else if (err.thrown) {
        // unparseable JSON (but no code)
        errorMessage += 'Could not parse as JSON';
      } else {
        errorMessage += `${err.body} (${err.statusCode})`;
      }

      logger.info(`ARCGIS: ${errorMessage}`);

      res.status(400).type('text/plain').send(errorMessage);

    })
    .done(() => {
      if (!res.headersSent) {
        // this will happen when the list of results has been processed and
        // iteration still has no reached the 11th result, which is very unlikely
        next();
      }
    });

};

// middleware that returns up to the first 10 records of a geojson file
function parseGeoJsonStream(stream, res, next) {
  let prefix = res.locals.source.type;
  if (res.locals.source.compression === 'zip') {
    prefix += ' ZIP';
  }
  prefix += ' GEOJSON';

  oboe(stream)
    .node('features.*.properties', properties => {
      if (_.isEmpty(res.locals.source.source_data.fields)) {
        logger.debug(`${prefix}: fields: ${JSON.stringify(_.keys(properties))}`);
        res.locals.source.source_data.fields = _.keys(properties);
      }

      logger.debug(`${prefix}: feature: ${JSON.stringify(properties)}`);
      res.locals.source.source_data.results.push(properties);

    })
    .node('features[9]', function() {
      // bail after the 10th result.  'done' does not get called after .abort()
      //  so next() must be called explicitly
      // must use full function() syntax for "this" reference
      logger.debug(`${prefix}: found 10 results, exiting`);
      this.abort();
      next();
    })
    .fail(err => {
      let errorMessage = `Error retrieving file ${res.locals.source.data}: `;
      errorMessage += 'Could not parse as JSON';
      logger.info(`${prefix}: ${errorMessage}`);

      res.status(400).type('text/plain').send(errorMessage);

    })
    .done(() => {
      if (!res.headersSent) {
        // this will happen when the list of results has been processed and
        // iteration still has no reached the 11th result, which is very unlikely
        next();
      }
    });

}

// middleware that returns up to the first 10 records of a csv file
function parseCsvStream(stream, res, next) {
  let prefix = res.locals.source.type;
  if (res.locals.source.compression === 'zip') {
    prefix += ' ZIP';
  }
  prefix += ' CSV';

  stream.once('data', data => {
    // grab the first line from the stream
    const lines = Buffer.from(data).toString().split('\n');

    const headerLine = lines.shift();

    // get the counts of each delimiter 
    const delimiterHistogram = _.pick(_.countBy(headerLine), [',', '|', '\t', ';']);

    // find the potential delimiter that appears most often 
    const likelyDelimiter = _.maxBy(_.keys(delimiterHistogram), i => delimiterHistogram[i]);

    res.locals.source.source_data.fields = headerLine.split(likelyDelimiter);
    // console.log(`${prefix}: fields: ${res.locals.source.source_data.fields}`);
    logger.debug(`${prefix}: fields: ${res.locals.source.source_data.fields}`);

    res.locals.source.conform.csvsplit = likelyDelimiter;
    logger.debug(`${prefix}: likely delimiter for ${res.locals.source.data} '${likelyDelimiter}'`);

    // pause the stream and put everything else but the first line
    // back on the stream
    stream.pause();
    stream.unshift(Buffer.from(lines.join('\n')));

    // otherwise everything was fine so pipe the response to CSV and collect records
    stream.pipe(csvParse({
      // DO NOT USE `from` and `to` to limit records since it downloads the entire
      // file whereas this way simply stops the download after 10 records
      delimiter: likelyDelimiter,
      skip_empty_lines: true,
      columns: res.locals.source.source_data.fields
    }))
    .on('error', err => {
      const errorMessage = `Error parsing file from ${res.locals.source.data} as CSV: ${err}`;
      // const errorMessage = `Error retrieving file ${res.locals.source.data}: ${err}`;
      logger.info(`${prefix}: ${errorMessage}`);
      res.status(400).type('text/plain').send(errorMessage);
    })
    .pipe(through2.obj(function(record, enc, callback) {
      // console.log('READING A RECORD')

      if (res.locals.source.source_data.results.length < 10) {
        logger.debug(`${prefix}: record: ${JSON.stringify(record)}`);
        res.locals.source.source_data.results.push(record);

        callback();

      } else {
        // there are enough records so end the stream prematurely, handle in 'close' event
        logger.debug('${prefix}: found 10 results, exiting');
        this.destroy();
      }

    }))
    .on('close', () => {
      logger.debug(`${prefix}: stream ended prematurely`);
      next();
    })
    .on('finish', () => {
      logger.debug(`${prefix}: stream ended normally`);
      next();
    });

    stream.resume();

  });

}

// middleware that returns up to the first 10 records of a dbf file
function parseDbfStream(stream, res, next) {
  let prefix = res.locals.source.type;
  if (res.locals.source.compression === 'zip') {
    prefix += ' ZIP';
  }
  prefix += ' DBF';

  res.locals.source.source_data.results = [];

  // pipe the dbf contents from the .zip file to a stream
  dbfstream(stream)
  .on('error', err => {
    let errorMessage = `Error parsing file from ${res.locals.source.data}: `;
    errorMessage += 'Could not parse as shapefile';
    logger.info(`${prefix}: ${errorMessage}`);

    res.status(400).type('text/plain').send(errorMessage);

  })
  .on('header', header => {
    // there's a header so pull the field names from it
    res.locals.source.source_data.fields = header.listOfFields.map(f => f.name);

    logger.debug(`${prefix}: fields: ${JSON.stringify(res.locals.source.source_data.fields)}`);

  })
  .on('data', record => {
    // if there aren't 10 records in the array yet and the record isn't deleted, then add it
    if (res.locals.source.source_data.results.length < 10) {
      if (!record['@deleted']) {
        // find all the non-@ attributes
        const attributes = _.pickBy(record, (value, key) => !_.startsWith(key, '@'));

        logger.debug(`${prefix}: attributes: ${JSON.stringify(attributes)}`);

        res.locals.source.source_data.results.push(attributes);

      }

    } else if (record['@numOfRecord'] === 11) {
      // don't use a plain `else` condition other this will fire multiple times
      logger.debug(`${prefix}: found 10 results, exiting`);

      // discard the remains of the .dbf file
      // entry.autodrain();

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

function processZipFile(zipfile, res, next) {
  const protocol = res.locals.source.type;

  const tmpZipStream = res.locals.temp.createWriteStream();

  // write the response to a temporary file
  zipfile.pipe(tmpZipStream).on('close', (err) => {
    logger.debug(`wrote ${tmpZipStream.bytesWritten} bytes to ${tmpZipStream.path}`);

    yauzl.open(tmpZipStream.path, {lazyEntries: true}, function(err, zipfile) {
      if (err) {
        const errorMessage = `Error retrieving file ${res.locals.source.data}: ${err}`;
        logger.info(`${protocol} ZIP: ${errorMessage}`);
        res.status(400).type('text/plain').send(errorMessage);

      } else {
        // read first entry
        zipfile.readEntry();

        zipfile.on('entry', function(entry) {
          if (isDelimitedFile(entry.fileName)) {
            logger.debug(`${protocol} ZIP CSV: ${entry.fileName}`);
            res.locals.source.conform.type = 'csv';

            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                logger.error(`err: ${err}`);
              } else {
                parseCsvStream(stream, res, next);
              }

            });

          }
          else if (_.endsWith(entry.fileName, '.geojson')) {
            logger.debug(`${protocol} ZIP GEOJSON: ${entry.path}`);

            res.locals.source.conform.type = 'geojson';

            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                console.error(`err: ${err}`);
              } else {
                parseGeoJsonStream(stream, res, next);
              } 

            });

          }
          else if (_.endsWith(entry.fileName, '.dbf')) {
            logger.debug(`${protocol} ZIP DBF: ${entry.fileName}`);

            // in the case of a DBF file, because there's no DBF parser that takes a stream,
            // write to a temporary file and read in that way
            res.locals.source.conform.type = 'shapefile';

            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                console.error(`err: ${err}`);
              } else {
                parseDbfStream(stream, res, next);
              }

            });

          }
          else {
            // this is a file that's currently unsupported so drain it so memory doesn't get full
            logger.debug(`${protocol} ZIP: skipping ${entry.fileName}`);
            zipfile.readEntry();

          }

        });

        // handle catastrophic errors (file isn't a .zip file, etc)
        zipfile.on('error', err => {
          const errorMessage = `Error retrieving file ${res.locals.source.data}: ${err}`;
          logger.info(`${protocol} ZIP: ${errorMessage}`);
          res.status(400).type('text/plain').send(errorMessage);

        });

        // handle end of .zip file
        zipfile.on('end', () => {
          if (!res.locals.source.conform.type) {
            logger.info(`${protocol} ZIP: Could not determine type from zip file`);
            res.status(400).type('text/plain').send('Could not determine type from zip file');
          }

        });

      }

    });

  });

}

function sampleHttpSource(req, res, next) {
  logger.debug(`HTTP GEOJSON: ${res.locals.source.data}`);

  const r = request(res.locals.source.data);

  // handle catastrophic errors like "connection refused"
  r.on('error', err => {
    const errorMessage = `Error retrieving file ${res.locals.source.data}: ${err.code}`;
    logger.info(`HTTP GEOJSON: ${errorMessage}`);

    res.status(400).type('text/plain').send(errorMessage);

  });

  // handle normal responses (including HTTP errors)
  r.on('response', response => {
    if (response.statusCode !== 200) {
      // something went wrong so optionally save up the response text and return an error
      let errorMessage = `Error retrieving file ${res.locals.source.data}`;

      // if the content type is text/plain, then use the error message text
      if (_.startsWith(_.get(response.headers, 'content-type'), 'text/plain')) {
        toString(r, (err, msg) => {
          errorMessage += `: ${msg} (${response.statusCode})`;
          logger.info(`HTTP GEOJSON: ${errorMessage}`);
          res.status(400).type('text/plain').send(errorMessage);

        });

      }
      else {
        errorMessage += `: (${response.statusCode})`;
        logger.info(`HTTP GEOJSON: ${errorMessage}`);
        res.status(400).type('text/plain').send(errorMessage);

      }

    } else {
      if (res.locals.source.conform.type === 'geojson') {
        parseGeoJsonStream(r, res, next);
      } 
      else if (res.locals.source.conform.type === 'csv') {
        // Write the header line and 100 data lines from the file to 
        // a temp file, then read that stream back in and process with that.
        // This approach is required because the actual CSV parser unshifts
        // records back onto the stream, which requires a readable stream and
        // `r` is not one of them.  
        const tempCsvFile = res.locals.temp.createWriteStream();

        let lineCount = 0;

        // read the stream in line-by-line
        r.pipe(byline.createStream())
          .pipe(through2.obj(function (line, enc, next) { 
            if (lineCount++ < 101) {
              this.push(line + '\n');
              // console.error(`wrote line # ${lineCount}`);
              return next();
            }

            // once 101 lines have been read, destroy the stream
            this.destroy(); // triggers 'close' event

            // close the temporary stream
            tempCsvFile.emit('close');

          }))
          .on('error', (err) => {
            logger.info(`HTTP CSV: ${err.message}`);
            res.status(400).type('text/plain').send(err.message);
            next();
          })
          .pipe(tempCsvFile)
          .on('close', () => {
            // once the temporary stream has been closed, parse it
            parseCsvStream(fs.createReadStream(tempCsvFile.path), res, next);
          });

      } 
      else if (res.locals.source.compression === 'zip') {
        processZipFile(r, res, next);
      } 

    }

  });

}

function sampleFtpSource(req, res, next) {
  logger.debug(`FTP GEOJSON: ${res.locals.source.data}`);

  const url = new URL(res.locals.source.data);

  const options = {
    host: url.hostname,
    port: url.port,
    user: url.username,
    pass: url.password
  };

  // if (url.username || url.password) {
  //   options.user = url.username;
  //   options.pass = url.password;
  // }

  const ftp = new JSFtp(options);

  // handle errors like "connection refused"
  ftp.on('error', (err) => {
    const errorMessage = `Error retrieving file ${res.locals.source.data}: ${err}`;
    logger.info(`FTP ZIP: ${errorMessage}`);
    res.status(400).type('text/plain').send(errorMessage);
  });

  ftp.auth(options.user, options.pass, authErr => {
    if (authErr) {
      const errorMessage = `Error retrieving file ${res.locals.source.data}: Authentication error`;

      logger.info(`FTP GEOJSON: ${errorMessage}`);
      res.status(400).type('text/plain').send(errorMessage);
      return;
    }

    ftp.get(url.pathname, (getErr, stream) => {
      // bail early if there's an error, such as non-existent file
      if (getErr) {
        const errorMessage = `Error retrieving file ${res.locals.source.data}: ${getErr}`;
        logger.info(`FTP GEOJSON: ${errorMessage}`);

        res.status(400).type('text/plain').send(errorMessage);
        return;
      }

      // get() returns a paused stream, so resume it
      stream.resume();

      if (res.locals.source.conform.type === 'geojson') {
        parseGeoJsonStream(stream, res, next);
      } 
      else if (res.locals.source.conform.type === 'csv') {
        parseCsvStream(stream, res, next);
      } 
      else if (res.locals.source.compression === 'zip') {
        processZipFile(stream, res, next);
      } 

    });

  });

}

// middleware that cleans up any temp files that were created in the course
// of the request
function cleanupTemp(req, res, next) {
  res.locals.temp.cleanup((err, stats) => {
    logger.debug(`temp clean up: ${JSON.stringify(stats)}`);
    next();
  });
};

// middleware that outputs the accumulated metadata, fields, and sample results
function output(req, res, next) {
  if (!res.headersSent) {
    res.status(200).send(res.locals.source);
  }
};

// setup a router that only handles Arcgis sources
const arcgisRouter = express.Router();
arcgisRouter.get('/', isArcgisSource, sampleArcgis);

const httpRouter = express.Router();
httpRouter.get('/', isHttpSource, sampleHttpSource);

const ftpRouter = express.Router();
ftpRouter.get('/', isFtpSource, sampleFtpSource);

router.get('/',
  preconditionsCheck,
  determineType,
  setupTemp,
  arcgisRouter,
  httpRouter,
  ftpRouter,
  cleanupTemp,
  output
);

module.exports = router;
