const tape = require('tape');
const proxyquire = require('proxyquire').noCallThru();
const router = require('express').Router();
const listEndpoints = require('express-list-endpoints');

tape('success conditions', test => {
  test.test('all credentials available should be passed to appropriate services', t => {
    const app = require('../app');

    t.deepEquals(listEndpoints(app), [
      {
        path: '/sample',
        methods: ['GET']
      },
      {
        path: '/submit',
        methods: ['POST']
      },
      {
        path: '/createIssue',
        methods: ['POST']
      },
      {
        path: '/sources',
        methods: ['GET']
      },
      {
        path: '/sources',
        methods: ['GET']
      },
      {
        path: '/download',
        methods: ['GET']
      },
      {
        path: '/maintainers/sources',
        methods: ['GET']
      }
    ]);

    t.end();

  });

});
