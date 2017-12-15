const express = require('express');
const GitHubApi = require('github');
const fileUpload = require('express-fileupload');
const _ = require('lodash');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

async function createBranch(req, res, next) {
  const github = new GitHubApi();

  const unique_hex_number = _.random(255, 255*255*255).toString(16);

  const reference_name = `submit_service_${unique_hex_number}`;
  const path = `sources/contrib/source_${unique_hex_number}.json`;

  // first, authenticate the user
  github.authenticate({
    type: 'oauth',
    token: req.app.locals.github.accessToken
  });

  // second, lookup the sha of openaddresses/openaddresses#master
  // master_reference_response.data.object.sha is needed when creating a reference
  let master_reference_response;
  try {
    master_reference_response = await github.gitdata.getReference({
      owner: 'openaddresses',
      repo: 'openaddresses',
      ref: 'heads/master'
    });

  } catch (err) {
    logger.error(`Error looking up master reference: ${err}`);
    return res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error looking up master reference: ${err}`
      }
    });
  }

  // third, create the reference for the authenticated user
  try {
    await github.gitdata.createReference({
      owner: 'openaddresses',
      repo: 'openaddresses',
      ref: `refs/heads/${reference_name}`,
      sha: master_reference_response.data.object.sha
    });

  } catch (err) {
    logger.error(`Error creating local reference: ${err}`);
    return res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating local reference: ${err}`
      }
    });
  }

  // fourth, create the file in the local reference for the authenticated user
  try {
    await github.repos.createFile({
      owner: 'openaddresses',
      repo: 'openaddresses',
      path: path,
      message: 'This file was added by the OpenAddresses submit-service',
      content: Buffer.from(req.files.source.data).toString('base64'),
      branch: reference_name
    });

  } catch (err) {
    logger.error(`Error creating file for reference: ${err}`);
    return res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating file for reference: ${err}`
      }
    });
  }

  // fifth, create the pull request
  let create_pull_request_response;
  try {
    create_pull_request_response = await github.pullRequests.create({
      owner: 'openaddresses',
      repo: 'openaddresses',
      title: 'Submit Service Pull Request',
      head: `openaddresses:${reference_name}`,
      base: 'master',
      body: 'This pull request contains changes requested by the Submit Service',
      maintainer_can_modify: true
    });

  } catch (err) {
    logger.error(`Error creating pull request: ${err}`);
    return res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating pull request: ${err}`
      }
    });
  }

  // entire github pipeline was successful so return the PR URL
  res.status(200).type('application/json').send({
    response: {
      url: create_pull_request_response.data.html_url
    }
  });

  next();

}

module.exports = express.Router()
  .use(fileUpload())
  .post('/', createBranch);
