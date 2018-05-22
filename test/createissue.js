const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const proxyquire = require('proxyquire');
const string2stream = require('string-to-stream');
const _ = require('lodash');

tape('error conditions', test => {
  test.test('GITHUB_ACCESS_TOKEN missing from environment should respond with error', t => {
    t.plan(3);

    // remove GITHUB_ACCESS_TOKEN from the process environment
    delete process.env.GITHUB_ACCESS_TOKEN;

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 500);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 500,
          message: 'GITHUB_ACCESS_TOKEN not defined in process environment'
        }
      });

    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('undefined POST body should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: 'POST body empty'
        }
      });
      t.end();
    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('POST body not parseable as JSON should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      body: 'this is not parseable as JSON',
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: 'POST body not parseable as JSON: "this is not parseable as JSON"'
        }
      });
      t.end();
    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('JSON POST body missing \'location\' should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        emailAddress: 'this is the email address',
        dataUrl: 'this is the data url',
        comments: 'this is some comments'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: 'POST body missing \'location\''
        }
      });
      t.end();
    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('JSON POST body missing \'emailAddress\' should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        location: 'this is the location',
        dataUrl: 'this is the data url',
        comments: 'this is some comments'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: 'POST body missing \'emailAddress\''
        }
      });
      t.end();
    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('JSON POST body missing \'dataUrl\' should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        location: 'this is the location',
        emailAddress: 'this is the email address',
        comments: 'this is the comments'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: 'POST body missing \'dataUrl\''
        }
      });
      t.end();
    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('JSON POST body missing \'comments\' should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const createIssueService = express().use('/', require('../createissue')).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        location: 'this is the location',
        emailAddress: 'this is the email address',
        dataUrl: 'this is the data url'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 400);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 400,
          message: 'POST body missing \'comments\''
        }
      });
      t.end();
    })
    .finally(() => {
      createIssueService.close();
    });

  });

  test.test('request failing to create issue should respond with 500 and error message', t => {
    t.plan(4);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    // mock the github in the createIssue route
    const createIssueEndpoint = proxyquire('../createissue', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          issues: {
            create: o => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                title: 'Submit Service Data for this is the location',
                body: `*Location*: this is the location
*Email Address*: this is the email address
*Data URL*: this is the data url
*Comments*: this is the comments`
              });

              return new Promise((resolve, reject) => reject('createIssue failed'));

            }
          }
        };
      },
      'lodash': {
        random: (start, end) => 4543821
      }
    });

    const createIssueService = express().use('/', createIssueEndpoint).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      body: {
        location: 'this is the location',
        emailAddress: 'this is the email address',
        dataUrl: 'this is the data url',
        comments: 'this is the comments'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(t.fail.bind(null, 'request should not have been successful'))
    .catch(err => {
      t.equals(err.statusCode, 500);
      t.equals(err.response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(err.error, {
        error: {
          code: 500,
          message: 'Error creating issue: createIssue failed'
        }
      });
    })
    .finally(() => {
      createIssueService.close();
    });

  });

});

tape('success conditions', test => {
  test.test('request creating issue should return 200 and issue link', t => {
    t.plan(4);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    // mock the github in the createIssue route
    const createIssueEndpoint = proxyquire('../createissue', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          issues: {
            create: o => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                title: 'Submit Service Data for this is the location',
                body: `*Location*: this is the location
*Email Address*: this is the email address
*Data URL*: this is the data url
*Comments*: this is the comments`
              });

              return new Promise((resolve, reject) => resolve({
                data: {
                  html_url: 'this is the html url for the issue'
                }
              }));
            }
          }
        };
      }
    });


    const createIssueService = express().use('/', createIssueEndpoint).listen();

    request({
      uri: `http://localhost:${createIssueService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        location: 'this is the location',
        emailAddress: 'this is the email address',
        dataUrl: 'this is the data url',
        comments: 'this is the comments'
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        response: {
          url: 'this is the html url for the issue'
        }
      });
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      createIssueService.close();
      t.end();
    });

  });

});