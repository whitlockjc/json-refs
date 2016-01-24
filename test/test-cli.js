/* eslint-env browser, mocha */

/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Jeremy Whitlock
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use strict';

var _ = require('lodash');
var assert = require('assert');
var cp = require('child_process');
var http = require('http');
var JsonRefs = require('..');
var path = require('path');
var pkg = require('../package.json');
var YAML = require('js-yaml');

var jsonRefsOptions = {
  loaderOptions: {
    processContent: function (res, callback) {
      callback(undefined, YAML.safeLoad(res.text));
    }
  }
};

var globalHelp = [
  '',
  '  Usage: json-refs [options] [command]',
  '',
  '',
  '  Commands:',
  '',
  '    help [command]                Display help information',
  '    resolve [options] <location>  Prints document at location with its JSON References resolved',
  '',
  '  Options:',
  '',
  '    -h, --help     output usage information',
  '    -V, --version  output the version number',
  '',
  '',
].join('\n');

var helpHelp = [
  '',
  '  Usage: help [options] [command]',
  '',
  '  Display help information',
  '',
  '  Options:',
  '',
  '    -h, --help  output usage information',
  '',
  ''
].join('\n');

var resolveHelp = [
  '',
  '  Usage: resolve [options] <location>',
  '',
  '  Prints document at location with its JSON References resolved',
  '',
  '  Options:',
  '',
  '    -h, --help             output usage information',
  '    -f, --force            Do not fail when the document has invalid JSON References',
  '    -H, --header <header>  The header to use when retrieving a remote document',
  '    -I, --filter <type>    The type of JSON References to resolved',
  '    -y, --yaml             Output as YAML',
  '',
  ''
].join('\n');

function executeJsonRefs (args, done, cwd) {
  var options;

  // Add Node args
  args.unshift('node', path.resolve(path.join(__dirname, '..', 'bin', 'json-refs')));

  if (typeof cwd !== 'undefined') {
    options = {
      cwd: cwd
    };
  }

  cp.exec(args.join(' '), options, function (err, stdout, stderr) {
    done(stderr, stdout);
  });
};

describe('json-refs CLI', function () {
  it('--help flag', function (done) {
    executeJsonRefs(['--help'], function (stderr, stdout) {
      assert.equal(stderr, '');
      assert.equal(stdout, globalHelp);

      done();
    });
  });

  it('--version flag', function (done) {
    executeJsonRefs(['--version'], function (stderr, stdout) {
      assert.equal(stderr, '');
      assert.equal(stdout, pkg.version + '\n');

      done();
    });
  });

  it('invalid command', function (done) {
    executeJsonRefs(['invalid'], function (stderr, stdout) {
      assert.equal(stderr, '');
      assert.equal(stdout, 'json-refs does not support the invalid command.\n' + globalHelp);

      done();
    });
  });

  it('no command', function (done) {
    executeJsonRefs([], function (stderr, stdout) {
      assert.equal(stderr, '');
      assert.equal(stdout, globalHelp);

      done();
    });
  });

  describe('help command', function () {
    it('--help flag', function (done) {
      executeJsonRefs(['help', '--help'], function (stderr, stdout) {
        assert.equal(stderr, '');
        assert.equal(stdout, helpHelp);

        done();
      });
    });

    it('no sub-command', function (done) {
      executeJsonRefs(['help'], function (stderr, stdout) {
        assert.equal(stderr, '');
        assert.equal(stdout, globalHelp);

        done();
      });
    });

    it('help sub-command', function (done) {
      executeJsonRefs(['help', 'help'], function (stderr, stdout) {
        assert.equal(stderr, '');
        assert.equal(stdout, helpHelp);

        done();
      });
    });

    it('resolve sub-command', function (done) {
      executeJsonRefs(['help', 'resolve'], function (stderr, stdout) {
        assert.equal(stderr, '');
        assert.equal(stdout, resolveHelp);

        done();
      });
    });
  });

  describe('resolve command', function () {
    it('--help flag', function (done) {
      executeJsonRefs(['resolve', '--help'], function (stderr, stdout) {
        assert.equal(stderr, '');
        assert.equal(stdout, resolveHelp);

        done();
      });
    });

    it('no arguments', function (done) {
      executeJsonRefs(['resolve'], function (stderr, stdout) {
        assert.equal(stderr, [
          '',
          '  error: missing required argument `location\'',
          '',
          '',
        ].join('\n'));
        assert.equal(stdout, '');

        done();
      });
    });

    describe('invalid location', function () {
      it('missing file location', function (done) {
        var filePath = './missing.yaml';

        executeJsonRefs(['resolve', filePath], function (stderr, stdout) {
          assert.ok(stderr.indexOf('error: ENOENT') > -1);
          assert.ok(stderr.indexOf('open \'' + path.resolve(filePath) + '\'') > -1);
          assert.equal(stdout, '');

          done();
        });
      });

      it('missing http location', function (done) {
        var location = 'https://rawgit.com/whitlockjc/json-refs/master/test/browser/documents/missing.yaml';

        executeJsonRefs(['resolve', location], function (stderr, stdout) {
          assert.equal(stderr, [
            '',
            '  error: Not Found',
            '',
            ''
          ].join('\n'));
          assert.equal(stdout, '');

          done();
        });
      });
    });

    describe('valid location', function () {
      var testDocumentLocation = path.join(__dirname, 'browser', 'documents', 'test-document.yaml');
      var httpServer;

      before(function (done) {
        httpServer = http.createServer(function (req, res) {
          // Echo back the provided headers
          ['Header-One', 'Header-Two'].forEach(function (header) {
            if (req.headers[header.toLowerCase()]) {
              res.setHeader(header, req.headers[header.toLowerCase()]);
            }
          });

          res.setHeader('Content-Type', 'application/json');

          res.end(JSON.stringify(pkg));
        });

        httpServer.listen(1337, done);
      });

      after(function (done) {
        httpServer.close(done);
      });

      it('no options', function (done) {
        this.timeout(10000);

        executeJsonRefs(['resolve', testDocumentLocation], function (stderr, stdout) {
          assert.equal(stdout, '');

          assert.equal(stderr, [
            '',
            '  error: Document has invalid references:',
            '',
            '  #/invalid: HTTP URIs must have a host.',
            '  #/missing: JSON Pointer points to missing location: #/some/missing/path',
            '  #/remote/relative/missing: JSON Pointer points to missing location: #/some/missing/path',
            '  #/remote/relative/child/missing: JSON Pointer points to missing location: #/some/missing/path',
            '  #/remote/relative/child/ancestor/missing: JSON Pointer points to missing location: #/some/missing/path',
            '',
            ''
          ].join('\n'));

          done();
        });
      });

      it('--filter option(s)', function (done) {
        this.timeout(10000);

        var cliArgs = [
          'resolve',
          testDocumentLocation,
          '--filter', 'relative',
          '-I', 'remote',
          '--force'
        ];
        var cOptions = _.cloneDeep(jsonRefsOptions);

        cOptions.filter = ['relative', 'remote'];

        executeJsonRefs(cliArgs, function (stderr, stdout) {
          assert.equal(stderr, '');

          JsonRefs.resolveRefsAt(testDocumentLocation, cOptions)
            .then(function (results) {
              assert.equal(stdout, JSON.stringify(results.resolved, null, 2) + '\n');
            })
            .then(done, done);
        });
      });

      it('--force option', function (done) {
        this.timeout(10000);

        executeJsonRefs(['resolve', testDocumentLocation, '--force'], function (stderr, stdout) {
          assert.equal(stderr, '');

          JsonRefs.resolveRefsAt(testDocumentLocation, jsonRefsOptions)
            .then(function (results) {
              assert.equal(stdout, JSON.stringify(results.resolved, null, 2) + '\n');
            })
            .then(done, done);
        });
      });

      it('--header option(s)', function (done) {
        this.timeout(10000);

        var cliArgs = [
          'resolve',
          'http://localhost:1337',
          '--header', '"MyHeader: MyValue"',
          '-H', '"MyOtherHeader: MyOtherValue"'
        ];
        var cOptions = _.cloneDeep(jsonRefsOptions);

        cOptions.loaderOptions.processContent = function (res, callback) {
          try {
            assert.equal(res.headers['header-one'], 'Value One');
            assert.equal(res.headers['header-two'], 'Value Two');

            callback(undefined, JSON.parse(res.text));
          } catch (err) {
            callback(err);
          }
        };

        executeJsonRefs(cliArgs, function (stderr, stdout) {
          assert.equal(stderr, '');

          assert.deepEqual(stdout, JSON.stringify(pkg, null, 2) + '\n');

          done();
        });
      });

      it('--yaml option', function (done) {
        this.timeout(10000);

        executeJsonRefs(['resolve', testDocumentLocation, '-fy'], function (stderr, stdout) {
          assert.equal(stderr, '');

          JsonRefs.resolveRefsAt(testDocumentLocation, jsonRefsOptions)
            .then(function (results) {
              assert.equal(stdout, YAML.safeDump(results.resolved, {noRefs: true}) + '\n');
            })
            .then(done, done);
        });
      });
    });

    describe('issues', function () {
      describe('Issue #67', function () {
        var expectedOutput = [
          '',
          '  error: Document has invalid references:',
          '',
          '  #/deferred: JSON Pointer points to missing location: #/project/name',
          '  #/missing: JSON Pointer points to missing location: #/some/missing/path',
          '  #/ancestor/deferred: JSON Pointer points to missing location: #/project/name',
          '  #/ancestor/missing: JSON Pointer points to missing location: #/some/missing/path',
          '  #/ancestor/nested/deferred: JSON Pointer points to missing location: #/project/name',
          '  #/ancestor/nested/missing: JSON Pointer points to missing location: #/some/missing/path',
          '  #/ancestor/nested/child/deferred: JSON Pointer points to missing location: #/project/name',
          '  #/ancestor/nested/child/missing: JSON Pointer points to missing location: #/some/missing/path',
          '',
          '',
        ].join('\n');

        it('relative references to ancestor of process.cwd()', function (done) {
          this.timeout(10000);

          executeJsonRefs(['resolve', './test-nested-1.yaml'], function (stderr, stdout) {
            assert.equal(stderr, expectedOutput);
            assert.equal(stdout, '');

            done();
          }, path.join(__dirname, 'browser', 'documents', 'nested'));
        });

        it('relative references to child of process.cwd()', function (done) {
          this.timeout(10000);

          executeJsonRefs(['resolve', '../test/browser/documents/nested/test-nested-1.yaml'], function (stderr, stdout) {
            assert.equal(stderr, expectedOutput);
            assert.equal(stdout, '');

            done();
          }, __dirname);
        });
      });
    });
  });
});
