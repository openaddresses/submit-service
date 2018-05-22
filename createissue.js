const express = require('express');
const GitHubApi = require('@octokit/rest');
const _ = require('lodash');
const bodyParser = require('body-parser');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

function postBodyErrorHandler(err, req, res, next) {
  if (_.get(err, 'type') === 'entity.parse.failed') {
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: `POST body not parseable as JSON: ${err.body}`
      }
    });

  } else {
    next();
  }

}

// verify that req.body contains an actual JSON object
function preconditionsCheck(req, res, next) {
  if (!process.env.GITHUB_ACCESS_TOKEN) {
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: 'GITHUB_ACCESS_TOKEN not defined in process environment'
      }
    });

  } else if (_.isEmpty(req.body)) {
    logger.error('POST body empty');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body empty'
      }
    });

  } else if (!_.has(req.body, 'location')) {
    logger.error('POST body empty');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body missing \'location\''
      }
    });

  } else if (!_.has(req.body, 'emailAddress')) {
    logger.error('POST body empty');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body missing \'emailAddress\''
      }
    });

  } else if (!_.has(req.body, 'dataUrl')) {
    logger.error('POST body empty');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body missing \'dataUrl\''
      }
    });

  } else if (!_.has(req.body, 'comments')) {
    logger.error('POST body empty');
    res.status(400).type('application/json').send({
      error: {
        code: 400,
        message: 'POST body missing \'comments\''
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

// create an issue
async function createIssue(req, res, next) {
  try {
    let content = `*Location*: ${req.body.location}\n`;
    content += `*Email Address*: ${req.body.emailAddress}\n`;
    content += `*Data URL*: ${req.body.dataUrl}\n`;
    content += `*Comments*: ${req.body.comments}`;

    const response = await res.locals.github.issues.create({
      owner: 'openaddresses',
      repo: 'openaddresses',
      title: `Submit Service Data for ${req.body.location}`,
      body: content
    });

    // create issue was successful so extract the url and set into locals
    res.locals.issueUrl = response.data.html_url;

    next();

  } catch (err) {
    logger.error(`Error creating issue: ${err}`);
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: `Error creating issue: ${err}`
      }
    });

  }

}

// send the pull request URL back to the caller
function output(req, res, next) {
  // entire github pipeline was successful so return the PR URL
  res.status(200).type('application/json').send({
    response: {
      url: res.locals.issueUrl
    }
  });    
}

module.exports = express.Router()
  .use(bodyParser.json())
  .use(postBodyErrorHandler)
  .post('/', [
    preconditionsCheck,
    authenticateWithGithub,
    createIssue,
    output
  ]);
