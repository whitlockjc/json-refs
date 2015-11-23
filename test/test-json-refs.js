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
var JsonRefs = require('../');

describe('json-refs', function () {
  describe('#isJsonPointer', function () {
    var invalidScenarios = [
      undefined,
      1,
      ' ',
      '# ',
      'some/path',
      '#some/path',
      'http://localhost#/some/path',
      './some/path'
    ];
    var validScenarios = [
      '',
      '#',
      '/',
      '#/',
      '#/some/path',
      '/some/path'
    ];

    it('should return true for valid JSON Pointers', function () {
      _.each(validScenarios, function (scenario, index) {
        try {
          assert.ok(JsonRefs.isJsonPointer(scenario));
        } catch (err) {
          err.message = '(Test scenario ' + index + ') ' + err.message;

          throw err;
        }
      });
    });

    it('should return false for invalid JSON Pointers', function () {
      _.each(invalidScenarios, function (scenario, index) {
        try {
          assert.ok(!JsonRefs.isJsonPointer(scenario));
        } catch (err) {
          err.message = '(Test scenario ' + index + ') ' + err.message;

          throw err;
        }
      });
    });
  });

  describe('#isJsonReference', function () {
    var invalidScenarios = [
      undefined,
      1,
      {},
      {$ref: 1},
      {$ref: '/file[/].html'}
    ];
    var validScenarios = [
      '#/definitions/Person',
      '/definitions/Person',
      'someId',
      'someId#/name',
      './models.json',
      'https://rawgit.com/whitlockjc/json-refs/master/package.json',
      'https://rawgit.com/whitlockjc/json-refs/master/package.json#/name'
    ];

    it('should return true for valid JSON References', function () {
      _.each(validScenarios, function (scenario, index) {
        try {
          assert.ok(JsonRefs.isJsonReference({$ref: scenario}));
        } catch (err) {
          err.message = '(Test scenario ' + index + ') ' + err.message;

          throw err;
        }
      });
    });

    it('should return false for invalid JSON References', function () {
      _.each(invalidScenarios, function (scenario, index) {
        try {
          assert.ok(!JsonRefs.isJsonReference(scenario));
        } catch (err) {
          err.message = '(Test scenario ' + index + ') ' + err.message;

          throw err;
        }
      });
    });
  });
});
