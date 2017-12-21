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
  .use('/sample', require('./sample'))
  .use('/submit', require('./submit'))
  .use(express.static(__dirname + '/public'));
