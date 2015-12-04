/* global describe, it */

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
var testDocument = YAML.safeLoad(fs.readFileSync(path.join(__dirname, 'test-document.yaml'), 'utf-8'));

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
      try {
        if (_.isError(expected)) {
          assert.equal(err.message, expected.message);
        } else {
          throw err;
        }
      } catch (err2) {
        err2.message = '(Test scenario ' + index + ') ' + err2.message;

        throw err2;
      }
    }
  });
}

function validateRefDetails (actual, defPtr, def) {
  var uriDetails = !_.isUndefined(def.$ref) ? URI.parse(def.$ref) : undefined;
  var type = 'invalid';

  assert.deepEqual(actual.def, def);

  if (_.isUndefined(uriDetails)) {
    assert.ok(_.isUndefined(actual.uri));
    assert.ok(_.isUndefined(actual.uriDetails));
    assert.ok(_.isUndefined(actual.error));
    assert.ok(_.isUndefined(actual.warning));
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
  }
}

function runRefDetailsTestScenarios (actual, defMap) {
  assert.deepEqual(Object.keys(actual), Object.keys(defMap));

  _.each(defMap, function (def, ptr) {
    validateRefDetails(actual[ptr], ptr, def);
  });
}

describe('json-refs', function () {
  describe('#findRefs', function () {
    it('should throw an error for invalid arguments', function () {
      var ofTypeError = new TypeError('options.filter must be an Array, a Function of a String');
      var osdpTypeError = new TypeError('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
      var osdpMissingError = new Error('JSON Pointer points to missing location: #/missing');
      var objTypeError = new TypeError('obj must be an Array or an Object');
      var optionsTypeError = new TypeError('options must be an Object');

      runTestScenarios([
        [[], objTypeError],
        [['wrongType'], objTypeError],
        [[{}, 1], optionsTypeError],
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

        it('option input (no options)', function () {
          runRefDetailsTestScenarios(JsonRefs.findRefs(testDocument), {
            '#/array/0': testDocument.array[0],
            '#/array/1': testDocument.array[1],
            '#/circular/root': testDocument.circular.root,
            '#/circular/ancestor': testDocument.circular.ancestor,
            '#/definitions/Person/properties/name': testDocument.definitions.Person.properties.name,
            '#/local': testDocument.local,
            '#/remote/absolute': testDocument.remote.absolute,
            '#/remote/absolute-with-hash': testDocument.remote['absolute-with-hash'],
            '#/remote/relative': testDocument.remote.relative,
            '#/remote/relative-with-hash': testDocument.remote['relative-with-hash'],
            '#/warning': testDocument.warning
          });
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

  describe('#getRefDetails', function () {
    // #findRefs uses #getRefs and all scenarios other than the 'invalid' reference is tested
    it('should return proper reference details (invalid reference - reference like)', function () {
      validateRefDetails(JsonRefs.getRefDetails(testDocument.invalid), '#/invalid', testDocument.invalid);
    });

    it('should return proper reference details (invalid reference)', function () {
      validateRefDetails(JsonRefs.getRefDetails(testDocument.project), '#/project', testDocument.project);
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
        [['./some/path'], false]
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
        [['https://rawgit.com/whitlockjc/json-refs/master/package.json#/name'], true]
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
});
