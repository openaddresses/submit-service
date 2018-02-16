const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const proxyquire = require('proxyquire');

tape('error conditions', test => {
  test.test('request failing to getContent should response with 400 and error', t => {
    t.plan(4);

    const sources_endpoint = proxyquire('../maintainers', {
      'github': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getCommits: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/sources/cc/rc/source.json'
              });

              callback('getCommits failed');

            }

          }
        };
      }
    });

    const submit_service = express().use('/maintainers/*', sources_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/maintainers/sources/cc/rc/source.json`,
      method: 'GET',
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
          message: 'Error getting commits: getCommits failed'
        }
      });
    })
    .finally(() => {
      submit_service.close();
    });

  });

  test.test('getContent returning an error for any sha should respond with 400 and error', t => {
    t.plan(4);

    const maintainers_endpoint = proxyquire('../maintainers', {
      'github': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getCommits: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/sources/cc/rc/source.json'
              });

              // successfully respond wth 3 SHAs
              callback(null, {
                data: [
                  {
                    sha: 'sha 1'
                  },
                  {
                    sha: 'sha 2'
                  },
                  {
                    sha: 'sha 3'
                  }
                ]
              });

            },
            getContent: (params, callback) => {
              if (params.ref === 'sha 1') {
                const content = {
                  email: 'email address 1'
                };

                callback(null, {
                  data: {
                    content: Buffer.from(JSON.stringify(content)).toString('base64')
                  },
                  meta: {
                    'last-modified': 'Tue, 18 Aug 2015 23:50:10 GMT'
                  }
                });

              }
              else if (params.ref === 'sha 2') {
                const content = {
                  email: 'email address 2'
                };

                callback(null, {
                  data: {
                    content: Buffer.from(JSON.stringify(content)).toString('base64')
                  },
                  meta: {
                    'last-modified': 'Fri, 21 Aug 2015 19:27:10 GMT'
                  }
                });

              }
              else if (params.ref === 'sha 3') {
                callback('getContent failed for sha 3');
              }
              else {
                t.fail(`received unknown params: ${params}`);
              }

            }

          }
        };
      }
    });

    const submit_service = express().use('/maintainers/*', maintainers_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/maintainers/sources/cc/rc/source.json`,
      method: 'GET',
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
          message: 'Error getting contents: getContent failed for sha 3'
        }
      });
    })
    .finally(() => {
      submit_service.close();
    });

  });

});

tape('success conditions', test => {
  test.test('source with 0 commits (for some reason) should return empty array', t => {
    t.plan(4);

    const maintainers_endpoint = proxyquire('../maintainers', {
      'github': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getCommits: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/sources/cc/rc/source.json'
              });

              callback(null, {
                data: []
              });

            }

          }
        };
      }
    });

    const submit_service = express().use('/maintainers/*', maintainers_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/maintainers/sources/cc/rc/source.json`,
      method: 'GET',
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, [], 'there should be no commits');
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      submit_service.close();
    });

  });

  test.test('getContent returning success for all SHAs should respond with 200 and in data order', t => {
    t.plan(7);

    const maintainers_endpoint = proxyquire('../maintainers', {
      'github': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getCommits: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/sources/cc/rc/source.json'
              });

              // successfully respond wth 3 SHAs
              callback(null, {
                data: [
                  {
                    sha: 'sha 1'
                  },
                  {
                    sha: 'sha 2'
                  },
                  {
                    sha: 'sha 3'
                  }
                ]
              });

            },
            getContent: (params, callback) => {
              if (params.ref === 'sha 1') {
                t.ok('sha 1 was requested');

                const content = {
                  email: 'email address 1'
                };

                callback(null, {
                  data: {
                    content: Buffer.from(JSON.stringify(content)).toString('base64')
                  },
                  meta: {
                    'last-modified': 'Sat, 03 Sep 2016 00:59:03 GMT'
                  }
                });

              }
              else if (params.ref === 'sha 2') {
                t.ok('sha 2 was requested');

                const content = {
                  email: 'email address 2'
                };

                callback(null, {
                  data: {
                    content: Buffer.from(JSON.stringify(content)).toString('base64')
                  },
                  meta: {
                    'last-modified': 'Tue, 18 Aug 2015 23:50:10 GMT'
                  }
                });

              }
              else if (params.ref === 'sha 3') {
                t.ok('sha 3 was requested');

                const content = {
                  email: 'email address 3'
                };

                callback(null, {
                  data: {
                    content: Buffer.from(JSON.stringify(content)).toString('base64')
                  },
                  meta: {
                    'last-modified': 'Fri, 21 Aug 2015 19:27:10 GMT'
                  }
                });

              }
              else {
                t.fail(`received unknown params: ${params}`);
              }

            }

          }
        };
      }
    });

    const submit_service = express().use('/maintainers/*', maintainers_endpoint).listen();

    request({
      uri: `http://localhost:${submit_service.address().port}/maintainers/sources/cc/rc/source.json`,
      method: 'GET',
      qs: {},
      json: true,
      resolveWithFullResponse: true
    })
    .then(response => {
      t.equals(response.statusCode, 200);
      t.equals(response.headers['content-type'], 'application/json; charset=utf-8');
      t.deepEquals(response.body, [
        {
          sha: 'sha 2',
          lastModified: 'Tue, 18 Aug 2015 23:50:10 GMT',
          email: 'email address 2'
        },
        {
          sha: 'sha 3',
          lastModified: 'Fri, 21 Aug 2015 19:27:10 GMT',
          email: 'email address 3'
        },
        {
          sha: 'sha 1',
          lastModified: 'Sat, 03 Sep 2016 00:59:03 GMT',
          email: 'email address 1'
        }
      ], 'revisions should be returned in increasing date order');

    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      submit_service.close();
    });

  });

});
