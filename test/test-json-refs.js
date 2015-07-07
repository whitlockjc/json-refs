/* global afterEach, describe, it */

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
var path = require('path');
var jsonRefs = require('../');
var YAML = require('js-yaml');

var options = {
  location: typeof window === 'undefined' ? __dirname : 'http://localhost:44444'
};
var projectJson = require('./browser/project.json');
var projectJsonUrl = 'http://localhost:44444/project.json';

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
        }
      }), {});
    });

    it('should return all valid references', function () {
      assert.deepEqual(jsonRefs.findRefs({
        $ref: 'http://json-schema.org/draft-04/schema',
        project: {
          $ref: projectJsonUrl
        }
      }), {
        '#/$ref': 'http://json-schema.org/draft-04/schema',
        '#/project/$ref': projectJsonUrl
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
        'http://json-schema.org/draft-04/schema': true,
        './some/relative.json': true,
        '../some/relative.json': true,
        'file://some/path': true
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
        'http://json-schema.org/draft-04/schema#': 'http://json-schema.org/draft-04/schema#',
        './testing.json': './testing.json',
        '../testing.json': '../testing.json'
      };

      _.each(tests, function (pathSegments, ptr) {
        assert.deepEqual(jsonRefs.pathFromPointer(ptr), pathSegments);
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

      _.each(tests, function (pathSegments, ptr) {
        assert.equal(jsonRefs.pathToPointer(pathSegments), ptr);
      });
    });
  });

  describe('#resolveRefs', function () {
    it('should throw an Error when passed the wrong arguments', function () {
      var errors = {
        'json is required': [],
        'json must be an object': ['wrongType'],
        'options must be an object': [{}, 'wrongType', function () {}],
        'options.location must be a string': [{}, {location: 123}, function () {}],
        'options.prepareRequest must be a function': [{}, {prepareRequest: 'wrongType'}, function () {}],
        'options.processContent must be a function': [{}, {processContent: 'wrongType'}, function () {}],
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
      afterEach(function () {
        jsonRefs.clearCache();
      });

      it('no references', function (done) {
        var json = {
          name: 'json-refs',
          url: 'https://github.com/whitlockjc/json-refs'
        };

        jsonRefs.resolveRefs(json, options, function (err, rJson, metadata) {
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

        jsonRefs.resolveRefs(json, options, function (err, rJson, metadata) {
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

        jsonRefs.resolveRefs(json, options, function (err, rJson) {
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
          $ref: projectJsonUrl
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options, function (err, rJson) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.equal(rJson.full_name, 'whitlockjc/json-refs');

          done();
        });
      });

      it('top-level reference with hash (Issue 19)', function (done) {
        var json = {
          $ref: projectJsonUrl + '#/owner'
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options, function (err, rJson) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.equal(rJson.login, 'whitlockjc');

          done();
        });
      });

      describe('circular references', function () {
        it('array', function (done) {
          var json = {
            a: [
              {
                $ref: '#'
              },
              'x'
            ]
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options, function (err, rJson) {
            assert.ok(_.isUndefined(err));
            assert.notDeepEqual(json, rJson);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.deepEqual(rJson, {
              a: [
                {
                  a: [
                    {},
                    'x'
                  ]
                },
                'x'
              ]
            });

            done();
          });
        });

        it('object', function (done) {
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

          jsonRefs.resolveRefs(json, options, function (err, rJson) {
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
      });

      it('simple remote reference', function (done) {
        var json = {
          project: {
            $ref: projectJsonUrl
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);
          assert.deepEqual({
            '#/project/$ref': {
              ref: projectJsonUrl,
              value: projectJson
            }
          }, metadata);

          assert.equal(rJson.project.name, 'json-refs');

          done();
        });
      });

      it('complex remote reference', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:44444/ref.json'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options, function (err, rJson) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);

          assert.equal(rJson.project.full_name, 'whitlockjc/json-refs');
          done();
        });
      });

      it('remote reference with hash', function (done) {
        var json = {
          name: {
            $ref: projectJsonUrl + '#/name'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);
          assert.deepEqual({
            '#/name/$ref': {
              ref: projectJsonUrl + '#/name',
              value: rJson.name
            }
          }, metadata);

          assert.equal(rJson.name, 'json-refs');

          done();
        });
      });

      it('multple remote references with hash', function (done) {
        var json = {
          fullName: {
            $ref: projectJsonUrl + '#/full_name'
          },
          name: {
            $ref: projectJsonUrl + '#/name'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.notDeepEqual(json, rJson);

          // Make sure the original JSON is untouched
          assert.deepEqual(json, cJson);
          assert.deepEqual({
            '#/fullName/$ref': {
              ref: projectJsonUrl + '#/full_name',
              value: rJson.fullName
            },
            '#/name/$ref': {
              ref: projectJsonUrl + '#/name',
              value: rJson.name
            }
          }, metadata);

          assert.equal(rJson.fullName, 'whitlockjc/json-refs');
          assert.equal(rJson.name, 'json-refs');

          done();
        });
      });

      it('remote reference requiring prepareRequest usage (Issue 12)', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:44444/secure/project.json'
          }
        };
        var cJson = _.cloneDeep(json);

        // Make request for reference that requires authentication (Should fail)
        jsonRefs.resolveRefs(json, options, function (err, rJson) {
          var cOptions = _.cloneDeep(options);

          assert.ok(!_.isUndefined(err));
          assert.ok(_.isUndefined(rJson));

          assert.equal(401, err.status);

          cOptions.prepareRequest = function (req) {
            req.auth('whitlockjc', 'json-refs');
          };

          // Make same request for the same reference but use prepareRequest to add authentication to the request
          jsonRefs.resolveRefs(json, cOptions, function (err2, rJson2) {
            assert.ok(_.isUndefined(err2));
            assert.notDeepEqual(json, rJson2);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(rJson2.project.name, 'json-refs');

            done();
          });
        });
      });

      it('remote reference requiring processContent usage', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:44444/project.yaml'
          }
        };

        // Make request for YAML reference (Should fail)
        jsonRefs.resolveRefs(json, options, function (err, rJson) {
          var cOptions = _.cloneDeep(options);

          assert.ok(!_.isUndefined(err));
          assert.ok(_.isUndefined(rJson));

          cOptions.processContent = function (content, ref) {
            assert.equal(ref, 'http://localhost:44444/project.yaml');

            return YAML.safeLoad(content);
          };

          // Make same request for the same reference but use processContent to parse the YAML
          jsonRefs.resolveRefs(json, cOptions, function (err2, rJson2) {
            assert.ok(_.isUndefined(err2));
            assert.notDeepEqual(json, rJson2);

            assert.deepEqual({
              project: projectJson
            }, rJson2);

            done();
          });
        });
      });

      it('do not return error for invalid remote reference scheme', function (done) {
        var json = {
          $ref: 'ssh://127.0.0.1:' + path.resolve(__dirname, '..', 'package.json')
        };

        jsonRefs.resolveRefs(json, options, function (err, rJson, metadata) {
          assert.ok(_.isUndefined(err));
          assert.deepEqual(json, rJson);
          assert.deepEqual({}, metadata);

          return done();
        });
      });

      describe('should resolve relative references', function () {
        it('no location', function (done) {
          // We cannot test relative references without location due to our current test framework
          if (typeof window !== 'undefined') {
            return done();
          }

          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? 'test/browser/' : '') + 'project.json'
            }
          };
          var cJson = _.cloneDeep(json);
          var cOptions = _.cloneDeep(options);

          delete cOptions.location;

          jsonRefs.resolveRefs(json, cOptions, function (err, rJson) {
            assert.ok(_.isUndefined(err));
            assert.notDeepEqual(json, rJson);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(rJson.project.full_name, 'whitlockjc/json-refs');

            done();
          });
        });

        it('simple', function (done) {
          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? './browser' : '.') + '/project.json'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options, function (err, rJson) {
            assert.ok(_.isUndefined(err));
            assert.notDeepEqual(json, rJson);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(rJson.project.full_name, 'whitlockjc/json-refs');

            done();
          });
        });

        it('nested', function (done) {
          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? 'browser/' : '') + 'project-nested.json'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options, function (err, rJson) {
            assert.ok(_.isUndefined(err));
            assert.notDeepEqual(json, rJson);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(rJson.project.full_name, 'whitlockjc/json-refs');

            done();
          });
        });
      });
    });
  });
});
