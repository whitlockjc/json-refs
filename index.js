/* exported findRefs, isRemotePointer, pathFromPointer, pathToPointer, resolveRefs */

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
var http = require('http');
var https = require('https');
var parseurl = require('url').parse;
var traverse = require('traverse');

/**
 * Callback used by all json-refs functions.
 *
 * @param {error} [err] - The error if there is a problem
 * @param {*} [result] - The result of the function
 *
 * @callback resultCallback
 */

/* Internal Functions */

/**
 * Retrieves the content at the URL and returns its JSON content.
 *
 * @param {string} url - The URL to retrieve
 * @param {resultCallback} done - The result callback
 *
 * @throws Error if there is a problem making the request or the content is not JSON
 */
var getRemoteJson = function getRemoteJson (url, done) {
  var options = parseurl(url);
  var transport = url.indexOf('https') > -1 ? https : http;

  options.headers = {
    'user-agent': 'whitlockjc/json-refs'
  };

  transport.get(options, function (res) {
    var body = '';

    res.on('data', function(chunk) {
      body += chunk;
    });

    res.on('end', function() {
      var err;
      var json;

      try {
        json = JSON.parse(body);
      } catch (e) {
        err = e;
      }

      done(err, json);
    });
  });
};

/* Exported Functions */

/**
 * Takes an array of path segments and creates a JSON Pointer from it.
 *
 * @see {@link http://tools.ietf.org/html/rfc6901}
 *
 * @param {string[]} path - The path segments
 *
 * @returns a JSON Pointer based on the path segments
 *
 * @throws Error if the arguments are missing or invalid
 */
var pathToPointer = module.exports.pathToPointer = function pathToPointer (path) {
  if (_.isUndefined(path)) {
    throw new Error('path is required');
  } else if (!_.isArray(path)) {
    throw new Error('path must be an array');
  }

  var ptr = '#';

  if (path.length > 0) {
    ptr += '/' + _.map(path, function (part) {
      return part.replace(/~/g, '~0').replace(/\//g, '~1');
    }).join('/');
  }

  return ptr;
};

/**
 * Find all JSON References in the document.
 *
 * @see {@link http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3}
 *
 * @param {object} json - The JSON document to find references in
 *
 * @returns an object whose keys are JSON Pointers to the '$ref' node of the JSON Reference
 *
 * @throws Error if the arguments are missing or invalid
 */
var findRefs = module.exports.findRefs = function findRefs (json) {
  if (_.isUndefined(json)) {
    throw new Error('json is required');
  } else if (!_.isPlainObject(json)) {
    throw new Error('json must be an object');
  }

  return traverse(json).reduce(function (acc) {
    var val = this.node;

    if (this.key === '$ref' && _.isString(val)) {
      acc[pathToPointer(this.path)] = val;
    }

    return acc;
  }, {});
};

/**
 * Returns whether or not the JSON Pointer is a remote reference.
 *
 * @param {string} ptr - The JSON Pointer
 *
 * @returns true if the JSON Pointer is remote or false if not
 *
 * @throws Error if the arguments are missing or invalid
 */
var isRemotePointer = module.exports.isRemotePointer = function isRemotePointer (ptr) {
  if (_.isUndefined(ptr)) {
    throw new Error('ptr is required');
  } else if (!_.isString(ptr)) {
    throw new Error('ptr must be a string');
  }

  // TODO: Update to work with relative file/path references

  return /^https?:\/\//.test(ptr);
};

/**
 * Takes a JSON Reference and returns an array of path segments.
 *
 * @see {@link http://tools.ietf.org/html/rfc6901}
 *
 * @param {string} ptr - The JSON Pointer for the JSON Reference
 *
 * @returns an array of path segments or the passed in string if it is a remote reference
 *
 * @throws Error if the arguments are missing or invalid
 */
var pathFromPointer = module.exports.pathFromPointer = function pathFromPointer (ptr) {
  if (_.isUndefined(ptr)) {
    throw new Error('ptr is required');
  } else if (!_.isString(ptr)) {
    throw new Error('ptr must be a string');
  }

  var path = [];

  if (isRemotePointer(ptr)) {
    path = ptr;
  } else {
    if (ptr.charAt(0) === '#' && ptr !== '#') {
      path = _.map(ptr.substring(1).split('/'), function (part) {
        return part.replace(/~0/g, '~').replace(/~1/g, '/');
      });

      // '/' by itself corresponds to [''] otherwise, remove the first entry
      if (path.length > 1) {
        path.shift();
      }
    }
  }

  return path;
};

/**
 * Takes a JSON document, resolves all JSON References and returns a fully resolved equivalent.
 *
 * If the document has no JSON References, the passed in document is returned untouched.  If there are references to be
 * resolved, the returned document is cloned and returned fully resolved.  The original document is untouched.
 *
 * @param {object} json - The JSON  document having zero or more JSON References
 * @param {resultCallback} done - The result callback
 *
 * @throws Error if the arguments are missing or invalid
 */
var resolveRefs = module.exports.resolveRefs = function resolveRefs (json, done) {
  if (_.isUndefined(json)) {
    throw new Error('json is required');
  } else if (!_.isPlainObject(json)) {
    throw new Error('json must be an object');
  } else if (_.isUndefined(done)) {
    throw new Error('done is required');
  } else if (!_.isFunction(done)) {
    throw new Error('done must be a function');
  }

  var isAsync = false;
  var refs = findRefs(json);
  var removeCircular = function removeCircular (jsonT) {
    // Remove circular references
    return jsonT.map(function () {
      if (this.circular) {
        // Always traverse one depth after recognizing a circular dependency
        this.update(traverse(this.node).map(function() {
          if (this.circular) {
            this.parent.remove();
          }
        }));
      }
    });
  };
  var cJsonT;

  if (Object.keys(refs).length > 0) {
    cJsonT = traverse(_.cloneDeep(json)); // Clone the input JSON to avoid altering it

    _.each(refs, function (ref, refPtr) {
      var refPath = pathFromPointer(refPtr);
      var parentPath = refPath.slice(0, refPath.length - 1);

      if (isRemotePointer(ref)) {
        isAsync = true;

        getRemoteJson(ref, function (err, json) {
          if (err) {
            done(err);
          } else {
            resolveRefs(json, function (err, json) {
              if (err) {
                done(err);
              } else {
                if (parentPath.length === 0) {
                  cJsonT.value = json;
                } else {
                  cJsonT.set(parentPath, traverse(json).get(pathFromPointer(parseurl(ref).hash || '#')));
                }

                done(undefined, removeCircular(cJsonT));
              }
            });
          }
        });
      } else {
        if (parentPath.length === 0) {
          cJsonT.value = json;
        } else {
          cJsonT.set(parentPath, cJsonT.get(pathFromPointer(ref)));
        }
      }
    });

    if (!isAsync) {
      done(undefined, removeCircular(cJsonT));
    }
  } else {
    done(undefined, json);
  }
};
