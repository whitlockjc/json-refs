/* global before, describe, it */

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
var fs = require('fs');
var JsonRefs = require('../');
var path = require('path');
var URI = require('uri-js');
var YAML = require('js-yaml');

var documentBase = path.join(__dirname, 'browser', 'documents');
var ofTypeError = new TypeError('options.filter must be an Array, a Function of a String');
var osdpTypeError = new TypeError('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
var osdpMissingError = new Error('JSON Pointer points to missing location: #/missing');
var objTypeError = new TypeError('obj must be an Array or an Object');
var optionsTypeError = new TypeError('options must be an Object');
var relativeBase = typeof window === 'undefined' ? documentBase : 'base/documents';
// These variables do not use documentBase because doing so breaks browserify's brfs transform
var testDocument = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'test-document.yaml'),
                                                 'utf-8'));
var testDocument1 = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'test-document-1.yaml'),
                                                  'utf-8'));
var testNestedDocument = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'nested',
                                                                 'test-nested.yaml'), 'utf-8'));
var testNestedDocument1 = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'nested',
                                                                  'test-nested-1.yaml'), 'utf-8'));

function validateError (expected, actual, index) {
  try {
    if (_.isError(expected)) {
      assert.equal(actual.message, expected.message);
    } else {
      throw actual;
    }
  } catch (err) {
    err.message = 'Test scenario (' + index + ') failed: ' + err.message;

    throw err;
  }
}

function runPromiseTestScenarios (scenarios, fn, done) {
  var allTests = Promise.resolve();

  _.each(scenarios, function (scenario, index) {
    var args = scenario[0];
    var expected = scenario[1];
    var aFn = assert.equal;

    if (_.isArray(expected) || _.isPlainObject(expected)) {
      aFn = assert.deepEqual;
    }

    allTests = allTests
      .then(function () {
        return fn.apply(JsonRefs, args);
      })
      .then(function () {
        if (_.isError(expected)) {
          throw new Error('Scenario should had failed');
        } else {
          aFn.apply(assert, [fn.apply(JsonRefs, args), expected]);
        }
      })
      .catch(function (err) {
        if (_.isError(expected)) {
          // Do not revalidate errors
          if (err.message.indexOf('Test scenario (') === -1) {
            validateError(expected, err, index);
          } else {
            throw err;
          }
        } else {
          throw new Error('Test scenario (' + index + ') should not had failed: ' + err.message);
        }
      });
  });

  allTests.then(done, done);
}

function runTestScenarios (scenarios, fn) {
  _.each(scenarios, function (scenario, index) {
    var args = scenario[0];
    var expected = scenario[1];
    var aFn = assert.equal;

    if (_.isArray(expected) || _.isPlainObject(expected)) {
      aFn = assert.deepEqual;
    }

    try {
      aFn.apply(assert, [fn.apply(JsonRefs, args), expected]);

      if (_.isError(expected)) {
        assert.fail('Should had thrown an error (' + expected.message + ')');
      }
    } catch (err) {
      validateError(expected, err, index);
    }
  });
}

// Required for two reasons:
//
//   1) Error objects from Superagent are different in the browser
//   2) The assert module in the browser seems to fail on deepEqual when keys are out of order
function validateResolvedRefDetails (actual, expected) {
  var aKeys = Object.keys(actual);
  var eKeys = Object.keys(expected);

  assert.equal(aKeys.length, eKeys.length);

  aKeys.forEach(function (refPtr) {
    var aRefDetails = actual[refPtr];
    var eRefDetails = expected[refPtr];
    var ardKeys = Object.keys(aRefDetails);
    var erdKeys = Object.keys(eRefDetails);

    assert.equal(ardKeys.length, erdKeys.length);

    ardKeys.forEach(function (key) {
      var aValue = aRefDetails[key];
      var eValue = eRefDetails[key];

      if (_.isError(eValue)) {
        assert.equal(aValue, eValue.message);
      } else if (_.isArray(eValue) || _.isPlainObject(eValue)) {
        assert.deepEqual(aValue, eValue);
      } else {
        assert.equal(aValue, eValue);
      }
    });
  });
}

function validateUnresolvedRefDetails (actual, defPtr, def) {
  var uriDetails = !_.isUndefined(def.$ref) ? URI.parse(def.$ref) : undefined;
  var type = 'invalid';

  assert.deepEqual(actual.def, def);

  if (_.isUndefined(uriDetails)) {
    assert.ok(_.isUndefined(actual.uri));
    assert.ok(_.isUndefined(actual.uriDetails));
    assert.ok(_.isUndefined(actual.warning));

    if (defPtr === '#/project') {
      assert.equal(actual.error, 'obj.$ref is not a String');
    } else {
      assert.ok(_.isUndefined(actual.error));
    }
  } else {
    assert.equal(actual.uri, def.$ref);
    assert.deepEqual(actual.uriDetails, uriDetails);

    if (_.isUndefined(actual.uriDetails.error)) {
      switch (uriDetails.reference) {
        case 'absolute':
        case 'uri':
          type = 'remote';
          break;
        case 'same-document':
          type = 'local';
          break;
        default:
          type = uriDetails.reference;
      }
    } else {
      assert.equal(actual.error, uriDetails.error);
    }
  }

  assert.equal(actual.type, type);
  assert.ok(['invalid', 'local', 'relative', 'remote'].indexOf(actual.type) > -1);

  if (defPtr === '#/warning') {
    assert.equal(actual.warning, 'Extra JSON Reference properties will be ignored: ignored');
  } else if (defPtr === '#/invalid') {
    assert.equal(actual.error, 'URI is not strictly valid.');
  }
}

function runRefDetailsTestScenarios (actual, defMap) {
  assert.deepEqual(Object.keys(actual), Object.keys(defMap));

  _.each(defMap, function (def, ptr) {
    validateUnresolvedRefDetails(actual[ptr], ptr, def);
  });
}

function yamlContentProcessor (res, callback) {
  callback(undefined, YAML.safeLoad(res.text));
}

describe('json-refs', function () {
  var expectedRelativeValue = {
    name: testNestedDocument.name,
    child: {
      name: testNestedDocument1.name,
      ancestor: {
        name: testDocument1.name,
        nested: {},
        local: testDocument1.name,
        deferred: testDocument.project.name,
        missing: testDocument1.missing
      },
      local: testNestedDocument1.name,
      deferred: testDocument.project.name,
      missing: testNestedDocument1.missing
    },
    local: testNestedDocument.name,
    deferred: testDocument.project.name,
    missing: testNestedDocument.missing
  };
  var expectedValidResolveRefs;
  var expectedFullyResolved;
  var remotePkgJson;

  before(function (done) {
    JsonRefs.findRefsAt('https://rawgit.com/whitlockjc/json-refs/master/package.json')
      .then(function (refs) {
        remotePkgJson = refs.value;
        expectedValidResolveRefs = {
          '#/array/0': {
            def: testDocument.array[0],
            uri: testDocument.array[0].$ref,
            uriDetails: URI.parse(testDocument.array[0].$ref),
            type: 'local',
            value: testDocument.project.name
          },
          '#/array/1': {
            def: testDocument.array[1],
            uri: testDocument.array[1].$ref,
            uriDetails: URI.parse(testDocument.array[1].$ref),
            type: 'local',
            value: testDocument.project.description
          },
          '#/circular/root': {
            def: testDocument.circular.root,
            uri: testDocument.circular.root.$ref,
            uriDetails: URI.parse(testDocument.circular.root.$ref),
            type: 'local',
            circular: true,
            value: {}
          },
          '#/circular/ancestor': {
            def: testDocument.circular.ancestor,
            uri: testDocument.circular.ancestor.$ref,
            uriDetails: URI.parse(testDocument.circular.ancestor.$ref),
            type: 'local',
            circular: true,
            value: {}
          },
          '#/definitions/Person/properties/name': {
            def: testDocument.definitions.Person.properties.name,
            uri: testDocument.definitions.Person.properties.name.$ref,
            uriDetails: URI.parse(testDocument.definitions.Person.properties.name.$ref),
            type: 'local',
            value: testDocument.definitions.HumanName
          },
          '#/local': {
            def: testDocument.local,
            uri: testDocument.local.$ref,
            uriDetails: URI.parse(testDocument.local.$ref),
            type: 'local',
            value: testDocument.project.name
          },
          '#/missing': {
            def: testDocument.missing,
            uri: testDocument.missing.$ref,
            uriDetails: URI.parse(testDocument.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          },
          '#/remote/absolute': {
            def: testDocument.remote.absolute,
            uri: testDocument.remote.absolute.$ref,
            uriDetails: URI.parse(testDocument.remote.absolute.$ref),
            type: 'remote',
            value: remotePkgJson
          },
          '#/remote/absolute-with-hash': {
            def: testDocument.remote['absolute-with-hash'],
            uri: testDocument.remote['absolute-with-hash'].$ref,
            uriDetails: URI.parse(testDocument.remote['absolute-with-hash'].$ref),
            type: 'remote',
            value: remotePkgJson.name
          },
          '#/remote/relative': {
            def: testDocument.remote.relative,
            uri: testDocument.remote.relative.$ref,
            uriDetails: URI.parse(testDocument.remote.relative.$ref),
            type: 'relative',
            value: expectedRelativeValue,
            circular: true
          },
          '#/remote/relative-with-hash': {
            def: testDocument.remote['relative-with-hash'],
            uri: testDocument.remote['relative-with-hash'].$ref,
            uriDetails: URI.parse(testDocument.remote['relative-with-hash'].$ref),
            type: 'relative',
            value: testNestedDocument.name
          },
          '#/remote/relative/child': {
            def: testNestedDocument.child,
            uri: testNestedDocument.child.$ref,
            uriDetails: URI.parse(testNestedDocument.child.$ref),
            type: 'relative',
            value: expectedRelativeValue.child,
            circular: true
          },
          '#/remote/relative/child/ancestor': {
            def: testNestedDocument1.ancestor,
            uri: testNestedDocument1.ancestor.$ref,
            uriDetails: URI.parse(testNestedDocument1.ancestor.$ref),
            type: 'relative',
            value: expectedRelativeValue.child.ancestor,
            circular: true
          },
          '#/remote/relative/child/ancestor/deferred': {
            def: testDocument1.deferred,
            uri: testDocument1.deferred.$ref,
            uriDetails: URI.parse(testDocument1.deferred.$ref),
            type: 'local',
            value: expectedRelativeValue.child.ancestor.deferred
          },
          '#/remote/relative/child/ancestor/local': {
            def: testDocument1.local,
            uri: testDocument1.local.$ref,
            uriDetails: URI.parse(testDocument1.local.$ref),
            type: 'local',
            value: expectedRelativeValue.child.ancestor.name
          },
          '#/remote/relative/child/ancestor/missing': {
            def: testDocument1.missing,
            uri: testDocument1.missing.$ref,
            uriDetails: URI.parse(testDocument1.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          },
          '#/remote/relative/child/ancestor/nested': {
            def: testDocument1.nested,
            uri: testDocument1.nested.$ref,
            uriDetails: URI.parse(testDocument1.nested.$ref),
            type: 'relative',
            value: {},
            circular: true
          },
          '#/remote/relative/child/deferred': {
            def: testNestedDocument1.deferred,
            uri: testNestedDocument1.deferred.$ref,
            uriDetails: URI.parse(testNestedDocument1.deferred.$ref),
            type: 'local',
            value: expectedRelativeValue.child.deferred
          },
          '#/remote/relative/child/local': {
            def: testNestedDocument1.local,
            uri: testNestedDocument1.local.$ref,
            uriDetails: URI.parse(testNestedDocument1.local.$ref),
            type: 'local',
            value: expectedRelativeValue.child.name
          },
          '#/remote/relative/child/missing': {
            def: testNestedDocument1.missing,
            uri: testNestedDocument1.missing.$ref,
            uriDetails: URI.parse(testNestedDocument1.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          },
          '#/remote/relative/deferred': {
            def: testNestedDocument.deferred,
            uri: testNestedDocument.deferred.$ref,
            uriDetails: URI.parse(testNestedDocument.deferred.$ref),
            type: 'local',
            value: expectedRelativeValue.child.deferred
          },
          '#/remote/relative/local': {
            def: testNestedDocument.local,
            uri: testNestedDocument.local.$ref,
            uriDetails: URI.parse(testNestedDocument.local.$ref),
            type: 'local',
            value: testNestedDocument.name
          },
          '#/remote/relative/missing': {
            def: testNestedDocument.missing,
            uri: testNestedDocument.missing.$ref,
            uriDetails: URI.parse(testNestedDocument.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          },
          '#/warning': {
            def: testDocument.warning,
            uri: testDocument.warning.$ref,
            uriDetails: URI.parse(testDocument.warning.$ref),
            type: 'local',
            value: testDocument.project.name,
            warning: 'Extra JSON Reference properties will be ignored: ignored'
          }
        };
        expectedFullyResolved = {
          project: testDocument.project,
          array: [
            testDocument.project.name,
            testDocument.project.description
          ],
          circular: {
            root: {},
            ancestor: {}
          },
          definitions: {
            HumanName: testDocument.definitions.HumanName,
            Person: {
              type: testDocument.definitions.Person.type,
              properties: {
                age: testDocument.definitions.Person.properties.age,
                name: testDocument.definitions.HumanName
              }
            }
          },
          invalid: testDocument.invalid,
          local: testDocument.project.name,
          missing: testDocument.missing,
          remote: {
            absolute: remotePkgJson,
            'absolute-with-hash': remotePkgJson.name,
            relative: expectedRelativeValue,
            'relative-with-hash': testNestedDocument.name
          },
          warning: testDocument.project.name
        };
      })
      .then(done, done);
  });

  describe('#decodePath', function () {
    it('should throw an error for invalid arguments', function () {
      try {
        JsonRefs.decodePath('wrongType');

        assert.fail('Should had failed');
      } catch (err) {
        assert.equal(err.message, 'path must be an array');
      }
    });

    it('should return the proper path segments', function () {
      runTestScenarios([
        [[[]], []],
        [[[1, '2']], ['1', '2']],
        [[['some', '~0', '~1', '~01']], ['some', '~', '/', '~1']]
      ], JsonRefs.decodePath);
    });
  });

  describe('#encodePath', function () {
    it('should throw an error for invalid arguments', function () {
      try {
        JsonRefs.encodePath('wrongType');

        assert.fail('Should had failed');
      } catch (err) {
        assert.equal(err.message, 'path must be an array');
      }
    });

    it('should return the proper path segments', function () {
      runTestScenarios([
        [[[]], []],
        [[[1, '2']], ['1', '2']],
        [[['some', '~', '/', '~1']], ['some', '~0', '~1', '~01']]
      ], JsonRefs.encodePath);
    });
  });

  describe('#findRefs', function () {
    var expectedAllReferences = {
      '#/array/0': testDocument.array[0],
      '#/array/1': testDocument.array[1],
      '#/circular/root': testDocument.circular.root,
      '#/circular/ancestor': testDocument.circular.ancestor,
      '#/definitions/Person/properties/name': testDocument.definitions.Person.properties.name,
      '#/invalid': testDocument.invalid,
      '#/local': testDocument.local,
      '#/missing': testDocument.missing,
      '#/remote/absolute': testDocument.remote.absolute,
      '#/remote/absolute-with-hash': testDocument.remote['absolute-with-hash'],
      '#/remote/relative': testDocument.remote.relative,
      '#/remote/relative-with-hash': testDocument.remote['relative-with-hash'],
      '#/warning': testDocument.warning
    };

    it('should throw an error for invalid arguments', function () {
      runTestScenarios([
        [[], objTypeError],
        [['wrongType'], objTypeError],
        [[{}, 1], optionsTypeError],
        [[{}, {includeInvalid: 'wrongType'}], new TypeError('options.includeInvalid must be a Boolean')],
        [[{}, {refPreProcessor: 'wrongType'}], new TypeError('options.refPreProcessor must be a Function')],
        [[{}, {refPostProcessor: 'wrongType'}], new TypeError('options.refPostProcessor must be a Function')],
        [[[], {subDocPath: 1}], osdpTypeError],
        [[{}, {subDocPath: '#/missing'}], osdpMissingError],
        [[{}, {filter: 1}], ofTypeError]
      ], JsonRefs.findRefs);
    });

    describe('should return the proper reference details', function () {
      describe('no options', function () {
        it('array input', function () {
          runRefDetailsTestScenarios(JsonRefs.findRefs(testDocument.array, {}), {
            '#/0': testDocument.array[0],
            '#/1': testDocument.array[1]
          });
        });

        it('object input (no options)', function () {
          var expectedAllValidRefs = _.cloneDeep(expectedAllReferences);

          delete expectedAllValidRefs['#/invalid'];

          runRefDetailsTestScenarios(JsonRefs.findRefs(testDocument), expectedAllValidRefs);
        });
      });

      describe('options.filter', function () {
        it('option as array', function () {
          assert.deepEqual(Object.keys(JsonRefs.findRefs(testDocument, {filter: ['relative', 'remote']})), [
            '#/remote/absolute',
            '#/remote/absolute-with-hash',
            '#/remote/relative',
            '#/remote/relative-with-hash'
          ]);
        });

        it('option as function', function () {
          assert.deepEqual(Object.keys(JsonRefs.findRefs(testDocument, {filter: function () {
            return false;
          }})), []);
        });

        it('option as string', function () {
          assert.deepEqual(Object.keys(JsonRefs.findRefs(testDocument, {filter: 'relative'})), [
            '#/remote/relative',
            '#/remote/relative-with-hash'
          ]);
        });
      });

      it('options.includeInvalid', function () {
        runRefDetailsTestScenarios(JsonRefs.findRefs(testDocument, {includeInvalid: true}), expectedAllReferences);
      });

      it('options.refPreProcessor', function () {
        var doc = {
          project: testDocument.project,
          ref: {
            $ref: '/file[/].html'
          }
        };
        var refs = JsonRefs.findRefs(doc);

        assert.equal(Object.keys(refs).length, 0);

        refs = JsonRefs.findRefs(doc, {
          refPreProcessor: function () {
            return {
              $ref: '#/project/name'
            };
          }
        });

        assert.equal(Object.keys(refs).length, 1);
      });

      it('options.refPreProcessor', function () {
        var doc = {
          project: testDocument.project,
          ref: {
            $ref: '#/project/name'
          }
        };
        var refs = JsonRefs.findRefs(doc);

        assert.ok(!_.has(refs['#/ref'], 'extra'));

        refs = JsonRefs.findRefs(doc, {
          refPostProcessor: function (refDetails) {
            refDetails.extra = 'An extra piece of metadata';

            return refDetails;
          }
        });

        assert.ok(_.has(refs['#/ref'], 'extra'));
      });

      describe('options.subDocPath', function () {
        it('option as array', function () {
          runRefDetailsTestScenarios(JsonRefs.findRefs(testDocument, {subDocPath: ['array', '0']}), {
            '#/array/0': testDocument.array[0]
          });
        });

        it('option as string', function () {
          runRefDetailsTestScenarios(JsonRefs.findRefs(testDocument, {subDocPath: '#/definitions'}), {
            '#/definitions/Person/properties/name': testDocument.definitions.Person.properties.name
          });
        });
      });
    });
  });

  describe('#findRefsAt', function () {
    // #findRefsAt uses #findRefs so all of the validation it does for input arguments is already tested so we just
    // need to test the cases that are unique to #findRefsAt.
    it('should return an error for an invalid location values', function (done) {
      var ilTypeError = new TypeError('location must be a string');

      runPromiseTestScenarios([
        [[undefined], ilTypeError],
        [[false], ilTypeError]
      ], JsonRefs.findRefsAt, done);
    });

    it('should handle a location to a missing resource', function (done) {
      var location = typeof window === 'undefined' ?
        './missing.json' :
        'https://rawgit.com/whitlockjc/json-refs/master/missing.json';

      JsonRefs.findRefsAt(location)
        .then(function () {
          throw new Error('JsonRefs.findRefsAt should had failed');
        })
        .catch(function (err) {
          if (typeof window === 'undefined') {
            assert.ok(err.message.indexOf('ENOENT') > -1);
            assert.ok(err.message.indexOf('missing.json') > -1);
          } else {
            assert.equal(err.message, 'Not Found');
          }
        })
        .then(done, done);
    });

    it('should handle a valid location', function (done) {
      JsonRefs.findRefsAt('./test-document.yaml', {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        relativeBase: relativeBase
      })
        .then(function (res) {
          assert.deepEqual(res, {
            refs: JsonRefs.findRefs(testDocument),
            value: testDocument
          });
        })
        .catch(function (err) {
          throw err;
        })
        .then(done, done);
    });
  });

  describe('#getRefDetails', function () {
    // #findRefs uses #getRefDetails and all scenarios other than the 'invalid' reference is tested
    it('should return proper reference details (invalid reference - reference like)', function () {
      validateUnresolvedRefDetails(JsonRefs.getRefDetails(testDocument.invalid), '#/invalid', testDocument.invalid);
    });

    it('should return proper reference details (invalid reference)', function () {
      validateUnresolvedRefDetails(JsonRefs.getRefDetails(testDocument.project), '#/project', testDocument.project);
    });
  });

  describe('#isPtr', function () {
    it('should return true for valid JSON Pointers', function () {
      runTestScenarios([
        [[''], true],
        [['#'], true],
        [['/'], true],
        [['#/'], true],
        [['#/some/path'], true],
        [['/some/path'], true]
      ], JsonRefs.isPtr);
    });

    it('should return false for invalid JSON Pointers', function () {
      runTestScenarios([
        [[undefined], false],
        [[1], false],
        [[' '], false],
        [['# '], false],
        [['some/path'], false],
        [['#some/path'], false],
        [['http://localhost#/some/path'], false],
        [['./some/path'], false],
        [['#/some/invalid/~token'], false],
        [['#/another/invalid/token/~'], false]
      ], JsonRefs.isPtr);
    });

    it('should support throwWithDetails argument', function () {
      var btError = new Error('ptr has invalid token(s)');
      var wsError = new Error('ptr must start with a / or #/');
      var wtError = new Error('ptr is not a String');

      runTestScenarios([
        [[undefined, true], wtError],
        [[1, true], wtError],
        [['some/path', true], wsError],
        [['#some/path', true], wsError],
        [['/some/invalid/~token', true], btError],
        [['/some/invalid/token/~', true], btError]
      ], JsonRefs.isPtr);
    });
  });

  describe('#isRef', function () {
    it('should return true for valid JSON References', function () {
      runTestScenarios([
        [[''], true],
        [['#'], true],
        [['#/definitions/Person'], true],
        [['/definitions/Person'], true],
        [['someId'], true],
        [['someId#/name'], true],
        [['./models.json'], true],
        [['https://rawgit.com/whitlockjc/json-refs/master/package.json'], true],
        [['https://rawgit.com/whitlockjc/json-refs/master/package.json#/name'], true],
        [['#/some/valid/token/~0/~1'], true]
      ].map(function (scenario) {
        scenario[0][0] = {$ref: scenario[0][0]};
        return scenario;
      }), JsonRefs.isRef);
    });

    it('should return false for invalid JSON References', function () {
      runTestScenarios([
        [[undefined], false],
        [[1], false],
        [[{}], false],
        [[{$ref: 1}], false],
        [[{$ref: '/file[/].html'}], false]
      ], JsonRefs.isRef);
    });
  });

  describe('#pathFromPtr', function () {
    it('should return the expected value', function () {
      var invalidArgError = new Error('ptr must be a JSON Pointer');

      runTestScenarios([
        [[undefined], invalidArgError],
        [['./some/path'], invalidArgError],
        [['#'], []],
        [[''], []],
        [['#/some/path'], ['some', 'path']],
        [['/some/path'], ['some', 'path']],
        [['#/paths/~1pets/~0{name}'], ['paths', '/pets', '~{name}']],
        [['/paths/~1pets/~0{name}'], ['paths', '/pets', '~{name}']]
      ], JsonRefs.pathFromPtr);
    });
  });

  describe('#pathToPtr', function () {
    it('should return the expected value', function () {
      var invalidArgError = new Error('path must be an Array');

      runTestScenarios([
        [[undefined], invalidArgError],
        [['wrongType'], invalidArgError],
        [[[]], '#'],
        [[[], false], ''],
        [[[1, 2, 'three']], '#/1/2/three'],
        [[[1, 2, 'three'], false], '/1/2/three'],
        [[['paths', '/pets', '~{name}']], '#/paths/~1pets/~0{name}'],
        [[['paths', '/pets', '~{name}'], false], '/paths/~1pets/~0{name}']
      ], JsonRefs.pathToPtr);
    });
  });

  describe('#resolveRefs', function () {
    it('should throw an error for invalid arguments', function (done) {
      JsonRefs.resolveRefs('wrongType')
        .then(function () {
          throw new Error('Should had failed');
        })
        .catch(function (err) {
          assert.equal(err.message, 'obj must be an Array or an Object');
        })
        .then(done, done);
    });

    it('should handle missing remote reference', function (done) {
      var doc = {
        $ref: 'fake.json'
      };

      JsonRefs.resolveRefs(doc, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        relativeBase: relativeBase
      })
        .then(function (res) {
          var refDetails;

          // Make sure the document is unchanged
          assert.deepEqual(res.resolved, doc);

          // Make sure there is no error thrown and that the reference details are accurate
          assert.equal(Object.keys(res.refs).length, 1);

          refDetails = res.refs['#'];

          assert.deepEqual(refDetails.def, doc);
          assert.equal(refDetails.uri, doc.$ref);
          assert.deepEqual(refDetails.uriDetails, URI.parse(doc.$ref));
          assert.equal(refDetails.type, 'relative');
          assert.ok(refDetails.missing);

          if (typeof window === 'undefined') {
            assert.ok(refDetails.error.indexOf('ENOENT') > -1);
            assert.ok(refDetails.error.indexOf('fake.json') > -1);
          } else {
            assert.equal(refDetails.error, 'Not Found');
          }
        })
        .then(done, done);
    });

    it('should return the expected value', function (done) {
      JsonRefs.resolveRefs(testDocument, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        relativeBase: relativeBase
      })
      .then(function (res) {
        // Validate the resolved document
        assert.deepEqual(res.resolved, expectedFullyResolved);

        // Validate the reference metadata
        validateResolvedRefDetails(res.refs, expectedValidResolveRefs);
      })
      .then(done, done);
    });

    it('should support options.subDocPath', function (done) {
      JsonRefs.resolveRefs(testDocument, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        relativeBase: relativeBase,
        subDocPath: '#/remote/relative'
      })
      .then(function (res) {
        // Validate the resolved document
        assert.deepEqual(res.resolved, {
          project: testDocument.project,
          array: testDocument.array,
          circular: testDocument.circular,
          definitions: testDocument.definitions,
          invalid: testDocument.invalid,
          local: testDocument.local,
          missing: testDocument.missing,
          remote: {
            absolute: testDocument.remote.absolute,
            'absolute-with-hash': testDocument.remote['absolute-with-hash'],
            relative: expectedRelativeValue,
            'relative-with-hash': testDocument.remote['relative-with-hash']
          },
          warning: testDocument.warning
        });

        // Validate the reference metadata
        validateResolvedRefDetails(res.refs, {
          '#/remote/relative': {
            def: testDocument.remote.relative,
            uri: testDocument.remote.relative.$ref,
            uriDetails: URI.parse(testDocument.remote.relative.$ref),
            type: 'relative',
            value: {
              name: testNestedDocument.name,
              child: expectedRelativeValue.child,
              local: testNestedDocument.name,
              deferred: testDocument.project.name,
              missing: testNestedDocument.missing
            },
            circular: true
          },
          '#/remote/relative/child': {
            def: testNestedDocument.child,
            uri: testNestedDocument.child.$ref,
            uriDetails: URI.parse(testNestedDocument.child.$ref),
            type: 'relative',
            value: expectedRelativeValue.child,
            circular: true
          },
          '#/remote/relative/child/ancestor': {
            def: testNestedDocument1.ancestor,
            uri: testNestedDocument1.ancestor.$ref,
            uriDetails: URI.parse(testNestedDocument1.ancestor.$ref),
            type: 'relative',
            value: expectedRelativeValue.child.ancestor,
            circular: true
          },
          '#/remote/relative/child/ancestor/deferred': {
            def: testDocument1.deferred,
            uri: testDocument1.deferred.$ref,
            uriDetails: URI.parse(testDocument1.deferred.$ref),
            type: 'local',
            value: expectedRelativeValue.child.ancestor.deferred
          },
          '#/remote/relative/child/ancestor/local': {
            def: testDocument1.local,
            uri: testDocument1.local.$ref,
            uriDetails: URI.parse(testDocument1.local.$ref),
            type: 'local',
            value: expectedRelativeValue.child.ancestor.name
          },
          '#/remote/relative/child/ancestor/missing': {
            def: testDocument1.missing,
            uri: testDocument1.missing.$ref,
            uriDetails: URI.parse(testDocument1.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          },
          '#/remote/relative/child/ancestor/nested': {
            def: testDocument1.nested,
            uri: testDocument1.nested.$ref,
            uriDetails: URI.parse(testDocument1.nested.$ref),
            type: 'relative',
            value: {},
            circular: true
          },
          '#/remote/relative/child/deferred': {
            def: testNestedDocument1.deferred,
            uri: testNestedDocument1.deferred.$ref,
            uriDetails: URI.parse(testNestedDocument1.deferred.$ref),
            type: 'local',
            value: expectedRelativeValue.child.deferred
          },
          '#/remote/relative/child/local': {
            def: testNestedDocument1.local,
            uri: testNestedDocument1.local.$ref,
            uriDetails: URI.parse(testNestedDocument1.local.$ref),
            type: 'local',
            value: expectedRelativeValue.child.name
          },
          '#/remote/relative/child/missing': {
            def: testNestedDocument1.missing,
            uri: testNestedDocument1.missing.$ref,
            uriDetails: URI.parse(testNestedDocument1.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          },
          '#/remote/relative/deferred': {
            def: testNestedDocument.deferred,
            uri: testNestedDocument.deferred.$ref,
            uriDetails: URI.parse(testNestedDocument.deferred.$ref),
            type: 'local',
            value: expectedRelativeValue.child.deferred
          },
          '#/remote/relative/local': {
            def: testNestedDocument.local,
            uri: testNestedDocument.local.$ref,
            uriDetails: URI.parse(testNestedDocument.local.$ref),
            type: 'local',
            value: testNestedDocument.name
          },
          '#/remote/relative/missing': {
            def: testNestedDocument.missing,
            uri: testNestedDocument.missing.$ref,
            uriDetails: URI.parse(testNestedDocument.missing.$ref),
            type: 'local',
            error: new Error('JSON Pointer points to missing location: #/some/missing/path'),
            missing: true
          }
        });
      })
      .then(done, done);
    });

    it('should support options.includeInvalid', function (done) {
      JsonRefs.resolveRefs(testDocument, {
        includeInvalid: true,
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        relativeBase: relativeBase
      })
        .then(function (res) {
          var expectedAllResolvedRefs = _.cloneDeep(expectedValidResolveRefs);

          expectedAllResolvedRefs['#/invalid'] = {
            def: testDocument.invalid,
            uri: testDocument.invalid.$ref,
            uriDetails: URI.parse(testDocument.invalid.$ref),
            error: 'URI is not strictly valid.',
            type: 'invalid'
          };

          // Validate the resolved document is the same as when options.includeInvalid is false
          assert.deepEqual(res.resolved, expectedFullyResolved);

          // Validate the reference metadata includes the invalid reference details
          validateResolvedRefDetails(res.refs, expectedAllResolvedRefs);
        })
        .then(done, done);
    });
  });

  describe('#resolveRefsAt', function () {
    it('should throw an error for invalid arguments', function (done) {
      JsonRefs.resolveRefsAt({})
        .then(function () {
          throw new Error('Should had failed');
        })
        .catch(function (err) {
          assert.equal(err.message, 'location must be a string');
        })
        .then(done, done);
    });

    describe('should return the expected value', function () {
      it('with options.relativeBase', function (done) {
        JsonRefs.resolveRefsAt('./test-document.yaml', {
          loaderOptions: {
            processContent: yamlContentProcessor
          },
          relativeBase: relativeBase
        })
          .then(function (res) {
            // Validate the retrieved document
            assert.deepEqual(res.value, testDocument);

            // Validate the resolved document
            assert.deepEqual(res.resolved, expectedFullyResolved);

            // Validate the reference metadata
            validateResolvedRefDetails(res.refs, expectedValidResolveRefs);
          })
          .then(done, done);
      });

      it('without options.relativeBase', function (done) {
        JsonRefs.resolveRefsAt(path.join(relativeBase, './test-document.yaml'), {
          loaderOptions: {
            processContent: yamlContentProcessor
          }
        })
          .then(function (res) {
            // Validate the retrieved document
            assert.deepEqual(res.value, testDocument);

            // Validate the resolved document
            assert.deepEqual(res.resolved, expectedFullyResolved);

            // Validate the reference metadata
            validateResolvedRefDetails(res.refs, expectedValidResolveRefs);
          })
          .then(done, done);
      });
    });
  });
});
