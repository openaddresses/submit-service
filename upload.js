const express = require('express');
const _ = require('lodash');
const sha1 = require('sha1');
const path = require('path');
const fileUpload = require('express-fileupload');

const acceptableUploadFileExtensions = ['.zip', '.csv', '.geojson'];

// if no datafile parameter was supplied, bail immediately
const uploadPreconditionsCheck = (req, res, next) => {
  if (!_.has(req, 'files.datafile')) {
    res.status(400).type('text/plain').send('\'datafile\' parameter is required');
  } else if (!_.includes(acceptableUploadFileExtensions, path.extname(req.files.datafile.name))) {
    res.status(400).type('text/plain').send('supported extensions are .zip, .csv, and .geojson');
  } else if (req.files.datafile.data.length > 50*1024*1024) {
    res.status(400).type('text/plain').send('max upload size is blah');
  } else {
    return next();
  }

};

// calculate the sha1 from the contents of the upload
const handleFileUpload = (req, res, next) => {
  res.locals.sha1 = sha1(req.files.datafile.data.toString());
  next();
};

const outputSha1 = (req, res, next) => {
  res.status(200).type('text/plain').send(res.locals.sha1);
};

module.exports = express.Router()
  .use(fileUpload())
  .post('/',
    uploadPreconditionsCheck,
    handleFileUpload,
    outputSha1
  );
