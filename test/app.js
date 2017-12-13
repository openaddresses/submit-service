const tape = require('tape');
const proxyquire = require('proxyquire').noCallThru();
const router = require('express').Router();
const listEndpoints = require('express-list-endpoints');

tape('success conditions', test => {
  test.test('all credentials available should be passed to appropriate services', t => {
    const credentials = {
      githubAccessToken: 'obviously a fake github access token',
      s3AccessKeyId: 'obviously a fake s3 access key id',
      s3SecretAccessKey: 'obviously a fake s3 secret access key'
    };

    const app = require('../app')(credentials);

    t.deepEquals(app.locals.s3, {
      accessKeyId: 'obviously a fake s3 access key id',
      secretAccessKey: 'obviously a fake s3 secret access key'
    });
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
