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

function initialize(req, res, next) {
  res.locals.github = new GitHubApi();

  // create a random number to hopefully generate a unique branch name and filename
  const unique_hex_number = _.random(255, 255*255*255).toString(16);

  res.locals.reference_name = `submit_service_${unique_hex_number}`;
  res.locals.path = `sources/contrib/source_${unique_hex_number}.json`;

  // first, authenticate the user
  res.locals.github.authenticate({
    type: 'oauth',
    token: req.app.locals.github.accessToken
  });

  next();

}

async function createBranch(req, res, next) {
  // second, lookup the sha of openaddresses/openaddresses#master
  // master_reference_response.data.object.sha is needed when creating a reference
  let master_reference_response;
  try {
    master_reference_response = await res.locals.github.gitdata.getReference({
      owner: 'openaddresses',
      repo: 'openaddresses',
      ref: 'heads/master'
    });

  } catch (err) {
    logger.error(`Error looking up master reference: ${err}`);
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error looking up master reference: ${err}`
      }
    });
  }

  // third, create the reference (branch)
  try {
    await res.locals.github.gitdata.createReference({
      owner: 'openaddresses',
      repo: 'openaddresses',
      ref: `refs/heads/${res.locals.reference_name}`,
      sha: master_reference_response.data.object.sha
    });

    next();

  } catch (err) {
    logger.error(`Error creating local reference: ${err}`);
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating local reference: ${err}`
      }
    });
  }

}

async function addSourceFile(req, res, next) {
  try {
    await res.locals.github.repos.createFile({
      owner: 'openaddresses',
      repo: 'openaddresses',
      path: res.locals.path,
      message: 'This file was added by the OpenAddresses submit-service',
      content: Buffer.from(req.files.source.data).toString('base64'),
      branch: res.locals.reference_name
    });

    next();

  } catch (err) {
    logger.error(`Error creating file for reference: ${err}`);
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating file for reference: ${err}`
      }
    });
  }

}

async function createPullRequest(req, res, next) {
  try {
    const create_pull_request_response = await res.locals.github.pullRequests.create({
      owner: 'openaddresses',
      repo: 'openaddresses',
      title: 'Submit Service Pull Request',
      head: `openaddresses:${res.locals.reference_name}`,
      base: 'master',
      body: 'This pull request contains changes requested by the Submit Service',
      maintainer_can_modify: true
    });

    res.locals.pull_request_url = create_pull_request_response.data.html_url;

    next();

  } catch (err) {
    logger.error(`Error creating pull request: ${err}`);
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating pull request: ${err}`
      }
    });
  }

}

function output(req, res, next) {
  // entire github pipeline was successful so return the PR URL
  res.status(200).type('application/json').send({
    response: {
      url: res.locals.pull_request_url
    }
  });

  next();

}

module.exports = express.Router()
  .use(fileUpload())
  .post('/', [
    initialize,
    createBranch,
    addSourceFile,
    createPullRequest,
    output
  ]);
