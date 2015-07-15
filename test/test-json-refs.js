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

var _ = require('../lib/utils');
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
        'file://some/path': true,
        'somefile.json': true,
        '/some/path': true
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
        '#/': [],
        '#/some/path': ['some', 'path'],
        '#/~0whitlockjc': ['~whitlockjc'],
        '#/~1home/whitlockjc': ['/home', 'whitlockjc'],
        '#/~0~1home/whitlockjc': ['~/home', 'whitlockjc'],
        'http://json-schema.org/draft-04/schema#': 'http://json-schema.org/draft-04/schema#',
        './testing.json': './testing.json',
        '../testing.json': '../testing.json',
        'testing.json': 'testing.json',
        '/testing.json': '/testing.json'
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
    describe('should throw an Error when passed the wrong arguments', function () {
      var scenarios = {
        'json is required': [],
        'json must be an object': ['wrongType'],
        'options must be an object': [{}, 'wrongType'],
        'options.depth must be a number': [{}, {depth: true}],
        'options.depth must be greater or equal to zero': [{}, {depth: -1}],
        'options.location must be a string': [{}, {location: 123}],
        'options.prepareRequest must be a function': [{}, {prepareRequest: 'wrongType'}],
        'options.processContent must be a function': [{}, {processContent: 'wrongType'}],
        'done must be a function': [{}, {}, 'wrongType']
      };

      it('callbacks', function (done) {
        var allTests = Promise.resolve();
        var scenarioKeys = Object.keys(scenarios);

        // We cannot test the first or last scenarios with callbacks
        _.each(scenarioKeys, function (scenario, index) {
          var args = scenarios[scenario];

          if (index === 0 || index === scenarioKeys.length - 1) {
            return;
          }

          allTests = allTests
            .then(function () {
              return new Promise(function (resolve, reject) {
                var cArgs = args.concat(function (err) {
                  if (!_.isError(err)) {
                    reject(new Error('JsonRefs#resolveRefs should had failed (' + scenario + ')'));
                  } else {
                    try {
                      assert.equal(err.message, scenario);

                      resolve();
                    } catch (err2) {
                      reject(err2);
                    }
                  }
                });

                jsonRefs.resolveRefs.apply(jsonRefs, cArgs);
              }).catch(done);
            });
        });

        allTests.then(done, done);
      });

      it('promises', function (done) {
        var allTests = Promise.resolve();

        _.each(scenarios, function (args, scenario) {
          allTests = allTests
            .then(function () {
              return new Promise(function (resolve, reject) {
                jsonRefs.resolveRefs.apply(undefined, args)
                  .then(function () {
                    reject(new Error('JsonRefs#resolveRefs should had failed (' + scenario + ')'));
                  }, function (err) {
                    try {
                      assert.equal(err.message, scenario);

                      resolve();
                    } catch (err2) {
                      reject(err2);
                    }
                  });
              });
            });
        });

        allTests.then(done, done);
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

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.deepEqual(json, results.resolved);
            assert.deepEqual({}, results.metadata);
          }).then(done, done);
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

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);
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
            }, results.metadata);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.deepEqual(results.resolved, {
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
              fake: {
                $ref: '#/unresolvable'
              },
              undefined: undefined
            });
          })
          .then(done, done);
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

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.deepEqual(results.resolved, {
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
          })
          .then(done, done);
      });

      // Here only to show that we special case the inability for traverse to replace the root node:
      //   https://github.com/substack/js-traverse/issues/42
      it('top-level reference (replaces whole document)', function (done) {
        var json = {
          $ref: projectJsonUrl
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(results.resolved.full_name, 'whitlockjc/json-refs');
          })
          .then(done, done);
      });

      it('top-level reference with hash (Issue 19)', function (done) {
        var json = {
          $ref: projectJsonUrl + '#/owner'
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(results.resolved.login, 'whitlockjc');
          })
          .then(done, done);
      });

      describe('circular references', function () {
        describe('local', function () {
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

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
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

                assert.ok(results.metadata['#/a/0/$ref'].circular);
              })
              .then(done, done);
          });

          it('object (allOf)', function (done) {
            var json = {
              definitions: {
                Cat: {
                  allOf: [
                    {
                      $ref: '#/definitions/Cat'
                    }
                  ]
                }
              }
            };
            var cJson = _.cloneDeep(json);
            var cOptions = _.cloneDeep(options);

            cOptions.depth = 0;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
                  definitions: {
                    Cat: {
                      allOf: [
                        {}
                      ]
                    }
                  }
                });

                assert.ok(results.metadata['#/definitions/Cat/allOf/0/$ref'].circular);
              })
              .then(done, done);
          });

          it('object (properties)', function (done) {
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

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
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
                            items: {},
                            type: 'array'
                          }
                        }
                      }
                    }
                  }
                });

                assert.ok(results.metadata['#/properties/family/items/$ref'].circular);
              })
              .then(done, done);
          });

          it('self (root)', function (done) {
            var json = {
              $ref: '#'
            };
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/$ref': {
                    circular: true,
                    ref: '#',
                    value: {}
                  }
                });
                assert.deepEqual(results.resolved, {});
              })
              .then(done, done);
          });

          it('self (child)', function (done) {
            var json = {
              child: {
                $ref: '#'
              }
            };
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/child/$ref': {
                    circular: true,
                    ref: '#',
                    value: {
                      child: {}
                    }
                  }
                });
                assert.deepEqual(results.resolved, {
                  child: {
                    child: {}
                  }
                });
              })
              .then(done, done);
          });
        });
      });

      describe('circular reference depth', function () {
        describe('local', function () {
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
            var cOptions = _.cloneDeep(options);

            cOptions.depth = 2;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
                  a: [
                    {
                      a: [
                        {
                          a: [
                            {},
                            'x'
                          ]
                        },
                        'x'
                      ]
                    },
                    'x'
                  ]
                });
              })
              .then(done, done);
          });

          it('array (zero depth)', function (done) {
            var json = {
              a: [
                {
                  $ref: '#'
                },
                'x'
              ]
            };
            var cJson = _.cloneDeep(json);
            var cOptions = _.cloneDeep(options);

            cOptions.depth = 0;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
                  a: [
                    {},
                    'x'
                  ]
                });
              })
              .then(done, done);
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
            var cOptions = _.cloneDeep(options);

            cOptions.depth = 2;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
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
                                  items: {},
                                  type: 'array'
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                });
              })
              .then(done, done);
          });

          it('object (zero depth)', function (done) {
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
            var cOptions = _.cloneDeep(options);

            cOptions.depth = 0;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.resolved, {
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
                      items: {}
                    }
                  }
                });
              })
              .then(done, done);
          });

          it('self (root)', function (done) {
            var json = {
              $ref: '#'
            };
            var cJson = _.cloneDeep(json);
            var cOptions = _.cloneDeep(options);

            // Even though we set the depth to 3, root references to self will never nest
            cOptions.depth = 3;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/$ref': {
                    circular: true,
                    ref: '#',
                    value: {}
                  }
                });
                assert.deepEqual(results.resolved, {});
              })
              .then(done, done);
          });

          it('self (child)', function (done) {
            var json = {
              child: {
                $ref: '#'
              }
            };
            var cJson = _.cloneDeep(json);
            var cOptions = _.cloneDeep(options);

            cOptions.depth = 3;

            jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/child/$ref': {
                    circular: true,
                    ref: '#',
                    value: {
                      child: {
                        child: {
                          child: {}
                        }
                      }
                    }
                  }
                });
                assert.deepEqual(results.resolved, {
                  child: {
                    child: {
                      child: {
                        child: {}
                      }
                    }
                  }
                });
              })
              .then(done, done);
          });
        });
      });

      it('missing remote reference', function (done) {
        var ref = 'relative-nonexistent-path';
        var json = {
          project: {
            $ref: ref
          }
        };
        var cJson = _.cloneDeep(json);
        var refPtr = '#/project/$ref';

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            var details = results.metadata[refPtr];
            var detailsKeys = Object.keys(details);

            assert.deepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.deepEqual([refPtr], Object.keys(results.metadata));
            assert.equal(details.ref, ref);
            assert.ok(detailsKeys.indexOf('value') === -1);
            assert.ok(detailsKeys.indexOf('err') > -1);
          })
          .then(done, done);
      });

      it('simple remote reference', function (done) {
        var json = {
          project: {
            $ref: projectJsonUrl
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);
            assert.deepEqual({
              '#/project/$ref': {
                ref: projectJsonUrl,
                value: projectJson
              }
            }, results.metadata);

            assert.equal(results.resolved.project.name, 'json-refs');
          })
          .then(done, done);
      });

      it('complex remote reference', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:44444/ref.json'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);

            assert.equal(results.resolved.project.full_name, 'whitlockjc/json-refs');
          })
          .then(done, done);
      });

      it('remote reference with hash', function (done) {
        var json = {
          name: {
            $ref: projectJsonUrl + '#/name'
          }
        };
        var cJson = _.cloneDeep(json);

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);
            assert.deepEqual({
              '#/name/$ref': {
                ref: projectJsonUrl + '#/name',
                value: results.resolved.name
              }
            }, results.metadata);

            assert.equal(results.resolved.name, 'json-refs');
          })
          .then(done, done);
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

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.notDeepEqual(json, results.resolved);

            // Make sure the original JSON is untouched
            assert.deepEqual(json, cJson);
            assert.deepEqual({
              '#/fullName/$ref': {
                ref: projectJsonUrl + '#/full_name',
                value: results.resolved.fullName
              },
              '#/name/$ref': {
                ref: projectJsonUrl + '#/name',
                value: results.resolved.name
              }
            }, results.metadata);

            assert.equal(results.resolved.fullName, 'whitlockjc/json-refs');
            assert.equal(results.resolved.name, 'json-refs');
          })
          .then(done, done);
      });

      it('remote reference requiring processContent usage', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:44444/project.yaml'
          }
        };

        // Make request for YAML reference (Should fail)
        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            var cOptions = _.cloneDeep(options);

            assert.deepEqual(json, results.resolved);
            assert.ok(Object.keys(results.metadata['#/project/$ref']).indexOf('err') > -1);

            cOptions.processContent = function (content, ref) {
              assert.equal(ref, 'http://localhost:44444/project.yaml');

              return YAML.safeLoad(content);
            };

            // Make same request for the same reference but use processContent to parse the YAML
            return jsonRefs.resolveRefs(json, cOptions)
              .then(function (results2) {
                assert.notDeepEqual(json, results2.resolved);

                assert.deepEqual({
                  project: projectJson
                }, results2.resolved);
              });
          })
          .then(done, done);
      });

      it('remote reference requiring prepareRequest usage (Issue 12)', function (done) {
        var json = {
          project: {
            $ref: 'http://localhost:44444/secure/project.json'
          }
        };
        var cJson = _.cloneDeep(json);

        // Make request for reference that requires authentication (Should fail)
        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            var cOptions = _.cloneDeep(options);

            assert.deepEqual(json, results.resolved);

            assert.equal(401, results.metadata['#/project/$ref'].err.status);

            cOptions.prepareRequest = function (req) {
              req.auth('whitlockjc', 'json-refs');
            };

            // Make same request for the same reference but use prepareRequest to add authentication to the request
            return jsonRefs.resolveRefs(json, cOptions)
              .then(function (results2) {
                assert.notDeepEqual(json, results2.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.equal(results2.resolved.project.name, 'json-refs');
              });
          })
          .then(done, done);
      });

      it('do not return error for invalid remote reference scheme', function (done) {
        var json = {
          $ref: 'ssh://127.0.0.1:' + path.resolve(__dirname, '..', 'package.json')
        };

        jsonRefs.resolveRefs(json, options)
          .then(function (results) {
            assert.deepEqual(json, results.resolved);
            assert.deepEqual({}, results.metadata);
          })
          .then(done, done);
      });

      describe('should resolve relative references', function () {
        it('no location', function (done) {
          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? 'test/browser/' : '') + 'project.json'
            }
          };
          var cJson = _.cloneDeep(json);
          var cOptions = _.cloneDeep(options);
          var test;

          delete cOptions.location;

          // We cannot test relative references without location due to our current test framework
          if (typeof window !== 'undefined') {
            test = Promise.resolve();
          } else {
            test = jsonRefs.resolveRefs(json, cOptions)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.equal(results.resolved.project.full_name, 'whitlockjc/json-refs');
              });
          }

          test.then(done, done);
        });

        it('simple', function (done) {
          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? './browser' : '.') + '/project.json'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.equal(results.resolved.project.full_name, 'whitlockjc/json-refs');
            })
            .then(done, done);
        });

        it('nested', function (done) {
          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? 'browser/' : '') + 'project-nested.json'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.equal(results.resolved.project.full_name, 'whitlockjc/json-refs');
            })
            .then(done, done);
        });
      });
    });
  });
});
