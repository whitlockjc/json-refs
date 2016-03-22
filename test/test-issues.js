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
var JsonRefs = typeof window === 'undefined' ? require('../') : window.JsonRefs;
var path = require('path');
var URI = require('uri-js');
var YAML = require('js-yaml');

var documentBase = path.join(__dirname, 'browser', 'documents');
var relativeBase = typeof window === 'undefined' ? documentBase : 'base/documents';
var personDocument = require('./browser/documents/{id}/person.json');

describe('json-refs Issues', function () {
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
      JsonRefs.resolveRefsAt('../documents/test-document.yaml', {
        loaderOptions: {
          processContent: function (res, callback) {
            callback(undefined, YAML.safeLoad(res.text));
          }
        },
        relativeBase: relativeBase
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

    describe('remote references', function () {
      it('should handle references with unescaped URI characters', function (done) {
        var doc = {
          $ref: './{id}/person.json'
        };

        JsonRefs.resolveRefs(doc, {
          relativeBase: relativeBase
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
                    path: './%7Bid%7D/person.json',
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
          relativeBase: relativeBase
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
                    path: './%7Bid%7D/person.json',
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

  describe('Issue #77', function () {
    it('combined URI\'s should handle windows pathing correctly', function (done) {
      JsonRefs.resolveRefsAt('../documents/test-document.yaml', {
        loaderOptions: {
          processContent: function (res, callback) {
            callback(undefined, YAML.safeLoad(res.text));
          }
        },
        relativeBase: relativeBase
      })
        .then(function (results) {
          assert.notEqual(results.refs['#/remote/relative'].missing, true);
        })
        .then(done, done);
    });
  });
});
