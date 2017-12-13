const express = require('express');
const morgan = require('morgan');

module.exports = credentials => {
  const app = express();

  // set credentials into the application-wide settings
  app.locals.s3 = {
    accessKeyId: credentials.s3AccessKeyId,
    secretAccessKey: credentials.s3SecretAccessKey
  };
  app.locals.github = {
    accessToken: credentials.githubAccessToken
  };

  app.use(morgan('combined'));

  app.use('/sample', require('./sample'));
  app.use('/upload', require('./upload'));
  app.use('/submit', require('./submit'));

  // expose testing UI
  app.use(express.static(__dirname + '/public'));

  return app;

};
