const tape = require('tape');
const { fork } = require('child_process');
const toString = require('stream-to-string');
const proxyquire = require('proxyquire').noCallThru();
const getPort = require('get-port');

tape('error condition tests', test => {
  test.test('undefined GITHUB_ACCESS_TOKEN in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {}
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: GITHUB_ACCESS_TOKEN is required\n');
        t.end();
      });
    });

  });

  test.test('empty GITHUB_ACCESS_TOKEN in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {
        GITHUB_ACCESS_TOKEN: '',
      }
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: GITHUB_ACCESS_TOKEN is required\n');
        t.end();
      });
    });

  });

});

tape('success conditions', test => {
  test.test('port not specified in environment should default to 3103', t => {
    process.env.GITHUB_ACCESS_TOKEN = 'obviously fake github access token';
    process.env.PORT = undefined;

    proxyquire('../index', {
      './app': {
        listen: (port) => {
          t.equals(port, 3103);
          t.end();
        }
      }
    });

  });

  test.test('port specified in environment should use it', t => {
    getPort().then(random_port => {
      process.env.GITHUB_ACCESS_TOKEN = 'obviously fake github access token';
      process.env.PORT = random_port;

      proxyquire('../index', {
        './app': {
          listen: (port) => {
            t.equals(port, random_port);
            t.end();
          }
        }
      });

    });

  });

});
