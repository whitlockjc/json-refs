/* global afterEach, describe, it, window */

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
  location: typeof window === 'undefined' ? path.join(__dirname, 'browser') : (window.location.origin + '/base')
};
var projectCircularChildJson = require('./browser/project-circular-child.json');
var projectCircularRootJson = require('./browser/project-circular-root.json');
var projectJson = require('./browser/project.json');
var remoteRefBase = typeof window === 'undefined' ? 'browser/' : '';

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
          $ref: remoteRefBase + 'project.json'
        }
      }), {
        '#/$ref': 'http://json-schema.org/draft-04/schema',
        '#/project/$ref': remoteRefBase + 'project.json'
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

      describe('local', function () {
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

                assert.ok(results.metadata['#/a/0'].circular);
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

                assert.ok(results.metadata['#/definitions/Cat/allOf/0'].circular);
              })
              .then(done, done);
          });

          it('object (allOf composition/inheritance - single level)', function (done) {
            var json = {
              definitions: {
                A: {
                  allOf: [
                    {
                      $ref: '#/definitions/B'
                    }
                  ]
                },
                B: {
                  allOf: [
                    {
                      $ref: '#/definitions/A'
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
                    A: {
                      allOf: [
                        {
                          allOf: [
                            {}
                          ]
                        }
                      ]
                    },
                    B: {
                      allOf: [
                        {
                          allOf: [
                            {}
                          ]
                        }
                      ]
                    }
                  }
                });

                assert.deepEqual(results.metadata, {
                  '#/definitions/A/allOf/0': {
                    ref: '#/definitions/B',
                    circular: true
                  },
                  '#/definitions/B/allOf/0': {
                    ref: '#/definitions/A',
                    circular: true
                  }
                });
              })
              .then(done, done);
          });

          it('object (allOf composition/inheritance - multi level)', function (done) {
            var json = {
              definitions: {
                A: {
                  allOf: [
                    {
                      $ref: '#/definitions/B'
                    }
                  ]
                },
                B: {
                  allOf: [
                    {
                      $ref: '#/definitions/C'
                    }
                  ]
                },
                C: {
                  allOf: [
                    {
                      $ref: '#/definitions/A'
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
                    A: {
                      allOf: [
                        {
                          allOf: [
                            {
                              allOf: [
                                {}
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    B: {
                      allOf: [
                        {
                          allOf: [
                            {
                              allOf: [
                                {}
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    C: {
                      allOf: [
                        {
                          allOf: [
                            {
                              allOf: [
                                {}
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  }
                });

                assert.deepEqual(results.metadata, {
                  '#/definitions/A/allOf/0': {
                    ref: '#/definitions/B',
                    circular: true
                  },
                  '#/definitions/B/allOf/0': {
                    ref: '#/definitions/C',
                    circular: true
                  },
                  '#/definitions/C/allOf/0': {
                    ref: '#/definitions/A',
                    circular: true
                  }
                });
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

                assert.ok(results.metadata['#/properties/family/items'].circular);
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
                  '#/child': {
                    circular: true,
                    ref: '#'
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
                  '#': {
                    circular: true,
                    ref: '#'
                  }
                });
                assert.deepEqual(results.resolved, {});
              })
              .then(done, done);
          });
        });

        describe('circular reference depth', function () {
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
                  '#': {
                    circular: true,
                    ref: '#'
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
                  '#/child': {
                    circular: true,
                    ref: '#'
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

        it('missing reference (child)', function (done) {
          var json = {
            child: {
              $ref: '#/missing'
            }
          };

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.deepEqual(json, json);
              assert.deepEqual(results.metadata, {
                '#/child': {
                  ref: '#/missing',
                  missing: true
                }
              });
            }).then(done, done);
        });

        it('missing reference (root)', function (done) {
          var json = {
            $ref: '#/missing'
          };

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.deepEqual(json, json);
              assert.deepEqual(results.metadata, {
                '#': {
                  ref: '#/missing',
                  missing: true
                }
              });
            }).then(done, done);
        });

        it('multiple references', function (done) {
          var json = {
            location: {
              remote: 'project.json'
            },
            project: {
              $ref: 'project.json'
            },
            owner: {
              $ref: '#/project/owner'
            },
            name: {
              $ref: '#/project/name'
            },
            detailsLocation: {
              $ref: '#/location/remote'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual(results.resolved, {
                location: json.location,
                project: projectJson,
                owner: projectJson.owner,
                name: projectJson.name,
                detailsLocation: json.location.remote
              });

              assert.deepEqual(results.metadata, {
                '#/project': {
                  ref: json.project.$ref
                },
                '#/owner': {
                  ref: json.owner.$ref
                },
                '#/name': {
                  ref: json.name.$ref
                },
                '#/detailsLocation': {
                  ref: json.detailsLocation.$ref
                }
              });
            })
            .then(done, done);
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

        it('reference', function (done) {
          var json = {
            person: {
              name: 'Jeremy'
            },
            project: {
              name: 'json-refs',
              maintainer: {
                $ref: '#/person'
              }
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);
              assert.deepEqual({
                '#/project/maintainer': {
                  ref: '#/person'
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
                  }
                }
              });
            })
            .then(done, done);
        });

        it('reference to undefined', function (done) {
          var json = {
            name: undefined,
            undefined: {
              $ref: '#/name'
            }
          };

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.deepEqual(results.resolved, {
                name: undefined,
                undefined: undefined
              });
              assert.deepEqual(results.metadata, {
                '#/undefined': {
                  ref: '#/name'
                }
              });
            }).then(done, done);
        });
      });

      describe('remote', function () {
        describe('circular references', function () {
          it('ancestor (child)', function (done) {
            var json = {
              child: {
                $ref: 'nested/project-circular-ancestor-child.json'
              }
            };
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/child': {
                    ref: json.child.$ref
                  },
                  '#/child/child': {
                    ref: 'project-circular-child-descendant.json'
                  },
                  '#/child/child/child': {
                    circular: true,
                    ref: 'nested/project-circular-ancestor-child.json'
                  }
                });
                assert.deepEqual(results.resolved, {
                  child: {
                    child: {
                      child: {
                        child: {
                          child: {
                            child: {}
                          }
                        }
                      }
                    }
                  }
                });
              })
              .then(done, done);
          });

          it('ancestor (root)', function (done) {
            var json = {
              $ref: 'nested/project-circular-ancestor-root.json'
            };
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#': {
                    circular: true,
                    ref: 'nested/project-circular-ancestor-root.json'
                  }
                });
                assert.deepEqual(results.resolved, {});
              })
              .then(done, done);
          });

          it('nested self (child)', function (done) {
            var json = {
              child: {
                $ref: 'nested/project-circular-child.json'
              }
            };
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/child': {
                    ref: 'nested/project-circular-child.json'
                  },
                  '#/child/child': {
                    circular: true,
                    ref: 'nested/project-circular-child.json'
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

          it('nested self (root)', function (done) {
            var json = {
              $ref: 'nested/project-circular-root.json'
            };
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#': {
                    circular: true,
                    ref: 'nested/project-circular-root.json'
                  }
                });
                assert.deepEqual(results.resolved, {});
              })
              .then(done, done);
          });

          it('self (child)', function (done) {
            var json = projectCircularChildJson;
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#/child': {
                    ref: json.child.$ref
                  },
                  '#/child/child': {
                    circular: true,
                    ref: projectCircularChildJson.child.$ref
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

          it('self (root)', function (done) {
            var json = projectCircularRootJson;
            var cJson = _.cloneDeep(json);

            jsonRefs.resolveRefs(json, options)
              .then(function (results) {
                assert.notDeepEqual(json, results.resolved);

                // Make sure the original JSON is untouched
                assert.deepEqual(json, cJson);

                assert.deepEqual(results.metadata, {
                  '#': {
                    circular: true,
                    ref: projectCircularRootJson.$ref
                  }
                });
                assert.deepEqual(results.resolved, {});
              })
              .then(done, done);
          });
        });

        it('invalid remote reference scheme', function (done) {
          var json = {
            $ref: 'ssh://127.0.0.1:' + path.resolve(__dirname, '..', 'package.json')
          };

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              var ref = '#';
              var refDetails = results.metadata[ref];

              assert.deepEqual(json, results.resolved);

              assert.equal(refDetails.ref, json.$ref);
              assert.ok(Object.keys(refDetails).indexOf('err') > -1);
            })
            .then(done, done);
        });

        it('local deferred', function (done) {
          var json = {
            project: {
              $ref: 'project.json'
            },
            owner: {
              $ref: '#/project/owner'
            }
          };

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.deepEqual(results.resolved, {
                project: projectJson,
                owner: projectJson.owner
              });
              assert.deepEqual(results.metadata, {
                '#/project': {
                  ref: json.project.$ref
                },
                '#/owner': {
                  ref: json.owner.$ref
                }
              });
            }).then(done, done);
        });

        it('missing reference (child)', function (done) {
          var ref = 'relative-nonexistent-path';
          var json = {
            child: {
              $ref: ref
            }
          };
          var cJson = _.cloneDeep(json);
          var refPtr = '#/child';

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              var details = results.metadata[refPtr];
              var detailsKeys = Object.keys(details);

              assert.deepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual([refPtr], Object.keys(results.metadata));
              assert.equal(details.ref, ref);
              assert.ok(details.missing);
              assert.ok(detailsKeys.indexOf('err') > -1);
            })
            .then(done, done);
        });

        it('missing reference (root)', function (done) {
          var ref = 'relative-nonexistent-path';
          var json = {
            $ref: ref
          };
          var cJson = _.cloneDeep(json);
          var refPtr = '#';

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              var details = results.metadata[refPtr];
              var detailsKeys = Object.keys(details);

              assert.deepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual([refPtr], Object.keys(results.metadata));
              assert.equal(details.ref, ref);
              assert.ok(details.missing);
              assert.ok(detailsKeys.indexOf('err') > -1);
            })
            .then(done, done);
        });

        it('multiple references', function (done) {
          var json = {
            project: {
              $ref: 'project.json'
            },
            nestedProject: {
              $ref: 'nested/project.json'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);
              assert.deepEqual({
                '#/project': {
                  ref: 'project.json'
                },
                '#/nestedProject': {
                  ref: 'nested/project.json'
                }
              }, results.metadata);

              assert.deepEqual(results.resolved, {
                project: projectJson,
                nestedProject: projectJson
              });
            })
            .then(done, done);
        });

        it('multple references with hash', function (done) {
          var json = {
            fullName: {
              $ref: 'project.json#/full_name'
            },
            name: {
              $ref: 'project.json#/name'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);
              assert.deepEqual({
                '#/fullName': {
                  ref: 'project.json#/full_name'
                },
                '#/name': {
                  ref: 'project.json#/name'
                }
              }, results.metadata);

              assert.deepEqual(results.resolved, {
                fullName: projectJson.full_name,
                name: projectJson.name
              });
            })
            .then(done, done);
        });

        it('reference (child)', function (done) {
          var json = {
            project: {
              $ref: 'project.json'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual(results.resolved, {
                project: projectJson
              });
            })
            .then(done, done);
        });

        // Here only to show that we special case the inability for traverse to replace the root node:
        //   https://github.com/substack/js-traverse/issues/42
        it('reference (root)', function (done) {
          var json = {
            $ref: 'project.json'
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual(results.resolved, projectJson);
            })
            .then(done, done);
        });

        it('reference requiring processContent usage', function (done) {
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
              assert.ok(Object.keys(results.metadata['#/project']).indexOf('err') > -1);

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

        it('reference requiring prepareRequest usage', function (done) {
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

              assert.equal(401, results.metadata['#/project'].err.status);

              cOptions.prepareRequest = function (req) {
                req.auth('whitlockjc', 'json-refs');
              };

              // Make same request for the same reference but use prepareRequest to add authentication to the request
              return jsonRefs.resolveRefs(json, cOptions)
                .then(function (results2) {
                  assert.notDeepEqual(json, results2.resolved);

                  // Make sure the original JSON is untouched
                  assert.deepEqual(json, cJson);

                  assert.deepEqual(results2.resolved, {
                    project: projectJson
                  });
                });
            })
            .then(done, done);
        });

        it('reference with hash (child)', function (done) {
          var json = {
            owner: {
              $ref: 'project.json#/owner'
            }
          };
          var cJson = _.cloneDeep(json);

          jsonRefs.resolveRefs(json, options)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual(results.resolved, {
                owner: projectJson.owner
              });
            })
            .then(done, done);
        });

        it('support relative references with no location', function (done) {
          var json = {
            project: {
              $ref: (typeof window === 'undefined' ? 'test/browser/' : 'base/') + 'project.json'
            }
          };
          var cJson = _.cloneDeep(json);
          var cOptions = _.cloneDeep(options);

          delete cOptions.location;

          jsonRefs.resolveRefs(json, cOptions)
            .then(function (results) {
              assert.notDeepEqual(json, results.resolved);

              // Make sure the original JSON is untouched
              assert.deepEqual(json, cJson);

              assert.deepEqual(results.resolved, {
                project: projectJson
              });
              assert.deepEqual(results.metadata, {
                '#/project': {
                  ref: json.project.$ref
                }
              });
            })
            .then(done, done);
        });
      });
    });
  });
});
