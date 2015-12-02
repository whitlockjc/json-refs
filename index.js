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

function findAncestors (obj, path) {
  var ancestors = [];
  var node = obj;

  path.slice(0, path.length - 1).forEach(function (seg) {
    if (seg in node) {
      node = node[seg];

      ancestors.push(node);
    }
  });

  return ancestors;
}

function findValue (obj, path) {
  var value = obj;

  path.forEach(function (seg) {
    if (seg in value) {
      value = value[seg];
    } else {
      throw Error('JSON Pointer points to missing location: ' + pathToPtr(path));
    }
  });

  return value;
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

function refHasExtraKeys (ref) {
  return Object.keys(ref).reduce(function (extras, key) {
    if (key !== '$ref') {
      extras.push(key);
    }

    return extras;
  }, []).length > 0;
}

function walk (ancestors, node, path, fn) {
  var processChildren = true;

  function walkItem (item, segment) {
    path.push(segment);
    walk(ancestors, item, path, fn);
    path.pop();
  }

  // Call the iteratee
  if (isType(fn, 'Function')) {
    processChildren = fn(ancestors, node, path);
  }

  // We do not process circular objects again
  if (ancestors.indexOf(node) === -1) {
    ancestors.push(node);

    if (processChildren !== false) {
      if (isType(node, 'Array')) {
        node.forEach(function (member, index) {
          walkItem(member, index.toString());
        });
      } else if (isType(node, 'Object')) {
        Object.keys(node).forEach(function (key) {
          walkItem(node[key], key);
        });
      }
    }
  }

  ancestors.pop();
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
      firstChar = ptr.charAt(0);

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

/**
 * Finds JSON References defined within the provided array/object.
 *
 * @param {array|object} obj - The structure to find JSON References within
 * @param {object} [options={}] - The options to use when finding references
 * @param {string|string[]} [options.subDocPath=[]] - The JSON Pointer or array of path segments to the sub document
 * location to search from
 *
 * @returns {object} an object whose keys are JSON Pointers (fragment version) to where the JSON Reference is defined
 * and whose values are the JSON Reference definition.
 *
 * @throws {Error} if `from` is not a valid JSON Pointer
 */
module.exports.findRefs = function (obj, options) {
  var ancestors = [];
  var fromObj = obj;
  var fromPath = [];
  var refs = {};

  // Validate the provided document
  if (!isType(obj, 'Array') && !isType(obj, 'Object')) {
    throw new TypeError('obj must be an Array or an Object');
  }

  // Validate the provided options
  if (!isType(options, 'Undefined') && !isType(options, 'Object')) {
    throw new TypeError('options must be an Object');
  }

  // Set default for options
  if (isType(options, 'Undefined')) {
    options = {
      subDocPath: []
    };
  } else if (isType(options.subDocPath, 'Undefined')) {
    options.subDocPath = [];
  }

  // Validate the options values
  if (!isType(options.subDocPath, 'Array') && !isPtr(options.subDocPath)) {
    // If a pointer is provided, throw an error if it's not the proper type
    throw new Error('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
  }

  // Convert from to a pointer
  if (isType(options.subDocPath, 'String')) {
    fromPath = pathFromPtr(options.subDocPath);
  } else {
    fromPath = options.subDocPath;
  }

  if (fromPath.length > 0) {
    ancestors = findAncestors(obj, fromPath);
    fromObj = findValue(obj, fromPath);
  }

  // Walk the document (or sub document) and find all JSON References
  walk(ancestors, fromObj, fromPath, function (ancestors, node, path) {
    var processChildren = true;

    if (isRef(node)) {
      refs[pathToPtr(path)] = node;

      // Whenever a JSON Reference has extra children, its children should be ignored so we want to stop processing.
      //   See: http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3
      if (refHasExtraKeys(node)) {
        processChildren = false;
      }
    }

    return processChildren;
  });

  return refs;
};
