const express = require('express');
const GitHubApi = require('github');
const _ = require('lodash');
const bodyParser = require('body-parser');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// The /submit endpoint creates a new pull request based on openaddresses/openaddresses
// master with a file containing the contents of the POST body


function postBodyErrorHandler(err, req, res, next) {
  if (_.get(err, 'type') === 'entity.parse.failed') {
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: `POST body not parseable as JSON: ${err.body}`
      }
    });

  } else if (_.get(err, 'type') === 'entity.too.large') {
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body exceeds max size of 50kb'
      }
    });

  } else {
    next();
  }

}

// verify that req.body contains an actual JSON object
function preconditionsCheck(req, res, next) {
  if (_.isEmpty(req.body)) {
    logger.error('POST body empty');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body empty'
      }
    });

  } else {
    next();

  }

}

// login to github
function authenticateWithGithub(req, res, next) {
  res.locals.github = new GitHubApi();

  res.locals.github.authenticate({
    type: 'oauth',
    token: process.env.GITHUB_ACCESS_TOKEN
  });

  next();

}

// generate a "unique" target reference name and upload file path for this source
function uniqueifyNames(req, res, next) {
  // create a random number to hopefully generate a unique branch name and filename
  const unique_hex_number = _.random(255, 255*255*255).toString(16);

  // this is the reference/branch name that will be created
  res.locals.reference_name = `submit_service_${unique_hex_number}`;

  // this is the file that will be added
  res.locals.path = `sources/contrib/source_${unique_hex_number}.json`;

  next();

}

// lookup the master openaddresses/openaddresses SHA and create a reference (branch)
// to it that can be used for this source
function branchFromMaster(req, res, next) {
  // lookup the sha of openaddresses/openaddresses#master
  // masterReferenceResponse.data.object.sha is needed when creating a reference
  res.locals.github.gitdata.getReference({
    owner: 'openaddresses',
    repo: 'openaddresses',
    ref: 'heads/master'
  }, (err, masterReferenceResponse) => {
    if (err) {
      logger.error(`Error looking up master reference: ${err}`);
      res.status(500).type('application/json').send({
        error: {
          code: 500,
          message: `Error looking up master reference: ${err}`
        }
      });
      return;

    }

    res.locals.github.gitdata.createReference({
      owner: 'openaddresses',
      repo: 'openaddresses',
      ref: `refs/heads/${res.locals.reference_name}`,
      sha: masterReferenceResponse.data.object.sha
    }, (err, response) => {
      if (err) {
        logger.error(`Error creating local reference: ${err}`);
        res.status(500).type('application/json').send({
          error: {
            code: 500,
            message: `Error creating local reference: ${err}`
          }
        });
        return;

      }

      next();

    });

  });

}

// take the POST body of this request and add it as a file to the branch
function addFileToBranch(req, res, next) {
  res.locals.github.repos.createFile({
    owner: 'openaddresses',
    repo: 'openaddresses',
    path: res.locals.path,
    message: 'This file was added by the OpenAddresses submit-service',
    content: Buffer.from(JSON.stringify(req.body)).toString('base64'),
    branch: res.locals.reference_name
  }, (err, response) => {
    if (err) {
      logger.error(`Error creating file for reference: ${err}`);
      res.status(500).type('application/json').send({
        error: {
          code: 500,
          message: `Error creating file for reference: ${err}`
        }
      });
    } else {
      next();
    }

  });

}

// create a pull request which will get picked up by the machine
function createPullRequest(req, res, next) {
  res.locals.github.pullRequests.create({
    owner: 'openaddresses',
    repo: 'openaddresses',
    title: 'Submit Service Pull Request',
    head: `openaddresses:${res.locals.reference_name}`,
    base: 'master',
    body: 'This pull request contains changes requested by the Submit Service',
    maintainer_can_modify: true
  }, (err, response) => {
    if (err) {
      logger.error(`Error creating pull request: ${err}`);
      res.status(500).type('application/json').send({
        error: {
          code: 500,
          message: `Error creating pull request: ${err}`
        }
      });
    } else {
      // create pull request was successful so extract the url and set into locals
      res.locals.pull_request_url = response.data.html_url;
      next();
    }

  });

}

// send the pull request URL back to the caller
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
  .use(bodyParser.json({
    limit: '50kb'
  }))
  .use(postBodyErrorHandler)
  .post('/', [
    preconditionsCheck,
    authenticateWithGithub,
    uniqueifyNames,
    branchFromMaster,
    addFileToBranch,
    createPullRequest,
    output
  ]);
