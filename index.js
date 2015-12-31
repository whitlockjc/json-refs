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

var pathLoader = require('path-loader');
var qs = require('querystring');
var slash = require('slash');
var URI = require('uri-js');

var ptrTokenRegex = /[~].?/g;
var ptrTokens = ['0', '1'];
var remoteCache = {};
var remoteTypes = ['relative', 'remote'];
var uriDetailsCache = {};

// Load promises polyfill if necessary
/* istanbul ignore if */
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

/* Internal Functions */

// This is a very simplistic clone function that does not take into account non-JSON types.  For these types the
// original value is used as the clone.  So while it's not a complete deep clone, for the needs of this project
// this should be sufficient.
function clone (obj) {
  var cloned;

  if (isType(obj, 'Array')) {
    cloned = [];

    obj.forEach(function (value, index) {
      cloned[index] = clone(value);
    });
  } else if (isType(obj, 'Object')) {
    cloned = {};

    Object.keys(obj).forEach(function (key) {
      cloned[key] = clone(obj[key]);
    });
  } else {
    cloned = obj;
  }

  return cloned;
}

function combinePaths (p1, p2) {
  var combined = [];

  function pathToSegments (path) {
    return isType(path, 'Undefined') || path === '' ? [] : path.split('/');
  }

  function handleSegment (seg) {
    if (seg === '..') {
      combined.pop();
    } else {
      combined.push(seg);
    }
  }

  pathToSegments(p1).concat(pathToSegments(p2)).forEach(handleSegment);

  return combined.length === 0 ? '' : combined.join('/');
}

function combineQueryParams (qs1, qs2) {
  var combined = {};

  function mergeQueryParams (obj) {
    Object.keys(obj).forEach(function (key) {
      combined[key] = obj[key];
    });
  }

  mergeQueryParams(qs.parse(qs1 || ''));
  mergeQueryParams(qs.parse(qs2 || ''));

  return Object.keys(combined).length === 0 ? undefined : qs.stringify(combined);
}

function combineURIs (u1, u2) {
  // Convert Windows paths
  if (isType(u1, 'String')) {
    u1 = slash(u1);
  }

  if (isType(u2, 'String')) {
    u2 = slash(u2);
  }

  var u2Details = URI.parse(isType(u2, 'Undefined') ? '' : u2);
  var u1Details;
  var combinedDetails;

  if (u2Details.reference === 'absolute' || u2Details.reference === 'uri') {
    combinedDetails = u2Details;
  } else {
    u1Details = isType(u1, 'Undefined') ? undefined : URI.parse(u1);

    if (!isType(u1Details, 'Undefined')) {
      combinedDetails = u1Details;

      // Join the paths
      combinedDetails.path = URI.normalize(combinePaths(u1Details.path, u2Details.path));

      // Join query parameters
      combinedDetails.query = combineQueryParams(u1Details.query, u2Details.query);
    } else {
      combinedDetails = u2Details;
    }
  }

  // Remove the fragment
  combinedDetails.fragment = undefined;

  return URI.serialize(combinedDetails);
}

function filterRefs (options, refs) {
  var refFilter = makeRefFilter(options);
  var filtered = {};
  var subDocPrefix = pathToPtr(makeSubDocPath(options));

  Object.keys(refs).forEach(function (refPtr) {
    var refDetails = refs[refPtr];

    if (refFilter(refDetails, pathFromPtr(refPtr)) === true && refPtr.indexOf(subDocPrefix) > -1) {
      filtered[refPtr] = refDetails;
    }
  });

  return filtered;
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

// Should this be its own exported API?
function findAllRefs (obj, options, parents, parentPath, documents) {
  var allTasks = Promise.resolve();
  var refs = findRefs(obj, options);

  Object.keys(refs).forEach(function (refPtr) {
    var refDetails = refs[refPtr];
    var refPath = pathFromPtr(refPtr);
    var location;
    var parentIndex;

    // Only process remote references
    if (remoteTypes.indexOf(refDetails.type) > -1) {
      location = combineURIs(options.relativeBase, refDetails.uri);
      parentIndex = parents.indexOf(location);

      if (parentIndex === -1) {
        allTasks = allTasks
          .then(function () {
            var rParentPath = parentPath.concat(refPath);
            var rOptions = clone(options);

            // Remove the sub document path
            delete rOptions.subDocPath;

            // Update the relativeBase based on the new location to retrieve
            rOptions.relativeBase = location.substring(0, location.lastIndexOf('/'));

            return findRefsAt(refDetails.uri, options)
              .then(function (rRefs) {
                // Record the location for circular reference identification
                rRefs.location = location;

                if (refDetails.uriDetails.fragment) {
                  // If the remote reference was for a fragment, do not include the reference details
                  rRefs.refs = {};

                  // Record the remote document
                  documents[pathToPtr(rParentPath)] = rRefs;

                  return rRefs;
                } else {
                  // Record the location in the document where the parent document was resolved
                  Object.keys(rRefs.refs).forEach(function (refPtr) {
                    rRefs.refs[refPtr].parentLocation = pathToPtr(rParentPath);
                  });

                  // Record the remote document
                  documents[pathToPtr(rParentPath)] = rRefs;

                  // Find all important references within the document
                  return findAllRefs(rRefs.value, rOptions, parents.concat(location), rParentPath, documents);
                }
              });
          });
      } else {
        // Mark seen ancestors as circular
        parents.slice(parentIndex).forEach(function (parent) {
          Object.keys(documents).forEach(function (cRefPtr) {
            var document = documents[cRefPtr];

            if (document.location === parent) {
              document.circular = true;
            }
          });
        });

        // Mark self as circular
        documents[pathToPtr(parentPath)].refs[refPtr].circular = true;
      }
    }
  });

  allTasks = allTasks
    .then(function () {
      // Only collapse the documents when we're back at the top of the promise stack
      if (parentPath.length === 0) {
        // Collapse all references together into one list
        Object.keys(documents).forEach(function (refPtr) {
          var document = documents[refPtr];

          // Merge each reference into the root document's references
          Object.keys(document.refs).forEach(function (cRefPtr) {
            var fPtr = pathToPtr(pathFromPtr(refPtr).concat(pathFromPtr(cRefPtr)));
            var refDetails = refs[fPtr];

            if (isType(refDetails, 'Undefined')) {
              refs[fPtr] = document.refs[cRefPtr];
            }
          });

          // Record the value of the remote reference
          refs[refPtr].value = document.value;

          // Mark the remote reference itself as circular
          if (document.circular) {
            refs[refPtr].circular = true;
          }
        });
      }

      return refs;
    });

  return allTasks;
}

function findValue (obj, path, ignore) {
  var value = obj;

  try {
    path.forEach(function (seg) {
      if (seg in value) {
        value = value[seg];
      } else {
        throw Error('JSON Pointer points to missing location: ' + pathToPtr(path));
      }
    });
  } catch (err) {
    if (ignore === true) {
      value = undefined;
    } else {
      throw err;
    }
  }

  return value;
}

function getExtraRefKeys (ref) {
  return Object.keys(ref).filter(function (key) {
    return key !== '$ref';
  });
}

function getRemoteDocument (url, options) {
  var cacheEntry = remoteCache[url];
  var allTasks = Promise.resolve();
  var loaderOptions = clone(options.loaderOptions || {});

  if (isType(cacheEntry, 'Undefined')) {
    // If there is no content processor, default to processing the raw response as JSON
    if (isType(loaderOptions.processContent, 'Undefined')) {
      loaderOptions.processContent = function (res, callback) {
        callback(undefined, JSON.parse(res.text));
      };
    }

    // Attempt to load the resource using  path-loader
    allTasks = pathLoader.load(url, loaderOptions);

    // Update the cache
    allTasks = allTasks
      .then(function (res) {
        remoteCache[url] = {
          value: res
        };

        return res;
      })
      .catch(function (err) {
        remoteCache[url] = {
          error: err
        };

        throw err;
      });
  } else {
    // Return the cached version
    allTasks = allTasks.then(function () {
      return cacheEntry.value;
    });
  }

  // Return a cloned version to avoid updating the cache
  allTasks = allTasks.then(function (res) {
    return clone(res);
  });

  return allTasks;
}

function isRefLike (obj) {
  return isType(obj, 'Object') && isType(obj.$ref, 'String');
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

function makeRefFilter (options) {
  var refFilter;

  if (isType(options.filter, 'Array') || isType(options.filter, 'String')) {
    refFilter = function (refDetails) {
      var validTypes = isType(options.filter, 'String') ? [options.filter] : options.filter;

      return validTypes.indexOf(refDetails.type) > -1;
    };
  } else if (isType(options.filter, 'Function')) {
    refFilter = options.filter;
  } else {
    refFilter = function () {
      return true;
    };
  }

  return refFilter;
}

function makeSubDocPath (options) {
  var fromPath = [];

  if (isType(options.subDocPath, 'Array')) {
    fromPath = options.subDocPath;
  } else if (isType(options.subDocPath, 'String')) {
    fromPath = pathFromPtr(options.subDocPath);
  }

  return fromPath;
}

function setValue (obj, refPath, value) {
  findValue(obj, refPath.slice(0, refPath.length - 1))[refPath[refPath.length - 1]] = value;
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

function validateOptions (options) {
  if (!isType(options, 'Undefined')) {
    if (!isType(options, 'Object')) {
      throw new TypeError('options must be an Object');
    } else if (!isType(options.subDocPath, 'Undefined') &&
               !isType(options.subDocPath, 'Array') &&
               !isPtr(options.subDocPath)) {
      // If a pointer is provided, throw an error if it's not the proper type
      throw new TypeError('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
    } else if (!isType(options.filter, 'Undefined') &&
               !isType(options.filter, 'Array') &&
               !isType(options.filter, 'Function') &&
               !isType(options.filter, 'String')) {
      throw new TypeError('options.filter must be an Array, a Function of a String');
    }
  }
}

/* Module Members */

/*
 * Each of the functions below are defined as function statements and *then* exported in two steps instead of one due
 * to a bug in jsdoc (https://github.com/jsdoc2md/jsdoc-parse/issues/18) that causes our documentation to be
 * generated improperly.  The impact to the user is significant enough for us to warrant working around it until this
 * is fixed.
 */

/**
 * The options used for various JsonRefs APIs.
 *
 * @typedef {object} JsonRefsOptions
 *
 * @param {string|string[]|function} [filter=function () {return true;}] - The filter to use when gathering JSON References *(If this value is
 * a single string or an array of strings, the value(s) are expected to be the `type(s)` you are interested in
 * collecting as described in {@link module:JsonRefs.getRefDetails}.  If it is a function, it is expected that the
 * function behaves like {@link module:JsonRefs~RefDetailsFilter}.)*
 * @param {object} [loaderOptions] - The options to pass to
 * {@link https://github.com/whitlockjc/path-loader/blob/master/docs/API.md#module_PathLoader.load|PathLoader~load}.
 * @param {string} [options.relativeBase] - The base location to use when resolving relative references *(Only useful
 * for APIs that do remote reference resolution.  If this value is not defined,
 * {@link https://github.com/whitlockjc/path-loader|path-loader} will use `window.location.href` for the browser and
 * `process.cwd()` for Node.js.)*
 * @param {string|string[]} [options.subDocPath=[]] - The JSON Pointer or array of path segments to the sub document
 * location to search from
 *
 * @alias module:JsonRefs~JsonRefsOptions
 */

/**
 * Simple function used to filter out JSON References.
 *
 * @typedef {function} RefDetailsFilter
 *
 * @param {module:JsonRefs~UnresolvedRefDetails} refDetails - The JSON Reference details to test
 * @param {string[]} path - The path to the JSON Reference
 *
 * @returns {boolean} whether the JSON Reference should be filtered *(out)* or not
 *
 * @alias module:JsonRefs~RefDetailsFilter
 */

/**
 * Detailed information about resolved JSON References.
 *
 * @typedef {module:JsonRefs~UnresolvedRefDetails} ResolvedRefDetails
 *
 * @property {boolean} [circular] - Whether or not the JSON Reference is circular *(Will not be set if the JSON
 * Reference is not circular)*
 * @property {boolean} [missing] - Whether or not the referenced value was missing or not *(Will not be set if the
 * referenced value is not missing)*
 * @property {*} [value] - The referenced value *(Will not be set if the referenced value is missing)*
 *
 * @alias module:JsonRefs~ResolvedRefDetails
 */

/**
 * The results of resolving the JSON References of an array/object.
 *
 * @typedef {object} ResolvedRefsResults
 *
 * @property {module:JsonRefs~ResolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~ResolvedRefDetails}
 * @property {object} value - The array/object with its JSON References fully resolved
 *
 * @alias module:JsonRefs~ResolvedRefsResults
 */

/**
 * An object containing the retrieved document and detailed information about its JSON References.
 *
 * @typedef {object} RetrievedRefsResults
 *
 * @property {module:JsonRefs~UnresolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~UnresolvedRefDetails}
 * @property {object} value - The retrieved document
 *
 * @alias module:JsonRefs~RetrievedRefsResults
 */

/**
 * An object containing the retrieved document, the document with its references resolved and  detailed information
 * about its JSON References.
 *
 * @typedef {object} RetrievedResolvedRefsResults
 *
 * @property {module:JsonRefs~UnresolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~UnresolvedRefDetails}
 * @property {module:JsonRefs~ResolvedRefsResults} - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~ResolvedRefDetails}
 * @property {object} value - The retrieved document
 *
 * @alias module:JsonRefs~RetrievedResolvedRefsResults
 */

/**
 * Detailed information about unresolved JSON References.
 *
 * @typedef {object} UnresolvedRefDetails
 *
 * @property {object} def - The JSON Reference definition
 * @property {string} [error] - The error information for invalid JSON Reference definition *(Only present when the
 * JSON Reference definition is invalid or there was a problem retrieving a remote reference during resolution)*
 * @property {string} uri - The URI portion of the JSON Reference
 * @property {object} uriDetails - Detailed information about the URI as provided by
 * {@link https://github.com/garycourt/uri-js|URI.parse}.
 * @property {string} type - The JSON Reference type *(This value can be one of the following: `invalid`, `local`,
 * `relative` or `remote`.)*
 * @property {string} [warning] - The warning information *(Only present when the JSON Reference definition produces a
 * warning)*
 *
 * @alias module:JsonRefs~UnresolvedRefDetails
 */

/**
 * Clears the internal cache of remote documents, reference details, etc.
 *
 * @alias module:JsonRefs.clearCache
 */
function clearCache () {
  remoteCache = {};
}

/**
 * Takes an array of path segments and decodes the JSON Pointer tokens in them.
 *
 * @param {string[]} path - The array of path segments
 *
 * @returns {string} the array of path segments with their JSON Pointer tokens decoded
 *
 * @throws {Error} if the path is not an `Array`
 *
 * @see {@link https://tools.ietf.org/html/rfc6901#section-3}
 *
 * @alias module:JsonRefs.decodePath
 */
function decodePath (path) {
  if (!isType(path, 'Array')) {
    throw new TypeError('path must be an array');
  }

  return path.map(function (seg) {
    if (!isType(seg, 'String')) {
      seg = JSON.stringify(seg);
    }

    return seg.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

/**
 * Takes an array of path segments and encodes the special JSON Pointer characters in them.
 *
 * @param {string[]} path - The array of path segments
 *
 * @returns {string} the array of path segments with their JSON Pointer tokens encoded
 *
 * @throws {Error} if the path is not an `Array`
 *
 * @see {@link https://tools.ietf.org/html/rfc6901#section-3}
 *
 * @alias module:JsonRefs.encodePath
 */
function encodePath (path) {
  if (!isType(path, 'Array')) {
    throw new TypeError('path must be an array');
  }

  return path.map(function (seg) {
    if (!isType(seg, 'String')) {
      seg = JSON.stringify(seg);
    }

    return seg.replace(/~/g, '~0').replace(/\//g, '~1');
  });
}

/**
 * Finds JSON References defined within the provided array/object.
 *
 * @param {array|object} obj - The structure to find JSON References within
 * @param {module:JsonRefs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {object} an object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined
 * and whose values are {@link module:JsonRefs~UnresolvedRefDetails}.
 *
 * @throws {Error} if `obj` is not an object or array
 *
 * @alias module:JsonRefs.findRefs
 */
function findRefs (obj, options) {
  var ancestors = [];
  var fromObj = obj;
  var fromPath;
  var refs = {};
  var refFilter;

  // Validate the provided document
  if (!isType(obj, 'Array') && !isType(obj, 'Object')) {
    throw new TypeError('obj must be an Array or an Object');
  }

  // Set default for options
  if (isType(options, 'Undefined')) {
    options = {};
  }

  // Validate options
  validateOptions(options);

  // Convert from to a pointer
  fromPath = makeSubDocPath(options);

  // Convert options.filter from an Array/String to a Function
  refFilter = makeRefFilter(options);

  if (fromPath.length > 0) {
    ancestors = findAncestors(obj, fromPath);
    fromObj = findValue(obj, fromPath);
  }

  // Walk the document (or sub document) and find all JSON References
  walk(ancestors, fromObj, fromPath, function (ancestors, node, path) {
    var processChildren = true;
    var refDetails;

    if (isRef(node)) {
      refDetails = getRefDetails(node);

      if (refFilter(refDetails, path) === true) {
        refs[pathToPtr(path)] = refDetails;
      }

      // Whenever a JSON Reference has extra children, its children should be ignored so we want to stop processing.
      //   See: http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3
      if (getExtraRefKeys(node).length > 0) {
        processChildren = false;
      }
    }

    return processChildren;
  });

  return refs;
}

/**
 * Finds JSON References defined within the document at the provided location.
 *
 * This API is identical to {@link module:JsonRefs.findRefs} except this API will retrieve a remote document and then
 * return the result of {@link module:JsonRefs.findRefs} on the retrieved document.
 *
 * @param {string} location - The location to retrieve *(Can be relative or absolute, just make sure you look at the
 * {@link module:JsonRefs~JsonRefsOptions|options documentation} to see how relative references are handled.)*
 * @param {module:JsonRefs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {Promise} a promise that resolves a {@link module:JsonRefs~RetrievedRefsResults} and rejects with an
 * `Error` when the input arguments fail validation
 *
 * @alias module:JsonRefs.findRefsAt
 *
 * @example
 * // Example that only resolves references within a sub document
 * JsonRefs.findRefsAt('http://petstore.swagger.io/v2/swagger.json', {
 *     subDocPath: '#/definitions'
 *   })
 *   .then(function (res) {
 *      // Do something with the response
 *      //
 *      // res.refs: JSON Reference locations and details
 *      // res.value: The retrieved document
 *   }, function (err) {
 *     console.log(err.stack);
 *   });
 */
function findRefsAt (location, options) {
  var allTasks = Promise.resolve();

  allTasks = allTasks
    .then(function () {
      var cOptions;

      // Validate the provided location
      if (!isType(location, 'String')) {
        throw new TypeError('location must be a string');
      }

      // Set default for options
      if (isType(options, 'Undefined')) {
        options = {};
      }

      // Validate options (Doing this here for a quick)
      validateOptions(options);

      cOptions = clone(options);

      // Combine the location and the optional relative base
      location = combineURIs(options.relativeBase, location);

      // Set the new relative reference location
      cOptions.relativeBase = location.substring(0, location.lastIndexOf('/'));

      return getRemoteDocument(location, cOptions);
    })
    .then(function (res) {
      var cacheEntry = clone(remoteCache[location]);
      var cOptions;

      if (isType(cacheEntry.refs, 'Undefined')) {
        cOptions = clone(options);

        // Do not filter any references so the cache is complete
        delete cOptions.filter;
        delete cOptions.subDocPath;

        remoteCache[location].refs = findRefs(res, cOptions);

        // Filter out the references based on options.filter and options.subDocPath
        cacheEntry.refs = filterRefs(options, remoteCache[location].refs);
      }

      return cacheEntry;
    });

  return allTasks;
}

/**
 * Returns detailed information about the JSON Reference.
 *
 * @param {object} obj - The JSON Reference definition
 *
 * @returns {module:JsonRefs~UnresolvedRefDetails} the detailed information
 *
 * @alias module:JsonRefs.getRefDetails
 */
function getRefDetails (obj) {
  var details = {
    def: obj
  };
  var cacheKey;
  var extraKeys;
  var uriDetails;

  if (isRefLike(obj)) {
    cacheKey = obj.$ref;
    uriDetails = uriDetailsCache[cacheKey];

    if (isType(uriDetails, 'Undefined')) {
      uriDetails =  uriDetailsCache[cacheKey] = URI.parse(obj.$ref);
    }

    details.uri = cacheKey;
    details.uriDetails = uriDetails;

    if (isType(uriDetails.error, 'Undefined')) {
      // Convert the URI reference to one of our types
      switch (uriDetails.reference) {
        case 'absolute':
        case 'uri':
          details.type = 'remote';
          break;
        case 'same-document':
          details.type = 'local';
          break;
        default:
          details.type = uriDetails.reference;
      }
    } else {
      details.error = details.uriDetails.error;
      details.type = 'invalid';
    }

    // Identify warning
    extraKeys = getExtraRefKeys(obj);

    if (extraKeys.length > 0) {
      details.warning = 'Extra JSON Reference properties will be ignored: ' + extraKeys.join(', ');
    }
  } else {
    details.type = 'invalid';
  }

  return details;
}

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
 *
 * @alias module:JsonRefs.isPtr
 */
function isPtr (ptr) {
  var valid = isType(ptr, 'String');
  var firstChar;
  var tokens;

  if (valid) {
    if (ptr !== '') {
      firstChar = ptr.charAt(0);

      if (['#', '/'].indexOf(firstChar) === -1) {
        valid = false;
      } else if (firstChar === '#' && ptr !== '#' && ptr.charAt(1) !== '/') {
        valid = false;
      } else {
        tokens = ptr.match(ptrTokenRegex);

        if (isType(tokens, 'Array')) {
          valid = tokens.every(function (token) {
            return ptrTokens.indexOf(token.split('~')[1]) > -1;
          });
        }
      }
    }
  }

  return valid;
}

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
 *
 * @alias module:JsonRefs.isRef
 */
function isRef (obj) {
  return isRefLike(obj) && getRefDetails(obj).type !== 'invalid';
}

/**
 * Returns an array of path segments for the provided JSON Pointer.
 *
 * @param {string} ptr - The JSON Pointer
 *
 * @returns {string[]} the path segments
 *
 * @throws {Error} if the provided `ptr` argument is not a JSON Pointer
 *
 * @alias module:JsonRefs.pathFromPtr
 */
function pathFromPtr (ptr) {
  if (!isPtr(ptr)) {
    throw new Error('ptr must be a JSON Pointer');
  }

  var segments = ptr.split('/');

  // Remove the first segment
  segments.shift();

  return decodePath(segments);
}

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
 * @throws {Error} if the `path` argument is not an array
 *
 * @alias module:JsonRefs.pathToPtr
 */
function pathToPtr (path, hashPrefix) {
  if (!isType(path, 'Array')) {
    throw new Error('path must be an Array');
  }

  // Encode each segment and return
  return (hashPrefix !== false ? '#' : '') + (path.length > 0 ? '/' : '') + encodePath(path).join('/');
}

/**
 * Finds JSON References defined within the provided array/object and resolves them.
 *
 * @param {array|object} obj - The structure to find JSON References within
 * @param {module:JsonRefs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {Promise} a promise that resolves a {@link module:JsonRefs~ResolvedRefsResults} and rejects with an
 * `Error` when the input arguments fail validation
 *
 * @alias module:JsonRefs.resolveRefs
 *
 * @example
 * // Example that only resolves relative and remote references
 * JsonRefs.resolveRefs(swaggerObj, {
 *     filter: ['relative', 'remote']
 *   })
 *   .then(function (res) {
 *      // Do something with the response
 *      //
 *      // res.refs: JSON Reference locations and details
 *      // res.resolved: The document with the appropriate JSON References resolved
 *   }, function (err) {
 *     console.log(err.stack);
 *   });
 */
function resolveRefs (obj, options) {
  var allTasks = Promise.resolve();

  allTasks = allTasks
    .then(function () {
      // Validate the provided document
      if (!isType(obj, 'Array') && !isType(obj, 'Object')) {
        throw new TypeError('obj must be an Array or an Object');
      }

      // Set default for options
      if (isType(options, 'Undefined')) {
        options = {};
      }

      // Validate options
      validateOptions(options);
    })
    .then(function () {
      // Find all references recursively
      return findAllRefs(obj, options, [], [], {});
    })
    .then(function (aRefs) {
      var cloned = clone(obj);
      var parentLocations = [];

      // Replace remote references first
      Object.keys(aRefs).forEach(function (refPtr) {
        var refDetails = aRefs[refPtr];
        var value;

        if (remoteTypes.indexOf(refDetails.type) > -1) {
          if (isType(refDetails.error, 'Undefined')) {
            try {
              value = findValue(refDetails.value || {},
                                refDetails.uriDetails.fragment ?
                                pathFromPtr(refDetails.uriDetails.fragment) :
                                  []);
              setValue(cloned, pathFromPtr(refPtr), value);

              // The reference includes a fragment so update the reference details
              if (!isType(refDetails.value, 'Undefined')) {
                refDetails.value = value;
              } else if (refDetails.circular) {
                // If there is no value and it's circular, set its value to an empty value
                refDetails.value = {};
              }
            } catch (err) {
              refDetails.error = err;
              refDetails.missing = true;
            }
          } else {
            refDetails.missing = true;
          }
        }
      });

      // Replace local references
      Object.keys(aRefs).forEach(function (refPtr) {
        var refDetails = aRefs[refPtr];
        var parentLocation = refDetails.parentLocation;
        var value;

        // Record that this reference has parent location details so we can clean it up later
        if (!isType(parentLocation, 'Undefined') && parentLocations.indexOf(refPtr) === -1) {
          parentLocations.push(refPtr);
        }

        if (remoteTypes.indexOf(refDetails.type) === -1) {
          if (isType(refDetails.error, 'Undefined')) {
            if (refPtr.indexOf(refDetails.uri) > -1) {
              refDetails.circular = true;
              value = {};
            } else {
              if (!isType(parentLocation, 'Undefined')) {
                // Attempt to get the referenced value from the remote document first
                value = findValue(findValue(cloned, pathFromPtr(parentLocation)),
                                  refDetails.uriDetails.fragment ?
                                    pathFromPtr(refDetails.uriDetails.fragment) :
                                    [], true);
              }
            }

            try {
              if (isType(value, 'Undefined')) {
                value = findValue(cloned,
                                  refDetails.uriDetails.fragment ?
                                  pathFromPtr(refDetails.uriDetails.fragment) :
                                    []);
              }

              setValue(cloned, pathFromPtr(refPtr), value);

              refDetails.value = value;
            } catch (err) {
              refDetails.error = err;
              refDetails.missing = true;
            }
          } else {
            refDetails.missing = true;
          }
        }
      });

      // Remove all parentLocation values
      parentLocations.forEach(function (refPtr) {
        delete aRefs[refPtr].parentLocation;
      });

      return {
        refs: aRefs,
        resolved: cloned
      };
    });

  return allTasks;
}

/**
 * Resolves JSON References defined within the document at the provided location.
 *
 * This API is identical to {@link module:JsonRefs.resolveRefs} except this API will retrieve a remote document and then
 * return the result of {@link module:JsonRefs.resolveRefs} on the retrieved document.
 *
 * @param {string} location - The location to retrieve *(Can be relative or absolute, just make sure you look at the
 * {@link module:JsonRefs~JsonRefsOptions|options documentation} to see how relative references are handled.)*
 * @param {module:JsonRefs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {Promise} a promise that resolves a {@link module:JsonRefs~RetrievedResolvedRefsResults} and rejects with an
 * `Error` when the input arguments fail validation
 *
 * @alias module:JsonRefs.resolveRefsAt
 *
 * @example
 * // Example that loads a JSON document (No options.loaderOptions.processContent required) and resolves all references
 * JsonRefs.resolveRefsAt('./swagger.json')
 *   .then(function (res) {
 *      // Do something with the response
 *      //
 *      // res.refs: JSON Reference locations and details
 *      // res.resolved: The document with the appropriate JSON References resolved
 *      // res.value: The retrieved document
 *   }, function (err) {
 *     console.log(err.stack);
 *   });
 */
function resolveRefsAt (location, options) {
  var allTasks = Promise.resolve();

  allTasks = allTasks
    .then(function () {
      var cOptions;

      // Validate the provided location
      if (!isType(location, 'String')) {
        throw new TypeError('location must be a string');
      }

      // Set default for options
      if (isType(options, 'Undefined')) {
        options = {};
      }

      // Validate options (Doing this here for a quick)
      validateOptions(options);

      cOptions = clone(options);

      // Combine the location and the optional relative base
      location = combineURIs(options.relativeBase, location);

      // Set the new relative reference location
      cOptions.relativeBase = location.substring(0, location.lastIndexOf('/'));

      return getRemoteDocument(location, cOptions);
    })
    .then(function (res) {
      return resolveRefs(res, options)
        .then(function (res2) {
          return {
            refs: res2.refs,
            resolved: res2.resolved,
            value: res
          };
        });
    });

  return allTasks;
}

/* Export the module members */
module.exports.clearCache = clearCache;
module.exports.decodePath = decodePath;
module.exports.encodePath = encodePath;
module.exports.findRefs = findRefs;
module.exports.findRefsAt = findRefsAt;
module.exports.getRefDetails = getRefDetails;
module.exports.isPtr = isPtr;
module.exports.isRef = isRef;
module.exports.pathFromPtr = pathFromPtr;
module.exports.pathToPtr = pathToPtr;
module.exports.resolveRefs = resolveRefs;
module.exports.resolveRefsAt = resolveRefsAt;
