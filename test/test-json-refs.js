/* global after, describe, it */

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

var _ = require('lodash-compat');
var assert = require('assert');
var http = require('http');
var jsonRefs = require('../');

var ghProjectUrl = 'https://api.github.com/repos/whitlockjc/json-refs';

describe('json-refs', function () {
  describe('#findRefs', function () {
    it('should throw an Error when passed the wrong arguments', function () {
      var errors = {
        'json is required': [],
        'json must be an object': ['wrongType']
      };

      _.each(errors, function (args, message) {
        try {
          jsonRefs.findRefs.apply(undefined, args);
        } catch (err) {
          assert.equal(message, err.message);
        }
      });
    });

    it('should not return references that are invalid', function () {
      assert.deepEqual(jsonRefs.findRefs({
        '$ref': {
          '$ref': 1
        },
      }), {});
    });

    it('should return all valid references', function () {
      assert.deepEqual(jsonRefs.findRefs({
        $ref: 'http://json-schema.org/draft-04/schema',
        project: {
          $ref: ghProjectUrl
        }
      }), {
        '#/$ref': 'http://json-schema.org/draft-04/schema',
        '#/project/$ref': ghProjectUrl
      });
    });
  });

  describe('#isJsonReference', function () {
    it('should return proper response', function () {
      var tests = [
        [undefined, false],
        [{$ref: 1}, false],
        [{$ref: '#'}, true]
      ];

      _.each(tests, function (test) {
        assert.ok(jsonRefs.isJsonReference(test[0]) === test[1]);
      });
    });
  });

  describe('#isRemotePointer', function () {
    it('should throw an Error when passed the wrong arguments', function () {
      var errors = {
        'ptr is required': [],
        'ptr must be a string': [[]]
      };

      _.each(errors, function (args, message) {
        try {
          jsonRefs.isRemotePointer.apply(undefined, args);
        } catch (err) {
          assert.equal(message, err.message);
        }
      });
    });

    it('should return proper response', function () {
      var tests = {
        '#': false,
        '#/some/path': false,
        'http://json-schema.org/draft-04/schema': true
      };

      _.each(tests, function (response, ptr) {
        assert.deepEqual(jsonRefs.isRemotePointer(ptr), response);
      });
    });
  });

  describe('#pathFromPointer', function () {
    it('should throw an Error when passed the wrong arguments', function () {
      var errors = {
        'ptr is required': [],
        'ptr must be a string': [[]]
      };

      _.each(errors, function (args, message) {
        try {
          jsonRefs.pathFromPointer.apply(undefined, args);
        } catch (err) {
          assert.equal(message, err.message);
        }
      });
    });

    it('should return valid path from the JSON Pointers', function () {
      var tests = {
        '#': [],
        '#/': [''],
        '#/some/path': ['some', 'path'],
        '#/~0whitlockjc': ['~whitlockjc'],
        '#/~1home/whitlockjc': ['/home', 'whitlockjc'],
        '#/~0~1home/whitlockjc': ['~/home', 'whitlockjc'],
        'http://json-schema.org/draft-04/schema#': 'http://json-schema.org/draft-04/schema#'
      };

      _.each(tests, function (path, ptr) {
        assert.deepEqual(jsonRefs.pathFromPointer(ptr), path);
      });
    });
  });

  describe('#pathToPointer', function () {
    it('should throw an Error when passed the wrong arguments', function () {
      var errors = {
        'path is required': [],
        'path must be an array': ['wrongType']
      };

      _.each(errors, function (args, message) {
        try {
          jsonRefs.pathToPointer.apply(undefined, args);
        } catch (err) {
          assert.equal(message, err.message);
        }
      });
    });

    it('should return valid JSON Pointers', function () {
      var tests = {
        '#': [],
        '#/some/path': ['some', 'path'],
        '#/~0whitlockjc': ['~whitlockjc'],
        '#/~1home/whitlockjc': ['/home', 'whitlockjc'],
        '#/~0~1home/whitlockjc': ['~/home', 'whitlockjc']
      };

      _.each(tests, function (path, ptr) {
        assert.equal(jsonRefs.pathToPointer(path), ptr);
      });
    });
  });

  describe('#resolveRefs', function () {
    it('should throw an Error when passed the wrong arguments', function () {
      var errors = {
        'json is required': [],
        'json must be an object': ['wrongType'],
        'done is required': [{}],
        'done must be a function': [{}, 'wrongType']
      };

      _.each(errors, function (args, message) {
        try {
          jsonRefs.resolveRefs.apply(undefined, args);
        } catch (err) {
          assert.equal(message, err.message);
        }
      });
    });

    describe('should return the appropriate response', function () {
      var server;

      after(function () {
        if (server) {
          server.close();
        }
      });

      it('no references', function (done) {
        var json = {
          name: 'json-refs',
          url: 'https://github.com/whitlockjc/json-refs'
        };

        jsonRefs.resolveRefs(json, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.deepEqual(json, rJson);
          assert.deepEqual({}, metadata);

          return done();
        });
      });

      it('simple reference', function (done) {
        var json = {
          person: {
            name: 'Jeremy'
          },
          project: {
            name: 'json-refs',
            maintainer: {
              $ref: '#/person'
            },
            organization: undefined
          },
          fake: {
            $ref: '#/unresolvable'
          },
          undefined: {
            $ref: '#/project/organization'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);
          assert.deepEqual({
            '#/project/maintainer/$ref': {
              ref: '#/person',
              value: {
                name: 'Jeremy'
              }
            },
            '#/fake/$ref': {
              ref: '#/unresolvable'
            },
            '#/undefined/$ref': {
              ref: '#/project/organization',
              value: undefined
            }
          }, metadata);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.deepEqual(rJson, {
            person: {
              name: 'Jeremy'
            },
            project: {
              name: 'json-refs',
              maintainer: {
                name: 'Jeremy'
              },
              organization: undefined
            },
            fake: undefined,
            undefined: undefined
          });

          done();
        });
      });

      it('complex reference', function (done) {
        var json = {
          A: {
            a: 'a',
            b: {
              $ref: '#/B'
            }
          },
          B: {
            b: 'b',
            c: {
              $ref: '#/C'
            }
          },
          C: {
            c: 'c'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.deepEqual(rJson, {
            A: {
              a: 'a',
              b: {
                b: 'b',
                c: {
                  c: 'c'
                }
              }
            },
            B: {
              b: 'b',
              c: {
                c: 'c'
              }
            },
            C: {
              c: 'c'
            }
          });

          done();
        });
      });

      // Here only to show that we special case the inability for traverse to replace the root node:
      //   https://github.com/substack/js-traverse/issues/42
      it('top-level reference (replaces whole document)', function (done) {
        var json = {
          $ref: ghProjectUrl
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.equal(rJson.name, 'json-refs');

          done();
        });
      });

      it('circular reference', function (done) {
        var json = {
          id: 'Person',
          properties: {
            name: {
              type: 'string'
            },
            age: {
              type: 'number'
            },
            family: {
              type: 'array',
              items: {
                $ref: '#'
              }
            }
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.deepEqual(rJson, {
            id: 'Person',
            properties: {
              name: {
                type: 'string'
              },
              age: {
                type: 'number'
              },
              family: {
                type: 'array',
                items: {
                  id: 'Person',
                  properties: {
                    name: {
                      type: 'string'
                    },
                    age: {
                      type: 'number'
                    },
                    family: {
                      type: 'array'
                    }
                  }
                }
              }
            }
          });

          done();
        });
      });

      it('simple remote reference', function (done) {
        var json = {
          project: {
            $ref: ghProjectUrl
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);
          assert.deepEqual({
            '#/project/$ref': {
              ref: ghProjectUrl,
              value: rJson.project
            }
          }, metadata);

          assert.equal(rJson.project.name, 'json-refs');

          done();
        });
      });

      it('complex remote reference', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:3000/'
          }
        };
        var cJson = _.cloneDeep(json);

        server = http.createServer(function (req, res) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            $ref: ghProjectUrl
          }));
        });

        server.listen(3000, function () {
          jsonRefs.resolveRefs(json, function (err, rJson) {
            assert.ok(_.isUndefined(err));
            assert.notDeepEqual(json, rJson);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(rJson.project.name, 'json-refs');

            done();
          });
        });
      });

      it('remote reference with hash', function (done) {
        var json = {
          owner: {
            $ref: ghProjectUrl + '#/owner/login'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);
          assert.deepEqual({
            '#/owner/$ref': {
              ref: ghProjectUrl + '#/owner/login',
              value: rJson.owner
            }
          }, metadata);

          assert.equal(rJson.owner, 'whitlockjc');

          done();
        });
      });

      it('multple remote references with hash', function (done) {
        var json = {
          owner: {
            $ref: ghProjectUrl + '#/owner/login'
          },
          name: {
            $ref: ghProjectUrl + '#/name'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);
          assert.deepEqual({
            '#/owner/$ref': {
              ref: ghProjectUrl + '#/owner/login',
              value: rJson.owner
            },
            '#/name/$ref': {
              ref: ghProjectUrl + '#/name',
              value: rJson.name
            }
          }, metadata);

          assert.equal(rJson.owner, 'whitlockjc');
          assert.equal(rJson.name, 'json-refs');

          done();
        });
      });
    });
  });
});
