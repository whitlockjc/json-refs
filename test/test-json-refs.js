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
var fs = require('fs');
var JsonRefs = typeof window === 'undefined' ? require('../') : window.JsonRefs;
var path = require('path');
var URI = require('uri-js');
var YAML = require('js-yaml');

var ofTypeError = new TypeError('options.filter must be an Array, a Function of a String');
var osdpTypeError = new TypeError('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
var osdpMissingError = new Error('options.subDocPath points to missing location: #/missing');
var objTypeError = new TypeError('obj must be an Array or an Object');
var optionsTypeError = new TypeError('options must be an Object');
var testDocumentLocation = path.join(typeof window === 'undefined' ?
                                       path.join(__dirname, 'browser', 'documents') :
                                       'base/documents',
                                     'test-document.yaml');
// These variables do not use documentBase because doing so breaks browserify's brfs transform
var personDocument = require('./browser/documents/{id}/person.json');
var testDocument = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'test-document.yaml'),
                                                 'utf-8'));
var testDocument1 = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'test-document-1.yaml'),
                                                  'utf-8'));
var testDocumentSame = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'test-document-same.yaml'),
                                                     'utf-8'));
var testNestedDocument = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'nested',
                                                                 'test-nested.yaml'), 'utf-8'));
var testNestedDocument1 = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'nested',
                                                                  'test-nested-1.yaml'), 'utf-8'));
var testTypesDocument = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'browser', 'documents', 'test-types.yaml'),
                                                      'utf-8'));

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
    assert.equal(actual.error, 'HTTP URIs must have a host.');
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

describe('json-refs API', function () {
  var expectedPersonValue = {
    type: 'object',
    properties: {
      addresses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            city: testTypesDocument.definitions.String,
            name: testTypesDocument.definitions.String,
            state: testTypesDocument.definitions.String,
            street: {
              type: 'array',
              items: testTypesDocument.definitions.String
            }
          }
        }
      },
      age: testTypesDocument.definitions.Integer,
      family: {
        type: 'array',
        items: {
          $ref: '#/definitions/Person'
        }
      },
      name: testTypesDocument.definitions.String
    }
  };
  var expectedRelativeValue = {
    name: testNestedDocument.name,
    child: {
      name: testNestedDocument1.name,
      ancestor: {
        name: testDocument1.name,
        nested: testDocument1.nested,
        local: testDocument1.name,
        missing: testDocument1.missing
      },
      local: testNestedDocument1.name,
      missing: testNestedDocument1.missing
    },
    local: testNestedDocument.name,
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
          '#/warning': {
            def: testDocument.warning,
            uri: testDocument.warning.$ref,
            uriDetails: URI.parse(testDocument.warning.$ref),
            type: 'local',
            value: testDocument.project.name,
            warning: 'Extra JSON Reference properties will be ignored: ignored'
          },
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
          '#/circular/ancestor': {
            def: testDocument.circular.ancestor,
            uri: testDocument.circular.ancestor.$ref,
            uriDetails: URI.parse(testDocument.circular.ancestor.$ref),
            type: 'local',
            circular: true,
            value: testDocument.circular.ancestor
          },
          '#/circular/root': {
            def: testDocument.circular.root,
            uri: testDocument.circular.root.$ref,
            uriDetails: URI.parse(testDocument.circular.root.$ref),
            type: 'local',
            circular: true,
            value: testDocument.circular.root
          },
          '#/circular/User/properties/status': {
            def: testDocument.circular.User.properties.status,
            uri: testDocument.circular.User.properties.status.$ref,
            uriDetails: URI.parse(testDocument.circular.User.properties.status.$ref),
            type: 'local',
            circular: true,
            value: testDocument.circular.User.properties.status
          },
          '#/circular/Status/properties/user': {
            def: testDocument.circular.Status.properties.user,
            uri: testDocument.circular.Status.properties.user.$ref,
            uriDetails: URI.parse(testDocument.circular.Status.properties.user.$ref),
            type: 'local',
            circular: true,
            value: testDocument.circular.Status.properties.user
          },
          '#/circular/Status/properties/message': {
            def: testDocument.circular.Status.properties.message,
            uri: testDocument.circular.Status.properties.message.$ref,
            uriDetails: URI.parse(testDocument.circular.Status.properties.message.$ref),
            type: 'local',
            circular: true,
            value: testDocument.circular.Status.properties.message
          },
          '#/circular/Message/properties/author': {
            def: testDocument.circular.Message.properties.author,
            uri: testDocument.circular.Message.properties.author.$ref,
            uriDetails: URI.parse(testDocument.circular.Message.properties.author.$ref),
            type: 'local',
            circular: true,
            value: testDocument.circular.Message.properties.author
          },
          '#/circular/StatusWrapper/properties/status': {
            def: testDocument.circular.StatusWrapper.properties.status,
            uri: testDocument.circular.StatusWrapper.properties.status.$ref,
            uriDetails: URI.parse(testDocument.circular.StatusWrapper.properties.status.$ref),
            type: 'local',
            value: testDocument.circular.Status
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
          },
          '#/remote/relative-missing': {
            def: testDocument.remote['relative-missing'],
            uri: testDocument.remote['relative-missing'].$ref,
            uriDetails: URI.parse(testDocument.remote['relative-missing'].$ref),
            type: 'relative',
            error: new Error('JSON Pointer points to missing location: ./missing.yaml'),
            missing: true
          },
          '#/remote/relative-with-hash': {
            def: testDocument.remote['relative-with-hash'],
            uri: testDocument.remote['relative-with-hash'].$ref,
            uriDetails: URI.parse(testDocument.remote['relative-with-hash'].$ref),
            type: 'relative',
            value: testNestedDocument.name
          },
          '#/remote/relative-with-hash2': {
            def: testDocument.remote['relative-with-hash2'],
            uri: testDocument.remote['relative-with-hash2'].$ref,
            uriDetails: URI.parse(testDocument.remote['relative-with-hash2'].$ref),
            type: 'relative',
            value: expectedPersonValue
          },
          '#/remote/relative-with-hash3': {
            def: testDocument.remote['relative-with-hash3'],
            uri: testDocument.remote['relative-with-hash3'].$ref,
            uriDetails: URI.parse(testDocument.remote['relative-with-hash3'].$ref),
            type: 'relative',
            error: new Error('JSON Pointer points to missing location: ./test-types.yaml#/missing'),
            missing: true
          },
          '#/remote/relative/child': {
            def: testNestedDocument.child,
            uri: testNestedDocument.child.$ref,
            uriDetails: URI.parse(testNestedDocument.child.$ref),
            type: 'relative',
            value: expectedRelativeValue.child,
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
          '#/definitions/Person/properties/name': {
            def: testDocument.definitions.Person.properties.name,
            uri: testDocument.definitions.Person.properties.name.$ref,
            uriDetails: URI.parse(testDocument.definitions.Person.properties.name.$ref),
            type: 'local',
            value: testDocument.definitions.HumanName
          },
          '#/remote/relative/child/ancestor': {
            def: testNestedDocument1.ancestor,
            uri: testNestedDocument1.ancestor.$ref,
            uriDetails: URI.parse(testNestedDocument1.ancestor.$ref),
            type: 'relative',
            value: expectedRelativeValue.child.ancestor,
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
            value: testDocument1.nested,
            circular: true
          },
          '#/remote/relative-with-hash2/properties/age': {
            def: testTypesDocument.definitions.Person.properties.age,
            uri: testTypesDocument.definitions.Person.properties.age.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Person.properties.age.$ref),
            type: 'local',
            value: expectedPersonValue.properties.age
          },
          '#/remote/relative-with-hash2/properties/name': {
            def: testTypesDocument.definitions.Person.properties.name,
            uri: testTypesDocument.definitions.Person.properties.name.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Person.properties.name.$ref),
            type: 'local',
            value: expectedPersonValue.properties.name
          },
          '#/remote/relative-with-hash2/properties/addresses/items': {
            def: testTypesDocument.definitions.Person.properties.addresses.items,
            uri: testTypesDocument.definitions.Person.properties.addresses.items.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Person.properties.addresses.items.$ref),
            type: 'local',
            value: expectedPersonValue.properties.addresses.items
          },
          '#/remote/relative-with-hash2/properties/addresses/items/properties/name': {
            def: testTypesDocument.definitions.Address.properties.name,
            uri: testTypesDocument.definitions.Address.properties.name.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Address.properties.name.$ref),
            type: 'local',
            value: expectedPersonValue.properties.addresses.items.properties.name
          },
          '#/remote/relative-with-hash2/properties/addresses/items/properties/street/items': {
            def: testTypesDocument.definitions.Address.properties.street.items,
            uri: testTypesDocument.definitions.Address.properties.street.items.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Address.properties.street.items.$ref),
            type: 'local',
            value: expectedPersonValue.properties.addresses.items.properties.street.items
          },
          '#/remote/relative-with-hash2/properties/addresses/items/properties/city': {
            def: testTypesDocument.definitions.Address.properties.city,
            uri: testTypesDocument.definitions.Address.properties.city.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Address.properties.city.$ref),
            type: 'local',
            value: expectedPersonValue.properties.addresses.items.properties.city
          },
          '#/remote/relative-with-hash2/properties/addresses/items/properties/state': {
            def: testTypesDocument.definitions.Address.properties.state,
            uri: testTypesDocument.definitions.Address.properties.state.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Address.properties.state.$ref),
            type: 'local',
            value: expectedPersonValue.properties.addresses.items.properties.state
          },
          '#/remote/relative-with-hash2/properties/family/items': {
            def: testTypesDocument.definitions.Person.properties.family.items,
            uri: testTypesDocument.definitions.Person.properties.family.items.$ref,
            uriDetails: URI.parse(testTypesDocument.definitions.Person.properties.family.items.$ref),
            type: 'local',
            value: expectedPersonValue.properties.family.items,
            circular: true
          }
        };
        expectedFullyResolved = {
          project: testDocument.project,
          array: [
            testDocument.project.name,
            testDocument.project.description
          ],
          circular: {
            root: testDocument.circular.root,
            ancestor: testDocument.circular.ancestor,
            User: testDocument.circular.User,
            Status: testDocument.circular.Status,
            Message: testDocument.circular.Message,
            StatusWrapper: {
              type: 'object',
              properties: {
                status: testDocument.circular.Status
              }
            }
          },
          definitions: {
            HumanName: testDocument.definitions.HumanName,
            Person: {
              type: 'object',
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
            'relative-missing': testDocument.remote['relative-missing'],
            'relative-with-hash': testNestedDocument.name,
            'relative-with-hash2': {
              type: 'object',
              properties: {
                addresses: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: testTypesDocument.definitions.String,
                      street: {
                        type: 'array',
                        items: testTypesDocument.definitions.String
                      },
                      city: testTypesDocument.definitions.String,
                      state: testTypesDocument.definitions.String
                    }
                  }
                },
                name: testTypesDocument.definitions.String,
                age: testTypesDocument.definitions.Integer,
                family: {
                  type: 'array',
                  items: testTypesDocument.definitions.Person.properties.family.items
                }
              }
            },
            'relative-with-hash3': testDocument.remote['relative-with-hash3']
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
      '#/circular/User/properties/status': testDocument.circular.User.properties.status,
      '#/circular/Status/properties/user': testDocument.circular.Status.properties.user,
      '#/circular/Status/properties/message': testDocument.circular.Status.properties.message,
      '#/circular/Message/properties/author': testDocument.circular.Message.properties.author,
      '#/circular/StatusWrapper/properties/status': testDocument.circular.StatusWrapper.properties.status,
      '#/definitions/Person/properties/name': testDocument.definitions.Person.properties.name,
      '#/invalid': testDocument.invalid,
      '#/local': testDocument.local,
      '#/missing': testDocument.missing,
      '#/remote/absolute': testDocument.remote.absolute,
      '#/remote/absolute-with-hash': testDocument.remote['absolute-with-hash'],
      '#/remote/relative': testDocument.remote.relative,
      '#/remote/relative-missing': testDocument.remote['relative-missing'],
      '#/remote/relative-with-hash': testDocument.remote['relative-with-hash'],
      '#/remote/relative-with-hash2': testDocument.remote['relative-with-hash2'],
      '#/remote/relative-with-hash3': testDocument.remote['relative-with-hash3'],
      '#/warning': testDocument.warning
    };

    it('should throw an error for invalid arguments', function () {
      runTestScenarios([
        [[], objTypeError],
        [['wrongType'], objTypeError],
        [[{}, 1], optionsTypeError],
        [[{}, {includeInvalid: 'wrongType'}], new TypeError('options.includeInvalid must be a Boolean')],
        [[{}, {location: false}], new TypeError('options.location must be a String')],
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
            '#/remote/relative-missing',
            '#/remote/relative-with-hash',
            '#/remote/relative-with-hash2',
            '#/remote/relative-with-hash3'
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
            '#/remote/relative-missing',
            '#/remote/relative-with-hash',
            '#/remote/relative-with-hash2',
            '#/remote/relative-with-hash3'
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
            $ref: 'http://:8080'
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

      it('options.refPostProcessor', function () {
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
      JsonRefs.findRefsAt(testDocumentLocation, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
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

    it('should handle a valid location with a fragment', function (done) {
      JsonRefs.findRefsAt(testDocumentLocation + '#/array', {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
      })
        .then(function (res) {
          assert.deepEqual(res, {
            refs: JsonRefs.findRefs(testDocument, {subDocPath: ['array']}),
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
        [[{$ref: 'http://:8080'}], false]
      ], JsonRefs.isRef);
    });
  });

  describe('#pathFromPtr', function () {
    it('should return the expected value', function () {
      runTestScenarios([
        [[undefined], new Error('ptr must be a JSON Pointer: ptr is not a String')],
        [['./some/path'], new Error('ptr must be a JSON Pointer: ptr must start with a / or #/')],
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
      var cDoc = _.cloneDeep(doc);

      JsonRefs.resolveRefs(doc, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
      })
        .then(function (res) {
          var refDetails;

          // Make sure the original document is unchanged
          assert.deepEqual(cDoc, doc);

          // Make sure there is no error thrown and that the reference details are accurate
          assert.equal(Object.keys(res.refs).length, 1);

          refDetails = res.refs['#'];

          assert.deepEqual(refDetails.def, doc);
          assert.equal(refDetails.uri, doc.$ref);
          assert.deepEqual(refDetails.uriDetails, URI.parse(doc.$ref));
          assert.equal(refDetails.type, 'relative');
          assert.ok(refDetails.missing);
          assert.equal(refDetails.error, 'JSON Pointer points to missing location: fake.json');
        })
        .then(done, done);
    });

    it('should return the expected value', function (done) {
      var cDoc = _.cloneDeep(testDocument);

      JsonRefs.resolveRefs(testDocument, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        location: testDocumentLocation
      })
        .then(function (res) {
          // Make sure the original document is unchanged
          assert.deepEqual(cDoc, testDocument);

          // Validate the resolved document
          assert.deepEqual(res.resolved, expectedFullyResolved);

          // Validate the reference metadata
          validateResolvedRefDetails(res.refs, expectedValidResolveRefs);
        })
        .then(done, done);
    });

    it('should handle definition contains the same name as its own', function (done) {
      JsonRefs.resolveRefs(testDocumentSame)
      .then(function (res) {
        assert.deepEqual(
          res.resolved.definitions.SameNameContain.properties.name,
          testDocumentSame.definitions.SameName
        );
      })
      .then(done, done);
    });

    it('should support options.filter', function (done) {
      JsonRefs.resolveRefs(testDocument, {
        filter: ['relative', 'remote'],
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        location: testDocumentLocation
      }).then(function (res) {
        var rootRefs = JsonRefs.findRefs(testDocument);

        _.each(rootRefs, function (refDetails, refPtr) {
          var ptrPath = JsonRefs.pathFromPtr(refPtr);

          if (['relative', 'remote'].indexOf(refDetails.type) > -1) {
            assert.ok(!_.isUndefined(res.refs[refPtr]));
            assert.deepEqual(_.get(res.resolved, ptrPath), _.get(expectedFullyResolved, ptrPath));
          } else {
            assert.ok(_.isUndefined(res.refs[refPtr]));
            assert.deepEqual(_.get(res.resolved, ptrPath), _.get(testDocument, ptrPath));
          }
        });
      })
      .then(done, done);
    });

    describe('should support options.resolveCirculars', function () {
      it('invalid type', function (done) {
        JsonRefs.resolveRefs({}, {resolveCirculars: 'nope'})
          .then(function () {
            throw new Error('Should had failed');
          })
          .catch(function (err) {
            assert.equal(err.message, 'options.resolveCirculars must be a Boolean');
          })
          .then(done, done);
      });

      it('valid value', function (done) {
        JsonRefs.resolveRefs(testDocument, {
          resolveCirculars: true,
          loaderOptions: {
            processContent: yamlContentProcessor
          },
          location: testDocumentLocation
        })
          .then(function (res) {
            var circularPtrs = {
              '#/circular/ancestor': res.resolved.circular,
              '#/circular/root': res.resolved,
              '#/circular/User/properties/status': res.resolved.circular.Status,
              '#/circular/Status/properties/user': res.resolved.circular.User,
              '#/circular/Status/properties/message': res.resolved.circular.Message,
              '#/circular/Message/properties/author': res.resolved.circular.User,
              '#/circular/StatusWrapper/properties/status': res.resolved.circular.Status,
              '#/remote/relative/child/ancestor/nested': res.resolved.remote.relative,
              '#/remote/relative-with-hash2/properties/family/items': res.resolved.remote['relative-with-hash2']
            };

            _.each(circularPtrs, function (circularValue, circularPtr) {
              // Validate resolved value
              assert.deepEqual(_.get(res.resolved, JsonRefs.pathFromPtr(circularPtr)), circularValue);
              // validate the reference metadata value
              assert.deepEqual(res.refs[circularPtr].value, circularValue);
            });
          })
          .then(done, done);
      });
    });

    it('should support options.subDocPath', function (done) {
      JsonRefs.resolveRefs(testDocument, {
        loaderOptions: {
          processContent: yamlContentProcessor
        },
        location: testDocumentLocation,
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
              'relative-missing': testDocument.remote['relative-missing'],
              'relative-with-hash': testDocument.remote['relative-with-hash'],
              'relative-with-hash2': testDocument.remote['relative-with-hash2'],
              'relative-with-hash3': testDocument.remote['relative-with-hash3']
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
                missing: testNestedDocument.missing
              },
            },
            '#/remote/relative/child': {
              def: testNestedDocument.child,
              uri: testNestedDocument.child.$ref,
              uriDetails: URI.parse(testNestedDocument.child.$ref),
              type: 'relative',
              value: expectedRelativeValue.child,
            },
            '#/remote/relative/child/ancestor': {
              def: testNestedDocument1.ancestor,
              uri: testNestedDocument1.ancestor.$ref,
              uriDetails: URI.parse(testNestedDocument1.ancestor.$ref),
              type: 'relative',
              value: expectedRelativeValue.child.ancestor,
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
              value: testDocument1.nested,
              circular: true
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
        location: testDocumentLocation
      })
        .then(function (res) {
          var expectedAllResolvedRefs = _.cloneDeep(expectedValidResolveRefs);

          expectedAllResolvedRefs['#/invalid'] = {
            def: testDocument.invalid,
            uri: testDocument.invalid.$ref,
            uriDetails: URI.parse(testDocument.invalid.$ref),
            error: 'HTTP URIs must have a host.',
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
    it('should return an error for an invalid location values', function (done) {
      JsonRefs.resolveRefsAt({})
        .then(function () {
          throw new Error('Should had failed');
        })
        .catch(function (err) {
          assert.equal(err.message, 'location must be a string');
        })
        .then(done, done);
    });

    it('should handle a location to a missing resource', function (done) {
      var location = typeof window === 'undefined' ?
        './missing.json' :
        'https://rawgit.com/whitlockjc/json-refs/master/missing.json';

      JsonRefs.resolveRefsAt(location)
        .then(function () {
          throw new Error('JsonRefs.resolveRefsAt should had failed');
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
      JsonRefs.resolveRefsAt(testDocumentLocation, {
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

    it('should handle a valid location with a fragment', function (done) {
      JsonRefs.resolveRefsAt(testDocumentLocation + '#/array', {
        loaderOptions: {
          processContent: yamlContentProcessor
        }
      })
        .then(function (res) {
          var expectedResolved = _.cloneDeep(testDocument);

          expectedResolved.array[0] = expectedResolved.project.name;
          expectedResolved.array[1] = expectedResolved.project.description;

          // Validate the retrieved document
          assert.deepEqual(res.value, testDocument);

          // Validate the resolved document
          assert.deepEqual(res.resolved, expectedResolved);

          // Validate the reference metadata
          validateResolvedRefDetails(res.refs, {
            '#/array/0': expectedValidResolveRefs['#/array/0'],
            '#/array/1': expectedValidResolveRefs['#/array/1'],
          });
        })
        .then(done, done);
    });
  });

  describe('Issue #73', function () {
    it('should not create extra references', function (done) {
      JsonRefs.resolveRefs({
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
          C: {}
        }
      })
        .then(function (results) {
          assert.equal(Object.keys(results.refs).length, 2);
        })
        .then(done, done);
    });
  });

  describe('Issue #72', function () {
    it('should fully resolve swagger-tools/samples/2.0/petstore.json', function (done) {
      JsonRefs.resolveRefsAt('https://rawgit.com/apigee-127/swagger-tools/master/samples/2.0/petstore.json')
        .then(function (results) {
          assert.equal(Object.keys(JsonRefs.findRefs(results.resolved)).length, 0);
        })
        .then(done, done);
    });
  });

  describe('Issue #67', function () {
    it('should handle relative locations for #findRefsAt and #resolveRefsAt', function (done) {
      JsonRefs.resolveRefsAt('../' + path.relative(path.dirname(process.cwd()),
                                                   testDocumentLocation), {
        loaderOptions: {
          processContent: function (res, callback) {
            callback(undefined, YAML.safeLoad(res.text));
          }
        },
        location: testDocumentLocation
      })
        .then(function (results) {
          // Make sure there are no unresolvable references except the expected ones
          _.each(results, function (refDetails, refPtr) {
            var expectedMissing = [
              '#/missing',
              '#/remote/relative/missing',
              '#/remote/relative/child/missing',
              '#/remote/relative/child/ancestor/missing'
            ];

            if (expectedMissing.indexOf(refPtr) === -1) {
              assert.ok(!_.has(refDetails.missing));
            }
          });
        })
        .then(done, done);
    });
  });

  describe('Issue #65', function () {
    it('should handle remote references with fragments replacing the whole document', function (done) {
      var uri = 'https://rawgit.com/apigee-127/swagger-tools/master/test/browser/people.json';
      var doc = {
        $ref: uri + '#/paths/~1people~1{id}'
      };

      JsonRefs.resolveRefsAt(uri)
        .then(function (results) {
          return JsonRefs.resolveRefs(doc)
            .then(function (results2) {
              assert.deepEqual(results2, {
                refs: {
                  '#': {
                    def: doc,
                    uri: doc.$ref,
                    uriDetails: {
                      fragment: '/paths/~1people~1%7Bid%7D',
                      host: 'rawgit.com',
                      path: '/apigee-127/swagger-tools/master/test/browser/people.json',
                      port: undefined,
                      query: undefined,
                      reference: 'uri',
                      scheme: 'https',
                      userinfo: undefined
                    },
                    type: 'remote',
                    value: results.value.paths['/people/{id}']
                  },
                  '#/delete/responses/default/schema': {
                    def: results.value.paths['/people/{id}'].delete.responses.default.schema,
                    uri: results.value.paths['/people/{id}'].delete.responses.default.schema.$ref,
                    uriDetails: {
                      fragment: '/definitions/Error',
                      host: undefined,
                      path: '',
                      port: undefined,
                      query: undefined,
                      reference: 'same-document',
                      scheme: undefined,
                      userinfo: undefined
                    },
                    type: 'local',
                    error: 'JSON Pointer points to missing location: #/definitions/Error',
                    missing: true
                  },
                  '#/get/responses/200/schema': {
                    def: results.value.paths['/people/{id}'].get.responses['200'].schema,
                    uri: results.value.paths['/people/{id}'].get.responses['200'].schema.$ref,
                    uriDetails: {
                      fragment: '/definitions/Pet',
                      host: undefined,
                      path: '',
                      port: undefined,
                      query: undefined,
                      reference: 'same-document',
                      scheme: undefined,
                      userinfo: undefined
                    },
                    type: 'local',
                    error: 'JSON Pointer points to missing location: #/definitions/Pet',
                    missing: true
                  },
                  '#/get/responses/default/schema': {
                    def: results.value.paths['/people/{id}'].get.responses.default.schema,
                    uri: results.value.paths['/people/{id}'].get.responses.default.schema.$ref,
                    uriDetails: {
                      fragment: '/definitions/Error',
                      host: undefined,
                      path: '',
                      port: undefined,
                      query: undefined,
                      reference: 'same-document',
                      scheme: undefined,
                      userinfo: undefined
                    },
                    type: 'local',
                    error: 'JSON Pointer points to missing location: #/definitions/Error',
                    missing: true
                  }
                },
                resolved: results.resolved.paths['/people/{id}']
              });
            });
        })
        .then(done, done);
    });
  });

  describe('Issue #63', function () {
    it('should handle options.filter and options.includeInvalid combination', function () {
      var doc = {
        $ref: 'http://:8080'
      };

      assert.deepEqual(JsonRefs.findRefs(doc, {filter: 'remote', includeInvalid: true}), {
        '#': {
          def: doc,
          uri: doc.$ref,
          uriDetails: URI.parse(doc.$ref),
          type: 'invalid',
          error: 'HTTP URIs must have a host.'
        }
      });
    });
  });

  describe('Issue #61', function () {
    describe('local references', function () {
      it('should handle references with unescaped URI characters', function (done) {
        var refURI = '#/~1some~1{id}~1hello there';
        var doc = {
          '/some/{id}/hello there': 'hello',
          'ref': {
            $ref: refURI
          }
        };

        JsonRefs.resolveRefs(doc)
          .then(function (results) {
            var refDetails = results.refs['#/ref'];

            assert.equal(Object.keys(results.refs).length, 1);
            assert.deepEqual(refDetails, {
              def: doc.ref,
              uri: refURI,
              uriDetails: {
                scheme: undefined,
                userinfo: undefined,
                host: undefined,
                port: undefined,
                path: '',
                query: undefined,
                fragment: '/~1some~1%7Bid%7D~1hello%20there',
                reference: 'same-document'
              },
              type: 'local',
              value: 'hello'
            });
          })
          .then(done, done);
      });

      it('should handle references with escaped URI characters', function (done) {
        var refURI = encodeURI('#/~1some~1{id}~1hello there/some nested path');
        var doc = {
          '/some/{id}/hello there': {
            'some nested path': 'hello'
          },
          'ref': {
            $ref: refURI
          }
        };

        JsonRefs.resolveRefs(doc, {
          location: path.join(path.dirname(testDocumentLocation), 'root.json')
        })
          .then(function (results) {
            var refDetails = results.refs['#/ref'];

            assert.equal(Object.keys(results.refs).length, 1);
            assert.deepEqual(refDetails, {
              def: doc.ref,
              uri: refURI,
              uriDetails: {
                scheme: undefined,
                userinfo: undefined,
                host: undefined,
                port: undefined,
                path: '',
                query: undefined,
                fragment: '/~1some~1%7Bid%7D~1hello%20there/some%20nested%20path',
                reference: 'same-document'
              },
              type: 'local',
              value: 'hello'
            });
          })
          .then(done, done);
      });
    });

    describe('remote references', function () {
      it('should handle references with unescaped URI characters', function (done) {
        var relativePath = './{id}/person.json';
        var doc = {
          $ref: relativePath
        };

        JsonRefs.resolveRefs(doc, {
          location: path.join(path.dirname(testDocumentLocation), 'root.json')
        })
          .then(function (results) {
            assert.deepEqual(results, {
              refs: {
                '#': {
                  def: doc,
                  uri: doc.$ref,
                  uriDetails: {
                    scheme: undefined,
                    userinfo: undefined,
                    host: undefined,
                    port: undefined,
                    path: encodeURI(relativePath),
                    query: undefined,
                    fragment: undefined,
                    reference: 'relative'
                  },
                  type: 'relative',
                  value: personDocument
                }
              },
              resolved: personDocument
            });
          })
          .then(done, done);
      });

      it('should handle references with escaped URI characters', function (done) {
        var doc = {
          ref: {
            $ref: encodeURI('./{id}/person.json')
          }
        };

        JsonRefs.resolveRefs(doc, {
          location: path.join(path.dirname(testDocumentLocation), 'root.json')
        })
          .then(function (results) {
            assert.deepEqual(results, {
              refs: {
                '#/ref': {
                  def: doc.ref,
                  uri: doc.ref.$ref,
                  uriDetails: {
                    scheme: undefined,
                    userinfo: undefined,
                    host: undefined,
                    port: undefined,
                    path: doc.ref.$ref,
                    query: undefined,
                    fragment: undefined,
                    reference: 'relative'
                  },
                  type: 'relative',
                  value: personDocument
                }
              },
              resolved: {
                ref: personDocument
              }
            });
          })
          .then(done, done);
      });
    });
  });
});
