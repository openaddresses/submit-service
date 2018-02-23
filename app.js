const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');

module.exports = express()
  .use(helmet({
    frameguard: {
      action: 'deny'
    }
  }))
  .use(morgan('combined'))
  .use('/download/**/*.json', require('./download'))
  .use('/maintainers/sources/**/*.json', require('./maintainers'))
  .use('/sample', require('./sample'))
  // The sources router must always be exposed on the /sources endpoint since
  // it requests files from github.com/openaddresses/openaddresses from the sources/
  // directory.  Both of the following are needed for complete operation.
  .use('/sources/*', require('./sources'))
  .use('/sources', require('./sources'))
  .use('/submit', require('./submit'))
  .use('/upload', require('./upload'))
  .use(express.static(__dirname + '/public'));
