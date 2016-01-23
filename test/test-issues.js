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

var assert = require('assert');
var JsonRefs = typeof window === 'undefined' ? require('../') : window.JsonRefs;
var URI = require('uri-js');

describe('json-refs issues', function () {
  describe('Issue #65', function () {
    it('should handle remote references with fragments replacing the whole document', function (done) {
      var uri = 'https://cdn.rawgit.com/apigee-127/swagger-tools/master/test/browser/people.json';
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
                      host: 'cdn.rawgit.com',
                      path: '/apigee-127/swagger-tools/master/test/browser/people.json',
                      port: undefined,
                      query: undefined,
                      reference: 'uri',
                      scheme: 'https',
                      userinfo: undefined
                    },
                    type: 'remote',
                    value: results.value.paths['/people/{id}']
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
});
