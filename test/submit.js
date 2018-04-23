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

    const submitService = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
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
      submitService.close();
    });

  });

  test.test('undefined POST body should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const submitService = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
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
      submitService.close();
    });

  });

  test.test('POST body not parseable as JSON should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const submitService = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
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
      submitService.close();
    });

  });

  test.test('POST body not parseable as JSON should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const submitService = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
      method: 'POST',
      qs: {},
      body: { str: Buffer.alloc(100000, '.').toString() },
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
          message: 'POST body exceeds max size of 50kb'
        }
      });

    })
    .finally(() => {
      submitService.close();
    });

  });

});

tape('valid source tests', test => {
  test.test('request failing to look up master reference should respond with 500 and error message', t => {
    t.plan(5, 'auth + master ref + response');

    // /submit pulls the github authentication token from the environment so set it here
    process.env.GITHUB_ACCESS_TOKEN = 'github authentication token';

    // mock the github in the submit route
    const submitEndpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: (options) => {
            t.deepEquals(options, {
              type: 'oauth',
              token: 'github authentication token'
            });
          },
          gitdata: {
            getReference: (o) => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                ref: 'heads/master'
              });

              return new Promise((resolve, reject) => reject('getReference for master failed'));

            },
            createReference: t.fail.bind(null, 'gitdata.createReference should not have been called')
          },
          repos: {
            createFile: t.fail.bind(null, 'repos.createFile should not have been called')
          },
          pullRequests: {
            create: () => t.fail.bind(null, 'pullRequests.create should not have been called')
          }
        };
      }
    });

    const submitService = express().use('/', submitEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        coverage: {},
        note: 'this is the note',
        data: 'this is the data URL',
        type: 'source type',
        conform: {}
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
          message: 'Error looking up master reference: getReference for master failed'
        }
      });
    })
    .finally(() => {
      submitService.close();
    });

  });

  test.test('request failing to create local reference should respond with 500 and error message', t => {
    t.plan(4);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    // mock the github in the submit route
    const submitEndpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: o => {
              return new Promise((resolve, reject) => resolve({
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }));
            },
            createReference: o => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                ref: 'refs/heads/submit_service_45554d',
                sha: 'master sha'
              });

              return new Promise((resolve, reject) => reject('createReference from master failed'));

            }
          },
          repos: {
            createFile: t.fail.bind(null, 'repos.createFile should not have been called')
          },
          pullRequests: {
            create: () => t.fail.bind(null, 'pullRequests.create should not have been called')
          }
        };
      },
      'lodash': {
        random: (start, end) => 4543821
      }
    });

    const app = express().use('/', submitEndpoint);
    app.locals.github = {
      accessToken: 'my super secret token'
    };
    const submitService = app.listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
      method: 'POST',
      qs: {},
      body: {
        coverage: {},
        note: 'this is the note',
        data: 'this is the data URL',
        type: 'source type',
        conform: {}
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
          message: 'Error creating local reference: createReference from master failed'
        }
      });
    })
    .finally(() => {
      submitService.close();
    });

  });

  test.test('request failing to create file in local reference should respond with 500 and error message', t => {
    t.plan(4);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const postContent = {
      coverage: {},
      note: 'this is the note',
      data: 'this is the data URL',
      type: 'source type',
      conform: {}
    };

    // mock the github in the submit route
    const submitEndpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: o => new Promise((resolve, reject) => resolve(
              {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }
            )),
            createReference: o => new Promise((resolve, reject) => resolve())
          },
          repos: {
            createFile: o => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: 'sources/contrib/source_45554d.json',
                message: 'This file was added by the OpenAddresses submit-service',
                content: Buffer.from(JSON.stringify(postContent, null, 4)).toString('base64'),
                branch: 'submit_service_45554d'
              });

              return new Promise((resolve, reject) => reject('createFile in local reference failed'));

            }
          },
          pullRequests: {
            create: () => t.fail.bind(null, 'pullRequests.create should not have been called')
          }
        };
      },
      'lodash': {
        random: (start, end) => 4543821
      }
    });

    const submitService = express().use('/', submitEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
      method: 'POST',
      body: postContent,
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
          message: 'Error creating file for reference: createFile in local reference failed'
        }
      });
    })
    .finally(() => {
      submitService.close();
    });

  });

  test.test('request failing to create pull request should respond with 500 and error message', t => {
    t.plan(4);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    // mock the github in the submit route
    const submitEndpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: o => new Promise((resolve, reject) => resolve(
              {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }
            )),
            createReference: o => new Promise((resolve, reject) => resolve())
          },
          repos: {
            createFile: o => new Promise((resolve, reject) => resolve())
          },
          pullRequests: {
            create: o => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                title: 'Submit Service Pull Request',
                head: 'openaddresses:submit_service_45554d',
                base: 'master',
                body: 'This pull request contains changes requested by the Submit Service',
                maintainer_can_modify: true
              });

              return new Promise((resolve, reject) => reject('createPullRequest failed'));

            }
          }
        };
      },
      'lodash': {
        random: (start, end) => 4543821
      }
    });

    const submitService = express().use('/', submitEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
      method: 'POST',
      body: {
        coverage: {},
        note: 'this is the note',
        data: 'this is the data URL',
        type: 'source type',
        conform: {}
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
          message: 'Error creating pull request: createPullRequest failed'
        }
      });
    })
    .finally(() => {
      submitService.close();
    });

  });

  test.test('request creating pull request should return 200 and PR link', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    // mock the github in the submit route
    const submitEndpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: o => new Promise((resolve, reject) => resolve(
              {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }
            )),
            createReference: o => new Promise((resolve, reject) => resolve())
          },
          repos: {
            createFile: o => new Promise((resolve, reject) => resolve())
          },
          pullRequests: {
            create: o => new Promise((resolve, reject) => resolve({
              data: {
                html_url: 'this is the html url for the pull request'
              }
            }))
          }
        };
      }
    });

    const submitService = express().use('/', submitEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/`,
      method: 'POST',
      body: {
        coverage: {},
        note: 'this is the note',
        data: 'this is the data URL',
        type: 'source type',
        conform: {}
      },
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, {
        response: {
          url: 'this is the html url for the pull request'
        }
      });
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      submitService.close();
      t.end();
    });

  });

});
