const tape = require('tape');
const { fork } = require('child_process');
const toString = require('stream-to-string');
const proxyquire = require('proxyquire').noCallThru();
const getPort = require('get-port');

tape('error condition tests', test => {
  test.test('undefined GITHUB_ACCESS_TOKEN in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {
        AWS_ACCESS_KEY_ID: 'obviously fake aws access key id',
        AWS_SECRET_ACCESS_KEY: 'obviously fake aws secret access key'
      }
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
        AWS_ACCESS_KEY_ID: 'obviously fake aws access key id',
        AWS_SECRET_ACCESS_KEY: 'obviously fake aws secret access key'
      }
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: GITHUB_ACCESS_TOKEN is required\n');
        t.end();
      });
    });

  });

  test.test('undefined AWS_ACCESS_KEY_ID in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {
        GITHUB_ACCESS_TOKEN: 'obviously fake github access token',
        AWS_SECRET_ACCESS_KEY: 'obviously fake aws secret access key'
      }
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: AWS_ACCESS_KEY_ID is required\n');
        t.end();
      });
    });

  });

  test.test('empty AWS_ACCESS_KEY_ID in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {
        GITHUB_ACCESS_TOKEN: 'obviously fake github access token',
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: 'obviously fake aws secret access key'
      }
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: AWS_ACCESS_KEY_ID is required\n');
        t.end();
      });
    });

  });

  test.test('undefined AWS_SECRET_ACCESS_KEY in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {
        GITHUB_ACCESS_TOKEN: 'obviously fake github access token',
        AWS_ACCESS_KEY_ID: 'obviously fake aws access key id'
      }
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: AWS_SECRET_ACCESS_KEY is required\n');
        t.end();
      });
    });

  });

  test.test('empty AWS_SECRET_ACCESS_KEY in credentials should throw error', t => {
    fork('./index', [], {
      stdio: ['ipc', 'pipe', 'pipe'],
      env: {
        GITHUB_ACCESS_TOKEN: 'obviously fake github access token',
        AWS_ACCESS_KEY_ID: 'obviously fake aws access key id',
        AWS_SECRET_ACCESS_KEY: ''
      }
    }).on('exit', function(code, signal) {
      t.equals(code, 1);

      toString(this.stderr, (err, msg) => {
        t.equals(msg, 'Error: AWS_SECRET_ACCESS_KEY is required\n');
        t.end();
      });
    });

  });

});

tape('success conditions', test => {
  test.test('port not specified in environment should default to 3103', t => {
    process.env.GITHUB_ACCESS_TOKEN = 'obviously fake github access token';
    process.env.AWS_ACCESS_KEY_ID = 'obviously fake aws access key id';
    process.env.AWS_SECRET_ACCESS_KEY = 'obviously fake aws secret access key';
    process.env.PORT = undefined;

    proxyquire('../index', {
      './app': () => {
        return {
          listen: (port) => {
            t.equals(port, 3103);
            t.end();
          }
        };
      }
    });

  });

  test.test('port specified in environment should use it', t => {
    getPort().then(random_port => {
      process.env.GITHUB_ACCESS_TOKEN = 'obviously fake github access token';
      process.env.AWS_ACCESS_KEY_ID = 'obviously fake aws access key id';
      process.env.AWS_SECRET_ACCESS_KEY = 'obviously fake aws secret access key';
      process.env.PORT = random_port;

      proxyquire('../index', {
        './app': () => {
          return {
            listen: (port) => {
              t.equals(port, random_port);
              t.end();
            }
          };
        }
      });

    });

  });

});
