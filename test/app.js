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
        path: '/upload',
        methods: ['POST']
      }
    ]);

    t.end();

  });

});
