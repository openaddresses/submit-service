const express = require('express');
const _ = require('lodash');
const path = require('path');
const fileUpload = require('express-fileupload');
const S3 = require('aws-sdk/clients/s3');
const string2stream = require('string-to-stream');

const acceptableUploadFileExtensions = ['.zip', '.csv', '.geojson'];

// if no datafile parameter was supplied, bail immediately
function uploadPreconditionsCheck(req, res, next) {
  const maxUploadSize = parseInt(process.env.MAX_UPLOAD_SIZE);

  if (isNaN(maxUploadSize)) {
    res.status(500).type('text/plain').send('MAX_UPLOAD_SIZE not defined in process environment');
  } else if (!_.has(req, 'files.datafile')) {
    res.status(400).type('text/plain').send('\'datafile\' parameter is required');
  } else if (!_.includes(acceptableUploadFileExtensions, path.extname(req.files.datafile.name))) {
    res.status(400).type('text/plain').send('supported extensions are .zip, .csv, and .geojson');
  } else if (req.files.datafile.data.length > maxUploadSize) {
    res.status(400).type('text/plain').send(`max upload size is ${maxUploadSize}`);
  } else {
    return next();
  }

};

// upload the file to s3 and redirect to /sample
function handleFileUpload(req, res, next) {
  const s3 = new S3({apiVersion: '2006-03-01'});

  // generate a 6 char hex string that doesn't start with a 0 to uniqify the s3 object Key
  const uniq = _.random(255, 255*255*255).toString(16);

  const uploadParams = {};
  uploadParams.Bucket = 'data.openaddresses.io';
  uploadParams.Body = string2stream(req.files.datafile.data.toString());
  uploadParams.Key = `cache/uploads/submit-service/${uniq}/${path.basename(req.files.datafile.name)}`;

  s3.upload(uploadParams, (err, data) => {
    if (err) {
      res.status(500).type('text/plain').send(err);
    } else {
      res.redirect(`/sample?source=${data.Location}`);
    }
  });

};

module.exports = express.Router()
  .use(fileUpload())
  .post('/',
    uploadPreconditionsCheck,
    handleFileUpload
  );
