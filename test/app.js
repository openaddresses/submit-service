const tape = require('tape');
const proxyquire = require('proxyquire').noCallThru();
const router = require('express').Router();
const listEndpoints = require('express-list-endpoints');

tape('success conditions', test => {
  test.test('all credentials available should be passed to appropriate services', t => {
    const credentials = {
      githubAccessToken: 'obviously a fake github access token'
    };

    const app = require('../app')(credentials);

    t.deepEquals(app.locals.github, {
      accessToken: 'obviously a fake github access token'
    });

    t.deepEquals(listEndpoints(app), [
      {
        path: '/sample',
        methods: ['GET']
      },
      {
        path: '/upload',
        methods: ['POST']
      },
      {
        path: '/submit',
        methods: ['POST']
      }
    ]);

    t.end();

  });

});
