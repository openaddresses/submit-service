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

    const submit_service = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

  test.test('undefined POST body should respond with 500 and error message', t => {
    t.plan(3);

    process.env.GITHUB_ACCESS_TOKEN = 'github access token';

    const submit_service = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

  test.test('POST body not parseable as JSON should respond with 500 and error message', t => {
    t.plan(3);

    const submit_service = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

  test.test('POST body not parseable as JSON should respond with 500 and error message', t => {
    t.plan(3);

    const submit_service = express().use('/', require('../submit')).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

});

tape('valid source tests', test => {
  test.test('request failing to look up master reference should respond with 500 and error message', t => {
    t.plan(5, 'auth + master ref + response');

    // /submit pulls the github authentication token from the environment so set it here
    process.env.GITHUB_ACCESS_TOKEN = 'github authentication token';

    // mock the github in the submit route
    const submit_endpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: (options) => {
            t.deepEquals(options, {
              type: 'oauth',
              token: 'github authentication token'
            });
          },
          gitdata: {
            getReference: (o, callback) => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                ref: 'heads/master'
              });

              callback('getReference for master failed');

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

    const submit_service = express().use('/', submit_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

  test.test('request failing to create local reference should respond with 500 and error message', t => {
    t.plan(4);

    // mock the github in the submit route
    const submit_endpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: (o, callback) => {
              callback(null, {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              });
            },
            createReference: (o, callback) => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                ref: 'refs/heads/submit_service_45554d',
                sha: 'master sha'
              });

              callback('createReference from master failed');

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

    const app = express().use('/', submit_endpoint);
    app.locals.github = {
      accessToken: 'my super secret token'
    };
    const submit_service = app.listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

  test.test('request failing to create file in local reference should respond with 500 and error message', t => {
    t.plan(4);

    const post_content = {
      coverage: {},
      note: 'this is the note',
      data: 'this is the data URL',
      type: 'source type',
      conform: {}
    };

    // mock the github in the submit route
    const submit_endpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: (o, callback) => callback(null,
              {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }
            ),
            createReference: (o, callback) => callback(null, null)
          },
          repos: {
            createFile: (o, callback) => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: 'sources/contrib/source_45554d.json',
                message: 'This file was added by the OpenAddresses submit-service',
                content: Buffer.from(JSON.stringify(post_content, null, 4)).toString('base64'),
                branch: 'submit_service_45554d'
              });

              callback('createFile in local reference failed');

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

    const submit_service = express().use('/', submit_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
      method: 'POST',
      body: post_content,
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
      submit_service.close();
    });

  });

  test.test('request failing to create pull request should respond with 500 and error message', t => {
    t.plan(4);

    // mock the github in the submit route
    const submit_endpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: (o, callback) => callback(null,
              {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }
            ),
            createReference: (o, callback) => callback(null, null)
          },
          repos: {
            createFile: (o, callback) => callback(null, null)
          },
          pullRequests: {
            create: (o, callback) => {
              t.deepEquals(o, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                title: 'Submit Service Pull Request',
                head: 'openaddresses:submit_service_45554d',
                base: 'master',
                body: 'This pull request contains changes requested by the Submit Service',
                maintainer_can_modify: true
              });

              callback('createPullRequest failed');

            }
          }
        };
      },
      'lodash': {
        random: (start, end) => 4543821
      }
    });

    const submit_service = express().use('/', submit_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

  test.test('request creating pull request should return 200 and PR link', t => {
    t.plan(3);

    // mock the github in the submit route
    const submit_endpoint = proxyquire('../submit', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          gitdata: {
            getReference: (o, callback) => callback(null,
              {
                data: {
                  object: {
                    sha: 'master sha'
                  }
                }
              }
            ),
            createReference: (o, callback) => callback(null, null)
          },
          repos: {
            createFile: (o, callback) => callback(null, null)
          },
          pullRequests: {
            create: (o, callback) => {
              callback(null, {
                data: {
                  html_url: 'this is the html url for the pull request'
                }
              });

            }
          }
        };
      }
    });

    const submit_service = express().use('/', submit_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/`,
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
      submit_service.close();
    });

  });

});
