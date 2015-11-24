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

/**
 * Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
 * JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.
 *
 * @module JsonRefs
 */

var URI = require('uri-js');

/* Internal Functions */

function decodeSegment (seg) {
  return seg.replace(/~0/g, '~').replace(/~1/g, '/');
}

function isType (obj, type) {
  // A PhantomJS bug (https://github.com/ariya/phantomjs/issues/11722) prohibits us from using the same approach for
  // undefined checking that we use for other types.
  if (type === 'Undefined') {
    return typeof obj === 'undefined';
  } else {
    return Object.prototype.toString.call(obj) === '[object ' + type + ']';
  }
}

function encodeSegment (seg) {
  if (!isType(seg, 'String')) {
    seg = JSON.stringify(seg);
  }
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

/* Module Members */

/**
 * Returns whether the argument represents a JSON Pointer.
 *
 * A string is a JSON Pointer if the following are all true:
 *
 *   * The string is of type `String`
 *   * The string must be empty or start with a `/` or `#/`
 *
 * @param {string} ptr - The string to check
 *
 * @returns {boolean} the result of the check
 *
 * @see {@link https://tools.ietf.org/html/rfc6901#section-3}
 */
var isPtr = module.exports.isPtr = function (ptr) {
  var valid = isType(ptr, 'String');
  var firstChar;

  if (valid) {
    if (ptr !== '') {
      firstChar = ptr.charAt(0)

      if (['#', '/'].indexOf(firstChar) === -1) {
        valid = false;
      } else if (firstChar === '#' && ptr !== '#' && ptr.charAt(1) !== '/') {
        valid = false;
      }
    }
  }

  return valid;
};

/**
 * Returns whether the argument represents a JSON Reference.
 *
 * An object is a JSON Reference only if the following are all true:
 *
 *   * The object is of type `Object`
 *   * The object has a `$ref` property
 *   * The `$ref` property is a valid URI
 *
 * @param {object} obj - The object to check
 *
 * @returns {boolean} the result of the check
 *
 * @see {@link http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3}
 */
var isRef = module.exports.isRef = function (obj) {
  return isType(obj, 'Object') && isType(obj.$ref, 'String') && isType(URI.parse(obj.$ref).error, 'Undefined');
};

/**
 * Returns an array of path segments for the provided JSON Pointer.
 *
 * @param {string} ptr - The JSON Pointer
 *
 * @returns {string[]} the path segments
 *
 * @throws {Error} if the provided argument is not a JSON Pointer
 */
var pathFromPtr = module.exports.pathFromPtr = function (ptr) {
  if (!isPtr(ptr)) {
    throw new Error('ptr must be a JSON Pointer');
  }

  var segments = ptr.split('/');

  // Remove the first segment
  segments.shift();

  // Decode each segment
  segments = segments.map(decodeSegment);

  return segments;
};

/**
 * Returns a JSON Pointer for the provided array of path segments.
 *
 * **Note:** If a path segment in `path` is not a `String`, it will be converted to one using `JSON.stringify`.
 *
 * @param {string[]} path - The array of path segments
 * @param {boolean} [hashPrefix=true] - Whether or not create a hash-prefixed JSON Pointer
 *
 * @returns {string} the corresponding JSON Pointer
 *
 * @throws {Error} if the argument is not an array
 */
var pathToPtr = module.exports.pathToPtr = function (path, hashPrefix) {
  if (!isType(path, 'Array')) {
    throw new Error('path must be an Array');
  }

  // Encode each segment and return
  return (hashPrefix !== false ? '#' : '') + (path.length > 0 ? '/' : '') + path.map(encodeSegment).join('/');
};
