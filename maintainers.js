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

// if no datafile parameter was supplied, bail immediately
function uploadPreconditionsCheck(req, res, next) {
  if (!process.env.GITHUB_ACCESS_TOKEN) {
    res.status(500).type('application/json').send({
      error: {
        code: 500,
        message: 'GITHUB_ACCESS_TOKEN not defined in process environment'
      }
    });

  } else {
    return next();
  }

}

// retrieve sources (files or directories) on a path
function getCommits(req, res, next) {
  const github = new GitHubApi();

  // github rate-limits unauthenticated requests, so authenticate since
  // this functionality can make many requests
  github.authenticate({
    type: 'oauth',
    token: process.env.GITHUB_ACCESS_TOKEN
  });

  // get all commits for a source
  github.repos.getCommits({
    owner: 'openaddresses',
    repo: 'openaddresses',
    path: req.baseUrl.replace('/maintainers', '')
  }, (err, response) => {
    if (err) {
      logger.error(`Error getting contents: ${err}`);
      res.status(400).type('application/json').send({
        error: {
          code: 400,
          message: `Error getting commits: ${err}`
        }
      });

    } else {
      const expectedNumberOfCommits = response.data.length;

      const commits = [];

      if (response.data.length === 0) {
        res.status(200).type('application/json').send([]);
        return;
      }

      // call getContent on each commit
      response.data.forEach(commit => {
        github.repos.getContent({
          owner: 'openaddresses',
          repo: 'openaddresses',
          path: req.baseUrl.replace('/maintainers', ''),
          ref: commit.sha
        }, (err, content) => {
          if (err) {
            // an error occurred for a getContent call so return an error
            logger.error(`Error getting contents: ${err}`);
            res.status(400).type('application/json').send({
              error: {
                code: 400,
                message: `Error getting contents: ${err}`
              }
            });

          } else {
            // parse the file, fixing bad regex escaping
            const parsed = JSON.parse(
              new Buffer(content.data.content, 'base64').
              toString('utf8').
              // this fixes an odd number of backslashes to an even number
              // eg: this file contains single backslashes:
              // https://github.com/openaddresses/openaddresses/blob/038592684059f70382575032c5591337313c2b90/sources/us/va/james_city.json
              replace(/\\(\\\\)*/g, '\\\\$1'));

            // record appropriate metadata
            commits.push({
              sha: commit.sha,
              email: parsed.email,
              lastModified: content.meta['last-modified']
            });

            // if all commits have been retrieved, sort by date and return them
            if (commits.length === expectedNumberOfCommits) {
              // sort because async means they're unordered
              commits.sort((a, b) => new Date(b.lastModified) < new Date(a.lastModified));

              res.status(200).type('application/json').send(commits);

            }

          }

        });

      });

    }

  });

}

module.exports = express.Router()
  .get('/', 
    cors(),
    uploadPreconditionsCheck,
    getCommits
  );
