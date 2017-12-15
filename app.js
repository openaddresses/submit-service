const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');

module.exports = () => {
  const app = express();

  app.use(helmet({
    frameguard: {
      action: 'deny'
    }
  }));
  
  app.use(morgan('combined'));

  app.use('/sample', require('./sample'));
  app.use('/upload', require('./upload'));
  app.use('/submit', require('./submit'));

  // expose testing UI
  app.use(express.static(__dirname + '/public'));

  return app;

};
