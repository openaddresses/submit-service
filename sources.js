const express = require('express');
const GitHubApi = require('@octokit/rest');
const cors = require('cors');

const winston = require('winston');
const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// helper function to filter out non-directories and non-json files
function isDirOrJsonFile(f) {
  return f.type === 'dir' || f.name.endsWith('.json');
}

// retain only the name, type, and path properties from each directory or file
function simplify(f) {
  return {
    name: f.name,
    type: f.type,
    path: f.path
  };
}

// retrieve sources (files or directories) on a path
function getSources(req, res, next) {
  const github = new GitHubApi();

  github.repos.getContent({
    owner: 'openaddresses',
    repo: 'openaddresses',
    path: req.baseUrl
  }, (err, response) => {
    if (err) {
      logger.error(`Error getting contents: ${err}`);
      res.status(400).type('application/json').send({
        error: {
          code: 400,
          message: `Error getting contents: ${err}`
        }
      });

    } else if (Array.isArray(response.data)) {
      res.status(200).type('application/json').send(
        response.data.filter(isDirOrJsonFile).map(simplify)
      );

    } else {
      res.status(400).type('application/json').send({
        error: {
          code: 400,
          message: `Error getting contents: ${req.baseUrl} is a file`
        }
      });

    }

  });

}

module.exports = express.Router()
  .get('/', [
    cors(), getSources
  ]);
