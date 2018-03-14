const tape = require('tape');
const express = require('express');
const request = require('request-promise');
const proxyquire = require('proxyquire');

tape('error conditions', test => {
  test.test('request failing to getContent should response with 400 and error', t => {
    t.plan(4);

    const sourcesEndpoint = proxyquire('../sources', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getContent: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/cc/rc'
              });

              callback('getContent failed');

            }

          }
        };
      }
    });

    const submitService = express().use('/*', sourcesEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/cc/rc`,
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
          message: 'Error getting contents: getContent failed'
        }
      });
    })
    .finally(() => {
      submitService.close();
    });

  });

  test.test('getContent returning a file should response with 400 and error', t => {
    t.plan(4);

    const sourcesEndpoint = proxyquire('../sources', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getContent: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/cc/rc/file.json'
              });

              callback(null, {
                data: {
                  name: 'file.json',
                  path: '/sources/file.json',
                  type: 'file'
                }
              });

            }

          }
        };
      }
    });

    const submitService = express().use('/*', sourcesEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/cc/rc/file.json`,
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
          message: 'Error getting contents: /cc/rc/file.json is a file'
        }
      });
    })
    .finally(() => {
      submitService.close();
    });

  });

});

tape('success conditions', test => {
  test.test('all directories and .json file sources should be returned', t => {
    t.plan(4);

    const sourcesEndpoint = proxyquire('../sources', {
      '@octokit/rest': function GitHub() {
        return {
          authenticate: () => {},
          repos: {
            getContent: (params, callback) => {
              t.deepEquals(params, {
                owner: 'openaddresses',
                repo: 'openaddresses',
                path: '/cc/rc'
              });

              callback(null, {
                data: [
                  {
                    name: 'file1.json',
                    type: 'file',
                    path: '/sources/cc/rc/file1.json',
                    field1: 'field1 value'
                  },
                  {
                    name: 'file2.json',
                    type: 'file',
                    path: '/sources/cc/rc/file2.json',
                    field2: 'field2 value'
                  },
                  {
                    name: 'dir1',
                    type: 'dir',
                    path: '/sources/cc/rc/dir1',
                    field3: 'field3 value'
                  },
                  {
                    name: 'file3.csv',
                    type: 'file',
                    path: '/sources/cc/rc/file3.csv',
                    field4: 'field4 value'
                  }
                ]
              });

            }

          }
        };
      }
    });

    const submitService = express().use('/*', sourcesEndpoint).listen();

    request({
      uri: `http://localhost:${submitService.address().port}/cc/rc`,
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
          name: 'file1.json',
          type: 'file',
          path: '/sources/cc/rc/file1.json'
        },
        {
          name: 'file2.json',
          type: 'file',
          path: '/sources/cc/rc/file2.json'
        },
        {
          name: 'dir1',
          type: 'dir',
          path: '/sources/cc/rc/dir1'
        }
      ]);
    })
    .catch(err => t.fail.bind(null, 'request should have been successful'))
    .finally(() => {
      submitService.close();
    });

  });

});
