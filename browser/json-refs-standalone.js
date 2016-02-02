(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.JsonRefs = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

var path = require('path');
var PathLoader = require('path-loader');
var qs = require('querystring');
var slash = require('slash');
var URI = require('uri-js');

var badPtrTokenRegex = /~(?:[^01]|$)/g;
var remoteCache = {};
var remoteTypes = ['relative', 'remote'];
var remoteUriTypes = ['absolute', 'uri'];
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

  var u2Details = parseURI(isType(u2, 'Undefined') ? '' : u2);
  var u1Details;
  var combinedDetails;

  if (remoteUriTypes.indexOf(u2Details.reference) > -1) {
    combinedDetails = u2Details;
  } else {
    u1Details = isType(u1, 'Undefined') ? undefined : parseURI(u1);

    if (!isType(u1Details, 'Undefined')) {
      combinedDetails = u1Details;

      // Join the paths
      combinedDetails.path = path.join(u1Details.path, u2Details.path);

      // Join query parameters
      combinedDetails.query = combineQueryParams(u1Details.query, u2Details.query);
    } else {
      combinedDetails = u2Details;
    }
  }

  // Remove the fragment
  combinedDetails.fragment = undefined;

  // For relative URIs, add back the '..' since it was removed above
  return (remoteUriTypes.indexOf(combinedDetails.reference) === -1 &&
          combinedDetails.path.indexOf('../') === 0 ? '../' : '') + URI.serialize(combinedDetails);
}

function findAncestors (obj, path) {
  var ancestors = [];
  var node;

  if (path.length > 0) {
    node = obj;

    path.slice(0, path.length - 1).forEach(function (seg) {
      if (seg in node) {
        node = node[seg];

        ancestors.push(node);
      }
    });
  }

  return ancestors;
}

function processSubDocument (mode, doc, subDocPath, refDetails, options, parents, parentPtrs, allRefs, indirect) {
  var refValue;
  var rOptions;

  if (subDocPath.length > 0) {
    try {
      refValue = findValue(doc, subDocPath);
    } catch (err) {
      // We only mark missing remote references as missing because local references can have deferred values
      if (mode === 'remote') {
        refDetails.error = err.message;
        refDetails.missing = true;
      }
    }
  } else {
    refValue = doc;
  }

  if (!isType(refValue, 'Undefined')) {
    refDetails.value = refValue;
  }

  if (isType(refValue, 'Array') || isType(refValue, 'Object')) {
    rOptions = clone(options);

    if (mode === 'local') {
      delete rOptions.subDocPath;

      // Traverse the dereferenced value
      doc = refValue;
    } else {
      rOptions.relativeBase = path.dirname(parents[parents.length - 1]);

      if (subDocPath.length === 0) {
        delete rOptions.subDocPath;
      } else {
        rOptions.subDocPath = subDocPath;
      }
    }

    return findRefsRecursive(doc, rOptions, parents, parentPtrs, allRefs, indirect);
  }
}

// Should this be its own exported API?
function findRefsRecursive (obj, options, parents, parentPtrs, allRefs, indirect) {
  var allTasks = Promise.resolve();
  var parentPath = parentPtrs.length ? pathFromPtr(parentPtrs[parentPtrs.length - 1]) : [];
  var refs = findRefs(obj, options);
  var subDocPath = options.subDocPath || [];
  var subDocPtr = pathToPtr(subDocPath);
  var ancestorPtrs = ['#'];

  parents.forEach(function (parent, index) {
    if (parent.charAt(0) !== '#') {
      ancestorPtrs.push(parentPtrs[index]);
    }
  });

  // Reverse the order so we search them in the proper order
  ancestorPtrs.reverse();

  if ((parents[parents.length - 1] || '').charAt(0) !== '#') {
    allRefs.documents[pathToPtr(parentPath)] = obj;
  }

  Object.keys(refs).forEach(function (refPtr) {
    var refDetails = refs[refPtr];
    var location;
    var parentIndex;
    var refFullPath;
    var refFullPtr;

    // If there are no parents, treat the reference pointer as-is.  Otherwise, the reference is a reference within a
    // remote document and its sub document path prefix must be removed.
    if (parents.length === 0) {
      refFullPath = parentPath.concat(pathFromPtr(refPtr));
    } else {
      refFullPath = parentPath.concat(pathFromPtr(refPtr).slice(parents.length === 0 ? 0 : subDocPath.length));
    }

    refFullPtr = pathToPtr(refFullPath);

    // It is possible to process the same reference more than once in the event of hierarchical references so we avoid
    // processing a reference if we've already done so.
    if (!isType(allRefs[refFullPtr], 'Undefined')) {
      return;
    }

    // Record the reference metadata
    allRefs.refs[refFullPtr] = refs[refPtr];

    // Do not process invalid references
    if (isType(refDetails.error, 'Undefined') && refDetails.type !== 'invalid') {
      if (remoteTypes.indexOf(refDetails.type) > -1) {
        location = combineURIs(options.relativeBase, refDetails.uri);
        parentIndex = parents.indexOf(location);
      } else {
        location = refDetails.uri;
        parentIndex = parentPtrs.indexOf(location);
      }

      // Record ancestor paths
      refDetails.ancestorPtrs = ancestorPtrs;

      // Record if the reference is indirect based on its parent
      refDetails.indirect = indirect;

      // Only process non-circular references further
      if (parentIndex === -1) {
        if (remoteTypes.indexOf(refDetails.type) > -1) {
          allTasks = allTasks
            .then(function () {
              return getRemoteDocument(location, options)
                .then(function (doc) {
                  return processSubDocument('remote',
                                            doc,
                                            isType(refDetails.uriDetails.fragment, 'Undefined') ?
                                              [] :
                                              pathFromPtr(decodeURI(refDetails.uriDetails.fragment)),
                                            refDetails,
                                            options,
                                            parents.concat(location),
                                            parentPtrs.concat(refFullPtr),
                                            allRefs,
                                            indirect);
                })
                .catch(function (err) {
                  refDetails.error = err.message;
                  refDetails.missing = true;
                });
            });
        } else {
          if (refFullPtr.indexOf(location + '/') !== 0 && refFullPtr !== location &&
              subDocPtr.indexOf(location + '/') !== 0 && subDocPtr !== location) {
            if (location.indexOf(subDocPtr + '/') !== 0) {
              allTasks = allTasks
                .then(function () {
                  return processSubDocument('local',
                                            obj,
                                            pathFromPtr(location),
                                            refDetails,
                                            options,
                                            parents.concat(location),
                                            parentPtrs.concat(refFullPtr),
                                            allRefs,
                                            indirect || (location.indexOf(subDocPtr + '/') === -1 && location !== subDocPtr));
                });
            }
          } else {
            refDetails.circular = true;
          }
        }
      } else {
        // Mark seen ancestors as circular
        parentPtrs.slice(parentIndex).forEach(function (parentPtr) {
          allRefs.refs[parentPtr].circular = true;
        });

        refDetails.circular = true;
      }
    }
  });

  allTasks = allTasks
    .then(function () {
      return allRefs;
    });

  return allTasks;
}

function findValue (obj, path) {
  var value = obj;

  path.forEach(function (seg) {
    seg = decodeURI(seg);

    if (seg in value) {
      value = value[seg];
    } else {
      throw Error('JSON Pointer points to missing location: ' + pathToPtr(path));
    }
  });

  return value;
}

function getExtraRefKeys (ref) {
  return Object.keys(ref).filter(function (key) {
    return key !== '$ref';
  });
}

function getRefType (refDetails) {
  var type;

  // Convert the URI reference to one of our types
  switch (refDetails.uriDetails.reference) {
  case 'absolute':
  case 'uri':
    type = 'remote';
    break;
  case 'same-document':
    type = 'local';
    break;
  default:
    type = refDetails.uriDetails.reference;
  }

  return type;
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

    // Attempt to load the resource using path-loader
    allTasks = PathLoader.load(decodeURI(url), loaderOptions);

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

function isRefLike (obj, throwWithDetails) {
  var refLike = true;

  try {
    if (!isType(obj, 'Object')) {
      throw new Error('obj is not an Object');
    } else if (!isType(obj.$ref, 'String')) {
      throw new Error('obj.$ref is not a String');
    }
  } catch (err) {
    if (throwWithDetails) {
      throw err;
    }

    refLike = false;
  }

  return refLike;
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
  var validTypes;

  if (isType(options.filter, 'Array') || isType(options.filter, 'String')) {
    validTypes = isType(options.filter, 'String') ? [options.filter] : options.filter;
    refFilter = function (refDetails) {
      // Check the exact type or for invalid URIs, check its original type
      return validTypes.indexOf(refDetails.type) > -1 || validTypes.indexOf(getRefType(refDetails)) > -1;
    };
  } else if (isType(options.filter, 'Function')) {
    refFilter = options.filter;
  } else if (isType(options.filter, 'Undefined')) {
    refFilter = function () {
      return true;
    };
  }

  return function (refDetails, path) {
    return (refDetails.type !== 'invalid' || options.includeInvalid === true) && refFilter(refDetails, path);
  };
}

function makeSubDocPath (options) {
  var subDocPath;

  if (isType(options.subDocPath, 'Array')) {
    subDocPath = options.subDocPath;
  } else if (isType(options.subDocPath, 'String')) {
    subDocPath = pathFromPtr(options.subDocPath);
  } else if (isType(options.subDocPath, 'Undefined')) {
    subDocPath = [];
  }

  return subDocPath;
}

function parseURI (uri) {
  // We decode first to avoid doubly encoding
  return URI.parse(encodeURI(decodeURI(uri)));
}

function setValue (obj, refPath, value) {
  findValue(obj, refPath.slice(0, refPath.length - 1))[decodeURI(refPath[refPath.length - 1])] = value;
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

function validateOptions (options, obj) {
  if (isType(options, 'Undefined')) {
    // Default to an empty options object
    options = {};
  } else {
    // Clone the options so we do not alter the ones passed in
    options = clone(options);
  }

  if (!isType(options, 'Object')) {
    throw new TypeError('options must be an Object');
  } else if (!isType(options.filter, 'Undefined') &&
             !isType(options.filter, 'Array') &&
             !isType(options.filter, 'Function') &&
             !isType(options.filter, 'String')) {
    throw new TypeError('options.filter must be an Array, a Function of a String');
  } else if (!isType(options.includeInvalid, 'Undefined') &&
             !isType(options.includeInvalid, 'Boolean')) {
    throw new TypeError('options.includeInvalid must be a Boolean');
  } else if (!isType(options.refPreProcessor, 'Undefined') &&
             !isType(options.refPreProcessor, 'Function')) {
    throw new TypeError('options.refPreProcessor must be a Function');
  } else if (!isType(options.refPostProcessor, 'Undefined') &&
             !isType(options.refPostProcessor, 'Function')) {
    throw new TypeError('options.refPostProcessor must be a Function');
  } else if (!isType(options.subDocPath, 'Undefined') &&
             !isType(options.subDocPath, 'Array') &&
             !isPtr(options.subDocPath)) {
    // If a pointer is provided, throw an error if it's not the proper type
    throw new TypeError('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
  }

  options.filter = makeRefFilter(options);

  // Set the subDocPath to avoid everyone else having to compute it
  options.subDocPath = makeSubDocPath(options);

  if (!isType(obj, 'Undefined')) {
    try {
      findValue(obj, options.subDocPath);
    } catch (err) {
      err.message = err.message.replace('JSON Pointer', 'options.subDocPath');

      throw err;
    }
  }

  return options;
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
 * @param {string|string[]|function} [filter=function () {return true;}] - The filter to use when gathering JSON
 * References *(If this value is a single string or an array of strings, the value(s) are expected to be the `type(s)`
 * you are interested in collecting as described in {@link module:JsonRefs.getRefDetails}.  If it is a function, it is
 * expected that the function behaves like {@link module:JsonRefs~RefDetailsFilter}.)*
 * @param {boolean} [includeInvalid=false] - Whether or not to include invalid JSON Reference details *(This will make
 * it so that objects that are like JSON Reference objects, as in they are an `Object` and the have a `$ref` property,
 * but fail validation will be included.  This is very useful for when you want to know if you have invalid JSON
 * Reference definitions.  This will not mean that APIs will process invalid JSON References but the reasons as to why
 * the JSON References are invalid will be included in the returned metadata.)*
 * @param {object} [loaderOptions] - The options to pass to
 * {@link https://github.com/whitlockjc/path-loader/blob/master/docs/API.md#module_PathLoader.load|PathLoader~load}
 * @param {module:JsonRefs~RefPreProcessor} [refPreProcessor] - The callback used to pre-process a JSON Reference like
 * object *(This is called prior to validating the JSON Reference like object and getting its details)*
 * @param {module:JsonRefs~RefPostProcessor} [refPostProcessor] - The callback used to post-process the JSON Reference
 * metadata *(This is called prior filtering the references)*
 * @param {string} [options.relativeBase] - The base location to use when resolving relative references *(Only useful
 * for APIs that do remote reference resolution.  If this value is not defined,
 * {@link https://github.com/whitlockjc/path-loader|path-loader} will use `window.location.href` for the browser and
 * `process.cwd()` for Node.js.)*
 * @param {string|string[]} [options.subDocPath=[]] - The JSON Pointer or array of path segments to the sub document
 * location to search from
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
 */

/**
 * Simple function used to pre-process a JSON Reference like object.
 *
 * @typedef {function} RefPreProcessor
 *
 * @param {object} obj - The JSON Reference like object
 * @param {string[]} path - The path to the JSON Reference like object
 *
 * @returns {object} the processed JSON Reference like object
 */

/**
 * Simple function used to post-process a JSON Reference details.
 *
 * @typedef {function} RefPostProcessor
 *
 * @param {module:JsonRefs~UnresolvedRefDetails} refDetails - The JSON Reference details to test
 * @param {string[]} path - The path to the JSON Reference
 *
 * @returns {object} the processed JSON Reference details object
 */

/**
 * Detailed information about resolved JSON References.
 *
 * @typedef {UnresolvedRefDetails} ResolvedRefDetails
 *
 * @property {boolean} [circular] - Whether or not the JSON Reference is circular *(Will not be set if the JSON
 * Reference is not circular)*
 * @property {boolean} [missing] - Whether or not the referenced value was missing or not *(Will not be set if the
 * referenced value is not missing)*
 * @property {*} [value] - The referenced value *(Will not be set if the referenced value is missing)*
 */

/**
 * The results of resolving the JSON References of an array/object.
 *
 * @typedef {object} ResolvedRefsResults
 *
 * @property {module:JsonRefs~ResolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~ResolvedRefDetails}
 * @property {object} value - The array/object with its JSON References fully resolved
 */

/**
 * An object containing the retrieved document and detailed information about its JSON References.
 *
 * @typedef {object} RetrievedRefsResults
 *
 * @property {module:JsonRefs~UnresolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~UnresolvedRefDetails}
 * @property {object} value - The retrieved document
 */

/**
 * An object containing the retrieved document, the document with its references resolved and  detailed information
 * about its JSON References.
 *
 * @typedef {object} RetrievedResolvedRefsResults
 *
 * @property {module:JsonRefs~UnresolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~UnresolvedRefDetails}
 * @property {ResolvedRefsResults} - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:JsonRefs~ResolvedRefDetails}
 * @property {object} value - The retrieved document
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

    return decodeURI(seg.replace(/~1/g, '/').replace(/~0/g, '~'));
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
 * @throws {Error} when the input arguments fail validation or if `options.subDocPath` points to an invalid location
 *
 * @alias module:JsonRefs.findRefs
 *
 * @example
 * // Finding all valid references
 * var allRefs = JsonRefs.findRefs(obj);
 * // Finding all remote references
 * var remoteRefs = JsonRefs.findRefs(obj, {filter: ['relative', 'remote']});
 * // Finding all invalid references
 * var invalidRefs = JsonRefs.findRefs(obj, {filter: 'invalid', includeInvalid: true});
 */
function findRefs (obj, options) {
  var refs = {};

  // Validate the provided document
  if (!isType(obj, 'Array') && !isType(obj, 'Object')) {
    throw new TypeError('obj must be an Array or an Object');
  }

  // Validate options
  options = validateOptions(options, obj);

  // Walk the document (or sub document) and find all JSON References
  walk(findAncestors(obj, options.subDocPath),
       findValue(obj, options.subDocPath),
       clone(options.subDocPath),
       function (ancestors, node, path) {
         var processChildren = true;
         var refDetails;

         if (isRefLike(node)) {
           // Pre-process the node when necessary
           if (!isType(options.refPreProcessor, 'Undefined')) {
             node = options.refPreProcessor(clone(node), path);
           }

           refDetails = getRefDetails(node);

           // Post-process the reference details
           if (!isType(options.refPostProcessor, 'Undefined')) {
             refDetails = options.refPostProcessor(refDetails, path);
           }

           if (options.filter(refDetails, path)) {
             refs[pathToPtr(path)] = refDetails;
           }

           // Whenever a JSON Reference has extra children, its children should not be processed.
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
 * `Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 *  the location argument points to an unloadable resource
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
      // Validate the provided location
      if (!isType(location, 'String')) {
        throw new TypeError('location must be a string');
      }

      // Validate options
      options = validateOptions(options);

      // Combine the location and the optional relative base
      location = combineURIs(options.relativeBase, location);

      return getRemoteDocument(location, options);
    })
    .then(function (res) {
      var cacheEntry = clone(remoteCache[location]);
      var cOptions = clone(options);
      var uriDetails = parseURI(location);

      if (isType(cacheEntry.refs, 'Undefined')) {
        // Do not filter any references so the cache is complete
        delete cOptions.filter;
        delete cOptions.subDocPath;

        cOptions.includeInvalid = true;

        remoteCache[location].refs = findRefs(res, cOptions);
      }

      // Add the filter options back
      if (!isType(options.filter, 'Undefined')) {
        cOptions.filter = options.filter;
      }

      if (!isType(uriDetails.fragment, 'Undefined')) {
        cOptions.subDocPath = pathFromPtr(decodeURI(uriDetails.fragment));
      } else if (!isType(uriDetails.subDocPath, 'Undefined')) {
        cOptions.subDocPath = options.subDocPath;
      }

      // This will use the cache so don't worry about calling it twice
      return {
        refs: findRefs(res, cOptions),
        value: res
      };
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

  try {
    if (isRefLike(obj, true)) {
      cacheKey = obj.$ref;
      uriDetails = uriDetailsCache[cacheKey];

      if (isType(uriDetails, 'Undefined')) {
        uriDetails = uriDetailsCache[cacheKey] = parseURI(cacheKey);
      }

      details.uri = cacheKey;
      details.uriDetails = uriDetails;

      if (isType(uriDetails.error, 'Undefined')) {
        details.type = getRefType(details);
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
  } catch (err) {
    details.error = err.message;
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
 *   * The string must be empty, `#` or start with a `/` or `#/`
 *
 * @param {string} ptr - The string to check
 * @param {boolean} [throwWithDetails=false] - Whether or not to throw an `Error` with the details as to why the value
 * provided is invalid
 *
 * @returns {boolean} the result of the check
 *
 * @throws {error} when the provided value is invalid and the `throwWithDetails` argument is `true`
 *
 * @alias module:JsonRefs.isPtr
 *
 * @see {@link https://tools.ietf.org/html/rfc6901#section-3}
 *
 * @example
 * // Separating the different ways to invoke isPtr for demonstration purposes
 * if (isPtr(str)) {
 *   // Handle a valid JSON Pointer
 * } else {
 *   // Get the reason as to why the value is not a JSON Pointer so you can fix/report it
 *   try {
 *     isPtr(str, true);
 *   } catch (err) {
 *     // The error message contains the details as to why the provided value is not a JSON Pointer
 *   }
 * }
 */
function isPtr (ptr, throwWithDetails) {
  var valid = true;
  var firstChar;

  try {
    if (isType(ptr, 'String')) {
      if (ptr !== '') {
        firstChar = ptr.charAt(0);

        if (['#', '/'].indexOf(firstChar) === -1) {
          throw new Error('ptr must start with a / or #/');
        } else if (firstChar === '#' && ptr !== '#' && ptr.charAt(1) !== '/') {
          throw new Error('ptr must start with a / or #/');
        } else if (ptr.match(badPtrTokenRegex)) {
          throw new Error('ptr has invalid token(s)');
        }
      }
    } else {
      throw new Error('ptr is not a String');
    }
  } catch (err) {
    if (throwWithDetails === true) {
      throw err;
    }

    valid = false;
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
 *   * The `$ref` property is a valid URI *(We do not require 100% strict URIs and will handle unescaped special
 *     characters.)*
 *
 * @param {object} obj - The object to check
 * @param {boolean} [throwWithDetails=false] - Whether or not to throw an `Error` with the details as to why the value
 * provided is invalid
 *
 * @returns {boolean} the result of the check
 *
 * @throws {error} when the provided value is invalid and the `throwWithDetails` argument is `true`
 *
 * @alias module:JsonRefs.isRef
 *
 * @see {@link http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3}
 *
 * @example
 * // Separating the different ways to invoke isRef for demonstration purposes
 * if (isRef(obj)) {
 *   // Handle a valid JSON Reference
 * } else {
 *   // Get the reason as to why the value is not a JSON Reference so you can fix/report it
 *   try {
 *     isRef(str, true);
 *   } catch (err) {
 *     // The error message contains the details as to why the provided value is not a JSON Reference
 *   }
 * }
 */
function isRef (obj, throwWithDetails) {
  return isRefLike(obj, throwWithDetails) && getRefDetails(obj, throwWithDetails).type !== 'invalid';
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
 * `Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 *  the location argument points to an unloadable resource
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

      // Validate options
      options = validateOptions(options, obj);

      // Clone the input so we do not alter it
      obj = clone(obj);
    })
    .then(function () {
      return findRefsRecursive(obj, options, [], [], {
        documents: {},
        refs: {}
      });
    })
    .then(function (allRefs) {
      var deferredRefs = {};
      var refs = {};

      function pathSorter (p1, p2) {
        return pathFromPtr(p1).length - pathFromPtr(p2).length;
      }

      // Resolve all references with a known value
      Object.keys(allRefs.refs).sort(pathSorter).forEach(function (refPtr) {
        var refDetails = allRefs.refs[refPtr];

        // Record all direct references
        if (!refDetails.indirect) {
          refs[refPtr] = refDetails;
        }

        // Delete helper property
        delete refDetails.indirect;

        if (isType(refDetails.error, 'Undefined') && refDetails.type !== 'invalid') {
          if (isType(refDetails.value, 'Undefined') && refDetails.circular) {
            refDetails.value = refDetails.def;
          }

          // We defer processing all references without a value until later
          if (isType(refDetails.value, 'Undefined')) {
            deferredRefs[refPtr] = refDetails;
          } else {
            if (refPtr === '#') {
              obj = refDetails.value;
            } else {
              setValue(obj, pathFromPtr(refPtr), refDetails.value);
            }

            // Delete helper property
            delete refDetails.ancestorPtrs;
          }
        }
      });

      // Resolve all deferred references
      Object.keys(deferredRefs).forEach(function (refPtr) {
        var refDetails = deferredRefs[refPtr];

        // Attempt to resolve the value against all if its ancestors in order
        refDetails.ancestorPtrs.forEach(function (ancestorPtr, index) {
          if (isType(refDetails.value, 'Undefined')) {
            try {
              refDetails.value = findValue(allRefs.documents[ancestorPtr], pathFromPtr(refDetails.uri));

              // Delete helper property
              delete refDetails.ancestorPtrs;

              setValue(obj, pathFromPtr(refPtr), refDetails.value);
            } catch (err) {
              if (index === refDetails.ancestorPtrs.length - 1) {
                refDetails.error = err.message;
                refDetails.missing = true;

                // Delete helper property
                delete refDetails.ancestorPtrs;
              }
            }
          }
        });
      });

      return {
        refs: refs,
        resolved: obj
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
 * `Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 *  the location argument points to an unloadable resource
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
      // Validate the provided location
      if (!isType(location, 'String')) {
        throw new TypeError('location must be a string');
      }

      // Validate options
      options = validateOptions(options);

      // Combine the location and the optional relative base
      location = combineURIs(options.relativeBase, location);

      return getRemoteDocument(location, options);
    })
    .then(function (res) {
      var cOptions = clone(options);
      var uriDetails = parseURI(location);

      // Set the sub document path if necessary
      if (!isType(uriDetails.fragment, 'Undefined')) {
        cOptions.subDocPath = pathFromPtr(decodeURI(uriDetails.fragment));
      }

      // Update the relative base based on the retrieved location
      cOptions.relativeBase = path.dirname(location);

      return resolveRefs(res, cOptions)
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

},{"native-promise-only":3,"path":4,"path-loader":5,"querystring":11,"slash":13,"uri-js":20}],2:[function(require,module,exports){

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  function on() {
    this.off(event, on);
    fn.apply(this, arguments);
  }

  on.fn = fn;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks['$' + event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks['$' + event];
    return this;
  }

  // remove specific handler
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks['$' + event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks['$' + event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

},{}],3:[function(require,module,exports){
(function (global){
/*! Native Promise Only
    v0.8.1 (c) Kyle Simpson
    MIT License: http://getify.mit-license.org
*/

(function UMD(name,context,definition){
	// special form of UMD for polyfilling across evironments
	context[name] = context[name] || definition();
	if (typeof module != "undefined" && module.exports) { module.exports = context[name]; }
	else if (typeof define == "function" && define.amd) { define(function $AMD$(){ return context[name]; }); }
})("Promise",typeof global != "undefined" ? global : this,function DEF(){
	/*jshint validthis:true */
	"use strict";

	var builtInProp, cycle, scheduling_queue,
		ToString = Object.prototype.toString,
		timer = (typeof setImmediate != "undefined") ?
			function timer(fn) { return setImmediate(fn); } :
			setTimeout
	;

	// dammit, IE8.
	try {
		Object.defineProperty({},"x",{});
		builtInProp = function builtInProp(obj,name,val,config) {
			return Object.defineProperty(obj,name,{
				value: val,
				writable: true,
				configurable: config !== false
			});
		};
	}
	catch (err) {
		builtInProp = function builtInProp(obj,name,val) {
			obj[name] = val;
			return obj;
		};
	}

	// Note: using a queue instead of array for efficiency
	scheduling_queue = (function Queue() {
		var first, last, item;

		function Item(fn,self) {
			this.fn = fn;
			this.self = self;
			this.next = void 0;
		}

		return {
			add: function add(fn,self) {
				item = new Item(fn,self);
				if (last) {
					last.next = item;
				}
				else {
					first = item;
				}
				last = item;
				item = void 0;
			},
			drain: function drain() {
				var f = first;
				first = last = cycle = void 0;

				while (f) {
					f.fn.call(f.self);
					f = f.next;
				}
			}
		};
	})();

	function schedule(fn,self) {
		scheduling_queue.add(fn,self);
		if (!cycle) {
			cycle = timer(scheduling_queue.drain);
		}
	}

	// promise duck typing
	function isThenable(o) {
		var _then, o_type = typeof o;

		if (o != null &&
			(
				o_type == "object" || o_type == "function"
			)
		) {
			_then = o.then;
		}
		return typeof _then == "function" ? _then : false;
	}

	function notify() {
		for (var i=0; i<this.chain.length; i++) {
			notifyIsolated(
				this,
				(this.state === 1) ? this.chain[i].success : this.chain[i].failure,
				this.chain[i]
			);
		}
		this.chain.length = 0;
	}

	// NOTE: This is a separate function to isolate
	// the `try..catch` so that other code can be
	// optimized better
	function notifyIsolated(self,cb,chain) {
		var ret, _then;
		try {
			if (cb === false) {
				chain.reject(self.msg);
			}
			else {
				if (cb === true) {
					ret = self.msg;
				}
				else {
					ret = cb.call(void 0,self.msg);
				}

				if (ret === chain.promise) {
					chain.reject(TypeError("Promise-chain cycle"));
				}
				else if (_then = isThenable(ret)) {
					_then.call(ret,chain.resolve,chain.reject);
				}
				else {
					chain.resolve(ret);
				}
			}
		}
		catch (err) {
			chain.reject(err);
		}
	}

	function resolve(msg) {
		var _then, self = this;

		// already triggered?
		if (self.triggered) { return; }

		self.triggered = true;

		// unwrap
		if (self.def) {
			self = self.def;
		}

		try {
			if (_then = isThenable(msg)) {
				schedule(function(){
					var def_wrapper = new MakeDefWrapper(self);
					try {
						_then.call(msg,
							function $resolve$(){ resolve.apply(def_wrapper,arguments); },
							function $reject$(){ reject.apply(def_wrapper,arguments); }
						);
					}
					catch (err) {
						reject.call(def_wrapper,err);
					}
				})
			}
			else {
				self.msg = msg;
				self.state = 1;
				if (self.chain.length > 0) {
					schedule(notify,self);
				}
			}
		}
		catch (err) {
			reject.call(new MakeDefWrapper(self),err);
		}
	}

	function reject(msg) {
		var self = this;

		// already triggered?
		if (self.triggered) { return; }

		self.triggered = true;

		// unwrap
		if (self.def) {
			self = self.def;
		}

		self.msg = msg;
		self.state = 2;
		if (self.chain.length > 0) {
			schedule(notify,self);
		}
	}

	function iteratePromises(Constructor,arr,resolver,rejecter) {
		for (var idx=0; idx<arr.length; idx++) {
			(function IIFE(idx){
				Constructor.resolve(arr[idx])
				.then(
					function $resolver$(msg){
						resolver(idx,msg);
					},
					rejecter
				);
			})(idx);
		}
	}

	function MakeDefWrapper(self) {
		this.def = self;
		this.triggered = false;
	}

	function MakeDef(self) {
		this.promise = self;
		this.state = 0;
		this.triggered = false;
		this.chain = [];
		this.msg = void 0;
	}

	function Promise(executor) {
		if (typeof executor != "function") {
			throw TypeError("Not a function");
		}

		if (this.__NPO__ !== 0) {
			throw TypeError("Not a promise");
		}

		// instance shadowing the inherited "brand"
		// to signal an already "initialized" promise
		this.__NPO__ = 1;

		var def = new MakeDef(this);

		this["then"] = function then(success,failure) {
			var o = {
				success: typeof success == "function" ? success : true,
				failure: typeof failure == "function" ? failure : false
			};
			// Note: `then(..)` itself can be borrowed to be used against
			// a different promise constructor for making the chained promise,
			// by substituting a different `this` binding.
			o.promise = new this.constructor(function extractChain(resolve,reject) {
				if (typeof resolve != "function" || typeof reject != "function") {
					throw TypeError("Not a function");
				}

				o.resolve = resolve;
				o.reject = reject;
			});
			def.chain.push(o);

			if (def.state !== 0) {
				schedule(notify,def);
			}

			return o.promise;
		};
		this["catch"] = function $catch$(failure) {
			return this.then(void 0,failure);
		};

		try {
			executor.call(
				void 0,
				function publicResolve(msg){
					resolve.call(def,msg);
				},
				function publicReject(msg) {
					reject.call(def,msg);
				}
			);
		}
		catch (err) {
			reject.call(def,err);
		}
	}

	var PromisePrototype = builtInProp({},"constructor",Promise,
		/*configurable=*/false
	);

	// Note: Android 4 cannot use `Object.defineProperty(..)` here
	Promise.prototype = PromisePrototype;

	// built-in "brand" to signal an "uninitialized" promise
	builtInProp(PromisePrototype,"__NPO__",0,
		/*configurable=*/false
	);

	builtInProp(Promise,"resolve",function Promise$resolve(msg) {
		var Constructor = this;

		// spec mandated checks
		// note: best "isPromise" check that's practical for now
		if (msg && typeof msg == "object" && msg.__NPO__ === 1) {
			return msg;
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			resolve(msg);
		});
	});

	builtInProp(Promise,"reject",function Promise$reject(msg) {
		return new this(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			reject(msg);
		});
	});

	builtInProp(Promise,"all",function Promise$all(arr) {
		var Constructor = this;

		// spec mandated checks
		if (ToString.call(arr) != "[object Array]") {
			return Constructor.reject(TypeError("Not an array"));
		}
		if (arr.length === 0) {
			return Constructor.resolve([]);
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			var len = arr.length, msgs = Array(len), count = 0;

			iteratePromises(Constructor,arr,function resolver(idx,msg) {
				msgs[idx] = msg;
				if (++count === len) {
					resolve(msgs);
				}
			},reject);
		});
	});

	builtInProp(Promise,"race",function Promise$race(arr) {
		var Constructor = this;

		// spec mandated checks
		if (ToString.call(arr) != "[object Array]") {
			return Constructor.reject(TypeError("Not an array"));
		}

		return new Constructor(function executor(resolve,reject){
			if (typeof resolve != "function" || typeof reject != "function") {
				throw TypeError("Not a function");
			}

			iteratePromises(Constructor,arr,function resolver(idx,msg){
				resolve(msg);
			},reject);
		});
	});

	return Promise;
});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],4:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))

},{"_process":8}],5:[function(require,module,exports){
/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Jeremy Whitlock
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
 * Utility that provides a single API for loading the content of a path/URL.
 *
 * @module PathLoader
 */

var supportedLoaders = {
  file: require('./lib/loaders/file'),
  http: require('./lib/loaders/http'),
  https: require('./lib/loaders/http')
};
var defaultLoader = typeof window === 'object' || typeof importScripts === 'function' ?
      supportedLoaders.http :
      supportedLoaders.file;

// Load promises polyfill if necessary
/* istanbul ignore if */
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

function getScheme (location) {
  if (typeof location !== 'undefined') {
    location = location.indexOf('://') === -1 ? '' : location.split('://')[0];
  }

  return location;
}

/**
 * Callback used to provide access to altering a remote request prior to the request being made.
 *
 * @typedef {function} PrepareRequestCallback
 *
 * @param {object} req - The Superagent request object
 * @param {string} location - The location being retrieved
 * @param {function} callback - First callback
 *
 * @alias module:PathLoader~PrepareRequestCallback
 */

 /**
  * Callback used to provide access to processing the raw response of the request being made. *(HTTP loader only)*
  *
  * @typedef {function} ProcessResponseCallback
  *
  * @param {object} res - The Superagent response object *(For non-HTTP loaders, this object will be like the Superagent
  * object in that it will have a `text` property whose value is the raw string value being processed.  This was done
  * for consistency.)*
  * @param {function} callback - Error-first callback
  *
  * @returns {*} the result of processing the responsexs
  *
  * @alias module:PathLoader~ProcessResponseCallback
  */

function getLoader (location) {
  var scheme = getScheme(location);
  var loader = supportedLoaders[scheme];

  if (typeof loader === 'undefined') {
    if (scheme === '') {
      loader = defaultLoader;
    } else {
      throw new Error('Unsupported scheme: ' + scheme);
    }
  }

  return loader;
}

/**
 * Loads a document at the provided location and returns a JavaScript object representation.
 *
 * @param {object} location - The location to the document
 * @param {object} [options] - The options
 * @param {string} [options.encoding='utf-8'] - The encoding to use when loading the file *(File loader only)*
 * @param {string} [options.method=get] - The HTTP method to use for the request *(HTTP loader only)*
 * @param {module:PathLoader~PrepareRequestCallback} [options.prepareRequest] - The callback used to prepare the request
 * *(HTTP loader only)*
 * @param {module:PathLoader~ProcessResponseCallback} [options.processContent] - The callback used to process the
 * response
 *
 * @returns {Promise} Always returns a promise even if there is a callback provided
 *
 * @example
 * // Example using Promises
 *
 * PathLoader
 *   .load('./package.json')
 *   .then(JSON.parse)
 *   .then(function (document) {
 *     console.log(document.name + ' (' + document.version + '): ' + document.description);
 *   }, function (err) {
 *     console.error(err.stack);
 *   });
 *
 * @example
 * // Example using options.prepareRequest to provide authentication details for a remotely secure URL
 *
 * PathLoader
 *   .load('https://api.github.com/repos/whitlockjc/path-loader', {
 *     prepareRequest: function (req, callback) {
 *       req.auth('my-username', 'my-password');
 *       callback(undefined, req);
 *     }
 *   })
 *   .then(JSON.parse)
 *   .then(function (document) {
 *     console.log(document.full_name + ': ' + document.description);
 *   }, function (err) {
 *     console.error(err.stack);
 *   });
 *
 * @example
 * // Example loading a YAML file
 *
 * PathLoader
 *   .load('/Users/not-you/projects/path-loader/.travis.yml')
 *   .then(YAML.safeLoad)
 *   .then(function (document) {
 *     console.log('path-loader uses the', document.language, 'language.');
 *   }, function (err) {
 *     console.error(err.stack);
 *   });
 *
 * @example
 * // Example loading a YAML file with options.processContent (Useful if you need information in the raw response)
 *
 * PathLoader
 *   .load('/Users/not-you/projects/path-loader/.travis.yml', {
 *     processContent: function (res, callback) {
 *       callback(YAML.safeLoad(res.text));
 *     }
 *   })
 *   .then(function (document) {
 *     console.log('path-loader uses the', document.language, 'language.');
 *   }, function (err) {
 *     console.error(err.stack);
 *   });
 */
module.exports.load = function (location, options) {
  var allTasks = Promise.resolve();

  // Default options to empty object
  if (typeof options === 'undefined') {
    options = {};
  }

  // Validate arguments
  allTasks = allTasks.then(function () {
    if (typeof location === 'undefined') {
      throw new TypeError('location is required');
    } else if (typeof location !== 'string') {
      throw new TypeError('location must be a string');
    }

    if (typeof options !== 'undefined') {
      if (typeof options !== 'object') {
        throw new TypeError('options must be an object');
      } else if (typeof options.processContent !== 'undefined' && typeof options.processContent !== 'function') {
        throw new TypeError('options.processContent must be a function');
      }
    }
  });

  // Load the document from the provided location and process it
  allTasks = allTasks
    .then(function () {
      return new Promise(function (resolve, reject) {
        var loader = getLoader(location);

        loader.load(location, options || {}, function (err, document) {
          if (err) {
            reject(err);
          } else {
            resolve(document);
          }
        });
      });
    })
    .then(function (res) {
      if (options.processContent) {
        return new Promise(function (resolve, reject) {
          // For consistency between file and http, always send an object with a 'text' property containing the raw
          // string value being processed.
          options.processContent(typeof res === 'object' ? res : {text: res}, function (err, processed) {
            if (err) {
              reject(err);
            } else {
              resolve(processed);
            }
          });
        });
      } else {
        // If there was no content processor, we will assume that for all objects that it is a Superagent response
        // and will return its `text` property value.  Otherwise, we will return the raw response.
        return typeof res === 'object' ? res.text : res;
      }
    });

  return allTasks;
};

},{"./lib/loaders/file":6,"./lib/loaders/http":7,"native-promise-only":3}],6:[function(require,module,exports){
/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Jeremy Whitlock
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

var unsupportedError = new TypeError('The \'file\' scheme is not supported in the browser');

/**
 * The file loader is not supported in the browser.
 *
 * @throws {error} the file loader is not supported in the browser
 */
module.exports.getBase = function () {
  throw unsupportedError;
};

/**
 * The file loader is not supported in the browser.
 */
module.exports.load = function () {
  var fn = arguments[arguments.length - 1];

  if (typeof fn === 'function') {
    fn(unsupportedError);
  } else {
    throw unsupportedError;
  }
};

},{}],7:[function(require,module,exports){
/* eslint-env node, browser */

/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Jeremy Whitlock
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

var request = require('superagent');

var supportedHttpMethods = ['delete', 'get', 'head', 'patch', 'post', 'put'];

/**
 * Loads a file from an http or https URL.
 *
 * @param {string} location - The document URL (If relative, location is relative to window.location.origin).
 * @param {object} options - The loader options
 * @param {string} [options.method=get] - The HTTP method to use for the request
 * @param {module:PathLoader~PrepareRequestCallback} [options.prepareRequest] - The callback used to prepare a request
 * @param {module:PathLoader~ProcessResponseCallback} [options.processContent] - The callback used to process the
 * response
 * @param {function} callback - The error-first callback
 */
module.exports.load = function (location, options, callback) {
  var realMethod = options.method ? options.method.toLowerCase() : 'get';
  var err;
  var realRequest;

  function makeRequest (err, req) {
    if (err) {
      callback(err);
    } else {
      // buffer() is only available in Node.js
      if (typeof req.buffer === 'function') {
        req.buffer(true);
      }

      req
        .end(function (err2, res) {
          if (err2) {
            callback(err2);
          } else {
            callback(undefined, res);
          }
        });
    }
  }

  if (typeof options.method !== 'undefined') {
    if (typeof options.method !== 'string') {
      err = new TypeError('options.method must be a string');
    } else if (supportedHttpMethods.indexOf(options.method) === -1) {
      err = new TypeError('options.method must be one of the following: ' +
        supportedHttpMethods.slice(0, supportedHttpMethods.length - 1).join(', ') + ' or ' +
        supportedHttpMethods[supportedHttpMethods.length - 1]);
    }
  } else if (typeof options.prepareRequest !== 'undefined' && typeof options.prepareRequest !== 'function') {
    err = new TypeError('options.prepareRequest must be a function');
  }

  if (!err) {
    realRequest = request[realMethod === 'delete' ? 'del' : realMethod](location);

    if (options.prepareRequest) {
      try {
        options.prepareRequest(realRequest, makeRequest);
      } catch (err2) {
        callback(err2);
      }
    } else {
      makeRequest(undefined, realRequest);
    }
  } else {
    callback(err);
  }
};

},{"superagent":14}],8:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],9:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],10:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],11:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":9,"./encode":10}],12:[function(require,module,exports){

/**
 * Reduce `arr` with `fn`.
 *
 * @param {Array} arr
 * @param {Function} fn
 * @param {Mixed} initial
 *
 * TODO: combatible error handling?
 */

module.exports = function(arr, fn, initial){  
  var idx = 0;
  var len = arr.length;
  var curr = arguments.length == 3
    ? initial
    : arr[idx++];

  while (idx < len) {
    curr = fn.call(null, curr, arr[idx], ++idx, arr);
  }
  
  return curr;
};
},{}],13:[function(require,module,exports){
'use strict';
module.exports = function (str) {
	var isExtendedLengthPath = /^\\\\\?\\/.test(str);
	var hasNonAscii = /[^\x00-\x80]+/.test(str);

	if (isExtendedLengthPath || hasNonAscii) {
		return str;
	}

	return str.replace(/\\/g, '/');
};

},{}],14:[function(require,module,exports){
/**
 * Module dependencies.
 */

var Emitter = require('emitter');
var reduce = require('reduce');

/**
 * Root reference for iframes.
 */

var root;
if (typeof window !== 'undefined') { // Browser window
  root = window;
} else if (typeof self !== 'undefined') { // Web Worker
  root = self;
} else { // Other environments
  root = this;
}

/**
 * Noop.
 */

function noop(){};

/**
 * Check if `obj` is a host object,
 * we don't want to serialize these :)
 *
 * TODO: future proof, move to compoent land
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isHost(obj) {
  var str = {}.toString.call(obj);

  switch (str) {
    case '[object File]':
    case '[object Blob]':
    case '[object FormData]':
      return true;
    default:
      return false;
  }
}

/**
 * Determine XHR.
 */

request.getXHR = function () {
  if (root.XMLHttpRequest
      && (!root.location || 'file:' != root.location.protocol
          || !root.ActiveXObject)) {
    return new XMLHttpRequest;
  } else {
    try { return new ActiveXObject('Microsoft.XMLHTTP'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch(e) {}
  }
  return false;
};

/**
 * Removes leading and trailing whitespace, added to support IE.
 *
 * @param {String} s
 * @return {String}
 * @api private
 */

var trim = ''.trim
  ? function(s) { return s.trim(); }
  : function(s) { return s.replace(/(^\s*|\s*$)/g, ''); };

/**
 * Check if `obj` is an object.
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isObject(obj) {
  return obj === Object(obj);
}

/**
 * Serialize the given `obj`.
 *
 * @param {Object} obj
 * @return {String}
 * @api private
 */

function serialize(obj) {
  if (!isObject(obj)) return obj;
  var pairs = [];
  for (var key in obj) {
    if (null != obj[key]) {
      pushEncodedKeyValuePair(pairs, key, obj[key]);
        }
      }
  return pairs.join('&');
}

/**
 * Helps 'serialize' with serializing arrays.
 * Mutates the pairs array.
 *
 * @param {Array} pairs
 * @param {String} key
 * @param {Mixed} val
 */

function pushEncodedKeyValuePair(pairs, key, val) {
  if (Array.isArray(val)) {
    return val.forEach(function(v) {
      pushEncodedKeyValuePair(pairs, key, v);
    });
  }
  pairs.push(encodeURIComponent(key)
    + '=' + encodeURIComponent(val));
}

/**
 * Expose serialization method.
 */

 request.serializeObject = serialize;

 /**
  * Parse the given x-www-form-urlencoded `str`.
  *
  * @param {String} str
  * @return {Object}
  * @api private
  */

function parseString(str) {
  var obj = {};
  var pairs = str.split('&');
  var parts;
  var pair;

  for (var i = 0, len = pairs.length; i < len; ++i) {
    pair = pairs[i];
    parts = pair.split('=');
    obj[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
  }

  return obj;
}

/**
 * Expose parser.
 */

request.parseString = parseString;

/**
 * Default MIME type map.
 *
 *     superagent.types.xml = 'application/xml';
 *
 */

request.types = {
  html: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  urlencoded: 'application/x-www-form-urlencoded',
  'form': 'application/x-www-form-urlencoded',
  'form-data': 'application/x-www-form-urlencoded'
};

/**
 * Default serialization map.
 *
 *     superagent.serialize['application/xml'] = function(obj){
 *       return 'generated xml here';
 *     };
 *
 */

 request.serialize = {
   'application/x-www-form-urlencoded': serialize,
   'application/json': JSON.stringify
 };

 /**
  * Default parsers.
  *
  *     superagent.parse['application/xml'] = function(str){
  *       return { object parsed from str };
  *     };
  *
  */

request.parse = {
  'application/x-www-form-urlencoded': parseString,
  'application/json': JSON.parse
};

/**
 * Parse the given header `str` into
 * an object containing the mapped fields.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function parseHeader(str) {
  var lines = str.split(/\r?\n/);
  var fields = {};
  var index;
  var line;
  var field;
  var val;

  lines.pop(); // trailing CRLF

  for (var i = 0, len = lines.length; i < len; ++i) {
    line = lines[i];
    index = line.indexOf(':');
    field = line.slice(0, index).toLowerCase();
    val = trim(line.slice(index + 1));
    fields[field] = val;
  }

  return fields;
}

/**
 * Check if `mime` is json or has +json structured syntax suffix.
 *
 * @param {String} mime
 * @return {Boolean}
 * @api private
 */

function isJSON(mime) {
  return /[\/+]json\b/.test(mime);
}

/**
 * Return the mime type for the given `str`.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function type(str){
  return str.split(/ *; */).shift();
};

/**
 * Return header field parameters.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function params(str){
  return reduce(str.split(/ *; */), function(obj, str){
    var parts = str.split(/ *= */)
      , key = parts.shift()
      , val = parts.shift();

    if (key && val) obj[key] = val;
    return obj;
  }, {});
};

/**
 * Initialize a new `Response` with the given `xhr`.
 *
 *  - set flags (.ok, .error, etc)
 *  - parse header
 *
 * Examples:
 *
 *  Aliasing `superagent` as `request` is nice:
 *
 *      request = superagent;
 *
 *  We can use the promise-like API, or pass callbacks:
 *
 *      request.get('/').end(function(res){});
 *      request.get('/', function(res){});
 *
 *  Sending data can be chained:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' })
 *        .end(function(res){});
 *
 *  Or passed to `.send()`:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' }, function(res){});
 *
 *  Or passed to `.post()`:
 *
 *      request
 *        .post('/user', { name: 'tj' })
 *        .end(function(res){});
 *
 * Or further reduced to a single call for simple cases:
 *
 *      request
 *        .post('/user', { name: 'tj' }, function(res){});
 *
 * @param {XMLHTTPRequest} xhr
 * @param {Object} options
 * @api private
 */

function Response(req, options) {
  options = options || {};
  this.req = req;
  this.xhr = this.req.xhr;
  // responseText is accessible only if responseType is '' or 'text' and on older browsers
  this.text = ((this.req.method !='HEAD' && (this.xhr.responseType === '' || this.xhr.responseType === 'text')) || typeof this.xhr.responseType === 'undefined')
     ? this.xhr.responseText
     : null;
  this.statusText = this.req.xhr.statusText;
  this.setStatusProperties(this.xhr.status);
  this.header = this.headers = parseHeader(this.xhr.getAllResponseHeaders());
  // getAllResponseHeaders sometimes falsely returns "" for CORS requests, but
  // getResponseHeader still works. so we get content-type even if getting
  // other headers fails.
  this.header['content-type'] = this.xhr.getResponseHeader('content-type');
  this.setHeaderProperties(this.header);
  this.body = this.req.method != 'HEAD'
    ? this.parseBody(this.text ? this.text : this.xhr.response)
    : null;
}

/**
 * Get case-insensitive `field` value.
 *
 * @param {String} field
 * @return {String}
 * @api public
 */

Response.prototype.get = function(field){
  return this.header[field.toLowerCase()];
};

/**
 * Set header related properties:
 *
 *   - `.type` the content type without params
 *
 * A response of "Content-Type: text/plain; charset=utf-8"
 * will provide you with a `.type` of "text/plain".
 *
 * @param {Object} header
 * @api private
 */

Response.prototype.setHeaderProperties = function(header){
  // content-type
  var ct = this.header['content-type'] || '';
  this.type = type(ct);

  // params
  var obj = params(ct);
  for (var key in obj) this[key] = obj[key];
};

/**
 * Parse the given body `str`.
 *
 * Used for auto-parsing of bodies. Parsers
 * are defined on the `superagent.parse` object.
 *
 * @param {String} str
 * @return {Mixed}
 * @api private
 */

Response.prototype.parseBody = function(str){
  var parse = request.parse[this.type];
  return parse && str && (str.length || str instanceof Object)
    ? parse(str)
    : null;
};

/**
 * Set flags such as `.ok` based on `status`.
 *
 * For example a 2xx response will give you a `.ok` of __true__
 * whereas 5xx will be __false__ and `.error` will be __true__. The
 * `.clientError` and `.serverError` are also available to be more
 * specific, and `.statusType` is the class of error ranging from 1..5
 * sometimes useful for mapping respond colors etc.
 *
 * "sugar" properties are also defined for common cases. Currently providing:
 *
 *   - .noContent
 *   - .badRequest
 *   - .unauthorized
 *   - .notAcceptable
 *   - .notFound
 *
 * @param {Number} status
 * @api private
 */

Response.prototype.setStatusProperties = function(status){
  // handle IE9 bug: http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
  if (status === 1223) {
    status = 204;
  }

  var type = status / 100 | 0;

  // status / class
  this.status = this.statusCode = status;
  this.statusType = type;

  // basics
  this.info = 1 == type;
  this.ok = 2 == type;
  this.clientError = 4 == type;
  this.serverError = 5 == type;
  this.error = (4 == type || 5 == type)
    ? this.toError()
    : false;

  // sugar
  this.accepted = 202 == status;
  this.noContent = 204 == status;
  this.badRequest = 400 == status;
  this.unauthorized = 401 == status;
  this.notAcceptable = 406 == status;
  this.notFound = 404 == status;
  this.forbidden = 403 == status;
};

/**
 * Return an `Error` representative of this response.
 *
 * @return {Error}
 * @api public
 */

Response.prototype.toError = function(){
  var req = this.req;
  var method = req.method;
  var url = req.url;

  var msg = 'cannot ' + method + ' ' + url + ' (' + this.status + ')';
  var err = new Error(msg);
  err.status = this.status;
  err.method = method;
  err.url = url;

  return err;
};

/**
 * Expose `Response`.
 */

request.Response = Response;

/**
 * Initialize a new `Request` with the given `method` and `url`.
 *
 * @param {String} method
 * @param {String} url
 * @api public
 */

function Request(method, url) {
  var self = this;
  Emitter.call(this);
  this._query = this._query || [];
  this.method = method;
  this.url = url;
  this.header = {};
  this._header = {};
  this.on('end', function(){
    var err = null;
    var res = null;

    try {
      res = new Response(self);
    } catch(e) {
      err = new Error('Parser is unable to parse the response');
      err.parse = true;
      err.original = e;
      // issue #675: return the raw response if the response parsing fails
      err.rawResponse = self.xhr && self.xhr.responseText ? self.xhr.responseText : null;
      return self.callback(err);
    }

    self.emit('response', res);

    if (err) {
      return self.callback(err, res);
    }

    if (res.status >= 200 && res.status < 300) {
      return self.callback(err, res);
    }

    var new_err = new Error(res.statusText || 'Unsuccessful HTTP response');
    new_err.original = err;
    new_err.response = res;
    new_err.status = res.status;

    self.callback(new_err, res);
  });
}

/**
 * Mixin `Emitter`.
 */

Emitter(Request.prototype);

/**
 * Allow for extension
 */

Request.prototype.use = function(fn) {
  fn(this);
  return this;
}

/**
 * Set timeout to `ms`.
 *
 * @param {Number} ms
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.timeout = function(ms){
  this._timeout = ms;
  return this;
};

/**
 * Clear previous timeout.
 *
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.clearTimeout = function(){
  this._timeout = 0;
  clearTimeout(this._timer);
  return this;
};

/**
 * Abort the request, and clear potential timeout.
 *
 * @return {Request}
 * @api public
 */

Request.prototype.abort = function(){
  if (this.aborted) return;
  this.aborted = true;
  this.xhr.abort();
  this.clearTimeout();
  this.emit('abort');
  return this;
};

/**
 * Set header `field` to `val`, or multiple fields with one object.
 *
 * Examples:
 *
 *      req.get('/')
 *        .set('Accept', 'application/json')
 *        .set('X-API-Key', 'foobar')
 *        .end(callback);
 *
 *      req.get('/')
 *        .set({ Accept: 'application/json', 'X-API-Key': 'foobar' })
 *        .end(callback);
 *
 * @param {String|Object} field
 * @param {String} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.set = function(field, val){
  if (isObject(field)) {
    for (var key in field) {
      this.set(key, field[key]);
    }
    return this;
  }
  this._header[field.toLowerCase()] = val;
  this.header[field] = val;
  return this;
};

/**
 * Remove header `field`.
 *
 * Example:
 *
 *      req.get('/')
 *        .unset('User-Agent')
 *        .end(callback);
 *
 * @param {String} field
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.unset = function(field){
  delete this._header[field.toLowerCase()];
  delete this.header[field];
  return this;
};

/**
 * Get case-insensitive header `field` value.
 *
 * @param {String} field
 * @return {String}
 * @api private
 */

Request.prototype.getHeader = function(field){
  return this._header[field.toLowerCase()];
};

/**
 * Set Content-Type to `type`, mapping values from `request.types`.
 *
 * Examples:
 *
 *      superagent.types.xml = 'application/xml';
 *
 *      request.post('/')
 *        .type('xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('application/xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 * @param {String} type
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.type = function(type){
  this.set('Content-Type', request.types[type] || type);
  return this;
};

/**
 * Force given parser
 *
 * Sets the body parser no matter type.
 *
 * @param {Function}
 * @api public
 */

Request.prototype.parse = function(fn){
  this._parser = fn;
  return this;
};

/**
 * Set Accept to `type`, mapping values from `request.types`.
 *
 * Examples:
 *
 *      superagent.types.json = 'application/json';
 *
 *      request.get('/agent')
 *        .accept('json')
 *        .end(callback);
 *
 *      request.get('/agent')
 *        .accept('application/json')
 *        .end(callback);
 *
 * @param {String} accept
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.accept = function(type){
  this.set('Accept', request.types[type] || type);
  return this;
};

/**
 * Set Authorization field value with `user` and `pass`.
 *
 * @param {String} user
 * @param {String} pass
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.auth = function(user, pass){
  var str = btoa(user + ':' + pass);
  this.set('Authorization', 'Basic ' + str);
  return this;
};

/**
* Add query-string `val`.
*
* Examples:
*
*   request.get('/shoes')
*     .query('size=10')
*     .query({ color: 'blue' })
*
* @param {Object|String} val
* @return {Request} for chaining
* @api public
*/

Request.prototype.query = function(val){
  if ('string' != typeof val) val = serialize(val);
  if (val) this._query.push(val);
  return this;
};

/**
 * Write the field `name` and `val` for "multipart/form-data"
 * request bodies.
 *
 * ``` js
 * request.post('/upload')
 *   .field('foo', 'bar')
 *   .end(callback);
 * ```
 *
 * @param {String} name
 * @param {String|Blob|File} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.field = function(name, val){
  if (!this._formData) this._formData = new root.FormData();
  this._formData.append(name, val);
  return this;
};

/**
 * Queue the given `file` as an attachment to the specified `field`,
 * with optional `filename`.
 *
 * ``` js
 * request.post('/upload')
 *   .attach(new Blob(['<a id="a"><b id="b">hey!</b></a>'], { type: "text/html"}))
 *   .end(callback);
 * ```
 *
 * @param {String} field
 * @param {Blob|File} file
 * @param {String} filename
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.attach = function(field, file, filename){
  if (!this._formData) this._formData = new root.FormData();
  this._formData.append(field, file, filename || file.name);
  return this;
};

/**
 * Send `data` as the request body, defaulting the `.type()` to "json" when
 * an object is given.
 *
 * Examples:
 *
 *       // manual json
 *       request.post('/user')
 *         .type('json')
 *         .send('{"name":"tj"}')
 *         .end(callback)
 *
 *       // auto json
 *       request.post('/user')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // manual x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send('name=tj')
 *         .end(callback)
 *
 *       // auto x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // defaults to x-www-form-urlencoded
  *      request.post('/user')
  *        .send('name=tobi')
  *        .send('species=ferret')
  *        .end(callback)
 *
 * @param {String|Object} data
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.send = function(data){
  var obj = isObject(data);
  var type = this.getHeader('Content-Type');

  // merge
  if (obj && isObject(this._data)) {
    for (var key in data) {
      this._data[key] = data[key];
    }
  } else if ('string' == typeof data) {
    if (!type) this.type('form');
    type = this.getHeader('Content-Type');
    if ('application/x-www-form-urlencoded' == type) {
      this._data = this._data
        ? this._data + '&' + data
        : data;
    } else {
      this._data = (this._data || '') + data;
    }
  } else {
    this._data = data;
  }

  if (!obj || isHost(data)) return this;
  if (!type) this.type('json');
  return this;
};

/**
 * Invoke the callback with `err` and `res`
 * and handle arity check.
 *
 * @param {Error} err
 * @param {Response} res
 * @api private
 */

Request.prototype.callback = function(err, res){
  var fn = this._callback;
  this.clearTimeout();
  fn(err, res);
};

/**
 * Invoke callback with x-domain error.
 *
 * @api private
 */

Request.prototype.crossDomainError = function(){
  var err = new Error('Request has been terminated\nPossible causes: the network is offline, Origin is not allowed by Access-Control-Allow-Origin, the page is being unloaded, etc.');
  err.crossDomain = true;

  err.status = this.status;
  err.method = this.method;
  err.url = this.url;

  this.callback(err);
};

/**
 * Invoke callback with timeout error.
 *
 * @api private
 */

Request.prototype.timeoutError = function(){
  var timeout = this._timeout;
  var err = new Error('timeout of ' + timeout + 'ms exceeded');
  err.timeout = timeout;
  this.callback(err);
};

/**
 * Enable transmission of cookies with x-domain requests.
 *
 * Note that for this to work the origin must not be
 * using "Access-Control-Allow-Origin" with a wildcard,
 * and also must set "Access-Control-Allow-Credentials"
 * to "true".
 *
 * @api public
 */

Request.prototype.withCredentials = function(){
  this._withCredentials = true;
  return this;
};

/**
 * Initiate request, invoking callback `fn(res)`
 * with an instanceof `Response`.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.end = function(fn){
  var self = this;
  var xhr = this.xhr = request.getXHR();
  var query = this._query.join('&');
  var timeout = this._timeout;
  var data = this._formData || this._data;

  // store callback
  this._callback = fn || noop;

  // state change
  xhr.onreadystatechange = function(){
    if (4 != xhr.readyState) return;

    // In IE9, reads to any property (e.g. status) off of an aborted XHR will
    // result in the error "Could not complete the operation due to error c00c023f"
    var status;
    try { status = xhr.status } catch(e) { status = 0; }

    if (0 == status) {
      if (self.timedout) return self.timeoutError();
      if (self.aborted) return;
      return self.crossDomainError();
    }
    self.emit('end');
  };

  // progress
  var handleProgress = function(e){
    if (e.total > 0) {
      e.percent = e.loaded / e.total * 100;
    }
    e.direction = 'download';
    self.emit('progress', e);
  };
  if (this.hasListeners('progress')) {
    xhr.onprogress = handleProgress;
  }
  try {
    if (xhr.upload && this.hasListeners('progress')) {
      xhr.upload.onprogress = handleProgress;
    }
  } catch(e) {
    // Accessing xhr.upload fails in IE from a web worker, so just pretend it doesn't exist.
    // Reported here:
    // https://connect.microsoft.com/IE/feedback/details/837245/xmlhttprequest-upload-throws-invalid-argument-when-used-from-web-worker-context
  }

  // timeout
  if (timeout && !this._timer) {
    this._timer = setTimeout(function(){
      self.timedout = true;
      self.abort();
    }, timeout);
  }

  // querystring
  if (query) {
    query = request.serializeObject(query);
    this.url += ~this.url.indexOf('?')
      ? '&' + query
      : '?' + query;
  }

  // initiate request
  xhr.open(this.method, this.url, true);

  // CORS
  if (this._withCredentials) xhr.withCredentials = true;

  // body
  if ('GET' != this.method && 'HEAD' != this.method && 'string' != typeof data && !isHost(data)) {
    // serialize stuff
    var contentType = this.getHeader('Content-Type');
    var serialize = this._parser || request.serialize[contentType ? contentType.split(';')[0] : ''];
    if (!serialize && isJSON(contentType)) serialize = request.serialize['application/json'];
    if (serialize) data = serialize(data);
  }

  // set header fields
  for (var field in this.header) {
    if (null == this.header[field]) continue;
    xhr.setRequestHeader(field, this.header[field]);
  }

  // send stuff
  this.emit('request', this);

  // IE11 xhr.send(undefined) sends 'undefined' string as POST payload (instead of nothing)
  // We need null here if data is undefined
  xhr.send(typeof data !== 'undefined' ? data : null);
  return this;
};

/**
 * Faux promise support
 *
 * @param {Function} fulfill
 * @param {Function} reject
 * @return {Request}
 */

Request.prototype.then = function (fulfill, reject) {
  return this.end(function(err, res) {
    err ? reject(err) : fulfill(res);
  });
}

/**
 * Expose `Request`.
 */

request.Request = Request;

/**
 * Issue a request:
 *
 * Examples:
 *
 *    request('GET', '/users').end(callback)
 *    request('/users').end(callback)
 *    request('/users', callback)
 *
 * @param {String} method
 * @param {String|Function} url or callback
 * @return {Request}
 * @api public
 */

function request(method, url) {
  // callback
  if ('function' == typeof url) {
    return new Request('GET', method).end(url);
  }

  // url first
  if (1 == arguments.length) {
    return new Request('GET', method);
  }

  return new Request(method, url);
}

/**
 * GET `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.get = function(url, data, fn){
  var req = request('GET', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.query(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * HEAD `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.head = function(url, data, fn){
  var req = request('HEAD', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * DELETE `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

function del(url, fn){
  var req = request('DELETE', url);
  if (fn) req.end(fn);
  return req;
};

request['del'] = del;
request['delete'] = del;

/**
 * PATCH `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} data
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.patch = function(url, data, fn){
  var req = request('PATCH', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * POST `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} data
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.post = function(url, data, fn){
  var req = request('POST', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * PUT `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.put = function(url, data, fn){
  var req = request('PUT', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * Expose `request`.
 */

module.exports = request;

},{"emitter":2,"reduce":12}],15:[function(require,module,exports){
/*! https://mths.be/punycode v1.3.2 by @mathias, modified for URI.js */

var punycode = (function () {

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw new RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * https://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		version: '1.3.2',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		ucs2: {
			decode: ucs2decode,
			encode: ucs2encode
		},
		decode: decode,
		encode: encode,
		toASCII: toASCII,
		toUnicode: toUnicode
	};

	return punycode;
}());

if (typeof COMPILED === "undefined" && typeof module !== "undefined") module.exports = punycode;
},{}],16:[function(require,module,exports){
///<reference path="commonjs.d.ts"/>
require("./schemes/http");
require("./schemes/urn");
require("./schemes/mailto");

},{"./schemes/http":17,"./schemes/mailto":18,"./schemes/urn":19}],17:[function(require,module,exports){
///<reference path="../uri.ts"/>
if (typeof COMPILED === "undefined" && typeof URI === "undefined" && typeof require === "function")
    var URI = require("../uri");
URI.SCHEMES["http"] = URI.SCHEMES["https"] = {
    domainHost: true,
    parse: function (components, options) {
        //report missing host
        if (!components.host) {
            components.error = components.error || "HTTP URIs must have a host.";
        }
        return components;
    },
    serialize: function (components, options) {
        //normalize the default port
        if (components.port === (String(components.scheme).toLowerCase() !== "https" ? 80 : 443) || components.port === "") {
            components.port = undefined;
        }
        //normalize the empty path
        if (!components.path) {
            components.path = "/";
        }
        //NOTE: We do not parse query strings for HTTP URIs
        //as WWW Form Url Encoded query strings are part of the HTML4+ spec,
        //and not the HTTP spec. 
        return components;
    }
};

},{"../uri":20}],18:[function(require,module,exports){
///<reference path="../uri.ts"/>
if (typeof COMPILED === "undefined" && typeof URI === "undefined" && typeof require === "function") {
    var URI = require("../uri"), punycode = require("../punycode");
}
(function () {
    function merge() {
        var sets = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            sets[_i - 0] = arguments[_i];
        }
        if (sets.length > 1) {
            sets[0] = sets[0].slice(0, -1);
            var xl = sets.length - 1;
            for (var x = 1; x < xl; ++x) {
                sets[x] = sets[x].slice(1, -1);
            }
            sets[xl] = sets[xl].slice(1);
            return sets.join('');
        }
        else {
            return sets[0];
        }
    }
    function subexp(str) {
        return "(?:" + str + ")";
    }
    var O = {}, isIRI = URI.IRI_SUPPORT, 
    //RFC 3986
    UNRESERVED$$ = "[A-Za-z0-9\\-\\.\\_\\~" + (isIRI ? "\\xA0-\\u200D\\u2010-\\u2029\\u202F-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF" : "") + "]", HEXDIG$$ = "[0-9A-Fa-f]", PCT_ENCODED$ = subexp(subexp("%[EFef]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%[89A-Fa-f]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%" + HEXDIG$$ + HEXDIG$$)), 
    //RFC 5322, except these symbols as per RFC 6068: @ : / ? # [ ] & ; = 
    //ATEXT$$ = "[A-Za-z0-9\\!\\#\\$\\%\\&\\'\\*\\+\\-\\/\\=\\?\\^\\_\\`\\{\\|\\}\\~]",
    //WSP$$ = "[\\x20\\x09]",
    //OBS_QTEXT$$ = "[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]",  //(%d1-8 / %d11-12 / %d14-31 / %d127)
    //QTEXT$$ = merge("[\\x21\\x23-\\x5B\\x5D-\\x7E]", OBS_QTEXT$$),  //%d33 / %d35-91 / %d93-126 / obs-qtext
    //VCHAR$$ = "[\\x21-\\x7E]",
    //WSP$$ = "[\\x20\\x09]",
    //OBS_QP$ = subexp("\\\\" + merge("[\\x00\\x0D\\x0A]", OBS_QTEXT$$)),  //%d0 / CR / LF / obs-qtext
    //FWS$ = subexp(subexp(WSP$$ + "*" + "\\x0D\\x0A") + "?" + WSP$$ + "+"),
    //QUOTED_PAIR$ = subexp(subexp("\\\\" + subexp(VCHAR$$ + "|" + WSP$$)) + "|" + OBS_QP$),
    //QUOTED_STRING$ = subexp('\\"' + subexp(FWS$ + "?" + QCONTENT$) + "*" + FWS$ + "?" + '\\"'),
    ATEXT$$ = "[A-Za-z0-9\\!\\$\\%\\'\\*\\+\\-\\^\\_\\`\\{\\|\\}\\~]", QTEXT$$ = "[\\!\\$\\%\\'\\(\\)\\*\\+\\,\\-\\.0-9\\<\\>A-Z\\x5E-\\x7E]", VCHAR$$ = merge(QTEXT$$, "[\\\"\\\\]"), DOT_ATOM_TEXT$ = subexp(ATEXT$$ + "+" + subexp("\\." + ATEXT$$ + "+") + "*"), QUOTED_PAIR$ = subexp("\\\\" + VCHAR$$), QCONTENT$ = subexp(QTEXT$$ + "|" + QUOTED_PAIR$), QUOTED_STRING$ = subexp('\\"' + QCONTENT$ + "*" + '\\"'), 
    //RFC 6068
    DTEXT_NO_OBS$$ = "[\\x21-\\x5A\\x5E-\\x7E]", SOME_DELIMS$$ = "[\\!\\$\\'\\(\\)\\*\\+\\,\\;\\:\\@]", QCHAR$ = subexp(UNRESERVED$$ + "|" + PCT_ENCODED$ + "|" + SOME_DELIMS$$), DOMAIN$ = subexp(DOT_ATOM_TEXT$ + "|" + "\\[" + DTEXT_NO_OBS$$ + "*" + "\\]"), LOCAL_PART$ = subexp(DOT_ATOM_TEXT$ + "|" + QUOTED_STRING$), ADDR_SPEC$ = subexp(LOCAL_PART$ + "\\@" + DOMAIN$), TO$ = subexp(ADDR_SPEC$ + subexp("\\," + ADDR_SPEC$) + "*"), HFNAME$ = subexp(QCHAR$ + "*"), HFVALUE$ = HFNAME$, HFIELD$ = subexp(HFNAME$ + "\\=" + HFVALUE$), HFIELDS2$ = subexp(HFIELD$ + subexp("\\&" + HFIELD$) + "*"), HFIELDS$ = subexp("\\?" + HFIELDS2$), MAILTO_URI = URI.VALIDATE_SUPPORT && new RegExp("^mailto\\:" + TO$ + "?" + HFIELDS$ + "?$"), UNRESERVED = new RegExp(UNRESERVED$$, "g"), PCT_ENCODED = new RegExp(PCT_ENCODED$, "g"), NOT_LOCAL_PART = new RegExp(merge("[^]", ATEXT$$, "[\\.]", '[\\"]', VCHAR$$), "g"), NOT_DOMAIN = new RegExp(merge("[^]", ATEXT$$, "[\\.]", "[\\[]", DTEXT_NO_OBS$$, "[\\]]"), "g"), NOT_HFNAME = new RegExp(merge("[^]", UNRESERVED$$, SOME_DELIMS$$), "g"), NOT_HFVALUE = NOT_HFNAME, TO = URI.VALIDATE_SUPPORT && new RegExp("^" + TO$ + "$"), HFIELDS = URI.VALIDATE_SUPPORT && new RegExp("^" + HFIELDS2$ + "$");
    function toUpperCase(str) {
        return str.toUpperCase();
    }
    function decodeUnreserved(str) {
        var decStr = URI.pctDecChars(str);
        return (!decStr.match(UNRESERVED) ? str : decStr);
    }
    function toArray(obj) {
        return obj !== undefined && obj !== null ? (obj instanceof Array && !obj.callee ? obj : (typeof obj.length !== "number" || obj.split || obj.setInterval || obj.call ? [obj] : Array.prototype.slice.call(obj))) : [];
    }
    URI.SCHEMES["mailto"] = {
        parse: function (components, options) {
            if (URI.VALIDATE_SUPPORT && !components.error) {
                if (components.path && !TO.test(components.path)) {
                    components.error = "Email address is not valid";
                }
                else if (components.query && !HFIELDS.test(components.query)) {
                    components.error = "Header fields are invalid";
                }
            }
            var to = components.to = (components.path ? components.path.split(",") : []);
            components.path = undefined;
            if (components.query) {
                var unknownHeaders = false, headers = {};
                var hfields = components.query.split("&");
                for (var x = 0, xl = hfields.length; x < xl; ++x) {
                    var hfield = hfields[x].split("=");
                    switch (hfield[0]) {
                        case "to":
                            var toAddrs = hfield[1].split(",");
                            for (var x_1 = 0, xl_1 = toAddrs.length; x_1 < xl_1; ++x_1) {
                                to.push(toAddrs[x_1]);
                            }
                            break;
                        case "subject":
                            components.subject = URI.unescapeComponent(hfield[1], options);
                            break;
                        case "body":
                            components.body = URI.unescapeComponent(hfield[1], options);
                            break;
                        default:
                            unknownHeaders = true;
                            headers[URI.unescapeComponent(hfield[0], options)] = URI.unescapeComponent(hfield[1], options);
                            break;
                    }
                }
                if (unknownHeaders)
                    components.headers = headers;
            }
            components.query = undefined;
            for (var x = 0, xl = to.length; x < xl; ++x) {
                var addr = to[x].split("@");
                addr[0] = URI.unescapeComponent(addr[0]);
                if (typeof punycode !== "undefined" && !options.unicodeSupport) {
                    //convert Unicode IDN -> ASCII IDN
                    try {
                        addr[1] = punycode.toASCII(URI.unescapeComponent(addr[1], options).toLowerCase());
                    }
                    catch (e) {
                        components.error = components.error || "Email address's domain name can not be converted to ASCII via punycode: " + e;
                    }
                }
                else {
                    addr[1] = URI.unescapeComponent(addr[1], options).toLowerCase();
                }
                to[x] = addr.join("@");
            }
            return components;
        },
        serialize: function (components, options) {
            var to = toArray(components.to);
            if (to) {
                for (var x = 0, xl = to.length; x < xl; ++x) {
                    var toAddr = String(to[x]);
                    var atIdx = toAddr.lastIndexOf("@");
                    var localPart = toAddr.slice(0, atIdx);
                    var domain = toAddr.slice(atIdx + 1);
                    localPart = localPart.replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_LOCAL_PART, URI.pctEncChar);
                    if (typeof punycode !== "undefined") {
                        //convert IDN via punycode
                        try {
                            domain = (!options.iri ? punycode.toASCII(URI.unescapeComponent(domain, options).toLowerCase()) : punycode.toUnicode(domain));
                        }
                        catch (e) {
                            components.error = components.error || "Email address's domain name can not be converted to " + (!options.iri ? "ASCII" : "Unicode") + " via punycode: " + e;
                        }
                    }
                    else {
                        domain = domain.replace(PCT_ENCODED, decodeUnreserved).toLowerCase().replace(PCT_ENCODED, toUpperCase).replace(NOT_DOMAIN, URI.pctEncChar);
                    }
                    to[x] = localPart + "@" + domain;
                }
                components.path = to.join(",");
            }
            var headers = components.headers = components.headers || {};
            if (components.subject)
                headers["subject"] = components.subject;
            if (components.body)
                headers["body"] = components.body;
            var fields = [];
            for (var name_1 in headers) {
                if (headers[name_1] !== O[name_1]) {
                    fields.push(name_1.replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_HFNAME, URI.pctEncChar) +
                        "=" +
                        headers[name_1].replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_HFVALUE, URI.pctEncChar));
                }
            }
            if (fields.length) {
                components.query = fields.join("&");
            }
            return components;
        }
    };
})();

},{"../punycode":15,"../uri":20}],19:[function(require,module,exports){
///<reference path="../uri.ts"/>
if (typeof COMPILED === "undefined" && typeof URI === "undefined" && typeof require === "function")
    var URI = require("../uri");
(function () {
    var pctEncChar = URI.pctEncChar, NID$ = "(?:[0-9A-Za-z][0-9A-Za-z\\-]{1,31})", PCT_ENCODED$ = "(?:\\%[0-9A-Fa-f]{2})", TRANS$$ = "[0-9A-Za-z\\(\\)\\+\\,\\-\\.\\:\\=\\@\\;\\$\\_\\!\\*\\'\\/\\?\\#]", NSS$ = "(?:(?:" + PCT_ENCODED$ + "|" + TRANS$$ + ")+)", URN_SCHEME = new RegExp("^urn\\:(" + NID$ + ")$"), URN_PATH = new RegExp("^(" + NID$ + ")\\:(" + NSS$ + ")$"), URN_PARSE = /^([^\:]+)\:(.*)/, URN_EXCLUDED = /[\x00-\x20\\\"\&\<\>\[\]\^\`\{\|\}\~\x7F-\xFF]/g, UUID = /^[0-9A-Fa-f]{8}(?:\-[0-9A-Fa-f]{4}){3}\-[0-9A-Fa-f]{12}$/;
    //RFC 2141
    URI.SCHEMES["urn"] = {
        parse: function (components, options) {
            var matches = components.path.match(URN_PATH), scheme, schemeHandler;
            if (!matches) {
                if (!options.tolerant) {
                    components.error = components.error || "URN is not strictly valid.";
                }
                matches = components.path.match(URN_PARSE);
            }
            if (matches) {
                scheme = "urn:" + matches[1].toLowerCase();
                schemeHandler = URI.SCHEMES[scheme];
                //in order to serialize properly, 
                //every URN must have a serializer that calls the URN serializer 
                if (!schemeHandler) {
                    //create fake scheme handler
                    schemeHandler = URI.SCHEMES[scheme] = {
                        parse: function (components, options) {
                            return components;
                        },
                        serialize: URI.SCHEMES["urn"].serialize
                    };
                }
                components.scheme = scheme;
                components.path = matches[2];
                components = schemeHandler.parse(components, options);
            }
            else {
                components.error = components.error || "URN can not be parsed.";
            }
            return components;
        },
        serialize: function (components, options) {
            var scheme = components.scheme || options.scheme, matches;
            if (scheme && scheme !== "urn") {
                var matches = scheme.match(URN_SCHEME);
                if (!matches) {
                    matches = ["urn:" + scheme, scheme];
                }
                components.scheme = "urn";
                components.path = matches[1] + ":" + (components.path ? components.path.replace(URN_EXCLUDED, pctEncChar) : "");
            }
            return components;
        }
    };
    //RFC 4122
    URI.SCHEMES["urn:uuid"] = {
        parse: function (components, options) {
            if (!options.tolerant && (!components.path || !components.path.match(UUID))) {
                components.error = components.error || "UUID is not valid.";
            }
            return components;
        },
        serialize: function (components, options) {
            //ensure UUID is valid
            if (!options.tolerant && (!components.path || !components.path.match(UUID))) {
                //invalid UUIDs can not have this scheme
                components.scheme = undefined;
            }
            else {
                //normalize UUID
                components.path = (components.path || "").toLowerCase();
            }
            return URI.SCHEMES["urn"].serialize(components, options);
        }
    };
}());

},{"../uri":20}],20:[function(require,module,exports){
/**
 * URI.js
 *
 * @fileoverview An RFC 3986 compliant, scheme extendable URI parsing/validating/resolving library for JavaScript.
 * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
 * @version 2.0.0
 * @see http://github.com/garycourt/uri-js
 * @license URI.js v2.0.0 (c) 2011 Gary Court. License: http://github.com/garycourt/uri-js
 */
/**
 * Copyright 2011 Gary Court. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are
 * permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice, this list of
 *       conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright notice, this list
 *       of conditions and the following disclaimer in the documentation and/or other materials
 *       provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY GARY COURT ``AS IS'' AND ANY EXPRESS OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GARY COURT OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
 * ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The views and conclusions contained in the software and documentation are those of the
 * authors and should not be interpreted as representing official policies, either expressed
 * or implied, of Gary Court.
 */
///<reference path="punycode.d.ts"/>
///<reference path="commonjs.d.ts"/>
/**
 * Compiler switch for indicating code is compiled
 * @define {boolean}
 */
var COMPILED = false;
/**
 * Compiler switch for supporting IRI URIs
 * @define {boolean}
 */
var URI__IRI_SUPPORT = true;
/**
 * Compiler switch for supporting URI validation
 * @define {boolean}
 */
var URI__VALIDATE_SUPPORT = true;
var URI = (function () {
    function merge() {
        var sets = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            sets[_i - 0] = arguments[_i];
        }
        if (sets.length > 1) {
            sets[0] = sets[0].slice(0, -1);
            var xl = sets.length - 1;
            for (var x = 1; x < xl; ++x) {
                sets[x] = sets[x].slice(1, -1);
            }
            sets[xl] = sets[xl].slice(1);
            return sets.join('');
        }
        else {
            return sets[0];
        }
    }
    function subexp(str) {
        return "(?:" + str + ")";
    }
    function buildExps(isIRI) {
        var ALPHA$$ = "[A-Za-z]", CR$ = "[\\x0D]", DIGIT$$ = "[0-9]", DQUOTE$$ = "[\\x22]", HEXDIG$$ = merge(DIGIT$$, "[A-Fa-f]"), LF$$ = "[\\x0A]", SP$$ = "[\\x20]", PCT_ENCODED$ = subexp(subexp("%[EFef]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%[89A-Fa-f]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%" + HEXDIG$$ + HEXDIG$$)), GEN_DELIMS$$ = "[\\:\\/\\?\\#\\[\\]\\@]", SUB_DELIMS$$ = "[\\!\\$\\&\\'\\(\\)\\*\\+\\,\\;\\=]", RESERVED$$ = merge(GEN_DELIMS$$, SUB_DELIMS$$), UCSCHAR$$ = isIRI ? "[\\xA0-\\u200D\\u2010-\\u2029\\u202F-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF]" : "[]", IPRIVATE$$ = isIRI ? "[\\uE000-\\uF8FF]" : "[]", UNRESERVED$$ = merge(ALPHA$$, DIGIT$$, "[\\-\\.\\_\\~]", UCSCHAR$$), SCHEME$ = subexp(ALPHA$$ + merge(ALPHA$$, DIGIT$$, "[\\+\\-\\.]") + "*"), USERINFO$ = subexp(subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:]")) + "*"), DEC_OCTET$ = subexp(subexp("25[0-5]") + "|" + subexp("2[0-4]" + DIGIT$$) + "|" + subexp("1" + DIGIT$$ + DIGIT$$) + "|" + subexp("[1-9]" + DIGIT$$) + "|" + DIGIT$$), IPV4ADDRESS$ = subexp(DEC_OCTET$ + "\\." + DEC_OCTET$ + "\\." + DEC_OCTET$ + "\\." + DEC_OCTET$), H16$ = subexp(HEXDIG$$ + "{1,4}"), LS32$ = subexp(subexp(H16$ + "\\:" + H16$) + "|" + IPV4ADDRESS$), IPV6ADDRESS$ = subexp(merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:]") + "+"), IPVFUTURE$ = subexp("v" + HEXDIG$$ + "+\\." + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:]") + "+"), IP_LITERAL$ = subexp("\\[" + subexp(IPV6ADDRESS$ + "|" + IPVFUTURE$) + "\\]"), REG_NAME$ = subexp(subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$)) + "*"), HOST$ = subexp(IP_LITERAL$ + "|" + IPV4ADDRESS$ + "(?!" + REG_NAME$ + ")" + "|" + REG_NAME$), PORT$ = subexp(DIGIT$$ + "*"), AUTHORITY$ = subexp(subexp(USERINFO$ + "@") + "?" + HOST$ + subexp("\\:" + PORT$) + "?"), PCHAR$ = subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:\\@]")), SEGMENT$ = subexp(PCHAR$ + "*"), SEGMENT_NZ$ = subexp(PCHAR$ + "+"), SEGMENT_NZ_NC$ = subexp(subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\@]")) + "+"), PATH_ABEMPTY$ = subexp(subexp("\\/" + SEGMENT$) + "*"), PATH_ABSOLUTE$ = subexp("\\/" + subexp(SEGMENT_NZ$ + PATH_ABEMPTY$) + "?"), PATH_NOSCHEME$ = subexp(SEGMENT_NZ_NC$ + PATH_ABEMPTY$), PATH_ROOTLESS$ = subexp(SEGMENT_NZ$ + PATH_ABEMPTY$), PATH_EMPTY$ = "(?!" + PCHAR$ + ")", PATH$ = subexp(PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_NOSCHEME$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$), QUERY$ = subexp(subexp(PCHAR$ + "|" + merge("[\\/\\?]", IPRIVATE$$)) + "*"), FRAGMENT$ = subexp(subexp(PCHAR$ + "|[\\/\\?]") + "*"), HIER_PART$ = subexp(subexp("\\/\\/" + AUTHORITY$ + PATH_ABEMPTY$) + "|" + PATH_ABSOLUTE$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$), URI$ = subexp(SCHEME$ + "\\:" + HIER_PART$ + subexp("\\?" + QUERY$) + "?" + subexp("\\#" + FRAGMENT$) + "?"), RELATIVE_PART$ = subexp(subexp("\\/\\/" + AUTHORITY$ + PATH_ABEMPTY$) + "|" + PATH_ABSOLUTE$ + "|" + PATH_NOSCHEME$ + "|" + PATH_EMPTY$), RELATIVE$ = subexp(RELATIVE_PART$ + subexp("\\?" + QUERY$) + "?" + subexp("\\#" + FRAGMENT$) + "?"), URI_REFERENCE$ = subexp(URI$ + "|" + RELATIVE$), ABSOLUTE_URI$ = subexp(SCHEME$ + "\\:" + HIER_PART$ + subexp("\\?" + QUERY$) + "?"), GENERIC_REF$ = "^(" + SCHEME$ + ")\\:" + subexp(subexp("\\/\\/(" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?)") + "?(" + PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$ + ")") + subexp("\\?(" + QUERY$ + ")") + "?" + subexp("\\#(" + FRAGMENT$ + ")") + "?$", RELATIVE_REF$ = "^(){0}" + subexp(subexp("\\/\\/(" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?)") + "?(" + PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_NOSCHEME$ + "|" + PATH_EMPTY$ + ")") + subexp("\\?(" + QUERY$ + ")") + "?" + subexp("\\#(" + FRAGMENT$ + ")") + "?$", ABSOLUTE_REF$ = "^(" + SCHEME$ + ")\\:" + subexp(subexp("\\/\\/(" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?)") + "?(" + PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$ + ")") + subexp("\\?(" + QUERY$ + ")") + "?$", SAMEDOC_REF$ = "^" + subexp("\\#(" + FRAGMENT$ + ")") + "?$", AUTHORITY_REF$ = "^" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?$";
        return {
            URI_REF: URI__VALIDATE_SUPPORT && new RegExp("(" + GENERIC_REF$ + ")|(" + RELATIVE_REF$ + ")"),
            NOT_SCHEME: new RegExp(merge("[^]", ALPHA$$, DIGIT$$, "[\\+\\-\\.]"), "g"),
            NOT_USERINFO: new RegExp(merge("[^\\%\\:]", UNRESERVED$$, SUB_DELIMS$$), "g"),
            NOT_HOST: new RegExp(merge("[^\\%]", UNRESERVED$$, SUB_DELIMS$$), "g"),
            NOT_PATH: new RegExp(merge("[^\\%\\/\\:\\@]", UNRESERVED$$, SUB_DELIMS$$), "g"),
            NOT_PATH_NOSCHEME: new RegExp(merge("[^\\%\\/\\@]", UNRESERVED$$, SUB_DELIMS$$), "g"),
            NOT_QUERY: new RegExp(merge("[^\\%]", UNRESERVED$$, SUB_DELIMS$$, "[\\:\\@\\/\\?]", IPRIVATE$$), "g"),
            NOT_FRAGMENT: new RegExp(merge("[^\\%]", UNRESERVED$$, SUB_DELIMS$$, "[\\:\\@\\/\\?]"), "g"),
            ESCAPE: new RegExp(merge("[^]", UNRESERVED$$, SUB_DELIMS$$), "g"),
            UNRESERVED: new RegExp(UNRESERVED$$, "g"),
            OTHER_CHARS: new RegExp(merge("[^\\%]", UNRESERVED$$, RESERVED$$), "g"),
            PCT_ENCODED: new RegExp(PCT_ENCODED$, "g")
        };
    }
    var URI_PROTOCOL = buildExps(false), IRI_PROTOCOL = URI__IRI_SUPPORT ? buildExps(true) : undefined, URI_PARSE = /^(?:([^:\/?#]+):)?(?:\/\/((?:([^\/?#@]*)@)?([^\/?#:]*)(?:\:(\d*))?))?([^?#]*)(?:\?([^#]*))?(?:#((?:.|\n)*))?/i, RDS1 = /^\.\.?\//, RDS2 = /^\/\.(\/|$)/, RDS3 = /^\/\.\.(\/|$)/, RDS4 = /^\.\.?$/, RDS5 = /^\/?(?:.|\n)*?(?=\/|$)/, NO_MATCH_IS_UNDEFINED = ("").match(/(){0}/)[1] === undefined;
    function pctEncChar(chr) {
        var c = chr.charCodeAt(0), e;
        if (c < 16)
            e = "%0" + c.toString(16).toUpperCase();
        else if (c < 128)
            e = "%" + c.toString(16).toUpperCase();
        else if (c < 2048)
            e = "%" + ((c >> 6) | 192).toString(16).toUpperCase() + "%" + ((c & 63) | 128).toString(16).toUpperCase();
        else
            e = "%" + ((c >> 12) | 224).toString(16).toUpperCase() + "%" + (((c >> 6) & 63) | 128).toString(16).toUpperCase() + "%" + ((c & 63) | 128).toString(16).toUpperCase();
        return e;
    }
    function pctDecChars(str) {
        var newStr = "", i = 0, il = str.length, c, c2, c3;
        while (i < il) {
            c = parseInt(str.substr(i + 1, 2), 16);
            if (c < 128) {
                newStr += String.fromCharCode(c);
                i += 3;
            }
            else if (c >= 194 && c < 224) {
                if ((il - i) >= 6) {
                    c2 = parseInt(str.substr(i + 4, 2), 16);
                    newStr += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                }
                else {
                    newStr += str.substr(i, 6);
                }
                i += 6;
            }
            else if (c >= 224) {
                if ((il - i) >= 9) {
                    c2 = parseInt(str.substr(i + 4, 2), 16);
                    c3 = parseInt(str.substr(i + 7, 2), 16);
                    newStr += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                }
                else {
                    newStr += str.substr(i, 9);
                }
                i += 9;
            }
            else {
                newStr += str.substr(i, 3);
                i += 3;
            }
        }
        return newStr;
    }
    function typeOf(o) {
        return o === undefined ? "undefined" : (o === null ? "null" : Object.prototype.toString.call(o).split(" ").pop().split("]").shift().toLowerCase());
    }
    function toUpperCase(str) {
        return str.toUpperCase();
    }
    var SCHEMES = {};
    function _normalizeComponentEncoding(components, protocol) {
        function decodeUnreserved(str) {
            var decStr = pctDecChars(str);
            return (!decStr.match(protocol.UNRESERVED) ? str : decStr);
        }
        if (components.scheme)
            components.scheme = String(components.scheme).replace(protocol.PCT_ENCODED, decodeUnreserved).toLowerCase().replace(protocol.NOT_SCHEME, "");
        if (components.userinfo !== undefined)
            components.userinfo = String(components.userinfo).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_USERINFO, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
        if (components.host !== undefined)
            components.host = String(components.host).replace(protocol.PCT_ENCODED, decodeUnreserved).toLowerCase().replace(protocol.NOT_HOST, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
        if (components.path !== undefined)
            components.path = String(components.path).replace(protocol.PCT_ENCODED, decodeUnreserved).replace((components.scheme ? protocol.NOT_PATH : protocol.NOT_PATH_NOSCHEME), pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
        if (components.query !== undefined)
            components.query = String(components.query).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_QUERY, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
        if (components.fragment !== undefined)
            components.fragment = String(components.fragment).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_FRAGMENT, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
        return components;
    }
    ;
    function parse(uriString, options) {
        if (options === void 0) { options = {}; }
        var protocol = (URI__IRI_SUPPORT && options.iri !== false ? IRI_PROTOCOL : URI_PROTOCOL), matches, parseError = false, components = {}, schemeHandler;
        if (options.reference === "suffix")
            uriString = (options.scheme ? options.scheme + ":" : "") + "//" + uriString;
        if (URI__VALIDATE_SUPPORT) {
            matches = uriString.match(protocol.URI_REF);
            if (matches) {
                if (matches[1]) {
                    //generic URI
                    matches = matches.slice(1, 10);
                }
                else {
                    //relative URI
                    matches = matches.slice(10, 19);
                }
            }
            if (!matches) {
                parseError = true;
                if (!options.tolerant)
                    components.error = components.error || "URI is not strictly valid.";
                matches = uriString.match(URI_PARSE);
            }
        }
        else {
            matches = uriString.match(URI_PARSE);
        }
        if (matches) {
            if (NO_MATCH_IS_UNDEFINED) {
                //store each component
                components.scheme = matches[1];
                //components.authority = matches[2];
                components.userinfo = matches[3];
                components.host = matches[4];
                components.port = parseInt(matches[5], 10);
                components.path = matches[6] || "";
                components.query = matches[7];
                components.fragment = matches[8];
                //fix port number
                if (isNaN(components.port)) {
                    components.port = matches[5];
                }
            }
            else {
                //store each component
                components.scheme = matches[1] || undefined;
                //components.authority = (uriString.indexOf("//") !== -1 ? matches[2] : undefined);
                components.userinfo = (uriString.indexOf("@") !== -1 ? matches[3] : undefined);
                components.host = (uriString.indexOf("//") !== -1 ? matches[4] : undefined);
                components.port = parseInt(matches[5], 10);
                components.path = matches[6] || "";
                components.query = (uriString.indexOf("?") !== -1 ? matches[7] : undefined);
                components.fragment = (uriString.indexOf("#") !== -1 ? matches[8] : undefined);
                //fix port number
                if (isNaN(components.port)) {
                    components.port = (uriString.match(/\/\/(?:.|\n)*\:(?:\/|\?|\#|$)/) ? matches[4] : undefined);
                }
            }
            //determine reference type
            if (components.scheme === undefined && components.userinfo === undefined && components.host === undefined && components.port === undefined && !components.path && components.query === undefined) {
                components.reference = "same-document";
            }
            else if (components.scheme === undefined) {
                components.reference = "relative";
            }
            else if (components.fragment === undefined) {
                components.reference = "absolute";
            }
            else {
                components.reference = "uri";
            }
            //check for reference errors
            if (options.reference && options.reference !== "suffix" && options.reference !== components.reference) {
                components.error = components.error || "URI is not a " + options.reference + " reference.";
            }
            //find scheme handler
            schemeHandler = SCHEMES[(options.scheme || components.scheme || "").toLowerCase()];
            //check if scheme can't handle IRIs
            if (URI__IRI_SUPPORT && typeof punycode !== "undefined" && !options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
                //if host component is a domain name
                if (components.host && (options.domainHost || (schemeHandler && schemeHandler.domainHost))) {
                    //convert Unicode IDN -> ASCII IDN
                    try {
                        components.host = punycode.toASCII(components.host.replace(protocol.PCT_ENCODED, pctDecChars).toLowerCase());
                    }
                    catch (e) {
                        components.error = components.error || "Host's domain name can not be converted to ASCII via punycode: " + e;
                    }
                }
                //convert IRI -> URI
                _normalizeComponentEncoding(components, URI_PROTOCOL);
            }
            else {
                //normalize encodings
                _normalizeComponentEncoding(components, protocol);
            }
            //perform scheme specific parsing
            if (schemeHandler && schemeHandler.parse) {
                schemeHandler.parse(components, options);
            }
        }
        else {
            parseError = true;
            components.error = components.error || "URI can not be parsed.";
        }
        return components;
    }
    ;
    function _recomposeAuthority(components, options) {
        var uriTokens = [];
        if (components.userinfo !== undefined) {
            uriTokens.push(components.userinfo);
            uriTokens.push("@");
        }
        if (components.host !== undefined) {
            uriTokens.push(components.host);
        }
        if (typeof components.port === "number") {
            uriTokens.push(":");
            uriTokens.push(components.port.toString(10));
        }
        return uriTokens.length ? uriTokens.join("") : undefined;
    }
    ;
    function removeDotSegments(input) {
        var output = [], s;
        while (input.length) {
            if (input.match(RDS1)) {
                input = input.replace(RDS1, "");
            }
            else if (input.match(RDS2)) {
                input = input.replace(RDS2, "/");
            }
            else if (input.match(RDS3)) {
                input = input.replace(RDS3, "/");
                output.pop();
            }
            else if (input === "." || input === "..") {
                input = "";
            }
            else {
                s = input.match(RDS5)[0];
                input = input.slice(s.length);
                output.push(s);
            }
        }
        return output.join("");
    }
    ;
    function serialize(components, options) {
        if (options === void 0) { options = {}; }
        var protocol = (URI__IRI_SUPPORT && options.iri ? IRI_PROTOCOL : URI_PROTOCOL), uriTokens = [], schemeHandler, authority, s;
        //find scheme handler
        schemeHandler = SCHEMES[(options.scheme || components.scheme || "").toLowerCase()];
        //perform scheme specific serialization
        if (schemeHandler && schemeHandler.serialize)
            schemeHandler.serialize(components, options);
        //if host component is a domain name
        if (URI__IRI_SUPPORT && typeof punycode !== "undefined" && components.host && (options.domainHost || (schemeHandler && schemeHandler.domainHost))) {
            //convert IDN via punycode
            try {
                components.host = (!options.iri ? punycode.toASCII(components.host.replace(protocol.PCT_ENCODED, pctDecChars).toLowerCase()) : punycode.toUnicode(components.host));
            }
            catch (e) {
                components.error = components.error || "Host's domain name can not be converted to " + (!options.iri ? "ASCII" : "Unicode") + " via punycode: " + e;
            }
        }
        //normalize encoding
        _normalizeComponentEncoding(components, protocol);
        if (options.reference !== "suffix" && components.scheme) {
            uriTokens.push(components.scheme);
            uriTokens.push(":");
        }
        authority = _recomposeAuthority(components, options);
        if (authority !== undefined) {
            if (options.reference !== "suffix") {
                uriTokens.push("//");
            }
            uriTokens.push(authority);
            if (components.path && components.path.charAt(0) !== "/") {
                uriTokens.push("/");
            }
        }
        if (components.path !== undefined) {
            s = components.path;
            if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
                s = removeDotSegments(s);
            }
            if (authority === undefined) {
                s = s.replace(/^\/\//, "/%2F"); //don't allow the path to start with "//"
            }
            uriTokens.push(s);
        }
        if (components.query !== undefined) {
            uriTokens.push("?");
            uriTokens.push(components.query);
        }
        if (components.fragment !== undefined) {
            uriTokens.push("#");
            uriTokens.push(components.fragment);
        }
        return uriTokens.join(''); //merge tokens into a string
    }
    ;
    function resolveComponents(base, relative, options, skipNormalization) {
        if (options === void 0) { options = {}; }
        var target = {};
        if (!skipNormalization) {
            base = parse(serialize(base, options), options); //normalize base components
            relative = parse(serialize(relative, options), options); //normalize relative components
        }
        options = options || {};
        if (!options.tolerant && relative.scheme) {
            target.scheme = relative.scheme;
            //target.authority = relative.authority;
            target.userinfo = relative.userinfo;
            target.host = relative.host;
            target.port = relative.port;
            target.path = removeDotSegments(relative.path);
            target.query = relative.query;
        }
        else {
            if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
                //target.authority = relative.authority;
                target.userinfo = relative.userinfo;
                target.host = relative.host;
                target.port = relative.port;
                target.path = removeDotSegments(relative.path);
                target.query = relative.query;
            }
            else {
                if (!relative.path) {
                    target.path = base.path;
                    if (relative.query !== undefined) {
                        target.query = relative.query;
                    }
                    else {
                        target.query = base.query;
                    }
                }
                else {
                    if (relative.path.charAt(0) === "/") {
                        target.path = removeDotSegments(relative.path);
                    }
                    else {
                        if ((base.userinfo !== undefined || base.host !== undefined || base.port !== undefined) && !base.path) {
                            target.path = "/" + relative.path;
                        }
                        else if (!base.path) {
                            target.path = relative.path;
                        }
                        else {
                            target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
                        }
                        target.path = removeDotSegments(target.path);
                    }
                    target.query = relative.query;
                }
                //target.authority = base.authority;
                target.userinfo = base.userinfo;
                target.host = base.host;
                target.port = base.port;
            }
            target.scheme = base.scheme;
        }
        target.fragment = relative.fragment;
        return target;
    }
    ;
    function resolve(baseURI, relativeURI, options) {
        return serialize(resolveComponents(parse(baseURI, options), parse(relativeURI, options), options, true), options);
    }
    ;
    function normalize(uri, options) {
        if (typeof uri === "string") {
            uri = serialize(parse(uri, options), options);
        }
        else if (typeOf(uri) === "object") {
            uri = parse(serialize(uri, options), options);
        }
        return uri;
    }
    ;
    function equal(uriA, uriB, options) {
        if (typeof uriA === "string") {
            uriA = serialize(parse(uriA, options), options);
        }
        else if (typeOf(uriA) === "object") {
            uriA = serialize(uriA, options);
        }
        if (typeof uriB === "string") {
            uriB = serialize(parse(uriB, options), options);
        }
        else if (typeOf(uriB) === "object") {
            uriB = serialize(uriB, options);
        }
        return uriA === uriB;
    }
    ;
    function escapeComponent(str, options) {
        return str && str.toString().replace((!URI__IRI_SUPPORT || !options || !options.iri ? URI_PROTOCOL.ESCAPE : IRI_PROTOCOL.ESCAPE), pctEncChar);
    }
    ;
    function unescapeComponent(str, options) {
        return str && str.toString().replace((!URI__IRI_SUPPORT || !options || !options.iri ? URI_PROTOCOL.PCT_ENCODED : IRI_PROTOCOL.PCT_ENCODED), pctDecChars);
    }
    ;
    return {
        IRI_SUPPORT: URI__IRI_SUPPORT,
        VALIDATE_SUPPORT: URI__VALIDATE_SUPPORT,
        pctEncChar: pctEncChar,
        pctDecChars: pctDecChars,
        SCHEMES: SCHEMES,
        parse: parse,
        _recomposeAuthority: _recomposeAuthority,
        removeDotSegments: removeDotSegments,
        serialize: serialize,
        resolveComponents: resolveComponents,
        resolve: resolve,
        normalize: normalize,
        equal: equal,
        escapeComponent: escapeComponent,
        unescapeComponent: unescapeComponent
    };
})();
if (!COMPILED && typeof module !== "undefined" && typeof require === "function") {
    var punycode = require("./punycode");
    module.exports = URI;
    require("./schemes");
}

},{"./punycode":15,"./schemes":16}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9jb21wb25lbnQtZW1pdHRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L2xpYi9ucG8uc3JjLmpzIiwibm9kZV9tb2R1bGVzL3BhdGgtYnJvd3NlcmlmeS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9saWIvbG9hZGVycy9maWxlLWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcGF0aC1sb2FkZXIvbGliL2xvYWRlcnMvaHR0cC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcXVlcnlzdHJpbmctZXMzL2RlY29kZS5qcyIsIm5vZGVfbW9kdWxlcy9xdWVyeXN0cmluZy1lczMvZW5jb2RlLmpzIiwibm9kZV9tb2R1bGVzL3F1ZXJ5c3RyaW5nLWVzMy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9yZWR1Y2UtY29tcG9uZW50L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3NsYXNoL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3N1cGVyYWdlbnQvbGliL2NsaWVudC5qcyIsIm5vZGVfbW9kdWxlcy91cmktanMvYnVpbGQvcHVueWNvZGUuanMiLCJub2RlX21vZHVsZXMvdXJpLWpzL2J1aWxkL3NjaGVtZXMuanMiLCJub2RlX21vZHVsZXMvdXJpLWpzL2J1aWxkL3NjaGVtZXMvaHR0cC5qcyIsIm5vZGVfbW9kdWxlcy91cmktanMvYnVpbGQvc2NoZW1lcy9tYWlsdG8uanMiLCJub2RlX21vZHVsZXMvdXJpLWpzL2J1aWxkL3NjaGVtZXMvdXJuLmpzIiwibm9kZV9tb2R1bGVzL3VyaS1qcy9idWlsZC91cmkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdHpDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3JYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNCBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBWYXJpb3VzIHV0aWxpdGllcyBmb3IgSlNPTiBSZWZlcmVuY2VzICooaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtcGJyeWFuLXp5cC1qc29uLXJlZi0wMykqIGFuZFxuICogSlNPTiBQb2ludGVycyAqKGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxKSouXG4gKlxuICogQG1vZHVsZSBKc29uUmVmc1xuICovXG5cbnZhciBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xudmFyIFBhdGhMb2FkZXIgPSByZXF1aXJlKCdwYXRoLWxvYWRlcicpO1xudmFyIHFzID0gcmVxdWlyZSgncXVlcnlzdHJpbmcnKTtcbnZhciBzbGFzaCA9IHJlcXVpcmUoJ3NsYXNoJyk7XG52YXIgVVJJID0gcmVxdWlyZSgndXJpLWpzJyk7XG5cbnZhciBiYWRQdHJUb2tlblJlZ2V4ID0gL34oPzpbXjAxXXwkKS9nO1xudmFyIHJlbW90ZUNhY2hlID0ge307XG52YXIgcmVtb3RlVHlwZXMgPSBbJ3JlbGF0aXZlJywgJ3JlbW90ZSddO1xudmFyIHJlbW90ZVVyaVR5cGVzID0gWydhYnNvbHV0ZScsICd1cmknXTtcbnZhciB1cmlEZXRhaWxzQ2FjaGUgPSB7fTtcblxuLy8gTG9hZCBwcm9taXNlcyBwb2x5ZmlsbCBpZiBuZWNlc3Nhcnlcbi8qIGlzdGFuYnVsIGlnbm9yZSBpZiAqL1xuaWYgKHR5cGVvZiBQcm9taXNlID09PSAndW5kZWZpbmVkJykge1xuICByZXF1aXJlKCduYXRpdmUtcHJvbWlzZS1vbmx5Jyk7XG59XG5cbi8qIEludGVybmFsIEZ1bmN0aW9ucyAqL1xuXG4vLyBUaGlzIGlzIGEgdmVyeSBzaW1wbGlzdGljIGNsb25lIGZ1bmN0aW9uIHRoYXQgZG9lcyBub3QgdGFrZSBpbnRvIGFjY291bnQgbm9uLUpTT04gdHlwZXMuICBGb3IgdGhlc2UgdHlwZXMgdGhlXG4vLyBvcmlnaW5hbCB2YWx1ZSBpcyB1c2VkIGFzIHRoZSBjbG9uZS4gIFNvIHdoaWxlIGl0J3Mgbm90IGEgY29tcGxldGUgZGVlcCBjbG9uZSwgZm9yIHRoZSBuZWVkcyBvZiB0aGlzIHByb2plY3Rcbi8vIHRoaXMgc2hvdWxkIGJlIHN1ZmZpY2llbnQuXG5mdW5jdGlvbiBjbG9uZSAob2JqKSB7XG4gIHZhciBjbG9uZWQ7XG5cbiAgaWYgKGlzVHlwZShvYmosICdBcnJheScpKSB7XG4gICAgY2xvbmVkID0gW107XG5cbiAgICBvYmouZm9yRWFjaChmdW5jdGlvbiAodmFsdWUsIGluZGV4KSB7XG4gICAgICBjbG9uZWRbaW5kZXhdID0gY2xvbmUodmFsdWUpO1xuICAgIH0pO1xuICB9IGVsc2UgaWYgKGlzVHlwZShvYmosICdPYmplY3QnKSkge1xuICAgIGNsb25lZCA9IHt9O1xuXG4gICAgT2JqZWN0LmtleXMob2JqKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGNsb25lZFtrZXldID0gY2xvbmUob2JqW2tleV0pO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGNsb25lZCA9IG9iajtcbiAgfVxuXG4gIHJldHVybiBjbG9uZWQ7XG59XG5cbmZ1bmN0aW9uIGNvbWJpbmVRdWVyeVBhcmFtcyAocXMxLCBxczIpIHtcbiAgdmFyIGNvbWJpbmVkID0ge307XG5cbiAgZnVuY3Rpb24gbWVyZ2VRdWVyeVBhcmFtcyAob2JqKSB7XG4gICAgT2JqZWN0LmtleXMob2JqKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGNvbWJpbmVkW2tleV0gPSBvYmpba2V5XTtcbiAgICB9KTtcbiAgfVxuXG4gIG1lcmdlUXVlcnlQYXJhbXMocXMucGFyc2UocXMxIHx8ICcnKSk7XG4gIG1lcmdlUXVlcnlQYXJhbXMocXMucGFyc2UocXMyIHx8ICcnKSk7XG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKGNvbWJpbmVkKS5sZW5ndGggPT09IDAgPyB1bmRlZmluZWQgOiBxcy5zdHJpbmdpZnkoY29tYmluZWQpO1xufVxuXG5mdW5jdGlvbiBjb21iaW5lVVJJcyAodTEsIHUyKSB7XG4gIC8vIENvbnZlcnQgV2luZG93cyBwYXRoc1xuICBpZiAoaXNUeXBlKHUxLCAnU3RyaW5nJykpIHtcbiAgICB1MSA9IHNsYXNoKHUxKTtcbiAgfVxuXG4gIGlmIChpc1R5cGUodTIsICdTdHJpbmcnKSkge1xuICAgIHUyID0gc2xhc2godTIpO1xuICB9XG5cbiAgdmFyIHUyRGV0YWlscyA9IHBhcnNlVVJJKGlzVHlwZSh1MiwgJ1VuZGVmaW5lZCcpID8gJycgOiB1Mik7XG4gIHZhciB1MURldGFpbHM7XG4gIHZhciBjb21iaW5lZERldGFpbHM7XG5cbiAgaWYgKHJlbW90ZVVyaVR5cGVzLmluZGV4T2YodTJEZXRhaWxzLnJlZmVyZW5jZSkgPiAtMSkge1xuICAgIGNvbWJpbmVkRGV0YWlscyA9IHUyRGV0YWlscztcbiAgfSBlbHNlIHtcbiAgICB1MURldGFpbHMgPSBpc1R5cGUodTEsICdVbmRlZmluZWQnKSA/IHVuZGVmaW5lZCA6IHBhcnNlVVJJKHUxKTtcblxuICAgIGlmICghaXNUeXBlKHUxRGV0YWlscywgJ1VuZGVmaW5lZCcpKSB7XG4gICAgICBjb21iaW5lZERldGFpbHMgPSB1MURldGFpbHM7XG5cbiAgICAgIC8vIEpvaW4gdGhlIHBhdGhzXG4gICAgICBjb21iaW5lZERldGFpbHMucGF0aCA9IHBhdGguam9pbih1MURldGFpbHMucGF0aCwgdTJEZXRhaWxzLnBhdGgpO1xuXG4gICAgICAvLyBKb2luIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICAgIGNvbWJpbmVkRGV0YWlscy5xdWVyeSA9IGNvbWJpbmVRdWVyeVBhcmFtcyh1MURldGFpbHMucXVlcnksIHUyRGV0YWlscy5xdWVyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbWJpbmVkRGV0YWlscyA9IHUyRGV0YWlscztcbiAgICB9XG4gIH1cblxuICAvLyBSZW1vdmUgdGhlIGZyYWdtZW50XG4gIGNvbWJpbmVkRGV0YWlscy5mcmFnbWVudCA9IHVuZGVmaW5lZDtcblxuICAvLyBGb3IgcmVsYXRpdmUgVVJJcywgYWRkIGJhY2sgdGhlICcuLicgc2luY2UgaXQgd2FzIHJlbW92ZWQgYWJvdmVcbiAgcmV0dXJuIChyZW1vdGVVcmlUeXBlcy5pbmRleE9mKGNvbWJpbmVkRGV0YWlscy5yZWZlcmVuY2UpID09PSAtMSAmJlxuICAgICAgICAgIGNvbWJpbmVkRGV0YWlscy5wYXRoLmluZGV4T2YoJy4uLycpID09PSAwID8gJy4uLycgOiAnJykgKyBVUkkuc2VyaWFsaXplKGNvbWJpbmVkRGV0YWlscyk7XG59XG5cbmZ1bmN0aW9uIGZpbmRBbmNlc3RvcnMgKG9iaiwgcGF0aCkge1xuICB2YXIgYW5jZXN0b3JzID0gW107XG4gIHZhciBub2RlO1xuXG4gIGlmIChwYXRoLmxlbmd0aCA+IDApIHtcbiAgICBub2RlID0gb2JqO1xuXG4gICAgcGF0aC5zbGljZSgwLCBwYXRoLmxlbmd0aCAtIDEpLmZvckVhY2goZnVuY3Rpb24gKHNlZykge1xuICAgICAgaWYgKHNlZyBpbiBub2RlKSB7XG4gICAgICAgIG5vZGUgPSBub2RlW3NlZ107XG5cbiAgICAgICAgYW5jZXN0b3JzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYW5jZXN0b3JzO1xufVxuXG5mdW5jdGlvbiBwcm9jZXNzU3ViRG9jdW1lbnQgKG1vZGUsIGRvYywgc3ViRG9jUGF0aCwgcmVmRGV0YWlscywgb3B0aW9ucywgcGFyZW50cywgcGFyZW50UHRycywgYWxsUmVmcywgaW5kaXJlY3QpIHtcbiAgdmFyIHJlZlZhbHVlO1xuICB2YXIgck9wdGlvbnM7XG5cbiAgaWYgKHN1YkRvY1BhdGgubGVuZ3RoID4gMCkge1xuICAgIHRyeSB7XG4gICAgICByZWZWYWx1ZSA9IGZpbmRWYWx1ZShkb2MsIHN1YkRvY1BhdGgpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLy8gV2Ugb25seSBtYXJrIG1pc3NpbmcgcmVtb3RlIHJlZmVyZW5jZXMgYXMgbWlzc2luZyBiZWNhdXNlIGxvY2FsIHJlZmVyZW5jZXMgY2FuIGhhdmUgZGVmZXJyZWQgdmFsdWVzXG4gICAgICBpZiAobW9kZSA9PT0gJ3JlbW90ZScpIHtcbiAgICAgICAgcmVmRGV0YWlscy5lcnJvciA9IGVyci5tZXNzYWdlO1xuICAgICAgICByZWZEZXRhaWxzLm1pc3NpbmcgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICByZWZWYWx1ZSA9IGRvYztcbiAgfVxuXG4gIGlmICghaXNUeXBlKHJlZlZhbHVlLCAnVW5kZWZpbmVkJykpIHtcbiAgICByZWZEZXRhaWxzLnZhbHVlID0gcmVmVmFsdWU7XG4gIH1cblxuICBpZiAoaXNUeXBlKHJlZlZhbHVlLCAnQXJyYXknKSB8fCBpc1R5cGUocmVmVmFsdWUsICdPYmplY3QnKSkge1xuICAgIHJPcHRpb25zID0gY2xvbmUob3B0aW9ucyk7XG5cbiAgICBpZiAobW9kZSA9PT0gJ2xvY2FsJykge1xuICAgICAgZGVsZXRlIHJPcHRpb25zLnN1YkRvY1BhdGg7XG5cbiAgICAgIC8vIFRyYXZlcnNlIHRoZSBkZXJlZmVyZW5jZWQgdmFsdWVcbiAgICAgIGRvYyA9IHJlZlZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICByT3B0aW9ucy5yZWxhdGl2ZUJhc2UgPSBwYXRoLmRpcm5hbWUocGFyZW50c1twYXJlbnRzLmxlbmd0aCAtIDFdKTtcblxuICAgICAgaWYgKHN1YkRvY1BhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGRlbGV0ZSByT3B0aW9ucy5zdWJEb2NQYXRoO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgck9wdGlvbnMuc3ViRG9jUGF0aCA9IHN1YkRvY1BhdGg7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbmRSZWZzUmVjdXJzaXZlKGRvYywgck9wdGlvbnMsIHBhcmVudHMsIHBhcmVudFB0cnMsIGFsbFJlZnMsIGluZGlyZWN0KTtcbiAgfVxufVxuXG4vLyBTaG91bGQgdGhpcyBiZSBpdHMgb3duIGV4cG9ydGVkIEFQST9cbmZ1bmN0aW9uIGZpbmRSZWZzUmVjdXJzaXZlIChvYmosIG9wdGlvbnMsIHBhcmVudHMsIHBhcmVudFB0cnMsIGFsbFJlZnMsIGluZGlyZWN0KSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuICB2YXIgcGFyZW50UGF0aCA9IHBhcmVudFB0cnMubGVuZ3RoID8gcGF0aEZyb21QdHIocGFyZW50UHRyc1twYXJlbnRQdHJzLmxlbmd0aCAtIDFdKSA6IFtdO1xuICB2YXIgcmVmcyA9IGZpbmRSZWZzKG9iaiwgb3B0aW9ucyk7XG4gIHZhciBzdWJEb2NQYXRoID0gb3B0aW9ucy5zdWJEb2NQYXRoIHx8IFtdO1xuICB2YXIgc3ViRG9jUHRyID0gcGF0aFRvUHRyKHN1YkRvY1BhdGgpO1xuICB2YXIgYW5jZXN0b3JQdHJzID0gWycjJ107XG5cbiAgcGFyZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChwYXJlbnQsIGluZGV4KSB7XG4gICAgaWYgKHBhcmVudC5jaGFyQXQoMCkgIT09ICcjJykge1xuICAgICAgYW5jZXN0b3JQdHJzLnB1c2gocGFyZW50UHRyc1tpbmRleF0pO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gUmV2ZXJzZSB0aGUgb3JkZXIgc28gd2Ugc2VhcmNoIHRoZW0gaW4gdGhlIHByb3BlciBvcmRlclxuICBhbmNlc3RvclB0cnMucmV2ZXJzZSgpO1xuXG4gIGlmICgocGFyZW50c1twYXJlbnRzLmxlbmd0aCAtIDFdIHx8ICcnKS5jaGFyQXQoMCkgIT09ICcjJykge1xuICAgIGFsbFJlZnMuZG9jdW1lbnRzW3BhdGhUb1B0cihwYXJlbnRQYXRoKV0gPSBvYmo7XG4gIH1cblxuICBPYmplY3Qua2V5cyhyZWZzKS5mb3JFYWNoKGZ1bmN0aW9uIChyZWZQdHIpIHtcbiAgICB2YXIgcmVmRGV0YWlscyA9IHJlZnNbcmVmUHRyXTtcbiAgICB2YXIgbG9jYXRpb247XG4gICAgdmFyIHBhcmVudEluZGV4O1xuICAgIHZhciByZWZGdWxsUGF0aDtcbiAgICB2YXIgcmVmRnVsbFB0cjtcblxuICAgIC8vIElmIHRoZXJlIGFyZSBubyBwYXJlbnRzLCB0cmVhdCB0aGUgcmVmZXJlbmNlIHBvaW50ZXIgYXMtaXMuICBPdGhlcndpc2UsIHRoZSByZWZlcmVuY2UgaXMgYSByZWZlcmVuY2Ugd2l0aGluIGFcbiAgICAvLyByZW1vdGUgZG9jdW1lbnQgYW5kIGl0cyBzdWIgZG9jdW1lbnQgcGF0aCBwcmVmaXggbXVzdCBiZSByZW1vdmVkLlxuICAgIGlmIChwYXJlbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVmRnVsbFBhdGggPSBwYXJlbnRQYXRoLmNvbmNhdChwYXRoRnJvbVB0cihyZWZQdHIpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVmRnVsbFBhdGggPSBwYXJlbnRQYXRoLmNvbmNhdChwYXRoRnJvbVB0cihyZWZQdHIpLnNsaWNlKHBhcmVudHMubGVuZ3RoID09PSAwID8gMCA6IHN1YkRvY1BhdGgubGVuZ3RoKSk7XG4gICAgfVxuXG4gICAgcmVmRnVsbFB0ciA9IHBhdGhUb1B0cihyZWZGdWxsUGF0aCk7XG5cbiAgICAvLyBJdCBpcyBwb3NzaWJsZSB0byBwcm9jZXNzIHRoZSBzYW1lIHJlZmVyZW5jZSBtb3JlIHRoYW4gb25jZSBpbiB0aGUgZXZlbnQgb2YgaGllcmFyY2hpY2FsIHJlZmVyZW5jZXMgc28gd2UgYXZvaWRcbiAgICAvLyBwcm9jZXNzaW5nIGEgcmVmZXJlbmNlIGlmIHdlJ3ZlIGFscmVhZHkgZG9uZSBzby5cbiAgICBpZiAoIWlzVHlwZShhbGxSZWZzW3JlZkZ1bGxQdHJdLCAnVW5kZWZpbmVkJykpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBSZWNvcmQgdGhlIHJlZmVyZW5jZSBtZXRhZGF0YVxuICAgIGFsbFJlZnMucmVmc1tyZWZGdWxsUHRyXSA9IHJlZnNbcmVmUHRyXTtcblxuICAgIC8vIERvIG5vdCBwcm9jZXNzIGludmFsaWQgcmVmZXJlbmNlc1xuICAgIGlmIChpc1R5cGUocmVmRGV0YWlscy5lcnJvciwgJ1VuZGVmaW5lZCcpICYmIHJlZkRldGFpbHMudHlwZSAhPT0gJ2ludmFsaWQnKSB7XG4gICAgICBpZiAocmVtb3RlVHlwZXMuaW5kZXhPZihyZWZEZXRhaWxzLnR5cGUpID4gLTEpIHtcbiAgICAgICAgbG9jYXRpb24gPSBjb21iaW5lVVJJcyhvcHRpb25zLnJlbGF0aXZlQmFzZSwgcmVmRGV0YWlscy51cmkpO1xuICAgICAgICBwYXJlbnRJbmRleCA9IHBhcmVudHMuaW5kZXhPZihsb2NhdGlvbik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2NhdGlvbiA9IHJlZkRldGFpbHMudXJpO1xuICAgICAgICBwYXJlbnRJbmRleCA9IHBhcmVudFB0cnMuaW5kZXhPZihsb2NhdGlvbik7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlY29yZCBhbmNlc3RvciBwYXRoc1xuICAgICAgcmVmRGV0YWlscy5hbmNlc3RvclB0cnMgPSBhbmNlc3RvclB0cnM7XG5cbiAgICAgIC8vIFJlY29yZCBpZiB0aGUgcmVmZXJlbmNlIGlzIGluZGlyZWN0IGJhc2VkIG9uIGl0cyBwYXJlbnRcbiAgICAgIHJlZkRldGFpbHMuaW5kaXJlY3QgPSBpbmRpcmVjdDtcblxuICAgICAgLy8gT25seSBwcm9jZXNzIG5vbi1jaXJjdWxhciByZWZlcmVuY2VzIGZ1cnRoZXJcbiAgICAgIGlmIChwYXJlbnRJbmRleCA9PT0gLTEpIHtcbiAgICAgICAgaWYgKHJlbW90ZVR5cGVzLmluZGV4T2YocmVmRGV0YWlscy50eXBlKSA+IC0xKSB7XG4gICAgICAgICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICByZXR1cm4gZ2V0UmVtb3RlRG9jdW1lbnQobG9jYXRpb24sIG9wdGlvbnMpXG4gICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKGRvYykge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHByb2Nlc3NTdWJEb2N1bWVudCgncmVtb3RlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9jLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc1R5cGUocmVmRGV0YWlscy51cmlEZXRhaWxzLmZyYWdtZW50LCAnVW5kZWZpbmVkJykgP1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtdIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoRnJvbVB0cihkZWNvZGVVUkkocmVmRGV0YWlscy51cmlEZXRhaWxzLmZyYWdtZW50KSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZkRldGFpbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudHMuY29uY2F0KGxvY2F0aW9uKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50UHRycy5jb25jYXQocmVmRnVsbFB0ciksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbFJlZnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZGlyZWN0KTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICByZWZEZXRhaWxzLmVycm9yID0gZXJyLm1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgICByZWZEZXRhaWxzLm1pc3NpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHJlZkZ1bGxQdHIuaW5kZXhPZihsb2NhdGlvbiArICcvJykgIT09IDAgJiYgcmVmRnVsbFB0ciAhPT0gbG9jYXRpb24gJiZcbiAgICAgICAgICAgICAgc3ViRG9jUHRyLmluZGV4T2YobG9jYXRpb24gKyAnLycpICE9PSAwICYmIHN1YkRvY1B0ciAhPT0gbG9jYXRpb24pIHtcbiAgICAgICAgICAgIGlmIChsb2NhdGlvbi5pbmRleE9mKHN1YkRvY1B0ciArICcvJykgIT09IDApIHtcbiAgICAgICAgICAgICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBwcm9jZXNzU3ViRG9jdW1lbnQoJ2xvY2FsJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb2JqLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoRnJvbVB0cihsb2NhdGlvbiksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZkRldGFpbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudHMuY29uY2F0KGxvY2F0aW9uKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50UHRycy5jb25jYXQocmVmRnVsbFB0ciksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbFJlZnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZGlyZWN0IHx8IChsb2NhdGlvbi5pbmRleE9mKHN1YkRvY1B0ciArICcvJykgPT09IC0xICYmIGxvY2F0aW9uICE9PSBzdWJEb2NQdHIpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVmRGV0YWlscy5jaXJjdWxhciA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBNYXJrIHNlZW4gYW5jZXN0b3JzIGFzIGNpcmN1bGFyXG4gICAgICAgIHBhcmVudFB0cnMuc2xpY2UocGFyZW50SW5kZXgpLmZvckVhY2goZnVuY3Rpb24gKHBhcmVudFB0cikge1xuICAgICAgICAgIGFsbFJlZnMucmVmc1twYXJlbnRQdHJdLmNpcmN1bGFyID0gdHJ1ZTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVmRGV0YWlscy5jaXJjdWxhciA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIGFsbFJlZnM7XG4gICAgfSk7XG5cbiAgcmV0dXJuIGFsbFRhc2tzO1xufVxuXG5mdW5jdGlvbiBmaW5kVmFsdWUgKG9iaiwgcGF0aCkge1xuICB2YXIgdmFsdWUgPSBvYmo7XG5cbiAgcGF0aC5mb3JFYWNoKGZ1bmN0aW9uIChzZWcpIHtcbiAgICBzZWcgPSBkZWNvZGVVUkkoc2VnKTtcblxuICAgIGlmIChzZWcgaW4gdmFsdWUpIHtcbiAgICAgIHZhbHVlID0gdmFsdWVbc2VnXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgRXJyb3IoJ0pTT04gUG9pbnRlciBwb2ludHMgdG8gbWlzc2luZyBsb2NhdGlvbjogJyArIHBhdGhUb1B0cihwYXRoKSk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGdldEV4dHJhUmVmS2V5cyAocmVmKSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhyZWYpLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG4gICAgcmV0dXJuIGtleSAhPT0gJyRyZWYnO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0UmVmVHlwZSAocmVmRGV0YWlscykge1xuICB2YXIgdHlwZTtcblxuICAvLyBDb252ZXJ0IHRoZSBVUkkgcmVmZXJlbmNlIHRvIG9uZSBvZiBvdXIgdHlwZXNcbiAgc3dpdGNoIChyZWZEZXRhaWxzLnVyaURldGFpbHMucmVmZXJlbmNlKSB7XG4gIGNhc2UgJ2Fic29sdXRlJzpcbiAgY2FzZSAndXJpJzpcbiAgICB0eXBlID0gJ3JlbW90ZSc7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ3NhbWUtZG9jdW1lbnQnOlxuICAgIHR5cGUgPSAnbG9jYWwnO1xuICAgIGJyZWFrO1xuICBkZWZhdWx0OlxuICAgIHR5cGUgPSByZWZEZXRhaWxzLnVyaURldGFpbHMucmVmZXJlbmNlO1xuICB9XG5cbiAgcmV0dXJuIHR5cGU7XG59XG5cbmZ1bmN0aW9uIGdldFJlbW90ZURvY3VtZW50ICh1cmwsIG9wdGlvbnMpIHtcbiAgdmFyIGNhY2hlRW50cnkgPSByZW1vdGVDYWNoZVt1cmxdO1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgdmFyIGxvYWRlck9wdGlvbnMgPSBjbG9uZShvcHRpb25zLmxvYWRlck9wdGlvbnMgfHwge30pO1xuXG4gIGlmIChpc1R5cGUoY2FjaGVFbnRyeSwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgLy8gSWYgdGhlcmUgaXMgbm8gY29udGVudCBwcm9jZXNzb3IsIGRlZmF1bHQgdG8gcHJvY2Vzc2luZyB0aGUgcmF3IHJlc3BvbnNlIGFzIEpTT05cbiAgICBpZiAoaXNUeXBlKGxvYWRlck9wdGlvbnMucHJvY2Vzc0NvbnRlbnQsICdVbmRlZmluZWQnKSkge1xuICAgICAgbG9hZGVyT3B0aW9ucy5wcm9jZXNzQ29udGVudCA9IGZ1bmN0aW9uIChyZXMsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrKHVuZGVmaW5lZCwgSlNPTi5wYXJzZShyZXMudGV4dCkpO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBdHRlbXB0IHRvIGxvYWQgdGhlIHJlc291cmNlIHVzaW5nIHBhdGgtbG9hZGVyXG4gICAgYWxsVGFza3MgPSBQYXRoTG9hZGVyLmxvYWQoZGVjb2RlVVJJKHVybCksIGxvYWRlck9wdGlvbnMpO1xuXG4gICAgLy8gVXBkYXRlIHRoZSBjYWNoZVxuICAgIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgcmVtb3RlQ2FjaGVbdXJsXSA9IHtcbiAgICAgICAgICB2YWx1ZTogcmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZnVuY3Rpb24gKGVycikge1xuICAgICAgICByZW1vdGVDYWNoZVt1cmxdID0ge1xuICAgICAgICAgIGVycm9yOiBlcnJcbiAgICAgICAgfTtcblxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBSZXR1cm4gdGhlIGNhY2hlZCB2ZXJzaW9uXG4gICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiBjYWNoZUVudHJ5LnZhbHVlO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgY2xvbmVkIHZlcnNpb24gdG8gYXZvaWQgdXBkYXRpbmcgdGhlIGNhY2hlXG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgcmV0dXJuIGNsb25lKHJlcyk7XG4gIH0pO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuZnVuY3Rpb24gaXNSZWZMaWtlIChvYmosIHRocm93V2l0aERldGFpbHMpIHtcbiAgdmFyIHJlZkxpa2UgPSB0cnVlO1xuXG4gIHRyeSB7XG4gICAgaWYgKCFpc1R5cGUob2JqLCAnT2JqZWN0JykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb2JqIGlzIG5vdCBhbiBPYmplY3QnKTtcbiAgICB9IGVsc2UgaWYgKCFpc1R5cGUob2JqLiRyZWYsICdTdHJpbmcnKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvYmouJHJlZiBpcyBub3QgYSBTdHJpbmcnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmICh0aHJvd1dpdGhEZXRhaWxzKSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgcmVmTGlrZSA9IGZhbHNlO1xuICB9XG5cbiAgcmV0dXJuIHJlZkxpa2U7XG59XG5cbmZ1bmN0aW9uIGlzVHlwZSAob2JqLCB0eXBlKSB7XG4gIC8vIEEgUGhhbnRvbUpTIGJ1ZyAoaHR0cHM6Ly9naXRodWIuY29tL2FyaXlhL3BoYW50b21qcy9pc3N1ZXMvMTE3MjIpIHByb2hpYml0cyB1cyBmcm9tIHVzaW5nIHRoZSBzYW1lIGFwcHJvYWNoIGZvclxuICAvLyB1bmRlZmluZWQgY2hlY2tpbmcgdGhhdCB3ZSB1c2UgZm9yIG90aGVyIHR5cGVzLlxuICBpZiAodHlwZSA9PT0gJ1VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCc7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCAnICsgdHlwZSArICddJztcbiAgfVxufVxuXG5mdW5jdGlvbiBtYWtlUmVmRmlsdGVyIChvcHRpb25zKSB7XG4gIHZhciByZWZGaWx0ZXI7XG4gIHZhciB2YWxpZFR5cGVzO1xuXG4gIGlmIChpc1R5cGUob3B0aW9ucy5maWx0ZXIsICdBcnJheScpIHx8IGlzVHlwZShvcHRpb25zLmZpbHRlciwgJ1N0cmluZycpKSB7XG4gICAgdmFsaWRUeXBlcyA9IGlzVHlwZShvcHRpb25zLmZpbHRlciwgJ1N0cmluZycpID8gW29wdGlvbnMuZmlsdGVyXSA6IG9wdGlvbnMuZmlsdGVyO1xuICAgIHJlZkZpbHRlciA9IGZ1bmN0aW9uIChyZWZEZXRhaWxzKSB7XG4gICAgICAvLyBDaGVjayB0aGUgZXhhY3QgdHlwZSBvciBmb3IgaW52YWxpZCBVUklzLCBjaGVjayBpdHMgb3JpZ2luYWwgdHlwZVxuICAgICAgcmV0dXJuIHZhbGlkVHlwZXMuaW5kZXhPZihyZWZEZXRhaWxzLnR5cGUpID4gLTEgfHwgdmFsaWRUeXBlcy5pbmRleE9mKGdldFJlZlR5cGUocmVmRGV0YWlscykpID4gLTE7XG4gICAgfTtcbiAgfSBlbHNlIGlmIChpc1R5cGUob3B0aW9ucy5maWx0ZXIsICdGdW5jdGlvbicpKSB7XG4gICAgcmVmRmlsdGVyID0gb3B0aW9ucy5maWx0ZXI7XG4gIH0gZWxzZSBpZiAoaXNUeXBlKG9wdGlvbnMuZmlsdGVyLCAnVW5kZWZpbmVkJykpIHtcbiAgICByZWZGaWx0ZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIChyZWZEZXRhaWxzLCBwYXRoKSB7XG4gICAgcmV0dXJuIChyZWZEZXRhaWxzLnR5cGUgIT09ICdpbnZhbGlkJyB8fCBvcHRpb25zLmluY2x1ZGVJbnZhbGlkID09PSB0cnVlKSAmJiByZWZGaWx0ZXIocmVmRGV0YWlscywgcGF0aCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIG1ha2VTdWJEb2NQYXRoIChvcHRpb25zKSB7XG4gIHZhciBzdWJEb2NQYXRoO1xuXG4gIGlmIChpc1R5cGUob3B0aW9ucy5zdWJEb2NQYXRoLCAnQXJyYXknKSkge1xuICAgIHN1YkRvY1BhdGggPSBvcHRpb25zLnN1YkRvY1BhdGg7XG4gIH0gZWxzZSBpZiAoaXNUeXBlKG9wdGlvbnMuc3ViRG9jUGF0aCwgJ1N0cmluZycpKSB7XG4gICAgc3ViRG9jUGF0aCA9IHBhdGhGcm9tUHRyKG9wdGlvbnMuc3ViRG9jUGF0aCk7XG4gIH0gZWxzZSBpZiAoaXNUeXBlKG9wdGlvbnMuc3ViRG9jUGF0aCwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgc3ViRG9jUGF0aCA9IFtdO1xuICB9XG5cbiAgcmV0dXJuIHN1YkRvY1BhdGg7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVVJJICh1cmkpIHtcbiAgLy8gV2UgZGVjb2RlIGZpcnN0IHRvIGF2b2lkIGRvdWJseSBlbmNvZGluZ1xuICByZXR1cm4gVVJJLnBhcnNlKGVuY29kZVVSSShkZWNvZGVVUkkodXJpKSkpO1xufVxuXG5mdW5jdGlvbiBzZXRWYWx1ZSAob2JqLCByZWZQYXRoLCB2YWx1ZSkge1xuICBmaW5kVmFsdWUob2JqLCByZWZQYXRoLnNsaWNlKDAsIHJlZlBhdGgubGVuZ3RoIC0gMSkpW2RlY29kZVVSSShyZWZQYXRoW3JlZlBhdGgubGVuZ3RoIC0gMV0pXSA9IHZhbHVlO1xufVxuXG5mdW5jdGlvbiB3YWxrIChhbmNlc3RvcnMsIG5vZGUsIHBhdGgsIGZuKSB7XG4gIHZhciBwcm9jZXNzQ2hpbGRyZW4gPSB0cnVlO1xuXG4gIGZ1bmN0aW9uIHdhbGtJdGVtIChpdGVtLCBzZWdtZW50KSB7XG4gICAgcGF0aC5wdXNoKHNlZ21lbnQpO1xuICAgIHdhbGsoYW5jZXN0b3JzLCBpdGVtLCBwYXRoLCBmbik7XG4gICAgcGF0aC5wb3AoKTtcbiAgfVxuXG4gIC8vIENhbGwgdGhlIGl0ZXJhdGVlXG4gIGlmIChpc1R5cGUoZm4sICdGdW5jdGlvbicpKSB7XG4gICAgcHJvY2Vzc0NoaWxkcmVuID0gZm4oYW5jZXN0b3JzLCBub2RlLCBwYXRoKTtcbiAgfVxuXG4gIC8vIFdlIGRvIG5vdCBwcm9jZXNzIGNpcmN1bGFyIG9iamVjdHMgYWdhaW5cbiAgaWYgKGFuY2VzdG9ycy5pbmRleE9mKG5vZGUpID09PSAtMSkge1xuICAgIGFuY2VzdG9ycy5wdXNoKG5vZGUpO1xuXG4gICAgaWYgKHByb2Nlc3NDaGlsZHJlbiAhPT0gZmFsc2UpIHtcbiAgICAgIGlmIChpc1R5cGUobm9kZSwgJ0FycmF5JykpIHtcbiAgICAgICAgbm9kZS5mb3JFYWNoKGZ1bmN0aW9uIChtZW1iZXIsIGluZGV4KSB7XG4gICAgICAgICAgd2Fsa0l0ZW0obWVtYmVyLCBpbmRleC50b1N0cmluZygpKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKGlzVHlwZShub2RlLCAnT2JqZWN0JykpIHtcbiAgICAgICAgT2JqZWN0LmtleXMobm9kZSkuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgICAgd2Fsa0l0ZW0obm9kZVtrZXldLCBrZXkpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhbmNlc3RvcnMucG9wKCk7XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlT3B0aW9ucyAob3B0aW9ucywgb2JqKSB7XG4gIGlmIChpc1R5cGUob3B0aW9ucywgJ1VuZGVmaW5lZCcpKSB7XG4gICAgLy8gRGVmYXVsdCB0byBhbiBlbXB0eSBvcHRpb25zIG9iamVjdFxuICAgIG9wdGlvbnMgPSB7fTtcbiAgfSBlbHNlIHtcbiAgICAvLyBDbG9uZSB0aGUgb3B0aW9ucyBzbyB3ZSBkbyBub3QgYWx0ZXIgdGhlIG9uZXMgcGFzc2VkIGluXG4gICAgb3B0aW9ucyA9IGNsb25lKG9wdGlvbnMpO1xuICB9XG5cbiAgaWYgKCFpc1R5cGUob3B0aW9ucywgJ09iamVjdCcpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBtdXN0IGJlIGFuIE9iamVjdCcpO1xuICB9IGVsc2UgaWYgKCFpc1R5cGUob3B0aW9ucy5maWx0ZXIsICdVbmRlZmluZWQnKSAmJlxuICAgICAgICAgICAgICFpc1R5cGUob3B0aW9ucy5maWx0ZXIsICdBcnJheScpICYmXG4gICAgICAgICAgICAgIWlzVHlwZShvcHRpb25zLmZpbHRlciwgJ0Z1bmN0aW9uJykgJiZcbiAgICAgICAgICAgICAhaXNUeXBlKG9wdGlvbnMuZmlsdGVyLCAnU3RyaW5nJykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zLmZpbHRlciBtdXN0IGJlIGFuIEFycmF5LCBhIEZ1bmN0aW9uIG9mIGEgU3RyaW5nJyk7XG4gIH0gZWxzZSBpZiAoIWlzVHlwZShvcHRpb25zLmluY2x1ZGVJbnZhbGlkLCAnVW5kZWZpbmVkJykgJiZcbiAgICAgICAgICAgICAhaXNUeXBlKG9wdGlvbnMuaW5jbHVkZUludmFsaWQsICdCb29sZWFuJykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zLmluY2x1ZGVJbnZhbGlkIG11c3QgYmUgYSBCb29sZWFuJyk7XG4gIH0gZWxzZSBpZiAoIWlzVHlwZShvcHRpb25zLnJlZlByZVByb2Nlc3NvciwgJ1VuZGVmaW5lZCcpICYmXG4gICAgICAgICAgICAgIWlzVHlwZShvcHRpb25zLnJlZlByZVByb2Nlc3NvciwgJ0Z1bmN0aW9uJykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zLnJlZlByZVByb2Nlc3NvciBtdXN0IGJlIGEgRnVuY3Rpb24nKTtcbiAgfSBlbHNlIGlmICghaXNUeXBlKG9wdGlvbnMucmVmUG9zdFByb2Nlc3NvciwgJ1VuZGVmaW5lZCcpICYmXG4gICAgICAgICAgICAgIWlzVHlwZShvcHRpb25zLnJlZlBvc3RQcm9jZXNzb3IsICdGdW5jdGlvbicpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yIG11c3QgYmUgYSBGdW5jdGlvbicpO1xuICB9IGVsc2UgaWYgKCFpc1R5cGUob3B0aW9ucy5zdWJEb2NQYXRoLCAnVW5kZWZpbmVkJykgJiZcbiAgICAgICAgICAgICAhaXNUeXBlKG9wdGlvbnMuc3ViRG9jUGF0aCwgJ0FycmF5JykgJiZcbiAgICAgICAgICAgICAhaXNQdHIob3B0aW9ucy5zdWJEb2NQYXRoKSkge1xuICAgIC8vIElmIGEgcG9pbnRlciBpcyBwcm92aWRlZCwgdGhyb3cgYW4gZXJyb3IgaWYgaXQncyBub3QgdGhlIHByb3BlciB0eXBlXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5zdWJEb2NQYXRoIG11c3QgYmUgYW4gQXJyYXkgb2YgcGF0aCBzZWdtZW50cyBvciBhIHZhbGlkIEpTT04gUG9pbnRlcicpO1xuICB9XG5cbiAgb3B0aW9ucy5maWx0ZXIgPSBtYWtlUmVmRmlsdGVyKG9wdGlvbnMpO1xuXG4gIC8vIFNldCB0aGUgc3ViRG9jUGF0aCB0byBhdm9pZCBldmVyeW9uZSBlbHNlIGhhdmluZyB0byBjb21wdXRlIGl0XG4gIG9wdGlvbnMuc3ViRG9jUGF0aCA9IG1ha2VTdWJEb2NQYXRoKG9wdGlvbnMpO1xuXG4gIGlmICghaXNUeXBlKG9iaiwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGZpbmRWYWx1ZShvYmosIG9wdGlvbnMuc3ViRG9jUGF0aCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBlcnIubWVzc2FnZSA9IGVyci5tZXNzYWdlLnJlcGxhY2UoJ0pTT04gUG9pbnRlcicsICdvcHRpb25zLnN1YkRvY1BhdGgnKTtcblxuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvcHRpb25zO1xufVxuXG4vKiBNb2R1bGUgTWVtYmVycyAqL1xuXG4vKlxuICogRWFjaCBvZiB0aGUgZnVuY3Rpb25zIGJlbG93IGFyZSBkZWZpbmVkIGFzIGZ1bmN0aW9uIHN0YXRlbWVudHMgYW5kICp0aGVuKiBleHBvcnRlZCBpbiB0d28gc3RlcHMgaW5zdGVhZCBvZiBvbmUgZHVlXG4gKiB0byBhIGJ1ZyBpbiBqc2RvYyAoaHR0cHM6Ly9naXRodWIuY29tL2pzZG9jMm1kL2pzZG9jLXBhcnNlL2lzc3Vlcy8xOCkgdGhhdCBjYXVzZXMgb3VyIGRvY3VtZW50YXRpb24gdG8gYmVcbiAqIGdlbmVyYXRlZCBpbXByb3Blcmx5LiAgVGhlIGltcGFjdCB0byB0aGUgdXNlciBpcyBzaWduaWZpY2FudCBlbm91Z2ggZm9yIHVzIHRvIHdhcnJhbnQgd29ya2luZyBhcm91bmQgaXQgdW50aWwgdGhpc1xuICogaXMgZml4ZWQuXG4gKi9cblxuLyoqXG4gKiBUaGUgb3B0aW9ucyB1c2VkIGZvciB2YXJpb3VzIEpzb25SZWZzIEFQSXMuXG4gKlxuICogQHR5cGVkZWYge29iamVjdH0gSnNvblJlZnNPcHRpb25zXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8c3RyaW5nW118ZnVuY3Rpb259IFtmaWx0ZXI9ZnVuY3Rpb24gKCkge3JldHVybiB0cnVlO31dIC0gVGhlIGZpbHRlciB0byB1c2Ugd2hlbiBnYXRoZXJpbmcgSlNPTlxuICogUmVmZXJlbmNlcyAqKElmIHRoaXMgdmFsdWUgaXMgYSBzaW5nbGUgc3RyaW5nIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MsIHRoZSB2YWx1ZShzKSBhcmUgZXhwZWN0ZWQgdG8gYmUgdGhlIGB0eXBlKHMpYFxuICogeW91IGFyZSBpbnRlcmVzdGVkIGluIGNvbGxlY3RpbmcgYXMgZGVzY3JpYmVkIGluIHtAbGluayBtb2R1bGU6SnNvblJlZnMuZ2V0UmVmRGV0YWlsc30uICBJZiBpdCBpcyBhIGZ1bmN0aW9uLCBpdCBpc1xuICogZXhwZWN0ZWQgdGhhdCB0aGUgZnVuY3Rpb24gYmVoYXZlcyBsaWtlIHtAbGluayBtb2R1bGU6SnNvblJlZnN+UmVmRGV0YWlsc0ZpbHRlcn0uKSpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2luY2x1ZGVJbnZhbGlkPWZhbHNlXSAtIFdoZXRoZXIgb3Igbm90IHRvIGluY2x1ZGUgaW52YWxpZCBKU09OIFJlZmVyZW5jZSBkZXRhaWxzICooVGhpcyB3aWxsIG1ha2VcbiAqIGl0IHNvIHRoYXQgb2JqZWN0cyB0aGF0IGFyZSBsaWtlIEpTT04gUmVmZXJlbmNlIG9iamVjdHMsIGFzIGluIHRoZXkgYXJlIGFuIGBPYmplY3RgIGFuZCB0aGUgaGF2ZSBhIGAkcmVmYCBwcm9wZXJ0eSxcbiAqIGJ1dCBmYWlsIHZhbGlkYXRpb24gd2lsbCBiZSBpbmNsdWRlZC4gIFRoaXMgaXMgdmVyeSB1c2VmdWwgZm9yIHdoZW4geW91IHdhbnQgdG8ga25vdyBpZiB5b3UgaGF2ZSBpbnZhbGlkIEpTT05cbiAqIFJlZmVyZW5jZSBkZWZpbml0aW9ucy4gIFRoaXMgd2lsbCBub3QgbWVhbiB0aGF0IEFQSXMgd2lsbCBwcm9jZXNzIGludmFsaWQgSlNPTiBSZWZlcmVuY2VzIGJ1dCB0aGUgcmVhc29ucyBhcyB0byB3aHlcbiAqIHRoZSBKU09OIFJlZmVyZW5jZXMgYXJlIGludmFsaWQgd2lsbCBiZSBpbmNsdWRlZCBpbiB0aGUgcmV0dXJuZWQgbWV0YWRhdGEuKSpcbiAqIEBwYXJhbSB7b2JqZWN0fSBbbG9hZGVyT3B0aW9uc10gLSBUaGUgb3B0aW9ucyB0byBwYXNzIHRvXG4gKiB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL3doaXRsb2NramMvcGF0aC1sb2FkZXIvYmxvYi9tYXN0ZXIvZG9jcy9BUEkubWQjbW9kdWxlX1BhdGhMb2FkZXIubG9hZHxQYXRoTG9hZGVyfmxvYWR9XG4gKiBAcGFyYW0ge21vZHVsZTpKc29uUmVmc35SZWZQcmVQcm9jZXNzb3J9IFtyZWZQcmVQcm9jZXNzb3JdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJlLXByb2Nlc3MgYSBKU09OIFJlZmVyZW5jZSBsaWtlXG4gKiBvYmplY3QgKihUaGlzIGlzIGNhbGxlZCBwcmlvciB0byB2YWxpZGF0aW5nIHRoZSBKU09OIFJlZmVyZW5jZSBsaWtlIG9iamVjdCBhbmQgZ2V0dGluZyBpdHMgZGV0YWlscykqXG4gKiBAcGFyYW0ge21vZHVsZTpKc29uUmVmc35SZWZQb3N0UHJvY2Vzc29yfSBbcmVmUG9zdFByb2Nlc3Nvcl0gLSBUaGUgY2FsbGJhY2sgdXNlZCB0byBwb3N0LXByb2Nlc3MgdGhlIEpTT04gUmVmZXJlbmNlXG4gKiBtZXRhZGF0YSAqKFRoaXMgaXMgY2FsbGVkIHByaW9yIGZpbHRlcmluZyB0aGUgcmVmZXJlbmNlcykqXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMucmVsYXRpdmVCYXNlXSAtIFRoZSBiYXNlIGxvY2F0aW9uIHRvIHVzZSB3aGVuIHJlc29sdmluZyByZWxhdGl2ZSByZWZlcmVuY2VzICooT25seSB1c2VmdWxcbiAqIGZvciBBUElzIHRoYXQgZG8gcmVtb3RlIHJlZmVyZW5jZSByZXNvbHV0aW9uLiAgSWYgdGhpcyB2YWx1ZSBpcyBub3QgZGVmaW5lZCxcbiAqIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vd2hpdGxvY2tqYy9wYXRoLWxvYWRlcnxwYXRoLWxvYWRlcn0gd2lsbCB1c2UgYHdpbmRvdy5sb2NhdGlvbi5ocmVmYCBmb3IgdGhlIGJyb3dzZXIgYW5kXG4gKiBgcHJvY2Vzcy5jd2QoKWAgZm9yIE5vZGUuanMuKSpcbiAqIEBwYXJhbSB7c3RyaW5nfHN0cmluZ1tdfSBbb3B0aW9ucy5zdWJEb2NQYXRoPVtdXSAtIFRoZSBKU09OIFBvaW50ZXIgb3IgYXJyYXkgb2YgcGF0aCBzZWdtZW50cyB0byB0aGUgc3ViIGRvY3VtZW50XG4gKiBsb2NhdGlvbiB0byBzZWFyY2ggZnJvbVxuICovXG5cbi8qKlxuICogU2ltcGxlIGZ1bmN0aW9uIHVzZWQgdG8gZmlsdGVyIG91dCBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge2Z1bmN0aW9ufSBSZWZEZXRhaWxzRmlsdGVyXG4gKlxuICogQHBhcmFtIHttb2R1bGU6SnNvblJlZnN+VW5yZXNvbHZlZFJlZkRldGFpbHN9IHJlZkRldGFpbHMgLSBUaGUgSlNPTiBSZWZlcmVuY2UgZGV0YWlscyB0byB0ZXN0XG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIHBhdGggdG8gdGhlIEpTT04gUmVmZXJlbmNlXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHdoZXRoZXIgdGhlIEpTT04gUmVmZXJlbmNlIHNob3VsZCBiZSBmaWx0ZXJlZCAqKG91dCkqIG9yIG5vdFxuICovXG5cbi8qKlxuICogU2ltcGxlIGZ1bmN0aW9uIHVzZWQgdG8gcHJlLXByb2Nlc3MgYSBKU09OIFJlZmVyZW5jZSBsaWtlIG9iamVjdC5cbiAqXG4gKiBAdHlwZWRlZiB7ZnVuY3Rpb259IFJlZlByZVByb2Nlc3NvclxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmogLSBUaGUgSlNPTiBSZWZlcmVuY2UgbGlrZSBvYmplY3RcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgcGF0aCB0byB0aGUgSlNPTiBSZWZlcmVuY2UgbGlrZSBvYmplY3RcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSB0aGUgcHJvY2Vzc2VkIEpTT04gUmVmZXJlbmNlIGxpa2Ugb2JqZWN0XG4gKi9cblxuLyoqXG4gKiBTaW1wbGUgZnVuY3Rpb24gdXNlZCB0byBwb3N0LXByb2Nlc3MgYSBKU09OIFJlZmVyZW5jZSBkZXRhaWxzLlxuICpcbiAqIEB0eXBlZGVmIHtmdW5jdGlvbn0gUmVmUG9zdFByb2Nlc3NvclxuICpcbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzflVucmVzb2x2ZWRSZWZEZXRhaWxzfSByZWZEZXRhaWxzIC0gVGhlIEpTT04gUmVmZXJlbmNlIGRldGFpbHMgdG8gdGVzdFxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFRoZSBwYXRoIHRvIHRoZSBKU09OIFJlZmVyZW5jZVxuICpcbiAqIEByZXR1cm5zIHtvYmplY3R9IHRoZSBwcm9jZXNzZWQgSlNPTiBSZWZlcmVuY2UgZGV0YWlscyBvYmplY3RcbiAqL1xuXG4vKipcbiAqIERldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHJlc29sdmVkIEpTT04gUmVmZXJlbmNlcy5cbiAqXG4gKiBAdHlwZWRlZiB7VW5yZXNvbHZlZFJlZkRldGFpbHN9IFJlc29sdmVkUmVmRGV0YWlsc1xuICpcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2NpcmN1bGFyXSAtIFdoZXRoZXIgb3Igbm90IHRoZSBKU09OIFJlZmVyZW5jZSBpcyBjaXJjdWxhciAqKFdpbGwgbm90IGJlIHNldCBpZiB0aGUgSlNPTlxuICogUmVmZXJlbmNlIGlzIG5vdCBjaXJjdWxhcikqXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFttaXNzaW5nXSAtIFdoZXRoZXIgb3Igbm90IHRoZSByZWZlcmVuY2VkIHZhbHVlIHdhcyBtaXNzaW5nIG9yIG5vdCAqKFdpbGwgbm90IGJlIHNldCBpZiB0aGVcbiAqIHJlZmVyZW5jZWQgdmFsdWUgaXMgbm90IG1pc3NpbmcpKlxuICogQHByb3BlcnR5IHsqfSBbdmFsdWVdIC0gVGhlIHJlZmVyZW5jZWQgdmFsdWUgKihXaWxsIG5vdCBiZSBzZXQgaWYgdGhlIHJlZmVyZW5jZWQgdmFsdWUgaXMgbWlzc2luZykqXG4gKi9cblxuLyoqXG4gKiBUaGUgcmVzdWx0cyBvZiByZXNvbHZpbmcgdGhlIEpTT04gUmVmZXJlbmNlcyBvZiBhbiBhcnJheS9vYmplY3QuXG4gKlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb2x2ZWRSZWZzUmVzdWx0c1xuICpcbiAqIEBwcm9wZXJ0eSB7bW9kdWxlOkpzb25SZWZzflJlc29sdmVkUmVmRGV0YWlsc30gcmVmcyAtIEFuIG9iamVjdCB3aG9zZSBrZXlzIGFyZSBKU09OIFBvaW50ZXJzICooZnJhZ21lbnQgdmVyc2lvbikqXG4gKiB0byB3aGVyZSB0aGUgSlNPTiBSZWZlcmVuY2UgaXMgZGVmaW5lZCBhbmQgd2hvc2UgdmFsdWVzIGFyZSB7QGxpbmsgbW9kdWxlOkpzb25SZWZzflJlc29sdmVkUmVmRGV0YWlsc31cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSB2YWx1ZSAtIFRoZSBhcnJheS9vYmplY3Qgd2l0aCBpdHMgSlNPTiBSZWZlcmVuY2VzIGZ1bGx5IHJlc29sdmVkXG4gKi9cblxuLyoqXG4gKiBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgcmV0cmlldmVkIGRvY3VtZW50IGFuZCBkZXRhaWxlZCBpbmZvcm1hdGlvbiBhYm91dCBpdHMgSlNPTiBSZWZlcmVuY2VzLlxuICpcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJldHJpZXZlZFJlZnNSZXN1bHRzXG4gKlxuICogQHByb3BlcnR5IHttb2R1bGU6SnNvblJlZnN+VW5yZXNvbHZlZFJlZkRldGFpbHN9IHJlZnMgLSBBbiBvYmplY3Qgd2hvc2Uga2V5cyBhcmUgSlNPTiBQb2ludGVycyAqKGZyYWdtZW50IHZlcnNpb24pKlxuICogdG8gd2hlcmUgdGhlIEpTT04gUmVmZXJlbmNlIGlzIGRlZmluZWQgYW5kIHdob3NlIHZhbHVlcyBhcmUge0BsaW5rIG1vZHVsZTpKc29uUmVmc35VbnJlc29sdmVkUmVmRGV0YWlsc31cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSB2YWx1ZSAtIFRoZSByZXRyaWV2ZWQgZG9jdW1lbnRcbiAqL1xuXG4vKipcbiAqIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZG9jdW1lbnQsIHRoZSBkb2N1bWVudCB3aXRoIGl0cyByZWZlcmVuY2VzIHJlc29sdmVkIGFuZCAgZGV0YWlsZWQgaW5mb3JtYXRpb25cbiAqIGFib3V0IGl0cyBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge29iamVjdH0gUmV0cmlldmVkUmVzb2x2ZWRSZWZzUmVzdWx0c1xuICpcbiAqIEBwcm9wZXJ0eSB7bW9kdWxlOkpzb25SZWZzflVucmVzb2x2ZWRSZWZEZXRhaWxzfSByZWZzIC0gQW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgKihmcmFnbWVudCB2ZXJzaW9uKSpcbiAqIHRvIHdoZXJlIHRoZSBKU09OIFJlZmVyZW5jZSBpcyBkZWZpbmVkIGFuZCB3aG9zZSB2YWx1ZXMgYXJlIHtAbGluayBtb2R1bGU6SnNvblJlZnN+VW5yZXNvbHZlZFJlZkRldGFpbHN9XG4gKiBAcHJvcGVydHkge1Jlc29sdmVkUmVmc1Jlc3VsdHN9IC0gQW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgKihmcmFnbWVudCB2ZXJzaW9uKSpcbiAqIHRvIHdoZXJlIHRoZSBKU09OIFJlZmVyZW5jZSBpcyBkZWZpbmVkIGFuZCB3aG9zZSB2YWx1ZXMgYXJlIHtAbGluayBtb2R1bGU6SnNvblJlZnN+UmVzb2x2ZWRSZWZEZXRhaWxzfVxuICogQHByb3BlcnR5IHtvYmplY3R9IHZhbHVlIC0gVGhlIHJldHJpZXZlZCBkb2N1bWVudFxuICovXG5cbi8qKlxuICogRGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgdW5yZXNvbHZlZCBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge29iamVjdH0gVW5yZXNvbHZlZFJlZkRldGFpbHNcbiAqXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGVmIC0gVGhlIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZXJyb3JdIC0gVGhlIGVycm9yIGluZm9ybWF0aW9uIGZvciBpbnZhbGlkIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb24gKihPbmx5IHByZXNlbnQgd2hlbiB0aGVcbiAqIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb24gaXMgaW52YWxpZCBvciB0aGVyZSB3YXMgYSBwcm9ibGVtIHJldHJpZXZpbmcgYSByZW1vdGUgcmVmZXJlbmNlIGR1cmluZyByZXNvbHV0aW9uKSpcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB1cmkgLSBUaGUgVVJJIHBvcnRpb24gb2YgdGhlIEpTT04gUmVmZXJlbmNlXG4gKiBAcHJvcGVydHkge29iamVjdH0gdXJpRGV0YWlscyAtIERldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHRoZSBVUkkgYXMgcHJvdmlkZWQgYnlcbiAqIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vZ2FyeWNvdXJ0L3VyaS1qc3xVUkkucGFyc2V9LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBUaGUgSlNPTiBSZWZlcmVuY2UgdHlwZSAqKFRoaXMgdmFsdWUgY2FuIGJlIG9uZSBvZiB0aGUgZm9sbG93aW5nOiBgaW52YWxpZGAsIGBsb2NhbGAsXG4gKiBgcmVsYXRpdmVgIG9yIGByZW1vdGVgLikqXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dhcm5pbmddIC0gVGhlIHdhcm5pbmcgaW5mb3JtYXRpb24gKihPbmx5IHByZXNlbnQgd2hlbiB0aGUgSlNPTiBSZWZlcmVuY2UgZGVmaW5pdGlvbiBwcm9kdWNlcyBhXG4gKiB3YXJuaW5nKSpcbiAqL1xuXG4vKipcbiAqIENsZWFycyB0aGUgaW50ZXJuYWwgY2FjaGUgb2YgcmVtb3RlIGRvY3VtZW50cywgcmVmZXJlbmNlIGRldGFpbHMsIGV0Yy5cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmNsZWFyQ2FjaGVcbiAqL1xuZnVuY3Rpb24gY2xlYXJDYWNoZSAoKSB7XG4gIHJlbW90ZUNhY2hlID0ge307XG59XG5cbi8qKlxuICogVGFrZXMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cyBhbmQgZGVjb2RlcyB0aGUgSlNPTiBQb2ludGVyIHRva2VucyBpbiB0aGVtLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50c1xuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIHdpdGggdGhlaXIgSlNPTiBQb2ludGVyIHRva2VucyBkZWNvZGVkXG4gKlxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZSBwYXRoIGlzIG5vdCBhbiBgQXJyYXlgXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEjc2VjdGlvbi0zfVxuICpcbiAqIEBhbGlhcyBtb2R1bGU6SnNvblJlZnMuZGVjb2RlUGF0aFxuICovXG5mdW5jdGlvbiBkZWNvZGVQYXRoIChwYXRoKSB7XG4gIGlmICghaXNUeXBlKHBhdGgsICdBcnJheScpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF0aCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gIH1cblxuICByZXR1cm4gcGF0aC5tYXAoZnVuY3Rpb24gKHNlZykge1xuICAgIGlmICghaXNUeXBlKHNlZywgJ1N0cmluZycpKSB7XG4gICAgICBzZWcgPSBKU09OLnN0cmluZ2lmeShzZWcpO1xuICAgIH1cblxuICAgIHJldHVybiBkZWNvZGVVUkkoc2VnLnJlcGxhY2UoL34xL2csICcvJykucmVwbGFjZSgvfjAvZywgJ34nKSk7XG4gIH0pO1xufVxuXG4vKipcbiAqIFRha2VzIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgYW5kIGVuY29kZXMgdGhlIHNwZWNpYWwgSlNPTiBQb2ludGVyIGNoYXJhY3RlcnMgaW4gdGhlbS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIGFycmF5IG9mIHBhdGggc2VnbWVudHNcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSB0aGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50cyB3aXRoIHRoZWlyIEpTT04gUG9pbnRlciB0b2tlbnMgZW5jb2RlZFxuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGUgcGF0aCBpcyBub3QgYW4gYEFycmF5YFxuICpcbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxI3NlY3Rpb24tM31cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmVuY29kZVBhdGhcbiAqL1xuZnVuY3Rpb24gZW5jb2RlUGF0aCAocGF0aCkge1xuICBpZiAoIWlzVHlwZShwYXRoLCAnQXJyYXknKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3BhdGggbXVzdCBiZSBhbiBhcnJheScpO1xuICB9XG5cbiAgcmV0dXJuIHBhdGgubWFwKGZ1bmN0aW9uIChzZWcpIHtcbiAgICBpZiAoIWlzVHlwZShzZWcsICdTdHJpbmcnKSkge1xuICAgICAgc2VnID0gSlNPTi5zdHJpbmdpZnkoc2VnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnLnJlcGxhY2UoL34vZywgJ34wJykucmVwbGFjZSgvXFwvL2csICd+MScpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBGaW5kcyBKU09OIFJlZmVyZW5jZXMgZGVmaW5lZCB3aXRoaW4gdGhlIHByb3ZpZGVkIGFycmF5L29iamVjdC5cbiAqXG4gKiBAcGFyYW0ge2FycmF5fG9iamVjdH0gb2JqIC0gVGhlIHN0cnVjdHVyZSB0byBmaW5kIEpTT04gUmVmZXJlbmNlcyB3aXRoaW5cbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzfkpzb25SZWZzT3B0aW9uc30gW29wdGlvbnNdIC0gVGhlIEpzb25SZWZzIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBhbiBvYmplY3Qgd2hvc2Uga2V5cyBhcmUgSlNPTiBQb2ludGVycyAqKGZyYWdtZW50IHZlcnNpb24pKiB0byB3aGVyZSB0aGUgSlNPTiBSZWZlcmVuY2UgaXMgZGVmaW5lZFxuICogYW5kIHdob3NlIHZhbHVlcyBhcmUge0BsaW5rIG1vZHVsZTpKc29uUmVmc35VbnJlc29sdmVkUmVmRGV0YWlsc30uXG4gKlxuICogQHRocm93cyB7RXJyb3J9IHdoZW4gdGhlIGlucHV0IGFyZ3VtZW50cyBmYWlsIHZhbGlkYXRpb24gb3IgaWYgYG9wdGlvbnMuc3ViRG9jUGF0aGAgcG9pbnRzIHRvIGFuIGludmFsaWQgbG9jYXRpb25cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmZpbmRSZWZzXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEZpbmRpbmcgYWxsIHZhbGlkIHJlZmVyZW5jZXNcbiAqIHZhciBhbGxSZWZzID0gSnNvblJlZnMuZmluZFJlZnMob2JqKTtcbiAqIC8vIEZpbmRpbmcgYWxsIHJlbW90ZSByZWZlcmVuY2VzXG4gKiB2YXIgcmVtb3RlUmVmcyA9IEpzb25SZWZzLmZpbmRSZWZzKG9iaiwge2ZpbHRlcjogWydyZWxhdGl2ZScsICdyZW1vdGUnXX0pO1xuICogLy8gRmluZGluZyBhbGwgaW52YWxpZCByZWZlcmVuY2VzXG4gKiB2YXIgaW52YWxpZFJlZnMgPSBKc29uUmVmcy5maW5kUmVmcyhvYmosIHtmaWx0ZXI6ICdpbnZhbGlkJywgaW5jbHVkZUludmFsaWQ6IHRydWV9KTtcbiAqL1xuZnVuY3Rpb24gZmluZFJlZnMgKG9iaiwgb3B0aW9ucykge1xuICB2YXIgcmVmcyA9IHt9O1xuXG4gIC8vIFZhbGlkYXRlIHRoZSBwcm92aWRlZCBkb2N1bWVudFxuICBpZiAoIWlzVHlwZShvYmosICdBcnJheScpICYmICFpc1R5cGUob2JqLCAnT2JqZWN0JykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvYmogbXVzdCBiZSBhbiBBcnJheSBvciBhbiBPYmplY3QnKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIG9wdGlvbnNcbiAgb3B0aW9ucyA9IHZhbGlkYXRlT3B0aW9ucyhvcHRpb25zLCBvYmopO1xuXG4gIC8vIFdhbGsgdGhlIGRvY3VtZW50IChvciBzdWIgZG9jdW1lbnQpIGFuZCBmaW5kIGFsbCBKU09OIFJlZmVyZW5jZXNcbiAgd2FsayhmaW5kQW5jZXN0b3JzKG9iaiwgb3B0aW9ucy5zdWJEb2NQYXRoKSxcbiAgICAgICBmaW5kVmFsdWUob2JqLCBvcHRpb25zLnN1YkRvY1BhdGgpLFxuICAgICAgIGNsb25lKG9wdGlvbnMuc3ViRG9jUGF0aCksXG4gICAgICAgZnVuY3Rpb24gKGFuY2VzdG9ycywgbm9kZSwgcGF0aCkge1xuICAgICAgICAgdmFyIHByb2Nlc3NDaGlsZHJlbiA9IHRydWU7XG4gICAgICAgICB2YXIgcmVmRGV0YWlscztcblxuICAgICAgICAgaWYgKGlzUmVmTGlrZShub2RlKSkge1xuICAgICAgICAgICAvLyBQcmUtcHJvY2VzcyB0aGUgbm9kZSB3aGVuIG5lY2Vzc2FyeVxuICAgICAgICAgICBpZiAoIWlzVHlwZShvcHRpb25zLnJlZlByZVByb2Nlc3NvciwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgICAgICAgICAgbm9kZSA9IG9wdGlvbnMucmVmUHJlUHJvY2Vzc29yKGNsb25lKG5vZGUpLCBwYXRoKTtcbiAgICAgICAgICAgfVxuXG4gICAgICAgICAgIHJlZkRldGFpbHMgPSBnZXRSZWZEZXRhaWxzKG5vZGUpO1xuXG4gICAgICAgICAgIC8vIFBvc3QtcHJvY2VzcyB0aGUgcmVmZXJlbmNlIGRldGFpbHNcbiAgICAgICAgICAgaWYgKCFpc1R5cGUob3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yLCAnVW5kZWZpbmVkJykpIHtcbiAgICAgICAgICAgICByZWZEZXRhaWxzID0gb3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yKHJlZkRldGFpbHMsIHBhdGgpO1xuICAgICAgICAgICB9XG5cbiAgICAgICAgICAgaWYgKG9wdGlvbnMuZmlsdGVyKHJlZkRldGFpbHMsIHBhdGgpKSB7XG4gICAgICAgICAgICAgcmVmc1twYXRoVG9QdHIocGF0aCldID0gcmVmRGV0YWlscztcbiAgICAgICAgICAgfVxuXG4gICAgICAgICAgIC8vIFdoZW5ldmVyIGEgSlNPTiBSZWZlcmVuY2UgaGFzIGV4dHJhIGNoaWxkcmVuLCBpdHMgY2hpbGRyZW4gc2hvdWxkIG5vdCBiZSBwcm9jZXNzZWQuXG4gICAgICAgICAgIC8vICAgU2VlOiBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzI3NlY3Rpb24tM1xuICAgICAgICAgICBpZiAoZ2V0RXh0cmFSZWZLZXlzKG5vZGUpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICBwcm9jZXNzQ2hpbGRyZW4gPSBmYWxzZTtcbiAgICAgICAgICAgfVxuICAgICAgICAgfVxuXG4gICAgICAgICByZXR1cm4gcHJvY2Vzc0NoaWxkcmVuO1xuICAgICAgIH0pO1xuXG4gIHJldHVybiByZWZzO1xufVxuXG4vKipcbiAqIEZpbmRzIEpTT04gUmVmZXJlbmNlcyBkZWZpbmVkIHdpdGhpbiB0aGUgZG9jdW1lbnQgYXQgdGhlIHByb3ZpZGVkIGxvY2F0aW9uLlxuICpcbiAqIFRoaXMgQVBJIGlzIGlkZW50aWNhbCB0byB7QGxpbmsgbW9kdWxlOkpzb25SZWZzLmZpbmRSZWZzfSBleGNlcHQgdGhpcyBBUEkgd2lsbCByZXRyaWV2ZSBhIHJlbW90ZSBkb2N1bWVudCBhbmQgdGhlblxuICogcmV0dXJuIHRoZSByZXN1bHQgb2Yge0BsaW5rIG1vZHVsZTpKc29uUmVmcy5maW5kUmVmc30gb24gdGhlIHJldHJpZXZlZCBkb2N1bWVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gdG8gcmV0cmlldmUgKihDYW4gYmUgcmVsYXRpdmUgb3IgYWJzb2x1dGUsIGp1c3QgbWFrZSBzdXJlIHlvdSBsb29rIGF0IHRoZVxuICoge0BsaW5rIG1vZHVsZTpKc29uUmVmc35Kc29uUmVmc09wdGlvbnN8b3B0aW9ucyBkb2N1bWVudGF0aW9ufSB0byBzZWUgaG93IHJlbGF0aXZlIHJlZmVyZW5jZXMgYXJlIGhhbmRsZWQuKSpcbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzfkpzb25SZWZzT3B0aW9uc30gW29wdGlvbnNdIC0gVGhlIEpzb25SZWZzIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgYSB7QGxpbmsgbW9kdWxlOkpzb25SZWZzflJldHJpZXZlZFJlZnNSZXN1bHRzfSBhbmQgcmVqZWN0cyB3aXRoIGFuXG4gKiBgRXJyb3JgIHdoZW4gdGhlIGlucHV0IGFyZ3VtZW50cyBmYWlsIHZhbGlkYXRpb24sIHdoZW4gYG9wdGlvbnMuc3ViRG9jUGF0aGAgcG9pbnRzIHRvIGFuIGludmFsaWQgbG9jYXRpb24gb3Igd2hlblxuICogIHRoZSBsb2NhdGlvbiBhcmd1bWVudCBwb2ludHMgdG8gYW4gdW5sb2FkYWJsZSByZXNvdXJjZVxuICpcbiAqIEBhbGlhcyBtb2R1bGU6SnNvblJlZnMuZmluZFJlZnNBdFxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIHRoYXQgb25seSByZXNvbHZlcyByZWZlcmVuY2VzIHdpdGhpbiBhIHN1YiBkb2N1bWVudFxuICogSnNvblJlZnMuZmluZFJlZnNBdCgnaHR0cDovL3BldHN0b3JlLnN3YWdnZXIuaW8vdjIvc3dhZ2dlci5qc29uJywge1xuICogICAgIHN1YkRvY1BhdGg6ICcjL2RlZmluaXRpb25zJ1xuICogICB9KVxuICogICAudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gKiAgICAgIC8vIERvIHNvbWV0aGluZyB3aXRoIHRoZSByZXNwb25zZVxuICogICAgICAvL1xuICogICAgICAvLyByZXMucmVmczogSlNPTiBSZWZlcmVuY2UgbG9jYXRpb25zIGFuZCBkZXRhaWxzXG4gKiAgICAgIC8vIHJlcy52YWx1ZTogVGhlIHJldHJpZXZlZCBkb2N1bWVudFxuICogICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gKiAgICAgY29uc29sZS5sb2coZXJyLnN0YWNrKTtcbiAqICAgfSk7XG4gKi9cbmZ1bmN0aW9uIGZpbmRSZWZzQXQgKGxvY2F0aW9uLCBvcHRpb25zKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcHJvdmlkZWQgbG9jYXRpb25cbiAgICAgIGlmICghaXNUeXBlKGxvY2F0aW9uLCAnU3RyaW5nJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbG9jYXRpb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgICAgfVxuXG4gICAgICAvLyBWYWxpZGF0ZSBvcHRpb25zXG4gICAgICBvcHRpb25zID0gdmFsaWRhdGVPcHRpb25zKG9wdGlvbnMpO1xuXG4gICAgICAvLyBDb21iaW5lIHRoZSBsb2NhdGlvbiBhbmQgdGhlIG9wdGlvbmFsIHJlbGF0aXZlIGJhc2VcbiAgICAgIGxvY2F0aW9uID0gY29tYmluZVVSSXMob3B0aW9ucy5yZWxhdGl2ZUJhc2UsIGxvY2F0aW9uKTtcblxuICAgICAgcmV0dXJuIGdldFJlbW90ZURvY3VtZW50KGxvY2F0aW9uLCBvcHRpb25zKTtcbiAgICB9KVxuICAgIC50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgIHZhciBjYWNoZUVudHJ5ID0gY2xvbmUocmVtb3RlQ2FjaGVbbG9jYXRpb25dKTtcbiAgICAgIHZhciBjT3B0aW9ucyA9IGNsb25lKG9wdGlvbnMpO1xuICAgICAgdmFyIHVyaURldGFpbHMgPSBwYXJzZVVSSShsb2NhdGlvbik7XG5cbiAgICAgIGlmIChpc1R5cGUoY2FjaGVFbnRyeS5yZWZzLCAnVW5kZWZpbmVkJykpIHtcbiAgICAgICAgLy8gRG8gbm90IGZpbHRlciBhbnkgcmVmZXJlbmNlcyBzbyB0aGUgY2FjaGUgaXMgY29tcGxldGVcbiAgICAgICAgZGVsZXRlIGNPcHRpb25zLmZpbHRlcjtcbiAgICAgICAgZGVsZXRlIGNPcHRpb25zLnN1YkRvY1BhdGg7XG5cbiAgICAgICAgY09wdGlvbnMuaW5jbHVkZUludmFsaWQgPSB0cnVlO1xuXG4gICAgICAgIHJlbW90ZUNhY2hlW2xvY2F0aW9uXS5yZWZzID0gZmluZFJlZnMocmVzLCBjT3B0aW9ucyk7XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCB0aGUgZmlsdGVyIG9wdGlvbnMgYmFja1xuICAgICAgaWYgKCFpc1R5cGUob3B0aW9ucy5maWx0ZXIsICdVbmRlZmluZWQnKSkge1xuICAgICAgICBjT3B0aW9ucy5maWx0ZXIgPSBvcHRpb25zLmZpbHRlcjtcbiAgICAgIH1cblxuICAgICAgaWYgKCFpc1R5cGUodXJpRGV0YWlscy5mcmFnbWVudCwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgICAgIGNPcHRpb25zLnN1YkRvY1BhdGggPSBwYXRoRnJvbVB0cihkZWNvZGVVUkkodXJpRGV0YWlscy5mcmFnbWVudCkpO1xuICAgICAgfSBlbHNlIGlmICghaXNUeXBlKHVyaURldGFpbHMuc3ViRG9jUGF0aCwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgICAgIGNPcHRpb25zLnN1YkRvY1BhdGggPSBvcHRpb25zLnN1YkRvY1BhdGg7XG4gICAgICB9XG5cbiAgICAgIC8vIFRoaXMgd2lsbCB1c2UgdGhlIGNhY2hlIHNvIGRvbid0IHdvcnJ5IGFib3V0IGNhbGxpbmcgaXQgdHdpY2VcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHJlZnM6IGZpbmRSZWZzKHJlcywgY09wdGlvbnMpLFxuICAgICAgICB2YWx1ZTogcmVzXG4gICAgICB9O1xuICAgIH0pO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGRldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHRoZSBKU09OIFJlZmVyZW5jZS5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gb2JqIC0gVGhlIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb25cbiAqXG4gKiBAcmV0dXJucyB7bW9kdWxlOkpzb25SZWZzflVucmVzb2x2ZWRSZWZEZXRhaWxzfSB0aGUgZGV0YWlsZWQgaW5mb3JtYXRpb25cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmdldFJlZkRldGFpbHNcbiAqL1xuZnVuY3Rpb24gZ2V0UmVmRGV0YWlscyAob2JqKSB7XG4gIHZhciBkZXRhaWxzID0ge1xuICAgIGRlZjogb2JqXG4gIH07XG4gIHZhciBjYWNoZUtleTtcbiAgdmFyIGV4dHJhS2V5cztcbiAgdmFyIHVyaURldGFpbHM7XG5cbiAgdHJ5IHtcbiAgICBpZiAoaXNSZWZMaWtlKG9iaiwgdHJ1ZSkpIHtcbiAgICAgIGNhY2hlS2V5ID0gb2JqLiRyZWY7XG4gICAgICB1cmlEZXRhaWxzID0gdXJpRGV0YWlsc0NhY2hlW2NhY2hlS2V5XTtcblxuICAgICAgaWYgKGlzVHlwZSh1cmlEZXRhaWxzLCAnVW5kZWZpbmVkJykpIHtcbiAgICAgICAgdXJpRGV0YWlscyA9IHVyaURldGFpbHNDYWNoZVtjYWNoZUtleV0gPSBwYXJzZVVSSShjYWNoZUtleSk7XG4gICAgICB9XG5cbiAgICAgIGRldGFpbHMudXJpID0gY2FjaGVLZXk7XG4gICAgICBkZXRhaWxzLnVyaURldGFpbHMgPSB1cmlEZXRhaWxzO1xuXG4gICAgICBpZiAoaXNUeXBlKHVyaURldGFpbHMuZXJyb3IsICdVbmRlZmluZWQnKSkge1xuICAgICAgICBkZXRhaWxzLnR5cGUgPSBnZXRSZWZUeXBlKGRldGFpbHMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGV0YWlscy5lcnJvciA9IGRldGFpbHMudXJpRGV0YWlscy5lcnJvcjtcbiAgICAgICAgZGV0YWlscy50eXBlID0gJ2ludmFsaWQnO1xuICAgICAgfVxuXG4gICAgICAvLyBJZGVudGlmeSB3YXJuaW5nXG4gICAgICBleHRyYUtleXMgPSBnZXRFeHRyYVJlZktleXMob2JqKTtcblxuICAgICAgaWYgKGV4dHJhS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGRldGFpbHMud2FybmluZyA9ICdFeHRyYSBKU09OIFJlZmVyZW5jZSBwcm9wZXJ0aWVzIHdpbGwgYmUgaWdub3JlZDogJyArIGV4dHJhS2V5cy5qb2luKCcsICcpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBkZXRhaWxzLnR5cGUgPSAnaW52YWxpZCc7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBkZXRhaWxzLmVycm9yID0gZXJyLm1lc3NhZ2U7XG4gICAgZGV0YWlscy50eXBlID0gJ2ludmFsaWQnO1xuICB9XG5cbiAgcmV0dXJuIGRldGFpbHM7XG59XG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIHRoZSBhcmd1bWVudCByZXByZXNlbnRzIGEgSlNPTiBQb2ludGVyLlxuICpcbiAqIEEgc3RyaW5nIGlzIGEgSlNPTiBQb2ludGVyIGlmIHRoZSBmb2xsb3dpbmcgYXJlIGFsbCB0cnVlOlxuICpcbiAqICAgKiBUaGUgc3RyaW5nIGlzIG9mIHR5cGUgYFN0cmluZ2BcbiAqICAgKiBUaGUgc3RyaW5nIG11c3QgYmUgZW1wdHksIGAjYCBvciBzdGFydCB3aXRoIGEgYC9gIG9yIGAjL2BcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHRyIC0gVGhlIHN0cmluZyB0byBjaGVja1xuICogQHBhcmFtIHtib29sZWFufSBbdGhyb3dXaXRoRGV0YWlscz1mYWxzZV0gLSBXaGV0aGVyIG9yIG5vdCB0byB0aHJvdyBhbiBgRXJyb3JgIHdpdGggdGhlIGRldGFpbHMgYXMgdG8gd2h5IHRoZSB2YWx1ZVxuICogcHJvdmlkZWQgaXMgaW52YWxpZFxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSB0aGUgcmVzdWx0IG9mIHRoZSBjaGVja1xuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSB3aGVuIHRoZSBwcm92aWRlZCB2YWx1ZSBpcyBpbnZhbGlkIGFuZCB0aGUgYHRocm93V2l0aERldGFpbHNgIGFyZ3VtZW50IGlzIGB0cnVlYFxuICpcbiAqIEBhbGlhcyBtb2R1bGU6SnNvblJlZnMuaXNQdHJcbiAqXG4gKiBAc2VlIHtAbGluayBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjkwMSNzZWN0aW9uLTN9XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFNlcGFyYXRpbmcgdGhlIGRpZmZlcmVudCB3YXlzIHRvIGludm9rZSBpc1B0ciBmb3IgZGVtb25zdHJhdGlvbiBwdXJwb3Nlc1xuICogaWYgKGlzUHRyKHN0cikpIHtcbiAqICAgLy8gSGFuZGxlIGEgdmFsaWQgSlNPTiBQb2ludGVyXG4gKiB9IGVsc2Uge1xuICogICAvLyBHZXQgdGhlIHJlYXNvbiBhcyB0byB3aHkgdGhlIHZhbHVlIGlzIG5vdCBhIEpTT04gUG9pbnRlciBzbyB5b3UgY2FuIGZpeC9yZXBvcnQgaXRcbiAqICAgdHJ5IHtcbiAqICAgICBpc1B0cihzdHIsIHRydWUpO1xuICogICB9IGNhdGNoIChlcnIpIHtcbiAqICAgICAvLyBUaGUgZXJyb3IgbWVzc2FnZSBjb250YWlucyB0aGUgZGV0YWlscyBhcyB0byB3aHkgdGhlIHByb3ZpZGVkIHZhbHVlIGlzIG5vdCBhIEpTT04gUG9pbnRlclxuICogICB9XG4gKiB9XG4gKi9cbmZ1bmN0aW9uIGlzUHRyIChwdHIsIHRocm93V2l0aERldGFpbHMpIHtcbiAgdmFyIHZhbGlkID0gdHJ1ZTtcbiAgdmFyIGZpcnN0Q2hhcjtcblxuICB0cnkge1xuICAgIGlmIChpc1R5cGUocHRyLCAnU3RyaW5nJykpIHtcbiAgICAgIGlmIChwdHIgIT09ICcnKSB7XG4gICAgICAgIGZpcnN0Q2hhciA9IHB0ci5jaGFyQXQoMCk7XG5cbiAgICAgICAgaWYgKFsnIycsICcvJ10uaW5kZXhPZihmaXJzdENoYXIpID09PSAtMSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcigncHRyIG11c3Qgc3RhcnQgd2l0aCBhIC8gb3IgIy8nKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaXJzdENoYXIgPT09ICcjJyAmJiBwdHIgIT09ICcjJyAmJiBwdHIuY2hhckF0KDEpICE9PSAnLycpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IHN0YXJ0IHdpdGggYSAvIG9yICMvJyk7XG4gICAgICAgIH0gZWxzZSBpZiAocHRyLm1hdGNoKGJhZFB0clRva2VuUmVnZXgpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgaGFzIGludmFsaWQgdG9rZW4ocyknKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyBub3QgYSBTdHJpbmcnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmICh0aHJvd1dpdGhEZXRhaWxzID09PSB0cnVlKSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgdmFsaWQgPSBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiB2YWxpZDtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgdGhlIGFyZ3VtZW50IHJlcHJlc2VudHMgYSBKU09OIFJlZmVyZW5jZS5cbiAqXG4gKiBBbiBvYmplY3QgaXMgYSBKU09OIFJlZmVyZW5jZSBvbmx5IGlmIHRoZSBmb2xsb3dpbmcgYXJlIGFsbCB0cnVlOlxuICpcbiAqICAgKiBUaGUgb2JqZWN0IGlzIG9mIHR5cGUgYE9iamVjdGBcbiAqICAgKiBUaGUgb2JqZWN0IGhhcyBhIGAkcmVmYCBwcm9wZXJ0eVxuICogICAqIFRoZSBgJHJlZmAgcHJvcGVydHkgaXMgYSB2YWxpZCBVUkkgKihXZSBkbyBub3QgcmVxdWlyZSAxMDAlIHN0cmljdCBVUklzIGFuZCB3aWxsIGhhbmRsZSB1bmVzY2FwZWQgc3BlY2lhbFxuICogICAgIGNoYXJhY3RlcnMuKSpcbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gb2JqIC0gVGhlIG9iamVjdCB0byBjaGVja1xuICogQHBhcmFtIHtib29sZWFufSBbdGhyb3dXaXRoRGV0YWlscz1mYWxzZV0gLSBXaGV0aGVyIG9yIG5vdCB0byB0aHJvdyBhbiBgRXJyb3JgIHdpdGggdGhlIGRldGFpbHMgYXMgdG8gd2h5IHRoZSB2YWx1ZVxuICogcHJvdmlkZWQgaXMgaW52YWxpZFxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSB0aGUgcmVzdWx0IG9mIHRoZSBjaGVja1xuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSB3aGVuIHRoZSBwcm92aWRlZCB2YWx1ZSBpcyBpbnZhbGlkIGFuZCB0aGUgYHRocm93V2l0aERldGFpbHNgIGFyZ3VtZW50IGlzIGB0cnVlYFxuICpcbiAqIEBhbGlhcyBtb2R1bGU6SnNvblJlZnMuaXNSZWZcbiAqXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzI3NlY3Rpb24tM31cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gU2VwYXJhdGluZyB0aGUgZGlmZmVyZW50IHdheXMgdG8gaW52b2tlIGlzUmVmIGZvciBkZW1vbnN0cmF0aW9uIHB1cnBvc2VzXG4gKiBpZiAoaXNSZWYob2JqKSkge1xuICogICAvLyBIYW5kbGUgYSB2YWxpZCBKU09OIFJlZmVyZW5jZVxuICogfSBlbHNlIHtcbiAqICAgLy8gR2V0IHRoZSByZWFzb24gYXMgdG8gd2h5IHRoZSB2YWx1ZSBpcyBub3QgYSBKU09OIFJlZmVyZW5jZSBzbyB5b3UgY2FuIGZpeC9yZXBvcnQgaXRcbiAqICAgdHJ5IHtcbiAqICAgICBpc1JlZihzdHIsIHRydWUpO1xuICogICB9IGNhdGNoIChlcnIpIHtcbiAqICAgICAvLyBUaGUgZXJyb3IgbWVzc2FnZSBjb250YWlucyB0aGUgZGV0YWlscyBhcyB0byB3aHkgdGhlIHByb3ZpZGVkIHZhbHVlIGlzIG5vdCBhIEpTT04gUmVmZXJlbmNlXG4gKiAgIH1cbiAqIH1cbiAqL1xuZnVuY3Rpb24gaXNSZWYgKG9iaiwgdGhyb3dXaXRoRGV0YWlscykge1xuICByZXR1cm4gaXNSZWZMaWtlKG9iaiwgdGhyb3dXaXRoRGV0YWlscykgJiYgZ2V0UmVmRGV0YWlscyhvYmosIHRocm93V2l0aERldGFpbHMpLnR5cGUgIT09ICdpbnZhbGlkJztcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgZm9yIHRoZSBwcm92aWRlZCBKU09OIFBvaW50ZXIuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHB0ciAtIFRoZSBKU09OIFBvaW50ZXJcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IHRoZSBwYXRoIHNlZ21lbnRzXG4gKlxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZSBwcm92aWRlZCBgcHRyYCBhcmd1bWVudCBpcyBub3QgYSBKU09OIFBvaW50ZXJcbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLnBhdGhGcm9tUHRyXG4gKi9cbmZ1bmN0aW9uIHBhdGhGcm9tUHRyIChwdHIpIHtcbiAgaWYgKCFpc1B0cihwdHIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgbXVzdCBiZSBhIEpTT04gUG9pbnRlcicpO1xuICB9XG5cbiAgdmFyIHNlZ21lbnRzID0gcHRyLnNwbGl0KCcvJyk7XG5cbiAgLy8gUmVtb3ZlIHRoZSBmaXJzdCBzZWdtZW50XG4gIHNlZ21lbnRzLnNoaWZ0KCk7XG5cbiAgcmV0dXJuIGRlY29kZVBhdGgoc2VnbWVudHMpO1xufVxuXG4vKipcbiAqIFJldHVybnMgYSBKU09OIFBvaW50ZXIgZm9yIHRoZSBwcm92aWRlZCBhcnJheSBvZiBwYXRoIHNlZ21lbnRzLlxuICpcbiAqICoqTm90ZToqKiBJZiBhIHBhdGggc2VnbWVudCBpbiBgcGF0aGAgaXMgbm90IGEgYFN0cmluZ2AsIGl0IHdpbGwgYmUgY29udmVydGVkIHRvIG9uZSB1c2luZyBgSlNPTi5zdHJpbmdpZnlgLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50c1xuICogQHBhcmFtIHtib29sZWFufSBbaGFzaFByZWZpeD10cnVlXSAtIFdoZXRoZXIgb3Igbm90IGNyZWF0ZSBhIGhhc2gtcHJlZml4ZWQgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge3N0cmluZ30gdGhlIGNvcnJlc3BvbmRpbmcgSlNPTiBQb2ludGVyXG4gKlxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZSBgcGF0aGAgYXJndW1lbnQgaXMgbm90IGFuIGFycmF5XG4gKlxuICogQGFsaWFzIG1vZHVsZTpKc29uUmVmcy5wYXRoVG9QdHJcbiAqL1xuZnVuY3Rpb24gcGF0aFRvUHRyIChwYXRoLCBoYXNoUHJlZml4KSB7XG4gIGlmICghaXNUeXBlKHBhdGgsICdBcnJheScpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwYXRoIG11c3QgYmUgYW4gQXJyYXknKTtcbiAgfVxuXG4gIC8vIEVuY29kZSBlYWNoIHNlZ21lbnQgYW5kIHJldHVyblxuICByZXR1cm4gKGhhc2hQcmVmaXggIT09IGZhbHNlID8gJyMnIDogJycpICsgKHBhdGgubGVuZ3RoID4gMCA/ICcvJyA6ICcnKSArIGVuY29kZVBhdGgocGF0aCkuam9pbignLycpO1xufVxuXG4vKipcbiAqIEZpbmRzIEpTT04gUmVmZXJlbmNlcyBkZWZpbmVkIHdpdGhpbiB0aGUgcHJvdmlkZWQgYXJyYXkvb2JqZWN0IGFuZCByZXNvbHZlcyB0aGVtLlxuICpcbiAqIEBwYXJhbSB7YXJyYXl8b2JqZWN0fSBvYmogLSBUaGUgc3RydWN0dXJlIHRvIGZpbmQgSlNPTiBSZWZlcmVuY2VzIHdpdGhpblxuICogQHBhcmFtIHttb2R1bGU6SnNvblJlZnN+SnNvblJlZnNPcHRpb25zfSBbb3B0aW9uc10gLSBUaGUgSnNvblJlZnMgb3B0aW9uc1xuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBhIHtAbGluayBtb2R1bGU6SnNvblJlZnN+UmVzb2x2ZWRSZWZzUmVzdWx0c30gYW5kIHJlamVjdHMgd2l0aCBhblxuICogYEVycm9yYCB3aGVuIHRoZSBpbnB1dCBhcmd1bWVudHMgZmFpbCB2YWxpZGF0aW9uLCB3aGVuIGBvcHRpb25zLnN1YkRvY1BhdGhgIHBvaW50cyB0byBhbiBpbnZhbGlkIGxvY2F0aW9uIG9yIHdoZW5cbiAqICB0aGUgbG9jYXRpb24gYXJndW1lbnQgcG9pbnRzIHRvIGFuIHVubG9hZGFibGUgcmVzb3VyY2VcbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLnJlc29sdmVSZWZzXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdGhhdCBvbmx5IHJlc29sdmVzIHJlbGF0aXZlIGFuZCByZW1vdGUgcmVmZXJlbmNlc1xuICogSnNvblJlZnMucmVzb2x2ZVJlZnMoc3dhZ2dlck9iaiwge1xuICogICAgIGZpbHRlcjogWydyZWxhdGl2ZScsICdyZW1vdGUnXVxuICogICB9KVxuICogICAudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gKiAgICAgIC8vIERvIHNvbWV0aGluZyB3aXRoIHRoZSByZXNwb25zZVxuICogICAgICAvL1xuICogICAgICAvLyByZXMucmVmczogSlNPTiBSZWZlcmVuY2UgbG9jYXRpb25zIGFuZCBkZXRhaWxzXG4gKiAgICAgIC8vIHJlcy5yZXNvbHZlZDogVGhlIGRvY3VtZW50IHdpdGggdGhlIGFwcHJvcHJpYXRlIEpTT04gUmVmZXJlbmNlcyByZXNvbHZlZFxuICogICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gKiAgICAgY29uc29sZS5sb2coZXJyLnN0YWNrKTtcbiAqICAgfSk7XG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVSZWZzIChvYmosIG9wdGlvbnMpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIFZhbGlkYXRlIHRoZSBwcm92aWRlZCBkb2N1bWVudFxuICAgICAgaWYgKCFpc1R5cGUob2JqLCAnQXJyYXknKSAmJiAhaXNUeXBlKG9iaiwgJ09iamVjdCcpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29iaiBtdXN0IGJlIGFuIEFycmF5IG9yIGFuIE9iamVjdCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBWYWxpZGF0ZSBvcHRpb25zXG4gICAgICBvcHRpb25zID0gdmFsaWRhdGVPcHRpb25zKG9wdGlvbnMsIG9iaik7XG5cbiAgICAgIC8vIENsb25lIHRoZSBpbnB1dCBzbyB3ZSBkbyBub3QgYWx0ZXIgaXRcbiAgICAgIG9iaiA9IGNsb25lKG9iaik7XG4gICAgfSlcbiAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gZmluZFJlZnNSZWN1cnNpdmUob2JqLCBvcHRpb25zLCBbXSwgW10sIHtcbiAgICAgICAgZG9jdW1lbnRzOiB7fSxcbiAgICAgICAgcmVmczoge31cbiAgICAgIH0pO1xuICAgIH0pXG4gICAgLnRoZW4oZnVuY3Rpb24gKGFsbFJlZnMpIHtcbiAgICAgIHZhciBkZWZlcnJlZFJlZnMgPSB7fTtcbiAgICAgIHZhciByZWZzID0ge307XG5cbiAgICAgIGZ1bmN0aW9uIHBhdGhTb3J0ZXIgKHAxLCBwMikge1xuICAgICAgICByZXR1cm4gcGF0aEZyb21QdHIocDEpLmxlbmd0aCAtIHBhdGhGcm9tUHRyKHAyKS5sZW5ndGg7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlc29sdmUgYWxsIHJlZmVyZW5jZXMgd2l0aCBhIGtub3duIHZhbHVlXG4gICAgICBPYmplY3Qua2V5cyhhbGxSZWZzLnJlZnMpLnNvcnQocGF0aFNvcnRlcikuZm9yRWFjaChmdW5jdGlvbiAocmVmUHRyKSB7XG4gICAgICAgIHZhciByZWZEZXRhaWxzID0gYWxsUmVmcy5yZWZzW3JlZlB0cl07XG5cbiAgICAgICAgLy8gUmVjb3JkIGFsbCBkaXJlY3QgcmVmZXJlbmNlc1xuICAgICAgICBpZiAoIXJlZkRldGFpbHMuaW5kaXJlY3QpIHtcbiAgICAgICAgICByZWZzW3JlZlB0cl0gPSByZWZEZXRhaWxzO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGVsZXRlIGhlbHBlciBwcm9wZXJ0eVxuICAgICAgICBkZWxldGUgcmVmRGV0YWlscy5pbmRpcmVjdDtcblxuICAgICAgICBpZiAoaXNUeXBlKHJlZkRldGFpbHMuZXJyb3IsICdVbmRlZmluZWQnKSAmJiByZWZEZXRhaWxzLnR5cGUgIT09ICdpbnZhbGlkJykge1xuICAgICAgICAgIGlmIChpc1R5cGUocmVmRGV0YWlscy52YWx1ZSwgJ1VuZGVmaW5lZCcpICYmIHJlZkRldGFpbHMuY2lyY3VsYXIpIHtcbiAgICAgICAgICAgIHJlZkRldGFpbHMudmFsdWUgPSByZWZEZXRhaWxzLmRlZjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBXZSBkZWZlciBwcm9jZXNzaW5nIGFsbCByZWZlcmVuY2VzIHdpdGhvdXQgYSB2YWx1ZSB1bnRpbCBsYXRlclxuICAgICAgICAgIGlmIChpc1R5cGUocmVmRGV0YWlscy52YWx1ZSwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgICAgICAgICBkZWZlcnJlZFJlZnNbcmVmUHRyXSA9IHJlZkRldGFpbHM7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChyZWZQdHIgPT09ICcjJykge1xuICAgICAgICAgICAgICBvYmogPSByZWZEZXRhaWxzLnZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgc2V0VmFsdWUob2JqLCBwYXRoRnJvbVB0cihyZWZQdHIpLCByZWZEZXRhaWxzLnZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRGVsZXRlIGhlbHBlciBwcm9wZXJ0eVxuICAgICAgICAgICAgZGVsZXRlIHJlZkRldGFpbHMuYW5jZXN0b3JQdHJzO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlc29sdmUgYWxsIGRlZmVycmVkIHJlZmVyZW5jZXNcbiAgICAgIE9iamVjdC5rZXlzKGRlZmVycmVkUmVmcykuZm9yRWFjaChmdW5jdGlvbiAocmVmUHRyKSB7XG4gICAgICAgIHZhciByZWZEZXRhaWxzID0gZGVmZXJyZWRSZWZzW3JlZlB0cl07XG5cbiAgICAgICAgLy8gQXR0ZW1wdCB0byByZXNvbHZlIHRoZSB2YWx1ZSBhZ2FpbnN0IGFsbCBpZiBpdHMgYW5jZXN0b3JzIGluIG9yZGVyXG4gICAgICAgIHJlZkRldGFpbHMuYW5jZXN0b3JQdHJzLmZvckVhY2goZnVuY3Rpb24gKGFuY2VzdG9yUHRyLCBpbmRleCkge1xuICAgICAgICAgIGlmIChpc1R5cGUocmVmRGV0YWlscy52YWx1ZSwgJ1VuZGVmaW5lZCcpKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICByZWZEZXRhaWxzLnZhbHVlID0gZmluZFZhbHVlKGFsbFJlZnMuZG9jdW1lbnRzW2FuY2VzdG9yUHRyXSwgcGF0aEZyb21QdHIocmVmRGV0YWlscy51cmkpKTtcblxuICAgICAgICAgICAgICAvLyBEZWxldGUgaGVscGVyIHByb3BlcnR5XG4gICAgICAgICAgICAgIGRlbGV0ZSByZWZEZXRhaWxzLmFuY2VzdG9yUHRycztcblxuICAgICAgICAgICAgICBzZXRWYWx1ZShvYmosIHBhdGhGcm9tUHRyKHJlZlB0ciksIHJlZkRldGFpbHMudmFsdWUpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgIGlmIChpbmRleCA9PT0gcmVmRGV0YWlscy5hbmNlc3RvclB0cnMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgICAgIHJlZkRldGFpbHMuZXJyb3IgPSBlcnIubWVzc2FnZTtcbiAgICAgICAgICAgICAgICByZWZEZXRhaWxzLm1pc3NpbmcgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgLy8gRGVsZXRlIGhlbHBlciBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgIGRlbGV0ZSByZWZEZXRhaWxzLmFuY2VzdG9yUHRycztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVmczogcmVmcyxcbiAgICAgICAgcmVzb2x2ZWQ6IG9ialxuICAgICAgfTtcbiAgICB9KTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgSlNPTiBSZWZlcmVuY2VzIGRlZmluZWQgd2l0aGluIHRoZSBkb2N1bWVudCBhdCB0aGUgcHJvdmlkZWQgbG9jYXRpb24uXG4gKlxuICogVGhpcyBBUEkgaXMgaWRlbnRpY2FsIHRvIHtAbGluayBtb2R1bGU6SnNvblJlZnMucmVzb2x2ZVJlZnN9IGV4Y2VwdCB0aGlzIEFQSSB3aWxsIHJldHJpZXZlIGEgcmVtb3RlIGRvY3VtZW50IGFuZCB0aGVuXG4gKiByZXR1cm4gdGhlIHJlc3VsdCBvZiB7QGxpbmsgbW9kdWxlOkpzb25SZWZzLnJlc29sdmVSZWZzfSBvbiB0aGUgcmV0cmlldmVkIGRvY3VtZW50LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhdGlvbiAtIFRoZSBsb2NhdGlvbiB0byByZXRyaWV2ZSAqKENhbiBiZSByZWxhdGl2ZSBvciBhYnNvbHV0ZSwganVzdCBtYWtlIHN1cmUgeW91IGxvb2sgYXQgdGhlXG4gKiB7QGxpbmsgbW9kdWxlOkpzb25SZWZzfkpzb25SZWZzT3B0aW9uc3xvcHRpb25zIGRvY3VtZW50YXRpb259IHRvIHNlZSBob3cgcmVsYXRpdmUgcmVmZXJlbmNlcyBhcmUgaGFuZGxlZC4pKlxuICogQHBhcmFtIHttb2R1bGU6SnNvblJlZnN+SnNvblJlZnNPcHRpb25zfSBbb3B0aW9uc10gLSBUaGUgSnNvblJlZnMgb3B0aW9uc1xuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBhIHtAbGluayBtb2R1bGU6SnNvblJlZnN+UmV0cmlldmVkUmVzb2x2ZWRSZWZzUmVzdWx0c30gYW5kIHJlamVjdHMgd2l0aCBhblxuICogYEVycm9yYCB3aGVuIHRoZSBpbnB1dCBhcmd1bWVudHMgZmFpbCB2YWxpZGF0aW9uLCB3aGVuIGBvcHRpb25zLnN1YkRvY1BhdGhgIHBvaW50cyB0byBhbiBpbnZhbGlkIGxvY2F0aW9uIG9yIHdoZW5cbiAqICB0aGUgbG9jYXRpb24gYXJndW1lbnQgcG9pbnRzIHRvIGFuIHVubG9hZGFibGUgcmVzb3VyY2VcbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLnJlc29sdmVSZWZzQXRcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB0aGF0IGxvYWRzIGEgSlNPTiBkb2N1bWVudCAoTm8gb3B0aW9ucy5sb2FkZXJPcHRpb25zLnByb2Nlc3NDb250ZW50IHJlcXVpcmVkKSBhbmQgcmVzb2x2ZXMgYWxsIHJlZmVyZW5jZXNcbiAqIEpzb25SZWZzLnJlc29sdmVSZWZzQXQoJy4vc3dhZ2dlci5qc29uJylcbiAqICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICogICAgICAvLyBEbyBzb21ldGhpbmcgd2l0aCB0aGUgcmVzcG9uc2VcbiAqICAgICAgLy9cbiAqICAgICAgLy8gcmVzLnJlZnM6IEpTT04gUmVmZXJlbmNlIGxvY2F0aW9ucyBhbmQgZGV0YWlsc1xuICogICAgICAvLyByZXMucmVzb2x2ZWQ6IFRoZSBkb2N1bWVudCB3aXRoIHRoZSBhcHByb3ByaWF0ZSBKU09OIFJlZmVyZW5jZXMgcmVzb2x2ZWRcbiAqICAgICAgLy8gcmVzLnZhbHVlOiBUaGUgcmV0cmlldmVkIGRvY3VtZW50XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmxvZyhlcnIuc3RhY2spO1xuICogICB9KTtcbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVJlZnNBdCAobG9jYXRpb24sIG9wdGlvbnMpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIFZhbGlkYXRlIHRoZSBwcm92aWRlZCBsb2NhdGlvblxuICAgICAgaWYgKCFpc1R5cGUobG9jYXRpb24sICdTdHJpbmcnKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsb2NhdGlvbiBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFZhbGlkYXRlIG9wdGlvbnNcbiAgICAgIG9wdGlvbnMgPSB2YWxpZGF0ZU9wdGlvbnMob3B0aW9ucyk7XG5cbiAgICAgIC8vIENvbWJpbmUgdGhlIGxvY2F0aW9uIGFuZCB0aGUgb3B0aW9uYWwgcmVsYXRpdmUgYmFzZVxuICAgICAgbG9jYXRpb24gPSBjb21iaW5lVVJJcyhvcHRpb25zLnJlbGF0aXZlQmFzZSwgbG9jYXRpb24pO1xuXG4gICAgICByZXR1cm4gZ2V0UmVtb3RlRG9jdW1lbnQobG9jYXRpb24sIG9wdGlvbnMpO1xuICAgIH0pXG4gICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgdmFyIGNPcHRpb25zID0gY2xvbmUob3B0aW9ucyk7XG4gICAgICB2YXIgdXJpRGV0YWlscyA9IHBhcnNlVVJJKGxvY2F0aW9uKTtcblxuICAgICAgLy8gU2V0IHRoZSBzdWIgZG9jdW1lbnQgcGF0aCBpZiBuZWNlc3NhcnlcbiAgICAgIGlmICghaXNUeXBlKHVyaURldGFpbHMuZnJhZ21lbnQsICdVbmRlZmluZWQnKSkge1xuICAgICAgICBjT3B0aW9ucy5zdWJEb2NQYXRoID0gcGF0aEZyb21QdHIoZGVjb2RlVVJJKHVyaURldGFpbHMuZnJhZ21lbnQpKTtcbiAgICAgIH1cblxuICAgICAgLy8gVXBkYXRlIHRoZSByZWxhdGl2ZSBiYXNlIGJhc2VkIG9uIHRoZSByZXRyaWV2ZWQgbG9jYXRpb25cbiAgICAgIGNPcHRpb25zLnJlbGF0aXZlQmFzZSA9IHBhdGguZGlybmFtZShsb2NhdGlvbik7XG5cbiAgICAgIHJldHVybiByZXNvbHZlUmVmcyhyZXMsIGNPcHRpb25zKVxuICAgICAgICAudGhlbihmdW5jdGlvbiAocmVzMikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZWZzOiByZXMyLnJlZnMsXG4gICAgICAgICAgICByZXNvbHZlZDogcmVzMi5yZXNvbHZlZCxcbiAgICAgICAgICAgIHZhbHVlOiByZXNcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbi8qIEV4cG9ydCB0aGUgbW9kdWxlIG1lbWJlcnMgKi9cbm1vZHVsZS5leHBvcnRzLmNsZWFyQ2FjaGUgPSBjbGVhckNhY2hlO1xubW9kdWxlLmV4cG9ydHMuZGVjb2RlUGF0aCA9IGRlY29kZVBhdGg7XG5tb2R1bGUuZXhwb3J0cy5lbmNvZGVQYXRoID0gZW5jb2RlUGF0aDtcbm1vZHVsZS5leHBvcnRzLmZpbmRSZWZzID0gZmluZFJlZnM7XG5tb2R1bGUuZXhwb3J0cy5maW5kUmVmc0F0ID0gZmluZFJlZnNBdDtcbm1vZHVsZS5leHBvcnRzLmdldFJlZkRldGFpbHMgPSBnZXRSZWZEZXRhaWxzO1xubW9kdWxlLmV4cG9ydHMuaXNQdHIgPSBpc1B0cjtcbm1vZHVsZS5leHBvcnRzLmlzUmVmID0gaXNSZWY7XG5tb2R1bGUuZXhwb3J0cy5wYXRoRnJvbVB0ciA9IHBhdGhGcm9tUHRyO1xubW9kdWxlLmV4cG9ydHMucGF0aFRvUHRyID0gcGF0aFRvUHRyO1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnMgPSByZXNvbHZlUmVmcztcbm1vZHVsZS5leHBvcnRzLnJlc29sdmVSZWZzQXQgPSByZXNvbHZlUmVmc0F0O1xuIiwiXG4vKipcbiAqIEV4cG9zZSBgRW1pdHRlcmAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBFbWl0dGVyO1xuXG4vKipcbiAqIEluaXRpYWxpemUgYSBuZXcgYEVtaXR0ZXJgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gRW1pdHRlcihvYmopIHtcbiAgaWYgKG9iaikgcmV0dXJuIG1peGluKG9iaik7XG59O1xuXG4vKipcbiAqIE1peGluIHRoZSBlbWl0dGVyIHByb3BlcnRpZXMuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbWl4aW4ob2JqKSB7XG4gIGZvciAodmFyIGtleSBpbiBFbWl0dGVyLnByb3RvdHlwZSkge1xuICAgIG9ialtrZXldID0gRW1pdHRlci5wcm90b3R5cGVba2V5XTtcbiAgfVxuICByZXR1cm4gb2JqO1xufVxuXG4vKipcbiAqIExpc3RlbiBvbiB0aGUgZ2l2ZW4gYGV2ZW50YCB3aXRoIGBmbmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub24gPVxuRW1pdHRlci5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgKHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF0gPSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdIHx8IFtdKVxuICAgIC5wdXNoKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFkZHMgYW4gYGV2ZW50YCBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgaW52b2tlZCBhIHNpbmdsZVxuICogdGltZSB0aGVuIGF1dG9tYXRpY2FsbHkgcmVtb3ZlZC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgZnVuY3Rpb24gb24oKSB7XG4gICAgdGhpcy5vZmYoZXZlbnQsIG9uKTtcbiAgICBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9XG5cbiAgb24uZm4gPSBmbjtcbiAgdGhpcy5vbihldmVudCwgb24pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUmVtb3ZlIHRoZSBnaXZlbiBjYWxsYmFjayBmb3IgYGV2ZW50YCBvciBhbGxcbiAqIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9mZiA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcblxuICAvLyBhbGxcbiAgaWYgKDAgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xuICAgIHRoaXMuX2NhbGxiYWNrcyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gc3BlY2lmaWMgZXZlbnRcbiAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XG4gIGlmICghY2FsbGJhY2tzKSByZXR1cm4gdGhpcztcblxuICAvLyByZW1vdmUgYWxsIGhhbmRsZXJzXG4gIGlmICgxID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHJlbW92ZSBzcGVjaWZpYyBoYW5kbGVyXG4gIHZhciBjYjtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBjYWxsYmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICBjYiA9IGNhbGxiYWNrc1tpXTtcbiAgICBpZiAoY2IgPT09IGZuIHx8IGNiLmZuID09PSBmbikge1xuICAgICAgY2FsbGJhY2tzLnNwbGljZShpLCAxKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogRW1pdCBgZXZlbnRgIHdpdGggdGhlIGdpdmVuIGFyZ3MuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge01peGVkfSAuLi5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuICB2YXIgYXJncyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICwgY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcblxuICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2tzID0gY2FsbGJhY2tzLnNsaWNlKDApO1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBjYWxsYmFja3MubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgIGNhbGxiYWNrc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUmV0dXJuIGFycmF5IG9mIGNhbGxiYWNrcyBmb3IgYGV2ZW50YC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEByZXR1cm4ge0FycmF5fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbihldmVudCl7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgcmV0dXJuIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF0gfHwgW107XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIHRoaXMgZW1pdHRlciBoYXMgYGV2ZW50YCBoYW5kbGVycy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmhhc0xpc3RlbmVycyA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgcmV0dXJuICEhIHRoaXMubGlzdGVuZXJzKGV2ZW50KS5sZW5ndGg7XG59O1xuIiwiLyohIE5hdGl2ZSBQcm9taXNlIE9ubHlcbiAgICB2MC44LjEgKGMpIEt5bGUgU2ltcHNvblxuICAgIE1JVCBMaWNlbnNlOiBodHRwOi8vZ2V0aWZ5Lm1pdC1saWNlbnNlLm9yZ1xuKi9cblxuKGZ1bmN0aW9uIFVNRChuYW1lLGNvbnRleHQsZGVmaW5pdGlvbil7XG5cdC8vIHNwZWNpYWwgZm9ybSBvZiBVTUQgZm9yIHBvbHlmaWxsaW5nIGFjcm9zcyBldmlyb25tZW50c1xuXHRjb250ZXh0W25hbWVdID0gY29udGV4dFtuYW1lXSB8fCBkZWZpbml0aW9uKCk7XG5cdGlmICh0eXBlb2YgbW9kdWxlICE9IFwidW5kZWZpbmVkXCIgJiYgbW9kdWxlLmV4cG9ydHMpIHsgbW9kdWxlLmV4cG9ydHMgPSBjb250ZXh0W25hbWVdOyB9XG5cdGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT0gXCJmdW5jdGlvblwiICYmIGRlZmluZS5hbWQpIHsgZGVmaW5lKGZ1bmN0aW9uICRBTUQkKCl7IHJldHVybiBjb250ZXh0W25hbWVdOyB9KTsgfVxufSkoXCJQcm9taXNlXCIsdHlwZW9mIGdsb2JhbCAhPSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDogdGhpcyxmdW5jdGlvbiBERUYoKXtcblx0Lypqc2hpbnQgdmFsaWR0aGlzOnRydWUgKi9cblx0XCJ1c2Ugc3RyaWN0XCI7XG5cblx0dmFyIGJ1aWx0SW5Qcm9wLCBjeWNsZSwgc2NoZWR1bGluZ19xdWV1ZSxcblx0XHRUb1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcsXG5cdFx0dGltZXIgPSAodHlwZW9mIHNldEltbWVkaWF0ZSAhPSBcInVuZGVmaW5lZFwiKSA/XG5cdFx0XHRmdW5jdGlvbiB0aW1lcihmbikgeyByZXR1cm4gc2V0SW1tZWRpYXRlKGZuKTsgfSA6XG5cdFx0XHRzZXRUaW1lb3V0XG5cdDtcblxuXHQvLyBkYW1taXQsIElFOC5cblx0dHJ5IHtcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoe30sXCJ4XCIse30pO1xuXHRcdGJ1aWx0SW5Qcm9wID0gZnVuY3Rpb24gYnVpbHRJblByb3Aob2JqLG5hbWUsdmFsLGNvbmZpZykge1xuXHRcdFx0cmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosbmFtZSx7XG5cdFx0XHRcdHZhbHVlOiB2YWwsXG5cdFx0XHRcdHdyaXRhYmxlOiB0cnVlLFxuXHRcdFx0XHRjb25maWd1cmFibGU6IGNvbmZpZyAhPT0gZmFsc2Vcblx0XHRcdH0pO1xuXHRcdH07XG5cdH1cblx0Y2F0Y2ggKGVycikge1xuXHRcdGJ1aWx0SW5Qcm9wID0gZnVuY3Rpb24gYnVpbHRJblByb3Aob2JqLG5hbWUsdmFsKSB7XG5cdFx0XHRvYmpbbmFtZV0gPSB2YWw7XG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH07XG5cdH1cblxuXHQvLyBOb3RlOiB1c2luZyBhIHF1ZXVlIGluc3RlYWQgb2YgYXJyYXkgZm9yIGVmZmljaWVuY3lcblx0c2NoZWR1bGluZ19xdWV1ZSA9IChmdW5jdGlvbiBRdWV1ZSgpIHtcblx0XHR2YXIgZmlyc3QsIGxhc3QsIGl0ZW07XG5cblx0XHRmdW5jdGlvbiBJdGVtKGZuLHNlbGYpIHtcblx0XHRcdHRoaXMuZm4gPSBmbjtcblx0XHRcdHRoaXMuc2VsZiA9IHNlbGY7XG5cdFx0XHR0aGlzLm5leHQgPSB2b2lkIDA7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGFkZDogZnVuY3Rpb24gYWRkKGZuLHNlbGYpIHtcblx0XHRcdFx0aXRlbSA9IG5ldyBJdGVtKGZuLHNlbGYpO1xuXHRcdFx0XHRpZiAobGFzdCkge1xuXHRcdFx0XHRcdGxhc3QubmV4dCA9IGl0ZW07XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0Zmlyc3QgPSBpdGVtO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGxhc3QgPSBpdGVtO1xuXHRcdFx0XHRpdGVtID0gdm9pZCAwO1xuXHRcdFx0fSxcblx0XHRcdGRyYWluOiBmdW5jdGlvbiBkcmFpbigpIHtcblx0XHRcdFx0dmFyIGYgPSBmaXJzdDtcblx0XHRcdFx0Zmlyc3QgPSBsYXN0ID0gY3ljbGUgPSB2b2lkIDA7XG5cblx0XHRcdFx0d2hpbGUgKGYpIHtcblx0XHRcdFx0XHRmLmZuLmNhbGwoZi5zZWxmKTtcblx0XHRcdFx0XHRmID0gZi5uZXh0O1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fTtcblx0fSkoKTtcblxuXHRmdW5jdGlvbiBzY2hlZHVsZShmbixzZWxmKSB7XG5cdFx0c2NoZWR1bGluZ19xdWV1ZS5hZGQoZm4sc2VsZik7XG5cdFx0aWYgKCFjeWNsZSkge1xuXHRcdFx0Y3ljbGUgPSB0aW1lcihzY2hlZHVsaW5nX3F1ZXVlLmRyYWluKTtcblx0XHR9XG5cdH1cblxuXHQvLyBwcm9taXNlIGR1Y2sgdHlwaW5nXG5cdGZ1bmN0aW9uIGlzVGhlbmFibGUobykge1xuXHRcdHZhciBfdGhlbiwgb190eXBlID0gdHlwZW9mIG87XG5cblx0XHRpZiAobyAhPSBudWxsICYmXG5cdFx0XHQoXG5cdFx0XHRcdG9fdHlwZSA9PSBcIm9iamVjdFwiIHx8IG9fdHlwZSA9PSBcImZ1bmN0aW9uXCJcblx0XHRcdClcblx0XHQpIHtcblx0XHRcdF90aGVuID0gby50aGVuO1xuXHRcdH1cblx0XHRyZXR1cm4gdHlwZW9mIF90aGVuID09IFwiZnVuY3Rpb25cIiA/IF90aGVuIDogZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBub3RpZnkoKSB7XG5cdFx0Zm9yICh2YXIgaT0wOyBpPHRoaXMuY2hhaW4ubGVuZ3RoOyBpKyspIHtcblx0XHRcdG5vdGlmeUlzb2xhdGVkKFxuXHRcdFx0XHR0aGlzLFxuXHRcdFx0XHQodGhpcy5zdGF0ZSA9PT0gMSkgPyB0aGlzLmNoYWluW2ldLnN1Y2Nlc3MgOiB0aGlzLmNoYWluW2ldLmZhaWx1cmUsXG5cdFx0XHRcdHRoaXMuY2hhaW5baV1cblx0XHRcdCk7XG5cdFx0fVxuXHRcdHRoaXMuY2hhaW4ubGVuZ3RoID0gMDtcblx0fVxuXG5cdC8vIE5PVEU6IFRoaXMgaXMgYSBzZXBhcmF0ZSBmdW5jdGlvbiB0byBpc29sYXRlXG5cdC8vIHRoZSBgdHJ5Li5jYXRjaGAgc28gdGhhdCBvdGhlciBjb2RlIGNhbiBiZVxuXHQvLyBvcHRpbWl6ZWQgYmV0dGVyXG5cdGZ1bmN0aW9uIG5vdGlmeUlzb2xhdGVkKHNlbGYsY2IsY2hhaW4pIHtcblx0XHR2YXIgcmV0LCBfdGhlbjtcblx0XHR0cnkge1xuXHRcdFx0aWYgKGNiID09PSBmYWxzZSkge1xuXHRcdFx0XHRjaGFpbi5yZWplY3Qoc2VsZi5tc2cpO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSB7XG5cdFx0XHRcdGlmIChjYiA9PT0gdHJ1ZSkge1xuXHRcdFx0XHRcdHJldCA9IHNlbGYubXNnO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdHJldCA9IGNiLmNhbGwodm9pZCAwLHNlbGYubXNnKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChyZXQgPT09IGNoYWluLnByb21pc2UpIHtcblx0XHRcdFx0XHRjaGFpbi5yZWplY3QoVHlwZUVycm9yKFwiUHJvbWlzZS1jaGFpbiBjeWNsZVwiKSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSBpZiAoX3RoZW4gPSBpc1RoZW5hYmxlKHJldCkpIHtcblx0XHRcdFx0XHRfdGhlbi5jYWxsKHJldCxjaGFpbi5yZXNvbHZlLGNoYWluLnJlamVjdCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0Y2hhaW4ucmVzb2x2ZShyZXQpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGNhdGNoIChlcnIpIHtcblx0XHRcdGNoYWluLnJlamVjdChlcnIpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHJlc29sdmUobXNnKSB7XG5cdFx0dmFyIF90aGVuLCBzZWxmID0gdGhpcztcblxuXHRcdC8vIGFscmVhZHkgdHJpZ2dlcmVkP1xuXHRcdGlmIChzZWxmLnRyaWdnZXJlZCkgeyByZXR1cm47IH1cblxuXHRcdHNlbGYudHJpZ2dlcmVkID0gdHJ1ZTtcblxuXHRcdC8vIHVud3JhcFxuXHRcdGlmIChzZWxmLmRlZikge1xuXHRcdFx0c2VsZiA9IHNlbGYuZGVmO1xuXHRcdH1cblxuXHRcdHRyeSB7XG5cdFx0XHRpZiAoX3RoZW4gPSBpc1RoZW5hYmxlKG1zZykpIHtcblx0XHRcdFx0c2NoZWR1bGUoZnVuY3Rpb24oKXtcblx0XHRcdFx0XHR2YXIgZGVmX3dyYXBwZXIgPSBuZXcgTWFrZURlZldyYXBwZXIoc2VsZik7XG5cdFx0XHRcdFx0dHJ5IHtcblx0XHRcdFx0XHRcdF90aGVuLmNhbGwobXNnLFxuXHRcdFx0XHRcdFx0XHRmdW5jdGlvbiAkcmVzb2x2ZSQoKXsgcmVzb2x2ZS5hcHBseShkZWZfd3JhcHBlcixhcmd1bWVudHMpOyB9LFxuXHRcdFx0XHRcdFx0XHRmdW5jdGlvbiAkcmVqZWN0JCgpeyByZWplY3QuYXBwbHkoZGVmX3dyYXBwZXIsYXJndW1lbnRzKTsgfVxuXHRcdFx0XHRcdFx0KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0Y2F0Y2ggKGVycikge1xuXHRcdFx0XHRcdFx0cmVqZWN0LmNhbGwoZGVmX3dyYXBwZXIsZXJyKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pXG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0c2VsZi5tc2cgPSBtc2c7XG5cdFx0XHRcdHNlbGYuc3RhdGUgPSAxO1xuXHRcdFx0XHRpZiAoc2VsZi5jaGFpbi5sZW5ndGggPiAwKSB7XG5cdFx0XHRcdFx0c2NoZWR1bGUobm90aWZ5LHNlbGYpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGNhdGNoIChlcnIpIHtcblx0XHRcdHJlamVjdC5jYWxsKG5ldyBNYWtlRGVmV3JhcHBlcihzZWxmKSxlcnIpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHJlamVjdChtc2cpIHtcblx0XHR2YXIgc2VsZiA9IHRoaXM7XG5cblx0XHQvLyBhbHJlYWR5IHRyaWdnZXJlZD9cblx0XHRpZiAoc2VsZi50cmlnZ2VyZWQpIHsgcmV0dXJuOyB9XG5cblx0XHRzZWxmLnRyaWdnZXJlZCA9IHRydWU7XG5cblx0XHQvLyB1bndyYXBcblx0XHRpZiAoc2VsZi5kZWYpIHtcblx0XHRcdHNlbGYgPSBzZWxmLmRlZjtcblx0XHR9XG5cblx0XHRzZWxmLm1zZyA9IG1zZztcblx0XHRzZWxmLnN0YXRlID0gMjtcblx0XHRpZiAoc2VsZi5jaGFpbi5sZW5ndGggPiAwKSB7XG5cdFx0XHRzY2hlZHVsZShub3RpZnksc2VsZik7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gaXRlcmF0ZVByb21pc2VzKENvbnN0cnVjdG9yLGFycixyZXNvbHZlcixyZWplY3Rlcikge1xuXHRcdGZvciAodmFyIGlkeD0wOyBpZHg8YXJyLmxlbmd0aDsgaWR4KyspIHtcblx0XHRcdChmdW5jdGlvbiBJSUZFKGlkeCl7XG5cdFx0XHRcdENvbnN0cnVjdG9yLnJlc29sdmUoYXJyW2lkeF0pXG5cdFx0XHRcdC50aGVuKFxuXHRcdFx0XHRcdGZ1bmN0aW9uICRyZXNvbHZlciQobXNnKXtcblx0XHRcdFx0XHRcdHJlc29sdmVyKGlkeCxtc2cpO1xuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0cmVqZWN0ZXJcblx0XHRcdFx0KTtcblx0XHRcdH0pKGlkeCk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gTWFrZURlZldyYXBwZXIoc2VsZikge1xuXHRcdHRoaXMuZGVmID0gc2VsZjtcblx0XHR0aGlzLnRyaWdnZXJlZCA9IGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gTWFrZURlZihzZWxmKSB7XG5cdFx0dGhpcy5wcm9taXNlID0gc2VsZjtcblx0XHR0aGlzLnN0YXRlID0gMDtcblx0XHR0aGlzLnRyaWdnZXJlZCA9IGZhbHNlO1xuXHRcdHRoaXMuY2hhaW4gPSBbXTtcblx0XHR0aGlzLm1zZyA9IHZvaWQgMDtcblx0fVxuXG5cdGZ1bmN0aW9uIFByb21pc2UoZXhlY3V0b3IpIHtcblx0XHRpZiAodHlwZW9mIGV4ZWN1dG9yICE9IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0fVxuXG5cdFx0aWYgKHRoaXMuX19OUE9fXyAhPT0gMCkge1xuXHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgcHJvbWlzZVwiKTtcblx0XHR9XG5cblx0XHQvLyBpbnN0YW5jZSBzaGFkb3dpbmcgdGhlIGluaGVyaXRlZCBcImJyYW5kXCJcblx0XHQvLyB0byBzaWduYWwgYW4gYWxyZWFkeSBcImluaXRpYWxpemVkXCIgcHJvbWlzZVxuXHRcdHRoaXMuX19OUE9fXyA9IDE7XG5cblx0XHR2YXIgZGVmID0gbmV3IE1ha2VEZWYodGhpcyk7XG5cblx0XHR0aGlzW1widGhlblwiXSA9IGZ1bmN0aW9uIHRoZW4oc3VjY2VzcyxmYWlsdXJlKSB7XG5cdFx0XHR2YXIgbyA9IHtcblx0XHRcdFx0c3VjY2VzczogdHlwZW9mIHN1Y2Nlc3MgPT0gXCJmdW5jdGlvblwiID8gc3VjY2VzcyA6IHRydWUsXG5cdFx0XHRcdGZhaWx1cmU6IHR5cGVvZiBmYWlsdXJlID09IFwiZnVuY3Rpb25cIiA/IGZhaWx1cmUgOiBmYWxzZVxuXHRcdFx0fTtcblx0XHRcdC8vIE5vdGU6IGB0aGVuKC4uKWAgaXRzZWxmIGNhbiBiZSBib3Jyb3dlZCB0byBiZSB1c2VkIGFnYWluc3Rcblx0XHRcdC8vIGEgZGlmZmVyZW50IHByb21pc2UgY29uc3RydWN0b3IgZm9yIG1ha2luZyB0aGUgY2hhaW5lZCBwcm9taXNlLFxuXHRcdFx0Ly8gYnkgc3Vic3RpdHV0aW5nIGEgZGlmZmVyZW50IGB0aGlzYCBiaW5kaW5nLlxuXHRcdFx0by5wcm9taXNlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoZnVuY3Rpb24gZXh0cmFjdENoYWluKHJlc29sdmUscmVqZWN0KSB7XG5cdFx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0XHR0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdG8ucmVzb2x2ZSA9IHJlc29sdmU7XG5cdFx0XHRcdG8ucmVqZWN0ID0gcmVqZWN0O1xuXHRcdFx0fSk7XG5cdFx0XHRkZWYuY2hhaW4ucHVzaChvKTtcblxuXHRcdFx0aWYgKGRlZi5zdGF0ZSAhPT0gMCkge1xuXHRcdFx0XHRzY2hlZHVsZShub3RpZnksZGVmKTtcblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIG8ucHJvbWlzZTtcblx0XHR9O1xuXHRcdHRoaXNbXCJjYXRjaFwiXSA9IGZ1bmN0aW9uICRjYXRjaCQoZmFpbHVyZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMudGhlbih2b2lkIDAsZmFpbHVyZSk7XG5cdFx0fTtcblxuXHRcdHRyeSB7XG5cdFx0XHRleGVjdXRvci5jYWxsKFxuXHRcdFx0XHR2b2lkIDAsXG5cdFx0XHRcdGZ1bmN0aW9uIHB1YmxpY1Jlc29sdmUobXNnKXtcblx0XHRcdFx0XHRyZXNvbHZlLmNhbGwoZGVmLG1zZyk7XG5cdFx0XHRcdH0sXG5cdFx0XHRcdGZ1bmN0aW9uIHB1YmxpY1JlamVjdChtc2cpIHtcblx0XHRcdFx0XHRyZWplY3QuY2FsbChkZWYsbXNnKTtcblx0XHRcdFx0fVxuXHRcdFx0KTtcblx0XHR9XG5cdFx0Y2F0Y2ggKGVycikge1xuXHRcdFx0cmVqZWN0LmNhbGwoZGVmLGVycik7XG5cdFx0fVxuXHR9XG5cblx0dmFyIFByb21pc2VQcm90b3R5cGUgPSBidWlsdEluUHJvcCh7fSxcImNvbnN0cnVjdG9yXCIsUHJvbWlzZSxcblx0XHQvKmNvbmZpZ3VyYWJsZT0qL2ZhbHNlXG5cdCk7XG5cblx0Ly8gTm90ZTogQW5kcm9pZCA0IGNhbm5vdCB1c2UgYE9iamVjdC5kZWZpbmVQcm9wZXJ0eSguLilgIGhlcmVcblx0UHJvbWlzZS5wcm90b3R5cGUgPSBQcm9taXNlUHJvdG90eXBlO1xuXG5cdC8vIGJ1aWx0LWluIFwiYnJhbmRcIiB0byBzaWduYWwgYW4gXCJ1bmluaXRpYWxpemVkXCIgcHJvbWlzZVxuXHRidWlsdEluUHJvcChQcm9taXNlUHJvdG90eXBlLFwiX19OUE9fX1wiLDAsXG5cdFx0Lypjb25maWd1cmFibGU9Ki9mYWxzZVxuXHQpO1xuXG5cdGJ1aWx0SW5Qcm9wKFByb21pc2UsXCJyZXNvbHZlXCIsZnVuY3Rpb24gUHJvbWlzZSRyZXNvbHZlKG1zZykge1xuXHRcdHZhciBDb25zdHJ1Y3RvciA9IHRoaXM7XG5cblx0XHQvLyBzcGVjIG1hbmRhdGVkIGNoZWNrc1xuXHRcdC8vIG5vdGU6IGJlc3QgXCJpc1Byb21pc2VcIiBjaGVjayB0aGF0J3MgcHJhY3RpY2FsIGZvciBub3dcblx0XHRpZiAobXNnICYmIHR5cGVvZiBtc2cgPT0gXCJvYmplY3RcIiAmJiBtc2cuX19OUE9fXyA9PT0gMSkge1xuXHRcdFx0cmV0dXJuIG1zZztcblx0XHR9XG5cblx0XHRyZXR1cm4gbmV3IENvbnN0cnVjdG9yKGZ1bmN0aW9uIGV4ZWN1dG9yKHJlc29sdmUscmVqZWN0KXtcblx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0XHR9XG5cblx0XHRcdHJlc29sdmUobXNnKTtcblx0XHR9KTtcblx0fSk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcInJlamVjdFwiLGZ1bmN0aW9uIFByb21pc2UkcmVqZWN0KG1zZykge1xuXHRcdHJldHVybiBuZXcgdGhpcyhmdW5jdGlvbiBleGVjdXRvcihyZXNvbHZlLHJlamVjdCl7XG5cdFx0XHRpZiAodHlwZW9mIHJlc29sdmUgIT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiByZWplY3QgIT0gXCJmdW5jdGlvblwiKSB7XG5cdFx0XHRcdHRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRcdFx0fVxuXG5cdFx0XHRyZWplY3QobXNnKTtcblx0XHR9KTtcblx0fSk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcImFsbFwiLGZ1bmN0aW9uIFByb21pc2UkYWxsKGFycikge1xuXHRcdHZhciBDb25zdHJ1Y3RvciA9IHRoaXM7XG5cblx0XHQvLyBzcGVjIG1hbmRhdGVkIGNoZWNrc1xuXHRcdGlmIChUb1N0cmluZy5jYWxsKGFycikgIT0gXCJbb2JqZWN0IEFycmF5XVwiKSB7XG5cdFx0XHRyZXR1cm4gQ29uc3RydWN0b3IucmVqZWN0KFR5cGVFcnJvcihcIk5vdCBhbiBhcnJheVwiKSk7XG5cdFx0fVxuXHRcdGlmIChhcnIubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRyZXR1cm4gQ29uc3RydWN0b3IucmVzb2x2ZShbXSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIG5ldyBDb25zdHJ1Y3RvcihmdW5jdGlvbiBleGVjdXRvcihyZXNvbHZlLHJlamVjdCl7XG5cdFx0XHRpZiAodHlwZW9mIHJlc29sdmUgIT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiByZWplY3QgIT0gXCJmdW5jdGlvblwiKSB7XG5cdFx0XHRcdHRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgbGVuID0gYXJyLmxlbmd0aCwgbXNncyA9IEFycmF5KGxlbiksIGNvdW50ID0gMDtcblxuXHRcdFx0aXRlcmF0ZVByb21pc2VzKENvbnN0cnVjdG9yLGFycixmdW5jdGlvbiByZXNvbHZlcihpZHgsbXNnKSB7XG5cdFx0XHRcdG1zZ3NbaWR4XSA9IG1zZztcblx0XHRcdFx0aWYgKCsrY291bnQgPT09IGxlbikge1xuXHRcdFx0XHRcdHJlc29sdmUobXNncyk7XG5cdFx0XHRcdH1cblx0XHRcdH0scmVqZWN0KTtcblx0XHR9KTtcblx0fSk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcInJhY2VcIixmdW5jdGlvbiBQcm9taXNlJHJhY2UoYXJyKSB7XG5cdFx0dmFyIENvbnN0cnVjdG9yID0gdGhpcztcblxuXHRcdC8vIHNwZWMgbWFuZGF0ZWQgY2hlY2tzXG5cdFx0aWYgKFRvU3RyaW5nLmNhbGwoYXJyKSAhPSBcIltvYmplY3QgQXJyYXldXCIpIHtcblx0XHRcdHJldHVybiBDb25zdHJ1Y3Rvci5yZWplY3QoVHlwZUVycm9yKFwiTm90IGFuIGFycmF5XCIpKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gbmV3IENvbnN0cnVjdG9yKGZ1bmN0aW9uIGV4ZWN1dG9yKHJlc29sdmUscmVqZWN0KXtcblx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0XHR9XG5cblx0XHRcdGl0ZXJhdGVQcm9taXNlcyhDb25zdHJ1Y3RvcixhcnIsZnVuY3Rpb24gcmVzb2x2ZXIoaWR4LG1zZyl7XG5cdFx0XHRcdHJlc29sdmUobXNnKTtcblx0XHRcdH0scmVqZWN0KTtcblx0XHR9KTtcblx0fSk7XG5cblx0cmV0dXJuIFByb21pc2U7XG59KTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4vLyByZXNvbHZlcyAuIGFuZCAuLiBlbGVtZW50cyBpbiBhIHBhdGggYXJyYXkgd2l0aCBkaXJlY3RvcnkgbmFtZXMgdGhlcmVcbi8vIG11c3QgYmUgbm8gc2xhc2hlcywgZW1wdHkgZWxlbWVudHMsIG9yIGRldmljZSBuYW1lcyAoYzpcXCkgaW4gdGhlIGFycmF5XG4vLyAoc28gYWxzbyBubyBsZWFkaW5nIGFuZCB0cmFpbGluZyBzbGFzaGVzIC0gaXQgZG9lcyBub3QgZGlzdGluZ3Vpc2hcbi8vIHJlbGF0aXZlIGFuZCBhYnNvbHV0ZSBwYXRocylcbmZ1bmN0aW9uIG5vcm1hbGl6ZUFycmF5KHBhcnRzLCBhbGxvd0Fib3ZlUm9vdCkge1xuICAvLyBpZiB0aGUgcGF0aCB0cmllcyB0byBnbyBhYm92ZSB0aGUgcm9vdCwgYHVwYCBlbmRzIHVwID4gMFxuICB2YXIgdXAgPSAwO1xuICBmb3IgKHZhciBpID0gcGFydHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICB2YXIgbGFzdCA9IHBhcnRzW2ldO1xuICAgIGlmIChsYXN0ID09PSAnLicpIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICB9IGVsc2UgaWYgKGxhc3QgPT09ICcuLicpIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICAgIHVwKys7XG4gICAgfSBlbHNlIGlmICh1cCkge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXAtLTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiB0aGUgcGF0aCBpcyBhbGxvd2VkIHRvIGdvIGFib3ZlIHRoZSByb290LCByZXN0b3JlIGxlYWRpbmcgLi5zXG4gIGlmIChhbGxvd0Fib3ZlUm9vdCkge1xuICAgIGZvciAoOyB1cC0tOyB1cCkge1xuICAgICAgcGFydHMudW5zaGlmdCgnLi4nKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG5cbi8vIFNwbGl0IGEgZmlsZW5hbWUgaW50byBbcm9vdCwgZGlyLCBiYXNlbmFtZSwgZXh0XSwgdW5peCB2ZXJzaW9uXG4vLyAncm9vdCcgaXMganVzdCBhIHNsYXNoLCBvciBub3RoaW5nLlxudmFyIHNwbGl0UGF0aFJlID1cbiAgICAvXihcXC8/fCkoW1xcc1xcU10qPykoKD86XFwuezEsMn18W15cXC9dKz98KShcXC5bXi5cXC9dKnwpKSg/OltcXC9dKikkLztcbnZhciBzcGxpdFBhdGggPSBmdW5jdGlvbihmaWxlbmFtZSkge1xuICByZXR1cm4gc3BsaXRQYXRoUmUuZXhlYyhmaWxlbmFtZSkuc2xpY2UoMSk7XG59O1xuXG4vLyBwYXRoLnJlc29sdmUoW2Zyb20gLi4uXSwgdG8pXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLnJlc29sdmUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJlc29sdmVkUGF0aCA9ICcnLFxuICAgICAgcmVzb2x2ZWRBYnNvbHV0ZSA9IGZhbHNlO1xuXG4gIGZvciAodmFyIGkgPSBhcmd1bWVudHMubGVuZ3RoIC0gMTsgaSA+PSAtMSAmJiAhcmVzb2x2ZWRBYnNvbHV0ZTsgaS0tKSB7XG4gICAgdmFyIHBhdGggPSAoaSA+PSAwKSA/IGFyZ3VtZW50c1tpXSA6IHByb2Nlc3MuY3dkKCk7XG5cbiAgICAvLyBTa2lwIGVtcHR5IGFuZCBpbnZhbGlkIGVudHJpZXNcbiAgICBpZiAodHlwZW9mIHBhdGggIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgdG8gcGF0aC5yZXNvbHZlIG11c3QgYmUgc3RyaW5ncycpO1xuICAgIH0gZWxzZSBpZiAoIXBhdGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHJlc29sdmVkUGF0aCA9IHBhdGggKyAnLycgKyByZXNvbHZlZFBhdGg7XG4gICAgcmVzb2x2ZWRBYnNvbHV0ZSA9IHBhdGguY2hhckF0KDApID09PSAnLyc7XG4gIH1cblxuICAvLyBBdCB0aGlzIHBvaW50IHRoZSBwYXRoIHNob3VsZCBiZSByZXNvbHZlZCB0byBhIGZ1bGwgYWJzb2x1dGUgcGF0aCwgYnV0XG4gIC8vIGhhbmRsZSByZWxhdGl2ZSBwYXRocyB0byBiZSBzYWZlIChtaWdodCBoYXBwZW4gd2hlbiBwcm9jZXNzLmN3ZCgpIGZhaWxzKVxuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICByZXNvbHZlZFBhdGggPSBub3JtYWxpemVBcnJheShmaWx0ZXIocmVzb2x2ZWRQYXRoLnNwbGl0KCcvJyksIGZ1bmN0aW9uKHApIHtcbiAgICByZXR1cm4gISFwO1xuICB9KSwgIXJlc29sdmVkQWJzb2x1dGUpLmpvaW4oJy8nKTtcblxuICByZXR1cm4gKChyZXNvbHZlZEFic29sdXRlID8gJy8nIDogJycpICsgcmVzb2x2ZWRQYXRoKSB8fCAnLic7XG59O1xuXG4vLyBwYXRoLm5vcm1hbGl6ZShwYXRoKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5ub3JtYWxpemUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHZhciBpc0Fic29sdXRlID0gZXhwb3J0cy5pc0Fic29sdXRlKHBhdGgpLFxuICAgICAgdHJhaWxpbmdTbGFzaCA9IHN1YnN0cihwYXRoLCAtMSkgPT09ICcvJztcblxuICAvLyBOb3JtYWxpemUgdGhlIHBhdGhcbiAgcGF0aCA9IG5vcm1hbGl6ZUFycmF5KGZpbHRlcihwYXRoLnNwbGl0KCcvJyksIGZ1bmN0aW9uKHApIHtcbiAgICByZXR1cm4gISFwO1xuICB9KSwgIWlzQWJzb2x1dGUpLmpvaW4oJy8nKTtcblxuICBpZiAoIXBhdGggJiYgIWlzQWJzb2x1dGUpIHtcbiAgICBwYXRoID0gJy4nO1xuICB9XG4gIGlmIChwYXRoICYmIHRyYWlsaW5nU2xhc2gpIHtcbiAgICBwYXRoICs9ICcvJztcbiAgfVxuXG4gIHJldHVybiAoaXNBYnNvbHV0ZSA/ICcvJyA6ICcnKSArIHBhdGg7XG59O1xuXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLmlzQWJzb2x1dGUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHJldHVybiBwYXRoLmNoYXJBdCgwKSA9PT0gJy8nO1xufTtcblxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5qb2luID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwYXRocyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMCk7XG4gIHJldHVybiBleHBvcnRzLm5vcm1hbGl6ZShmaWx0ZXIocGF0aHMsIGZ1bmN0aW9uKHAsIGluZGV4KSB7XG4gICAgaWYgKHR5cGVvZiBwICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIHRvIHBhdGguam9pbiBtdXN0IGJlIHN0cmluZ3MnKTtcbiAgICB9XG4gICAgcmV0dXJuIHA7XG4gIH0pLmpvaW4oJy8nKSk7XG59O1xuXG5cbi8vIHBhdGgucmVsYXRpdmUoZnJvbSwgdG8pXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLnJlbGF0aXZlID0gZnVuY3Rpb24oZnJvbSwgdG8pIHtcbiAgZnJvbSA9IGV4cG9ydHMucmVzb2x2ZShmcm9tKS5zdWJzdHIoMSk7XG4gIHRvID0gZXhwb3J0cy5yZXNvbHZlKHRvKS5zdWJzdHIoMSk7XG5cbiAgZnVuY3Rpb24gdHJpbShhcnIpIHtcbiAgICB2YXIgc3RhcnQgPSAwO1xuICAgIGZvciAoOyBzdGFydCA8IGFyci5sZW5ndGg7IHN0YXJ0KyspIHtcbiAgICAgIGlmIChhcnJbc3RhcnRdICE9PSAnJykgYnJlYWs7XG4gICAgfVxuXG4gICAgdmFyIGVuZCA9IGFyci5sZW5ndGggLSAxO1xuICAgIGZvciAoOyBlbmQgPj0gMDsgZW5kLS0pIHtcbiAgICAgIGlmIChhcnJbZW5kXSAhPT0gJycpIGJyZWFrO1xuICAgIH1cblxuICAgIGlmIChzdGFydCA+IGVuZCkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBhcnIuc2xpY2Uoc3RhcnQsIGVuZCAtIHN0YXJ0ICsgMSk7XG4gIH1cblxuICB2YXIgZnJvbVBhcnRzID0gdHJpbShmcm9tLnNwbGl0KCcvJykpO1xuICB2YXIgdG9QYXJ0cyA9IHRyaW0odG8uc3BsaXQoJy8nKSk7XG5cbiAgdmFyIGxlbmd0aCA9IE1hdGgubWluKGZyb21QYXJ0cy5sZW5ndGgsIHRvUGFydHMubGVuZ3RoKTtcbiAgdmFyIHNhbWVQYXJ0c0xlbmd0aCA9IGxlbmd0aDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmIChmcm9tUGFydHNbaV0gIT09IHRvUGFydHNbaV0pIHtcbiAgICAgIHNhbWVQYXJ0c0xlbmd0aCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB2YXIgb3V0cHV0UGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IHNhbWVQYXJ0c0xlbmd0aDsgaSA8IGZyb21QYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dHB1dFBhcnRzLnB1c2goJy4uJyk7XG4gIH1cblxuICBvdXRwdXRQYXJ0cyA9IG91dHB1dFBhcnRzLmNvbmNhdCh0b1BhcnRzLnNsaWNlKHNhbWVQYXJ0c0xlbmd0aCkpO1xuXG4gIHJldHVybiBvdXRwdXRQYXJ0cy5qb2luKCcvJyk7XG59O1xuXG5leHBvcnRzLnNlcCA9ICcvJztcbmV4cG9ydHMuZGVsaW1pdGVyID0gJzonO1xuXG5leHBvcnRzLmRpcm5hbWUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHZhciByZXN1bHQgPSBzcGxpdFBhdGgocGF0aCksXG4gICAgICByb290ID0gcmVzdWx0WzBdLFxuICAgICAgZGlyID0gcmVzdWx0WzFdO1xuXG4gIGlmICghcm9vdCAmJiAhZGlyKSB7XG4gICAgLy8gTm8gZGlybmFtZSB3aGF0c29ldmVyXG4gICAgcmV0dXJuICcuJztcbiAgfVxuXG4gIGlmIChkaXIpIHtcbiAgICAvLyBJdCBoYXMgYSBkaXJuYW1lLCBzdHJpcCB0cmFpbGluZyBzbGFzaFxuICAgIGRpciA9IGRpci5zdWJzdHIoMCwgZGlyLmxlbmd0aCAtIDEpO1xuICB9XG5cbiAgcmV0dXJuIHJvb3QgKyBkaXI7XG59O1xuXG5cbmV4cG9ydHMuYmFzZW5hbWUgPSBmdW5jdGlvbihwYXRoLCBleHQpIHtcbiAgdmFyIGYgPSBzcGxpdFBhdGgocGF0aClbMl07XG4gIC8vIFRPRE86IG1ha2UgdGhpcyBjb21wYXJpc29uIGNhc2UtaW5zZW5zaXRpdmUgb24gd2luZG93cz9cbiAgaWYgKGV4dCAmJiBmLnN1YnN0cigtMSAqIGV4dC5sZW5ndGgpID09PSBleHQpIHtcbiAgICBmID0gZi5zdWJzdHIoMCwgZi5sZW5ndGggLSBleHQubGVuZ3RoKTtcbiAgfVxuICByZXR1cm4gZjtcbn07XG5cblxuZXhwb3J0cy5leHRuYW1lID0gZnVuY3Rpb24ocGF0aCkge1xuICByZXR1cm4gc3BsaXRQYXRoKHBhdGgpWzNdO1xufTtcblxuZnVuY3Rpb24gZmlsdGVyICh4cywgZikge1xuICAgIGlmICh4cy5maWx0ZXIpIHJldHVybiB4cy5maWx0ZXIoZik7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgeHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGYoeHNbaV0sIGksIHhzKSkgcmVzLnB1c2goeHNbaV0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xufVxuXG4vLyBTdHJpbmcucHJvdG90eXBlLnN1YnN0ciAtIG5lZ2F0aXZlIGluZGV4IGRvbid0IHdvcmsgaW4gSUU4XG52YXIgc3Vic3RyID0gJ2FiJy5zdWJzdHIoLTEpID09PSAnYidcbiAgICA/IGZ1bmN0aW9uIChzdHIsIHN0YXJ0LCBsZW4pIHsgcmV0dXJuIHN0ci5zdWJzdHIoc3RhcnQsIGxlbikgfVxuICAgIDogZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikge1xuICAgICAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IHN0ci5sZW5ndGggKyBzdGFydDtcbiAgICAgICAgcmV0dXJuIHN0ci5zdWJzdHIoc3RhcnQsIGxlbik7XG4gICAgfVxuO1xuIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNSBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBVdGlsaXR5IHRoYXQgcHJvdmlkZXMgYSBzaW5nbGUgQVBJIGZvciBsb2FkaW5nIHRoZSBjb250ZW50IG9mIGEgcGF0aC9VUkwuXG4gKlxuICogQG1vZHVsZSBQYXRoTG9hZGVyXG4gKi9cblxudmFyIHN1cHBvcnRlZExvYWRlcnMgPSB7XG4gIGZpbGU6IHJlcXVpcmUoJy4vbGliL2xvYWRlcnMvZmlsZScpLFxuICBodHRwOiByZXF1aXJlKCcuL2xpYi9sb2FkZXJzL2h0dHAnKSxcbiAgaHR0cHM6IHJlcXVpcmUoJy4vbGliL2xvYWRlcnMvaHR0cCcpXG59O1xudmFyIGRlZmF1bHRMb2FkZXIgPSB0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgaW1wb3J0U2NyaXB0cyA9PT0gJ2Z1bmN0aW9uJyA/XG4gICAgICBzdXBwb3J0ZWRMb2FkZXJzLmh0dHAgOlxuICAgICAgc3VwcG9ydGVkTG9hZGVycy5maWxlO1xuXG4vLyBMb2FkIHByb21pc2VzIHBvbHlmaWxsIGlmIG5lY2Vzc2FyeVxuLyogaXN0YW5idWwgaWdub3JlIGlmICovXG5pZiAodHlwZW9mIFByb21pc2UgPT09ICd1bmRlZmluZWQnKSB7XG4gIHJlcXVpcmUoJ25hdGl2ZS1wcm9taXNlLW9ubHknKTtcbn1cblxuZnVuY3Rpb24gZ2V0U2NoZW1lIChsb2NhdGlvbikge1xuICBpZiAodHlwZW9mIGxvY2F0aW9uICE9PSAndW5kZWZpbmVkJykge1xuICAgIGxvY2F0aW9uID0gbG9jYXRpb24uaW5kZXhPZignOi8vJykgPT09IC0xID8gJycgOiBsb2NhdGlvbi5zcGxpdCgnOi8vJylbMF07XG4gIH1cblxuICByZXR1cm4gbG9jYXRpb247XG59XG5cbi8qKlxuICogQ2FsbGJhY2sgdXNlZCB0byBwcm92aWRlIGFjY2VzcyB0byBhbHRlcmluZyBhIHJlbW90ZSByZXF1ZXN0IHByaW9yIHRvIHRoZSByZXF1ZXN0IGJlaW5nIG1hZGUuXG4gKlxuICogQHR5cGVkZWYge2Z1bmN0aW9ufSBQcmVwYXJlUmVxdWVzdENhbGxiYWNrXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IHJlcSAtIFRoZSBTdXBlcmFnZW50IHJlcXVlc3Qgb2JqZWN0XG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gYmVpbmcgcmV0cmlldmVkXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIEZpcnN0IGNhbGxiYWNrXG4gKlxuICogQGFsaWFzIG1vZHVsZTpQYXRoTG9hZGVyflByZXBhcmVSZXF1ZXN0Q2FsbGJhY2tcbiAqL1xuXG4gLyoqXG4gICogQ2FsbGJhY2sgdXNlZCB0byBwcm92aWRlIGFjY2VzcyB0byBwcm9jZXNzaW5nIHRoZSByYXcgcmVzcG9uc2Ugb2YgdGhlIHJlcXVlc3QgYmVpbmcgbWFkZS4gKihIVFRQIGxvYWRlciBvbmx5KSpcbiAgKlxuICAqIEB0eXBlZGVmIHtmdW5jdGlvbn0gUHJvY2Vzc1Jlc3BvbnNlQ2FsbGJhY2tcbiAgKlxuICAqIEBwYXJhbSB7b2JqZWN0fSByZXMgLSBUaGUgU3VwZXJhZ2VudCByZXNwb25zZSBvYmplY3QgKihGb3Igbm9uLUhUVFAgbG9hZGVycywgdGhpcyBvYmplY3Qgd2lsbCBiZSBsaWtlIHRoZSBTdXBlcmFnZW50XG4gICogb2JqZWN0IGluIHRoYXQgaXQgd2lsbCBoYXZlIGEgYHRleHRgIHByb3BlcnR5IHdob3NlIHZhbHVlIGlzIHRoZSByYXcgc3RyaW5nIHZhbHVlIGJlaW5nIHByb2Nlc3NlZC4gIFRoaXMgd2FzIGRvbmVcbiAgKiBmb3IgY29uc2lzdGVuY3kuKSpcbiAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIEVycm9yLWZpcnN0IGNhbGxiYWNrXG4gICpcbiAgKiBAcmV0dXJucyB7Kn0gdGhlIHJlc3VsdCBvZiBwcm9jZXNzaW5nIHRoZSByZXNwb25zZXhzXG4gICpcbiAgKiBAYWxpYXMgbW9kdWxlOlBhdGhMb2FkZXJ+UHJvY2Vzc1Jlc3BvbnNlQ2FsbGJhY2tcbiAgKi9cblxuZnVuY3Rpb24gZ2V0TG9hZGVyIChsb2NhdGlvbikge1xuICB2YXIgc2NoZW1lID0gZ2V0U2NoZW1lKGxvY2F0aW9uKTtcbiAgdmFyIGxvYWRlciA9IHN1cHBvcnRlZExvYWRlcnNbc2NoZW1lXTtcblxuICBpZiAodHlwZW9mIGxvYWRlciA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoc2NoZW1lID09PSAnJykge1xuICAgICAgbG9hZGVyID0gZGVmYXVsdExvYWRlcjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbnN1cHBvcnRlZCBzY2hlbWU6ICcgKyBzY2hlbWUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBsb2FkZXI7XG59XG5cbi8qKlxuICogTG9hZHMgYSBkb2N1bWVudCBhdCB0aGUgcHJvdmlkZWQgbG9jYXRpb24gYW5kIHJldHVybnMgYSBKYXZhU2NyaXB0IG9iamVjdCByZXByZXNlbnRhdGlvbi5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gdG8gdGhlIGRvY3VtZW50XG4gKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gVGhlIG9wdGlvbnNcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5lbmNvZGluZz0ndXRmLTgnXSAtIFRoZSBlbmNvZGluZyB0byB1c2Ugd2hlbiBsb2FkaW5nIHRoZSBmaWxlICooRmlsZSBsb2FkZXIgb25seSkqXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMubWV0aG9kPWdldF0gLSBUaGUgSFRUUCBtZXRob2QgdG8gdXNlIGZvciB0aGUgcmVxdWVzdCAqKEhUVFAgbG9hZGVyIG9ubHkpKlxuICogQHBhcmFtIHttb2R1bGU6UGF0aExvYWRlcn5QcmVwYXJlUmVxdWVzdENhbGxiYWNrfSBbb3B0aW9ucy5wcmVwYXJlUmVxdWVzdF0gLSBUaGUgY2FsbGJhY2sgdXNlZCB0byBwcmVwYXJlIHRoZSByZXF1ZXN0XG4gKiAqKEhUVFAgbG9hZGVyIG9ubHkpKlxuICogQHBhcmFtIHttb2R1bGU6UGF0aExvYWRlcn5Qcm9jZXNzUmVzcG9uc2VDYWxsYmFja30gW29wdGlvbnMucHJvY2Vzc0NvbnRlbnRdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJvY2VzcyB0aGVcbiAqIHJlc3BvbnNlXG4gKlxuICogQHJldHVybnMge1Byb21pc2V9IEFsd2F5cyByZXR1cm5zIGEgcHJvbWlzZSBldmVuIGlmIHRoZXJlIGlzIGEgY2FsbGJhY2sgcHJvdmlkZWRcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBQcm9taXNlc1xuICpcbiAqIFBhdGhMb2FkZXJcbiAqICAgLmxvYWQoJy4vcGFja2FnZS5qc29uJylcbiAqICAgLnRoZW4oSlNPTi5wYXJzZSlcbiAqICAgLnRoZW4oZnVuY3Rpb24gKGRvY3VtZW50KSB7XG4gKiAgICAgY29uc29sZS5sb2coZG9jdW1lbnQubmFtZSArICcgKCcgKyBkb2N1bWVudC52ZXJzaW9uICsgJyk6ICcgKyBkb2N1bWVudC5kZXNjcmlwdGlvbik7XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIHVzaW5nIG9wdGlvbnMucHJlcGFyZVJlcXVlc3QgdG8gcHJvdmlkZSBhdXRoZW50aWNhdGlvbiBkZXRhaWxzIGZvciBhIHJlbW90ZWx5IHNlY3VyZSBVUkxcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvcGF0aC1sb2FkZXInLCB7XG4gKiAgICAgcHJlcGFyZVJlcXVlc3Q6IGZ1bmN0aW9uIChyZXEsIGNhbGxiYWNrKSB7XG4gKiAgICAgICByZXEuYXV0aCgnbXktdXNlcm5hbWUnLCAnbXktcGFzc3dvcmQnKTtcbiAqICAgICAgIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVxKTtcbiAqICAgICB9XG4gKiAgIH0pXG4gKiAgIC50aGVuKEpTT04ucGFyc2UpXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICogICAgIGNvbnNvbGUubG9nKGRvY3VtZW50LmZ1bGxfbmFtZSArICc6ICcgKyBkb2N1bWVudC5kZXNjcmlwdGlvbik7XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIGxvYWRpbmcgYSBZQU1MIGZpbGVcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCcvVXNlcnMvbm90LXlvdS9wcm9qZWN0cy9wYXRoLWxvYWRlci8udHJhdmlzLnltbCcpXG4gKiAgIC50aGVuKFlBTUwuc2FmZUxvYWQpXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICogICAgIGNvbnNvbGUubG9nKCdwYXRoLWxvYWRlciB1c2VzIHRoZScsIGRvY3VtZW50Lmxhbmd1YWdlLCAnbGFuZ3VhZ2UuJyk7XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIGxvYWRpbmcgYSBZQU1MIGZpbGUgd2l0aCBvcHRpb25zLnByb2Nlc3NDb250ZW50IChVc2VmdWwgaWYgeW91IG5lZWQgaW5mb3JtYXRpb24gaW4gdGhlIHJhdyByZXNwb25zZSlcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCcvVXNlcnMvbm90LXlvdS9wcm9qZWN0cy9wYXRoLWxvYWRlci8udHJhdmlzLnltbCcsIHtcbiAqICAgICBwcm9jZXNzQ29udGVudDogZnVuY3Rpb24gKHJlcywgY2FsbGJhY2spIHtcbiAqICAgICAgIGNhbGxiYWNrKFlBTUwuc2FmZUxvYWQocmVzLnRleHQpKTtcbiAqICAgICB9XG4gKiAgIH0pXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICogICAgIGNvbnNvbGUubG9nKCdwYXRoLWxvYWRlciB1c2VzIHRoZScsIGRvY3VtZW50Lmxhbmd1YWdlLCAnbGFuZ3VhZ2UuJyk7XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICovXG5tb2R1bGUuZXhwb3J0cy5sb2FkID0gZnVuY3Rpb24gKGxvY2F0aW9uLCBvcHRpb25zKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIC8vIERlZmF1bHQgb3B0aW9ucyB0byBlbXB0eSBvYmplY3RcbiAgaWYgKHR5cGVvZiBvcHRpb25zID09PSAndW5kZWZpbmVkJykge1xuICAgIG9wdGlvbnMgPSB7fTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGFyZ3VtZW50c1xuICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgIGlmICh0eXBlb2YgbG9jYXRpb24gPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsb2NhdGlvbiBpcyByZXF1aXJlZCcpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGxvY2F0aW9uICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbG9jYXRpb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3B0aW9ucyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucyAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygb3B0aW9ucy5wcm9jZXNzQ29udGVudCAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5wcm9jZXNzQ29udGVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIC8vIExvYWQgdGhlIGRvY3VtZW50IGZyb20gdGhlIHByb3ZpZGVkIGxvY2F0aW9uIGFuZCBwcm9jZXNzIGl0XG4gIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICB2YXIgbG9hZGVyID0gZ2V0TG9hZGVyKGxvY2F0aW9uKTtcblxuICAgICAgICBsb2FkZXIubG9hZChsb2NhdGlvbiwgb3B0aW9ucyB8fCB7fSwgZnVuY3Rpb24gKGVyciwgZG9jdW1lbnQpIHtcbiAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzb2x2ZShkb2N1bWVudCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pXG4gICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgaWYgKG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgICAvLyBGb3IgY29uc2lzdGVuY3kgYmV0d2VlbiBmaWxlIGFuZCBodHRwLCBhbHdheXMgc2VuZCBhbiBvYmplY3Qgd2l0aCBhICd0ZXh0JyBwcm9wZXJ0eSBjb250YWluaW5nIHRoZSByYXdcbiAgICAgICAgICAvLyBzdHJpbmcgdmFsdWUgYmVpbmcgcHJvY2Vzc2VkLlxuICAgICAgICAgIG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQodHlwZW9mIHJlcyA9PT0gJ29iamVjdCcgPyByZXMgOiB7dGV4dDogcmVzfSwgZnVuY3Rpb24gKGVyciwgcHJvY2Vzc2VkKSB7XG4gICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmVzb2x2ZShwcm9jZXNzZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElmIHRoZXJlIHdhcyBubyBjb250ZW50IHByb2Nlc3Nvciwgd2Ugd2lsbCBhc3N1bWUgdGhhdCBmb3IgYWxsIG9iamVjdHMgdGhhdCBpdCBpcyBhIFN1cGVyYWdlbnQgcmVzcG9uc2VcbiAgICAgICAgLy8gYW5kIHdpbGwgcmV0dXJuIGl0cyBgdGV4dGAgcHJvcGVydHkgdmFsdWUuICBPdGhlcndpc2UsIHdlIHdpbGwgcmV0dXJuIHRoZSByYXcgcmVzcG9uc2UuXG4gICAgICAgIHJldHVybiB0eXBlb2YgcmVzID09PSAnb2JqZWN0JyA/IHJlcy50ZXh0IDogcmVzO1xuICAgICAgfVxuICAgIH0pO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn07XG4iLCIvKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE1IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdW5zdXBwb3J0ZWRFcnJvciA9IG5ldyBUeXBlRXJyb3IoJ1RoZSBcXCdmaWxlXFwnIHNjaGVtZSBpcyBub3Qgc3VwcG9ydGVkIGluIHRoZSBicm93c2VyJyk7XG5cbi8qKlxuICogVGhlIGZpbGUgbG9hZGVyIGlzIG5vdCBzdXBwb3J0ZWQgaW4gdGhlIGJyb3dzZXIuXG4gKlxuICogQHRocm93cyB7ZXJyb3J9IHRoZSBmaWxlIGxvYWRlciBpcyBub3Qgc3VwcG9ydGVkIGluIHRoZSBicm93c2VyXG4gKi9cbm1vZHVsZS5leHBvcnRzLmdldEJhc2UgPSBmdW5jdGlvbiAoKSB7XG4gIHRocm93IHVuc3VwcG9ydGVkRXJyb3I7XG59O1xuXG4vKipcbiAqIFRoZSBmaWxlIGxvYWRlciBpcyBub3Qgc3VwcG9ydGVkIGluIHRoZSBicm93c2VyLlxuICovXG5tb2R1bGUuZXhwb3J0cy5sb2FkID0gZnVuY3Rpb24gKCkge1xuICB2YXIgZm4gPSBhcmd1bWVudHNbYXJndW1lbnRzLmxlbmd0aCAtIDFdO1xuXG4gIGlmICh0eXBlb2YgZm4gPT09ICdmdW5jdGlvbicpIHtcbiAgICBmbih1bnN1cHBvcnRlZEVycm9yKTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyB1bnN1cHBvcnRlZEVycm9yO1xuICB9XG59O1xuIiwiLyogZXNsaW50LWVudiBub2RlLCBicm93c2VyICovXG5cbi8qXG4gKiBUaGUgTUlUIExpY2Vuc2UgKE1JVClcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTUgSmVyZW15IFdoaXRsb2NrXG4gKlxuICogUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuICogb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuICogaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuICogdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuICogY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4gKiBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4gKiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4gKiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuICogQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuICogTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbiAqIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbiAqIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciByZXF1ZXN0ID0gcmVxdWlyZSgnc3VwZXJhZ2VudCcpO1xuXG52YXIgc3VwcG9ydGVkSHR0cE1ldGhvZHMgPSBbJ2RlbGV0ZScsICdnZXQnLCAnaGVhZCcsICdwYXRjaCcsICdwb3N0JywgJ3B1dCddO1xuXG4vKipcbiAqIExvYWRzIGEgZmlsZSBmcm9tIGFuIGh0dHAgb3IgaHR0cHMgVVJMLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhdGlvbiAtIFRoZSBkb2N1bWVudCBVUkwgKElmIHJlbGF0aXZlLCBsb2NhdGlvbiBpcyByZWxhdGl2ZSB0byB3aW5kb3cubG9jYXRpb24ub3JpZ2luKS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gVGhlIGxvYWRlciBvcHRpb25zXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMubWV0aG9kPWdldF0gLSBUaGUgSFRUUCBtZXRob2QgdG8gdXNlIGZvciB0aGUgcmVxdWVzdFxuICogQHBhcmFtIHttb2R1bGU6UGF0aExvYWRlcn5QcmVwYXJlUmVxdWVzdENhbGxiYWNrfSBbb3B0aW9ucy5wcmVwYXJlUmVxdWVzdF0gLSBUaGUgY2FsbGJhY2sgdXNlZCB0byBwcmVwYXJlIGEgcmVxdWVzdFxuICogQHBhcmFtIHttb2R1bGU6UGF0aExvYWRlcn5Qcm9jZXNzUmVzcG9uc2VDYWxsYmFja30gW29wdGlvbnMucHJvY2Vzc0NvbnRlbnRdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJvY2VzcyB0aGVcbiAqIHJlc3BvbnNlXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIFRoZSBlcnJvci1maXJzdCBjYWxsYmFja1xuICovXG5tb2R1bGUuZXhwb3J0cy5sb2FkID0gZnVuY3Rpb24gKGxvY2F0aW9uLCBvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgcmVhbE1ldGhvZCA9IG9wdGlvbnMubWV0aG9kID8gb3B0aW9ucy5tZXRob2QudG9Mb3dlckNhc2UoKSA6ICdnZXQnO1xuICB2YXIgZXJyO1xuICB2YXIgcmVhbFJlcXVlc3Q7XG5cbiAgZnVuY3Rpb24gbWFrZVJlcXVlc3QgKGVyciwgcmVxKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gYnVmZmVyKCkgaXMgb25seSBhdmFpbGFibGUgaW4gTm9kZS5qc1xuICAgICAgaWYgKHR5cGVvZiByZXEuYnVmZmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJlcS5idWZmZXIodHJ1ZSk7XG4gICAgICB9XG5cbiAgICAgIHJlcVxuICAgICAgICAuZW5kKGZ1bmN0aW9uIChlcnIyLCByZXMpIHtcbiAgICAgICAgICBpZiAoZXJyMikge1xuICAgICAgICAgICAgY2FsbGJhY2soZXJyMik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGlmICh0eXBlb2Ygb3B0aW9ucy5tZXRob2QgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLm1ldGhvZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGVyciA9IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMubWV0aG9kIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9IGVsc2UgaWYgKHN1cHBvcnRlZEh0dHBNZXRob2RzLmluZGV4T2Yob3B0aW9ucy5tZXRob2QpID09PSAtMSkge1xuICAgICAgZXJyID0gbmV3IFR5cGVFcnJvcignb3B0aW9ucy5tZXRob2QgbXVzdCBiZSBvbmUgb2YgdGhlIGZvbGxvd2luZzogJyArXG4gICAgICAgIHN1cHBvcnRlZEh0dHBNZXRob2RzLnNsaWNlKDAsIHN1cHBvcnRlZEh0dHBNZXRob2RzLmxlbmd0aCAtIDEpLmpvaW4oJywgJykgKyAnIG9yICcgK1xuICAgICAgICBzdXBwb3J0ZWRIdHRwTWV0aG9kc1tzdXBwb3J0ZWRIdHRwTWV0aG9kcy5sZW5ndGggLSAxXSk7XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBvcHRpb25zLnByZXBhcmVSZXF1ZXN0ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygb3B0aW9ucy5wcmVwYXJlUmVxdWVzdCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIGVyciA9IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMucHJlcGFyZVJlcXVlc3QgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cblxuICBpZiAoIWVycikge1xuICAgIHJlYWxSZXF1ZXN0ID0gcmVxdWVzdFtyZWFsTWV0aG9kID09PSAnZGVsZXRlJyA/ICdkZWwnIDogcmVhbE1ldGhvZF0obG9jYXRpb24pO1xuXG4gICAgaWYgKG9wdGlvbnMucHJlcGFyZVJlcXVlc3QpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG9wdGlvbnMucHJlcGFyZVJlcXVlc3QocmVhbFJlcXVlc3QsIG1ha2VSZXF1ZXN0KTtcbiAgICAgIH0gY2F0Y2ggKGVycjIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyMik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG1ha2VSZXF1ZXN0KHVuZGVmaW5lZCwgcmVhbFJlcXVlc3QpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjYWxsYmFjayhlcnIpO1xuICB9XG59O1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuJ3VzZSBzdHJpY3QnO1xuXG4vLyBJZiBvYmouaGFzT3duUHJvcGVydHkgaGFzIGJlZW4gb3ZlcnJpZGRlbiwgdGhlbiBjYWxsaW5nXG4vLyBvYmouaGFzT3duUHJvcGVydHkocHJvcCkgd2lsbCBicmVhay5cbi8vIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL2pveWVudC9ub2RlL2lzc3Vlcy8xNzA3XG5mdW5jdGlvbiBoYXNPd25Qcm9wZXJ0eShvYmosIHByb3ApIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHFzLCBzZXAsIGVxLCBvcHRpb25zKSB7XG4gIHNlcCA9IHNlcCB8fCAnJic7XG4gIGVxID0gZXEgfHwgJz0nO1xuICB2YXIgb2JqID0ge307XG5cbiAgaWYgKHR5cGVvZiBxcyAhPT0gJ3N0cmluZycgfHwgcXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG9iajtcbiAgfVxuXG4gIHZhciByZWdleHAgPSAvXFwrL2c7XG4gIHFzID0gcXMuc3BsaXQoc2VwKTtcblxuICB2YXIgbWF4S2V5cyA9IDEwMDA7XG4gIGlmIChvcHRpb25zICYmIHR5cGVvZiBvcHRpb25zLm1heEtleXMgPT09ICdudW1iZXInKSB7XG4gICAgbWF4S2V5cyA9IG9wdGlvbnMubWF4S2V5cztcbiAgfVxuXG4gIHZhciBsZW4gPSBxcy5sZW5ndGg7XG4gIC8vIG1heEtleXMgPD0gMCBtZWFucyB0aGF0IHdlIHNob3VsZCBub3QgbGltaXQga2V5cyBjb3VudFxuICBpZiAobWF4S2V5cyA+IDAgJiYgbGVuID4gbWF4S2V5cykge1xuICAgIGxlbiA9IG1heEtleXM7XG4gIH1cblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgKytpKSB7XG4gICAgdmFyIHggPSBxc1tpXS5yZXBsYWNlKHJlZ2V4cCwgJyUyMCcpLFxuICAgICAgICBpZHggPSB4LmluZGV4T2YoZXEpLFxuICAgICAgICBrc3RyLCB2c3RyLCBrLCB2O1xuXG4gICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICBrc3RyID0geC5zdWJzdHIoMCwgaWR4KTtcbiAgICAgIHZzdHIgPSB4LnN1YnN0cihpZHggKyAxKTtcbiAgICB9IGVsc2Uge1xuICAgICAga3N0ciA9IHg7XG4gICAgICB2c3RyID0gJyc7XG4gICAgfVxuXG4gICAgayA9IGRlY29kZVVSSUNvbXBvbmVudChrc3RyKTtcbiAgICB2ID0gZGVjb2RlVVJJQ29tcG9uZW50KHZzdHIpO1xuXG4gICAgaWYgKCFoYXNPd25Qcm9wZXJ0eShvYmosIGspKSB7XG4gICAgICBvYmpba10gPSB2O1xuICAgIH0gZWxzZSBpZiAoaXNBcnJheShvYmpba10pKSB7XG4gICAgICBvYmpba10ucHVzaCh2KTtcbiAgICB9IGVsc2Uge1xuICAgICAgb2JqW2tdID0gW29ialtrXSwgdl07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG9iajtcbn07XG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbiAoeHMpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh4cykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHN0cmluZ2lmeVByaW1pdGl2ZSA9IGZ1bmN0aW9uKHYpIHtcbiAgc3dpdGNoICh0eXBlb2Ygdikge1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gdjtcblxuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuXG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiBpc0Zpbml0ZSh2KSA/IHYgOiAnJztcblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gJyc7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ob2JqLCBzZXAsIGVxLCBuYW1lKSB7XG4gIHNlcCA9IHNlcCB8fCAnJic7XG4gIGVxID0gZXEgfHwgJz0nO1xuICBpZiAob2JqID09PSBudWxsKSB7XG4gICAgb2JqID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmogPT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG1hcChvYmplY3RLZXlzKG9iaiksIGZ1bmN0aW9uKGspIHtcbiAgICAgIHZhciBrcyA9IGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUoaykpICsgZXE7XG4gICAgICBpZiAoaXNBcnJheShvYmpba10pKSB7XG4gICAgICAgIHJldHVybiBtYXAob2JqW2tdLCBmdW5jdGlvbih2KSB7XG4gICAgICAgICAgcmV0dXJuIGtzICsgZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZSh2KSk7XG4gICAgICAgIH0pLmpvaW4oc2VwKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBrcyArIGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUob2JqW2tdKSk7XG4gICAgICB9XG4gICAgfSkuam9pbihzZXApO1xuXG4gIH1cblxuICBpZiAoIW5hbWUpIHJldHVybiAnJztcbiAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUobmFtZSkpICsgZXEgK1xuICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShvYmopKTtcbn07XG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbiAoeHMpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh4cykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuXG5mdW5jdGlvbiBtYXAgKHhzLCBmKSB7XG4gIGlmICh4cy5tYXApIHJldHVybiB4cy5tYXAoZik7XG4gIHZhciByZXMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgIHJlcy5wdXNoKGYoeHNbaV0sIGkpKTtcbiAgfVxuICByZXR1cm4gcmVzO1xufVxuXG52YXIgb2JqZWN0S2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIChvYmopIHtcbiAgdmFyIHJlcyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSkpIHJlcy5wdXNoKGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlcztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbmV4cG9ydHMuZGVjb2RlID0gZXhwb3J0cy5wYXJzZSA9IHJlcXVpcmUoJy4vZGVjb2RlJyk7XG5leHBvcnRzLmVuY29kZSA9IGV4cG9ydHMuc3RyaW5naWZ5ID0gcmVxdWlyZSgnLi9lbmNvZGUnKTtcbiIsIlxuLyoqXG4gKiBSZWR1Y2UgYGFycmAgd2l0aCBgZm5gLlxuICpcbiAqIEBwYXJhbSB7QXJyYXl9IGFyclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEBwYXJhbSB7TWl4ZWR9IGluaXRpYWxcbiAqXG4gKiBUT0RPOiBjb21iYXRpYmxlIGVycm9yIGhhbmRsaW5nP1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oYXJyLCBmbiwgaW5pdGlhbCl7ICBcbiAgdmFyIGlkeCA9IDA7XG4gIHZhciBsZW4gPSBhcnIubGVuZ3RoO1xuICB2YXIgY3VyciA9IGFyZ3VtZW50cy5sZW5ndGggPT0gM1xuICAgID8gaW5pdGlhbFxuICAgIDogYXJyW2lkeCsrXTtcblxuICB3aGlsZSAoaWR4IDwgbGVuKSB7XG4gICAgY3VyciA9IGZuLmNhbGwobnVsbCwgY3VyciwgYXJyW2lkeF0sICsraWR4LCBhcnIpO1xuICB9XG4gIFxuICByZXR1cm4gY3Vycjtcbn07IiwiJ3VzZSBzdHJpY3QnO1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc3RyKSB7XG5cdHZhciBpc0V4dGVuZGVkTGVuZ3RoUGF0aCA9IC9eXFxcXFxcXFxcXD9cXFxcLy50ZXN0KHN0cik7XG5cdHZhciBoYXNOb25Bc2NpaSA9IC9bXlxceDAwLVxceDgwXSsvLnRlc3Qoc3RyKTtcblxuXHRpZiAoaXNFeHRlbmRlZExlbmd0aFBhdGggfHwgaGFzTm9uQXNjaWkpIHtcblx0XHRyZXR1cm4gc3RyO1xuXHR9XG5cblx0cmV0dXJuIHN0ci5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59O1xuIiwiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciBFbWl0dGVyID0gcmVxdWlyZSgnZW1pdHRlcicpO1xudmFyIHJlZHVjZSA9IHJlcXVpcmUoJ3JlZHVjZScpO1xuXG4vKipcbiAqIFJvb3QgcmVmZXJlbmNlIGZvciBpZnJhbWVzLlxuICovXG5cbnZhciByb290O1xuaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnKSB7IC8vIEJyb3dzZXIgd2luZG93XG4gIHJvb3QgPSB3aW5kb3c7XG59IGVsc2UgaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgeyAvLyBXZWIgV29ya2VyXG4gIHJvb3QgPSBzZWxmO1xufSBlbHNlIHsgLy8gT3RoZXIgZW52aXJvbm1lbnRzXG4gIHJvb3QgPSB0aGlzO1xufVxuXG4vKipcbiAqIE5vb3AuXG4gKi9cblxuZnVuY3Rpb24gbm9vcCgpe307XG5cbi8qKlxuICogQ2hlY2sgaWYgYG9iamAgaXMgYSBob3N0IG9iamVjdCxcbiAqIHdlIGRvbid0IHdhbnQgdG8gc2VyaWFsaXplIHRoZXNlIDopXG4gKlxuICogVE9ETzogZnV0dXJlIHByb29mLCBtb3ZlIHRvIGNvbXBvZW50IGxhbmRcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaXNIb3N0KG9iaikge1xuICB2YXIgc3RyID0ge30udG9TdHJpbmcuY2FsbChvYmopO1xuXG4gIHN3aXRjaCAoc3RyKSB7XG4gICAgY2FzZSAnW29iamVjdCBGaWxlXSc6XG4gICAgY2FzZSAnW29iamVjdCBCbG9iXSc6XG4gICAgY2FzZSAnW29iamVjdCBGb3JtRGF0YV0nOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIERldGVybWluZSBYSFIuXG4gKi9cblxucmVxdWVzdC5nZXRYSFIgPSBmdW5jdGlvbiAoKSB7XG4gIGlmIChyb290LlhNTEh0dHBSZXF1ZXN0XG4gICAgICAmJiAoIXJvb3QubG9jYXRpb24gfHwgJ2ZpbGU6JyAhPSByb290LmxvY2F0aW9uLnByb3RvY29sXG4gICAgICAgICAgfHwgIXJvb3QuQWN0aXZlWE9iamVjdCkpIHtcbiAgICByZXR1cm4gbmV3IFhNTEh0dHBSZXF1ZXN0O1xuICB9IGVsc2Uge1xuICAgIHRyeSB7IHJldHVybiBuZXcgQWN0aXZlWE9iamVjdCgnTWljcm9zb2Z0LlhNTEhUVFAnKTsgfSBjYXRjaChlKSB7fVxuICAgIHRyeSB7IHJldHVybiBuZXcgQWN0aXZlWE9iamVjdCgnTXN4bWwyLlhNTEhUVFAuNi4wJyk7IH0gY2F0Y2goZSkge31cbiAgICB0cnkgeyByZXR1cm4gbmV3IEFjdGl2ZVhPYmplY3QoJ01zeG1sMi5YTUxIVFRQLjMuMCcpOyB9IGNhdGNoKGUpIHt9XG4gICAgdHJ5IHsgcmV0dXJuIG5ldyBBY3RpdmVYT2JqZWN0KCdNc3htbDIuWE1MSFRUUCcpOyB9IGNhdGNoKGUpIHt9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuLyoqXG4gKiBSZW1vdmVzIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHdoaXRlc3BhY2UsIGFkZGVkIHRvIHN1cHBvcnQgSUUuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbnZhciB0cmltID0gJycudHJpbVxuICA/IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMudHJpbSgpOyB9XG4gIDogZnVuY3Rpb24ocykgeyByZXR1cm4gcy5yZXBsYWNlKC8oXlxccyp8XFxzKiQpL2csICcnKTsgfTtcblxuLyoqXG4gKiBDaGVjayBpZiBgb2JqYCBpcyBhbiBvYmplY3QuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGlzT2JqZWN0KG9iaikge1xuICByZXR1cm4gb2JqID09PSBPYmplY3Qob2JqKTtcbn1cblxuLyoqXG4gKiBTZXJpYWxpemUgdGhlIGdpdmVuIGBvYmpgLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZShvYmopIHtcbiAgaWYgKCFpc09iamVjdChvYmopKSByZXR1cm4gb2JqO1xuICB2YXIgcGFpcnMgPSBbXTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIGlmIChudWxsICE9IG9ialtrZXldKSB7XG4gICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywga2V5LCBvYmpba2V5XSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgcmV0dXJuIHBhaXJzLmpvaW4oJyYnKTtcbn1cblxuLyoqXG4gKiBIZWxwcyAnc2VyaWFsaXplJyB3aXRoIHNlcmlhbGl6aW5nIGFycmF5cy5cbiAqIE11dGF0ZXMgdGhlIHBhaXJzIGFycmF5LlxuICpcbiAqIEBwYXJhbSB7QXJyYXl9IHBhaXJzXG4gKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gKiBAcGFyYW0ge01peGVkfSB2YWxcbiAqL1xuXG5mdW5jdGlvbiBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywga2V5LCB2YWwpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuICAgIHJldHVybiB2YWwuZm9yRWFjaChmdW5jdGlvbih2KSB7XG4gICAgICBwdXNoRW5jb2RlZEtleVZhbHVlUGFpcihwYWlycywga2V5LCB2KTtcbiAgICB9KTtcbiAgfVxuICBwYWlycy5wdXNoKGVuY29kZVVSSUNvbXBvbmVudChrZXkpXG4gICAgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQodmFsKSk7XG59XG5cbi8qKlxuICogRXhwb3NlIHNlcmlhbGl6YXRpb24gbWV0aG9kLlxuICovXG5cbiByZXF1ZXN0LnNlcmlhbGl6ZU9iamVjdCA9IHNlcmlhbGl6ZTtcblxuIC8qKlxuICAqIFBhcnNlIHRoZSBnaXZlbiB4LXd3dy1mb3JtLXVybGVuY29kZWQgYHN0cmAuXG4gICpcbiAgKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gICogQHJldHVybiB7T2JqZWN0fVxuICAqIEBhcGkgcHJpdmF0ZVxuICAqL1xuXG5mdW5jdGlvbiBwYXJzZVN0cmluZyhzdHIpIHtcbiAgdmFyIG9iaiA9IHt9O1xuICB2YXIgcGFpcnMgPSBzdHIuc3BsaXQoJyYnKTtcbiAgdmFyIHBhcnRzO1xuICB2YXIgcGFpcjtcblxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gcGFpcnMubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcbiAgICBwYWlyID0gcGFpcnNbaV07XG4gICAgcGFydHMgPSBwYWlyLnNwbGl0KCc9Jyk7XG4gICAgb2JqW2RlY29kZVVSSUNvbXBvbmVudChwYXJ0c1swXSldID0gZGVjb2RlVVJJQ29tcG9uZW50KHBhcnRzWzFdKTtcbiAgfVxuXG4gIHJldHVybiBvYmo7XG59XG5cbi8qKlxuICogRXhwb3NlIHBhcnNlci5cbiAqL1xuXG5yZXF1ZXN0LnBhcnNlU3RyaW5nID0gcGFyc2VTdHJpbmc7XG5cbi8qKlxuICogRGVmYXVsdCBNSU1FIHR5cGUgbWFwLlxuICpcbiAqICAgICBzdXBlcmFnZW50LnR5cGVzLnhtbCA9ICdhcHBsaWNhdGlvbi94bWwnO1xuICpcbiAqL1xuXG5yZXF1ZXN0LnR5cGVzID0ge1xuICBodG1sOiAndGV4dC9odG1sJyxcbiAganNvbjogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICB4bWw6ICdhcHBsaWNhdGlvbi94bWwnLFxuICB1cmxlbmNvZGVkOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyxcbiAgJ2Zvcm0nOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyxcbiAgJ2Zvcm0tZGF0YSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXG59O1xuXG4vKipcbiAqIERlZmF1bHQgc2VyaWFsaXphdGlvbiBtYXAuXG4gKlxuICogICAgIHN1cGVyYWdlbnQuc2VyaWFsaXplWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKG9iail7XG4gKiAgICAgICByZXR1cm4gJ2dlbmVyYXRlZCB4bWwgaGVyZSc7XG4gKiAgICAgfTtcbiAqXG4gKi9cblxuIHJlcXVlc3Quc2VyaWFsaXplID0ge1xuICAgJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCc6IHNlcmlhbGl6ZSxcbiAgICdhcHBsaWNhdGlvbi9qc29uJzogSlNPTi5zdHJpbmdpZnlcbiB9O1xuXG4gLyoqXG4gICogRGVmYXVsdCBwYXJzZXJzLlxuICAqXG4gICogICAgIHN1cGVyYWdlbnQucGFyc2VbJ2FwcGxpY2F0aW9uL3htbCddID0gZnVuY3Rpb24oc3RyKXtcbiAgKiAgICAgICByZXR1cm4geyBvYmplY3QgcGFyc2VkIGZyb20gc3RyIH07XG4gICogICAgIH07XG4gICpcbiAgKi9cblxucmVxdWVzdC5wYXJzZSA9IHtcbiAgJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCc6IHBhcnNlU3RyaW5nLFxuICAnYXBwbGljYXRpb24vanNvbic6IEpTT04ucGFyc2Vcbn07XG5cbi8qKlxuICogUGFyc2UgdGhlIGdpdmVuIGhlYWRlciBgc3RyYCBpbnRvXG4gKiBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgbWFwcGVkIGZpZWxkcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZUhlYWRlcihzdHIpIHtcbiAgdmFyIGxpbmVzID0gc3RyLnNwbGl0KC9cXHI/XFxuLyk7XG4gIHZhciBmaWVsZHMgPSB7fTtcbiAgdmFyIGluZGV4O1xuICB2YXIgbGluZTtcbiAgdmFyIGZpZWxkO1xuICB2YXIgdmFsO1xuXG4gIGxpbmVzLnBvcCgpOyAvLyB0cmFpbGluZyBDUkxGXG5cbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGxpbmVzLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gICAgbGluZSA9IGxpbmVzW2ldO1xuICAgIGluZGV4ID0gbGluZS5pbmRleE9mKCc6Jyk7XG4gICAgZmllbGQgPSBsaW5lLnNsaWNlKDAsIGluZGV4KS50b0xvd2VyQ2FzZSgpO1xuICAgIHZhbCA9IHRyaW0obGluZS5zbGljZShpbmRleCArIDEpKTtcbiAgICBmaWVsZHNbZmllbGRdID0gdmFsO1xuICB9XG5cbiAgcmV0dXJuIGZpZWxkcztcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBgbWltZWAgaXMganNvbiBvciBoYXMgK2pzb24gc3RydWN0dXJlZCBzeW50YXggc3VmZml4LlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtaW1lXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaXNKU09OKG1pbWUpIHtcbiAgcmV0dXJuIC9bXFwvK11qc29uXFxiLy50ZXN0KG1pbWUpO1xufVxuXG4vKipcbiAqIFJldHVybiB0aGUgbWltZSB0eXBlIGZvciB0aGUgZ2l2ZW4gYHN0cmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gdHlwZShzdHIpe1xuICByZXR1cm4gc3RyLnNwbGl0KC8gKjsgKi8pLnNoaWZ0KCk7XG59O1xuXG4vKipcbiAqIFJldHVybiBoZWFkZXIgZmllbGQgcGFyYW1ldGVycy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJhbXMoc3RyKXtcbiAgcmV0dXJuIHJlZHVjZShzdHIuc3BsaXQoLyAqOyAqLyksIGZ1bmN0aW9uKG9iaiwgc3RyKXtcbiAgICB2YXIgcGFydHMgPSBzdHIuc3BsaXQoLyAqPSAqLylcbiAgICAgICwga2V5ID0gcGFydHMuc2hpZnQoKVxuICAgICAgLCB2YWwgPSBwYXJ0cy5zaGlmdCgpO1xuXG4gICAgaWYgKGtleSAmJiB2YWwpIG9ialtrZXldID0gdmFsO1xuICAgIHJldHVybiBvYmo7XG4gIH0sIHt9KTtcbn07XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVzcG9uc2VgIHdpdGggdGhlIGdpdmVuIGB4aHJgLlxuICpcbiAqICAtIHNldCBmbGFncyAoLm9rLCAuZXJyb3IsIGV0YylcbiAqICAtIHBhcnNlIGhlYWRlclxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICBBbGlhc2luZyBgc3VwZXJhZ2VudGAgYXMgYHJlcXVlc3RgIGlzIG5pY2U6XG4gKlxuICogICAgICByZXF1ZXN0ID0gc3VwZXJhZ2VudDtcbiAqXG4gKiAgV2UgY2FuIHVzZSB0aGUgcHJvbWlzZS1saWtlIEFQSSwgb3IgcGFzcyBjYWxsYmFja3M6XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnLycpLmVuZChmdW5jdGlvbihyZXMpe30pO1xuICogICAgICByZXF1ZXN0LmdldCgnLycsIGZ1bmN0aW9uKHJlcyl7fSk7XG4gKlxuICogIFNlbmRpbmcgZGF0YSBjYW4gYmUgY2hhaW5lZDpcbiAqXG4gKiAgICAgIHJlcXVlc3RcbiAqICAgICAgICAucG9zdCgnL3VzZXInKVxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiAgT3IgcGFzc2VkIHRvIGAuc2VuZCgpYDpcbiAqXG4gKiAgICAgIHJlcXVlc3RcbiAqICAgICAgICAucG9zdCgnL3VzZXInKVxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqICBPciBwYXNzZWQgdG8gYC5wb3N0KClgOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicsIHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiBPciBmdXJ0aGVyIHJlZHVjZWQgdG8gYSBzaW5nbGUgY2FsbCBmb3Igc2ltcGxlIGNhc2VzOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicsIHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqIEBwYXJhbSB7WE1MSFRUUFJlcXVlc3R9IHhoclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIFJlc3BvbnNlKHJlcSwgb3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgdGhpcy5yZXEgPSByZXE7XG4gIHRoaXMueGhyID0gdGhpcy5yZXEueGhyO1xuICAvLyByZXNwb25zZVRleHQgaXMgYWNjZXNzaWJsZSBvbmx5IGlmIHJlc3BvbnNlVHlwZSBpcyAnJyBvciAndGV4dCcgYW5kIG9uIG9sZGVyIGJyb3dzZXJzXG4gIHRoaXMudGV4dCA9ICgodGhpcy5yZXEubWV0aG9kICE9J0hFQUQnICYmICh0aGlzLnhoci5yZXNwb25zZVR5cGUgPT09ICcnIHx8IHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3RleHQnKSkgfHwgdHlwZW9mIHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3VuZGVmaW5lZCcpXG4gICAgID8gdGhpcy54aHIucmVzcG9uc2VUZXh0XG4gICAgIDogbnVsbDtcbiAgdGhpcy5zdGF0dXNUZXh0ID0gdGhpcy5yZXEueGhyLnN0YXR1c1RleHQ7XG4gIHRoaXMuc2V0U3RhdHVzUHJvcGVydGllcyh0aGlzLnhoci5zdGF0dXMpO1xuICB0aGlzLmhlYWRlciA9IHRoaXMuaGVhZGVycyA9IHBhcnNlSGVhZGVyKHRoaXMueGhyLmdldEFsbFJlc3BvbnNlSGVhZGVycygpKTtcbiAgLy8gZ2V0QWxsUmVzcG9uc2VIZWFkZXJzIHNvbWV0aW1lcyBmYWxzZWx5IHJldHVybnMgXCJcIiBmb3IgQ09SUyByZXF1ZXN0cywgYnV0XG4gIC8vIGdldFJlc3BvbnNlSGVhZGVyIHN0aWxsIHdvcmtzLiBzbyB3ZSBnZXQgY29udGVudC10eXBlIGV2ZW4gaWYgZ2V0dGluZ1xuICAvLyBvdGhlciBoZWFkZXJzIGZhaWxzLlxuICB0aGlzLmhlYWRlclsnY29udGVudC10eXBlJ10gPSB0aGlzLnhoci5nZXRSZXNwb25zZUhlYWRlcignY29udGVudC10eXBlJyk7XG4gIHRoaXMuc2V0SGVhZGVyUHJvcGVydGllcyh0aGlzLmhlYWRlcik7XG4gIHRoaXMuYm9keSA9IHRoaXMucmVxLm1ldGhvZCAhPSAnSEVBRCdcbiAgICA/IHRoaXMucGFyc2VCb2R5KHRoaXMudGV4dCA/IHRoaXMudGV4dCA6IHRoaXMueGhyLnJlc3BvbnNlKVxuICAgIDogbnVsbDtcbn1cblxuLyoqXG4gKiBHZXQgY2FzZS1pbnNlbnNpdGl2ZSBgZmllbGRgIHZhbHVlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXNwb25zZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oZmllbGQpe1xuICByZXR1cm4gdGhpcy5oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XG59O1xuXG4vKipcbiAqIFNldCBoZWFkZXIgcmVsYXRlZCBwcm9wZXJ0aWVzOlxuICpcbiAqICAgLSBgLnR5cGVgIHRoZSBjb250ZW50IHR5cGUgd2l0aG91dCBwYXJhbXNcbiAqXG4gKiBBIHJlc3BvbnNlIG9mIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04XCJcbiAqIHdpbGwgcHJvdmlkZSB5b3Ugd2l0aCBhIGAudHlwZWAgb2YgXCJ0ZXh0L3BsYWluXCIuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGhlYWRlclxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnNldEhlYWRlclByb3BlcnRpZXMgPSBmdW5jdGlvbihoZWFkZXIpe1xuICAvLyBjb250ZW50LXR5cGVcbiAgdmFyIGN0ID0gdGhpcy5oZWFkZXJbJ2NvbnRlbnQtdHlwZSddIHx8ICcnO1xuICB0aGlzLnR5cGUgPSB0eXBlKGN0KTtcblxuICAvLyBwYXJhbXNcbiAgdmFyIG9iaiA9IHBhcmFtcyhjdCk7XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHRoaXNba2V5XSA9IG9ialtrZXldO1xufTtcblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gYm9keSBgc3RyYC5cbiAqXG4gKiBVc2VkIGZvciBhdXRvLXBhcnNpbmcgb2YgYm9kaWVzLiBQYXJzZXJzXG4gKiBhcmUgZGVmaW5lZCBvbiB0aGUgYHN1cGVyYWdlbnQucGFyc2VgIG9iamVjdC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtNaXhlZH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlc3BvbnNlLnByb3RvdHlwZS5wYXJzZUJvZHkgPSBmdW5jdGlvbihzdHIpe1xuICB2YXIgcGFyc2UgPSByZXF1ZXN0LnBhcnNlW3RoaXMudHlwZV07XG4gIHJldHVybiBwYXJzZSAmJiBzdHIgJiYgKHN0ci5sZW5ndGggfHwgc3RyIGluc3RhbmNlb2YgT2JqZWN0KVxuICAgID8gcGFyc2Uoc3RyKVxuICAgIDogbnVsbDtcbn07XG5cbi8qKlxuICogU2V0IGZsYWdzIHN1Y2ggYXMgYC5va2AgYmFzZWQgb24gYHN0YXR1c2AuXG4gKlxuICogRm9yIGV4YW1wbGUgYSAyeHggcmVzcG9uc2Ugd2lsbCBnaXZlIHlvdSBhIGAub2tgIG9mIF9fdHJ1ZV9fXG4gKiB3aGVyZWFzIDV4eCB3aWxsIGJlIF9fZmFsc2VfXyBhbmQgYC5lcnJvcmAgd2lsbCBiZSBfX3RydWVfXy4gVGhlXG4gKiBgLmNsaWVudEVycm9yYCBhbmQgYC5zZXJ2ZXJFcnJvcmAgYXJlIGFsc28gYXZhaWxhYmxlIHRvIGJlIG1vcmVcbiAqIHNwZWNpZmljLCBhbmQgYC5zdGF0dXNUeXBlYCBpcyB0aGUgY2xhc3Mgb2YgZXJyb3IgcmFuZ2luZyBmcm9tIDEuLjVcbiAqIHNvbWV0aW1lcyB1c2VmdWwgZm9yIG1hcHBpbmcgcmVzcG9uZCBjb2xvcnMgZXRjLlxuICpcbiAqIFwic3VnYXJcIiBwcm9wZXJ0aWVzIGFyZSBhbHNvIGRlZmluZWQgZm9yIGNvbW1vbiBjYXNlcy4gQ3VycmVudGx5IHByb3ZpZGluZzpcbiAqXG4gKiAgIC0gLm5vQ29udGVudFxuICogICAtIC5iYWRSZXF1ZXN0XG4gKiAgIC0gLnVuYXV0aG9yaXplZFxuICogICAtIC5ub3RBY2NlcHRhYmxlXG4gKiAgIC0gLm5vdEZvdW5kXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IHN0YXR1c1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnNldFN0YXR1c1Byb3BlcnRpZXMgPSBmdW5jdGlvbihzdGF0dXMpe1xuICAvLyBoYW5kbGUgSUU5IGJ1ZzogaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMDA0Njk3Mi9tc2llLXJldHVybnMtc3RhdHVzLWNvZGUtb2YtMTIyMy1mb3ItYWpheC1yZXF1ZXN0XG4gIGlmIChzdGF0dXMgPT09IDEyMjMpIHtcbiAgICBzdGF0dXMgPSAyMDQ7XG4gIH1cblxuICB2YXIgdHlwZSA9IHN0YXR1cyAvIDEwMCB8IDA7XG5cbiAgLy8gc3RhdHVzIC8gY2xhc3NcbiAgdGhpcy5zdGF0dXMgPSB0aGlzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHRoaXMuc3RhdHVzVHlwZSA9IHR5cGU7XG5cbiAgLy8gYmFzaWNzXG4gIHRoaXMuaW5mbyA9IDEgPT0gdHlwZTtcbiAgdGhpcy5vayA9IDIgPT0gdHlwZTtcbiAgdGhpcy5jbGllbnRFcnJvciA9IDQgPT0gdHlwZTtcbiAgdGhpcy5zZXJ2ZXJFcnJvciA9IDUgPT0gdHlwZTtcbiAgdGhpcy5lcnJvciA9ICg0ID09IHR5cGUgfHwgNSA9PSB0eXBlKVxuICAgID8gdGhpcy50b0Vycm9yKClcbiAgICA6IGZhbHNlO1xuXG4gIC8vIHN1Z2FyXG4gIHRoaXMuYWNjZXB0ZWQgPSAyMDIgPT0gc3RhdHVzO1xuICB0aGlzLm5vQ29udGVudCA9IDIwNCA9PSBzdGF0dXM7XG4gIHRoaXMuYmFkUmVxdWVzdCA9IDQwMCA9PSBzdGF0dXM7XG4gIHRoaXMudW5hdXRob3JpemVkID0gNDAxID09IHN0YXR1cztcbiAgdGhpcy5ub3RBY2NlcHRhYmxlID0gNDA2ID09IHN0YXR1cztcbiAgdGhpcy5ub3RGb3VuZCA9IDQwNCA9PSBzdGF0dXM7XG4gIHRoaXMuZm9yYmlkZGVuID0gNDAzID09IHN0YXR1cztcbn07XG5cbi8qKlxuICogUmV0dXJuIGFuIGBFcnJvcmAgcmVwcmVzZW50YXRpdmUgb2YgdGhpcyByZXNwb25zZS5cbiAqXG4gKiBAcmV0dXJuIHtFcnJvcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnRvRXJyb3IgPSBmdW5jdGlvbigpe1xuICB2YXIgcmVxID0gdGhpcy5yZXE7XG4gIHZhciBtZXRob2QgPSByZXEubWV0aG9kO1xuICB2YXIgdXJsID0gcmVxLnVybDtcblxuICB2YXIgbXNnID0gJ2Nhbm5vdCAnICsgbWV0aG9kICsgJyAnICsgdXJsICsgJyAoJyArIHRoaXMuc3RhdHVzICsgJyknO1xuICB2YXIgZXJyID0gbmV3IEVycm9yKG1zZyk7XG4gIGVyci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcbiAgZXJyLm1ldGhvZCA9IG1ldGhvZDtcbiAgZXJyLnVybCA9IHVybDtcblxuICByZXR1cm4gZXJyO1xufTtcblxuLyoqXG4gKiBFeHBvc2UgYFJlc3BvbnNlYC5cbiAqL1xuXG5yZXF1ZXN0LlJlc3BvbnNlID0gUmVzcG9uc2U7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVxdWVzdGAgd2l0aCB0aGUgZ2l2ZW4gYG1ldGhvZGAgYW5kIGB1cmxgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2RcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gUmVxdWVzdChtZXRob2QsIHVybCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIEVtaXR0ZXIuY2FsbCh0aGlzKTtcbiAgdGhpcy5fcXVlcnkgPSB0aGlzLl9xdWVyeSB8fCBbXTtcbiAgdGhpcy5tZXRob2QgPSBtZXRob2Q7XG4gIHRoaXMudXJsID0gdXJsO1xuICB0aGlzLmhlYWRlciA9IHt9O1xuICB0aGlzLl9oZWFkZXIgPSB7fTtcbiAgdGhpcy5vbignZW5kJywgZnVuY3Rpb24oKXtcbiAgICB2YXIgZXJyID0gbnVsbDtcbiAgICB2YXIgcmVzID0gbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICByZXMgPSBuZXcgUmVzcG9uc2Uoc2VsZik7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICBlcnIgPSBuZXcgRXJyb3IoJ1BhcnNlciBpcyB1bmFibGUgdG8gcGFyc2UgdGhlIHJlc3BvbnNlJyk7XG4gICAgICBlcnIucGFyc2UgPSB0cnVlO1xuICAgICAgZXJyLm9yaWdpbmFsID0gZTtcbiAgICAgIC8vIGlzc3VlICM2NzU6IHJldHVybiB0aGUgcmF3IHJlc3BvbnNlIGlmIHRoZSByZXNwb25zZSBwYXJzaW5nIGZhaWxzXG4gICAgICBlcnIucmF3UmVzcG9uc2UgPSBzZWxmLnhociAmJiBzZWxmLnhoci5yZXNwb25zZVRleHQgPyBzZWxmLnhoci5yZXNwb25zZVRleHQgOiBudWxsO1xuICAgICAgcmV0dXJuIHNlbGYuY2FsbGJhY2soZXJyKTtcbiAgICB9XG5cbiAgICBzZWxmLmVtaXQoJ3Jlc3BvbnNlJywgcmVzKTtcblxuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBzZWxmLmNhbGxiYWNrKGVyciwgcmVzKTtcbiAgICB9XG5cbiAgICBpZiAocmVzLnN0YXR1cyA+PSAyMDAgJiYgcmVzLnN0YXR1cyA8IDMwMCkge1xuICAgICAgcmV0dXJuIHNlbGYuY2FsbGJhY2soZXJyLCByZXMpO1xuICAgIH1cblxuICAgIHZhciBuZXdfZXJyID0gbmV3IEVycm9yKHJlcy5zdGF0dXNUZXh0IHx8ICdVbnN1Y2Nlc3NmdWwgSFRUUCByZXNwb25zZScpO1xuICAgIG5ld19lcnIub3JpZ2luYWwgPSBlcnI7XG4gICAgbmV3X2Vyci5yZXNwb25zZSA9IHJlcztcbiAgICBuZXdfZXJyLnN0YXR1cyA9IHJlcy5zdGF0dXM7XG5cbiAgICBzZWxmLmNhbGxiYWNrKG5ld19lcnIsIHJlcyk7XG4gIH0pO1xufVxuXG4vKipcbiAqIE1peGluIGBFbWl0dGVyYC5cbiAqL1xuXG5FbWl0dGVyKFJlcXVlc3QucHJvdG90eXBlKTtcblxuLyoqXG4gKiBBbGxvdyBmb3IgZXh0ZW5zaW9uXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZm4pIHtcbiAgZm4odGhpcyk7XG4gIHJldHVybiB0aGlzO1xufVxuXG4vKipcbiAqIFNldCB0aW1lb3V0IHRvIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUudGltZW91dCA9IGZ1bmN0aW9uKG1zKXtcbiAgdGhpcy5fdGltZW91dCA9IG1zO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogQ2xlYXIgcHJldmlvdXMgdGltZW91dC5cbiAqXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuY2xlYXJUaW1lb3V0ID0gZnVuY3Rpb24oKXtcbiAgdGhpcy5fdGltZW91dCA9IDA7XG4gIGNsZWFyVGltZW91dCh0aGlzLl90aW1lcik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBBYm9ydCB0aGUgcmVxdWVzdCwgYW5kIGNsZWFyIHBvdGVudGlhbCB0aW1lb3V0LlxuICpcbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmFib3J0ID0gZnVuY3Rpb24oKXtcbiAgaWYgKHRoaXMuYWJvcnRlZCkgcmV0dXJuO1xuICB0aGlzLmFib3J0ZWQgPSB0cnVlO1xuICB0aGlzLnhoci5hYm9ydCgpO1xuICB0aGlzLmNsZWFyVGltZW91dCgpO1xuICB0aGlzLmVtaXQoJ2Fib3J0Jyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgaGVhZGVyIGBmaWVsZGAgdG8gYHZhbGAsIG9yIG11bHRpcGxlIGZpZWxkcyB3aXRoIG9uZSBvYmplY3QuXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICByZXEuZ2V0KCcvJylcbiAqICAgICAgICAuc2V0KCdBY2NlcHQnLCAnYXBwbGljYXRpb24vanNvbicpXG4gKiAgICAgICAgLnNldCgnWC1BUEktS2V5JywgJ2Zvb2JhcicpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogICAgICByZXEuZ2V0KCcvJylcbiAqICAgICAgICAuc2V0KHsgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsICdYLUFQSS1LZXknOiAnZm9vYmFyJyB9KVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xuICpcbiAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gZmllbGRcbiAqIEBwYXJhbSB7U3RyaW5nfSB2YWxcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihmaWVsZCwgdmFsKXtcbiAgaWYgKGlzT2JqZWN0KGZpZWxkKSkge1xuICAgIGZvciAodmFyIGtleSBpbiBmaWVsZCkge1xuICAgICAgdGhpcy5zZXQoa2V5LCBmaWVsZFtrZXldKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgdGhpcy5faGVhZGVyW2ZpZWxkLnRvTG93ZXJDYXNlKCldID0gdmFsO1xuICB0aGlzLmhlYWRlcltmaWVsZF0gPSB2YWw7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBSZW1vdmUgaGVhZGVyIGBmaWVsZGAuXG4gKlxuICogRXhhbXBsZTpcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC51bnNldCgnVXNlci1BZ2VudCcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUudW5zZXQgPSBmdW5jdGlvbihmaWVsZCl7XG4gIGRlbGV0ZSB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XG4gIGRlbGV0ZSB0aGlzLmhlYWRlcltmaWVsZF07XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBHZXQgY2FzZS1pbnNlbnNpdGl2ZSBoZWFkZXIgYGZpZWxkYCB2YWx1ZS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmdldEhlYWRlciA9IGZ1bmN0aW9uKGZpZWxkKXtcbiAgcmV0dXJuIHRoaXMuX2hlYWRlcltmaWVsZC50b0xvd2VyQ2FzZSgpXTtcbn07XG5cbi8qKlxuICogU2V0IENvbnRlbnQtVHlwZSB0byBgdHlwZWAsIG1hcHBpbmcgdmFsdWVzIGZyb20gYHJlcXVlc3QudHlwZXNgLlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgICAgc3VwZXJhZ2VudC50eXBlcy54bWwgPSAnYXBwbGljYXRpb24veG1sJztcbiAqXG4gKiAgICAgIHJlcXVlc3QucG9zdCgnLycpXG4gKiAgICAgICAgLnR5cGUoJ3htbCcpXG4gKiAgICAgICAgLnNlbmQoeG1sc3RyaW5nKVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xuICpcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcbiAqICAgICAgICAudHlwZSgnYXBwbGljYXRpb24veG1sJylcbiAqICAgICAgICAuc2VuZCh4bWxzdHJpbmcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHR5cGVcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24odHlwZSl7XG4gIHRoaXMuc2V0KCdDb250ZW50LVR5cGUnLCByZXF1ZXN0LnR5cGVzW3R5cGVdIHx8IHR5cGUpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogRm9yY2UgZ2l2ZW4gcGFyc2VyXG4gKlxuICogU2V0cyB0aGUgYm9keSBwYXJzZXIgbm8gbWF0dGVyIHR5cGUuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUucGFyc2UgPSBmdW5jdGlvbihmbil7XG4gIHRoaXMuX3BhcnNlciA9IGZuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IEFjY2VwdCB0byBgdHlwZWAsIG1hcHBpbmcgdmFsdWVzIGZyb20gYHJlcXVlc3QudHlwZXNgLlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgICAgc3VwZXJhZ2VudC50eXBlcy5qc29uID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xuICpcbiAqICAgICAgcmVxdWVzdC5nZXQoJy9hZ2VudCcpXG4gKiAgICAgICAgLmFjY2VwdCgnanNvbicpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcbiAqICAgICAgICAuYWNjZXB0KCdhcHBsaWNhdGlvbi9qc29uJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gYWNjZXB0XG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYWNjZXB0ID0gZnVuY3Rpb24odHlwZSl7XG4gIHRoaXMuc2V0KCdBY2NlcHQnLCByZXF1ZXN0LnR5cGVzW3R5cGVdIHx8IHR5cGUpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0IEF1dGhvcml6YXRpb24gZmllbGQgdmFsdWUgd2l0aCBgdXNlcmAgYW5kIGBwYXNzYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXNlclxuICogQHBhcmFtIHtTdHJpbmd9IHBhc3NcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5hdXRoID0gZnVuY3Rpb24odXNlciwgcGFzcyl7XG4gIHZhciBzdHIgPSBidG9hKHVzZXIgKyAnOicgKyBwYXNzKTtcbiAgdGhpcy5zZXQoJ0F1dGhvcml6YXRpb24nLCAnQmFzaWMgJyArIHN0cik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4qIEFkZCBxdWVyeS1zdHJpbmcgYHZhbGAuXG4qXG4qIEV4YW1wbGVzOlxuKlxuKiAgIHJlcXVlc3QuZ2V0KCcvc2hvZXMnKVxuKiAgICAgLnF1ZXJ5KCdzaXplPTEwJylcbiogICAgIC5xdWVyeSh7IGNvbG9yOiAnYmx1ZScgfSlcbipcbiogQHBhcmFtIHtPYmplY3R8U3RyaW5nfSB2YWxcbiogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4qIEBhcGkgcHVibGljXG4qL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5xdWVyeSA9IGZ1bmN0aW9uKHZhbCl7XG4gIGlmICgnc3RyaW5nJyAhPSB0eXBlb2YgdmFsKSB2YWwgPSBzZXJpYWxpemUodmFsKTtcbiAgaWYgKHZhbCkgdGhpcy5fcXVlcnkucHVzaCh2YWwpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogV3JpdGUgdGhlIGZpZWxkIGBuYW1lYCBhbmQgYHZhbGAgZm9yIFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiXG4gKiByZXF1ZXN0IGJvZGllcy5cbiAqXG4gKiBgYGAganNcbiAqIHJlcXVlc3QucG9zdCgnL3VwbG9hZCcpXG4gKiAgIC5maWVsZCgnZm9vJywgJ2JhcicpXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xuICogYGBgXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAqIEBwYXJhbSB7U3RyaW5nfEJsb2J8RmlsZX0gdmFsXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuZmllbGQgPSBmdW5jdGlvbihuYW1lLCB2YWwpe1xuICBpZiAoIXRoaXMuX2Zvcm1EYXRhKSB0aGlzLl9mb3JtRGF0YSA9IG5ldyByb290LkZvcm1EYXRhKCk7XG4gIHRoaXMuX2Zvcm1EYXRhLmFwcGVuZChuYW1lLCB2YWwpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUXVldWUgdGhlIGdpdmVuIGBmaWxlYCBhcyBhbiBhdHRhY2htZW50IHRvIHRoZSBzcGVjaWZpZWQgYGZpZWxkYCxcbiAqIHdpdGggb3B0aW9uYWwgYGZpbGVuYW1lYC5cbiAqXG4gKiBgYGAganNcbiAqIHJlcXVlc3QucG9zdCgnL3VwbG9hZCcpXG4gKiAgIC5hdHRhY2gobmV3IEJsb2IoWyc8YSBpZD1cImFcIj48YiBpZD1cImJcIj5oZXkhPC9iPjwvYT4nXSwgeyB0eXBlOiBcInRleHQvaHRtbFwifSkpXG4gKiAgIC5lbmQoY2FsbGJhY2spO1xuICogYGBgXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXG4gKiBAcGFyYW0ge0Jsb2J8RmlsZX0gZmlsZVxuICogQHBhcmFtIHtTdHJpbmd9IGZpbGVuYW1lXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24oZmllbGQsIGZpbGUsIGZpbGVuYW1lKXtcbiAgaWYgKCF0aGlzLl9mb3JtRGF0YSkgdGhpcy5fZm9ybURhdGEgPSBuZXcgcm9vdC5Gb3JtRGF0YSgpO1xuICB0aGlzLl9mb3JtRGF0YS5hcHBlbmQoZmllbGQsIGZpbGUsIGZpbGVuYW1lIHx8IGZpbGUubmFtZSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZW5kIGBkYXRhYCBhcyB0aGUgcmVxdWVzdCBib2R5LCBkZWZhdWx0aW5nIHRoZSBgLnR5cGUoKWAgdG8gXCJqc29uXCIgd2hlblxuICogYW4gb2JqZWN0IGlzIGdpdmVuLlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgICAgIC8vIG1hbnVhbCBqc29uXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnR5cGUoJ2pzb24nKVxuICogICAgICAgICAuc2VuZCgne1wibmFtZVwiOlwidGpcIn0nKVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIGF1dG8ganNvblxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIG1hbnVhbCB4LXd3dy1mb3JtLXVybGVuY29kZWRcbiAqICAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxuICogICAgICAgICAudHlwZSgnZm9ybScpXG4gKiAgICAgICAgIC5zZW5kKCduYW1lPXRqJylcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBhdXRvIHgtd3d3LWZvcm0tdXJsZW5jb2RlZFxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgIC50eXBlKCdmb3JtJylcbiAqICAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0pXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogICAgICAgLy8gZGVmYXVsdHMgdG8geC13d3ctZm9ybS11cmxlbmNvZGVkXG4gICogICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAgKiAgICAgICAgLnNlbmQoJ25hbWU9dG9iaScpXG4gICogICAgICAgIC5zZW5kKCdzcGVjaWVzPWZlcnJldCcpXG4gICogICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBkYXRhXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKGRhdGEpe1xuICB2YXIgb2JqID0gaXNPYmplY3QoZGF0YSk7XG4gIHZhciB0eXBlID0gdGhpcy5nZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScpO1xuXG4gIC8vIG1lcmdlXG4gIGlmIChvYmogJiYgaXNPYmplY3QodGhpcy5fZGF0YSkpIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gZGF0YSkge1xuICAgICAgdGhpcy5fZGF0YVtrZXldID0gZGF0YVtrZXldO1xuICAgIH1cbiAgfSBlbHNlIGlmICgnc3RyaW5nJyA9PSB0eXBlb2YgZGF0YSkge1xuICAgIGlmICghdHlwZSkgdGhpcy50eXBlKCdmb3JtJyk7XG4gICAgdHlwZSA9IHRoaXMuZ2V0SGVhZGVyKCdDb250ZW50LVR5cGUnKTtcbiAgICBpZiAoJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcgPT0gdHlwZSkge1xuICAgICAgdGhpcy5fZGF0YSA9IHRoaXMuX2RhdGFcbiAgICAgICAgPyB0aGlzLl9kYXRhICsgJyYnICsgZGF0YVxuICAgICAgICA6IGRhdGE7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2RhdGEgPSAodGhpcy5fZGF0YSB8fCAnJykgKyBkYXRhO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aGlzLl9kYXRhID0gZGF0YTtcbiAgfVxuXG4gIGlmICghb2JqIHx8IGlzSG9zdChkYXRhKSkgcmV0dXJuIHRoaXM7XG4gIGlmICghdHlwZSkgdGhpcy50eXBlKCdqc29uJyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBJbnZva2UgdGhlIGNhbGxiYWNrIHdpdGggYGVycmAgYW5kIGByZXNgXG4gKiBhbmQgaGFuZGxlIGFyaXR5IGNoZWNrLlxuICpcbiAqIEBwYXJhbSB7RXJyb3J9IGVyclxuICogQHBhcmFtIHtSZXNwb25zZX0gcmVzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5jYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgcmVzKXtcbiAgdmFyIGZuID0gdGhpcy5fY2FsbGJhY2s7XG4gIHRoaXMuY2xlYXJUaW1lb3V0KCk7XG4gIGZuKGVyciwgcmVzKTtcbn07XG5cbi8qKlxuICogSW52b2tlIGNhbGxiYWNrIHdpdGggeC1kb21haW4gZXJyb3IuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuY3Jvc3NEb21haW5FcnJvciA9IGZ1bmN0aW9uKCl7XG4gIHZhciBlcnIgPSBuZXcgRXJyb3IoJ1JlcXVlc3QgaGFzIGJlZW4gdGVybWluYXRlZFxcblBvc3NpYmxlIGNhdXNlczogdGhlIG5ldHdvcmsgaXMgb2ZmbGluZSwgT3JpZ2luIGlzIG5vdCBhbGxvd2VkIGJ5IEFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiwgdGhlIHBhZ2UgaXMgYmVpbmcgdW5sb2FkZWQsIGV0Yy4nKTtcbiAgZXJyLmNyb3NzRG9tYWluID0gdHJ1ZTtcblxuICBlcnIuc3RhdHVzID0gdGhpcy5zdGF0dXM7XG4gIGVyci5tZXRob2QgPSB0aGlzLm1ldGhvZDtcbiAgZXJyLnVybCA9IHRoaXMudXJsO1xuXG4gIHRoaXMuY2FsbGJhY2soZXJyKTtcbn07XG5cbi8qKlxuICogSW52b2tlIGNhbGxiYWNrIHdpdGggdGltZW91dCBlcnJvci5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50aW1lb3V0RXJyb3IgPSBmdW5jdGlvbigpe1xuICB2YXIgdGltZW91dCA9IHRoaXMuX3RpbWVvdXQ7XG4gIHZhciBlcnIgPSBuZXcgRXJyb3IoJ3RpbWVvdXQgb2YgJyArIHRpbWVvdXQgKyAnbXMgZXhjZWVkZWQnKTtcbiAgZXJyLnRpbWVvdXQgPSB0aW1lb3V0O1xuICB0aGlzLmNhbGxiYWNrKGVycik7XG59O1xuXG4vKipcbiAqIEVuYWJsZSB0cmFuc21pc3Npb24gb2YgY29va2llcyB3aXRoIHgtZG9tYWluIHJlcXVlc3RzLlxuICpcbiAqIE5vdGUgdGhhdCBmb3IgdGhpcyB0byB3b3JrIHRoZSBvcmlnaW4gbXVzdCBub3QgYmVcbiAqIHVzaW5nIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIgd2l0aCBhIHdpbGRjYXJkLFxuICogYW5kIGFsc28gbXVzdCBzZXQgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFsc1wiXG4gKiB0byBcInRydWVcIi5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLndpdGhDcmVkZW50aWFscyA9IGZ1bmN0aW9uKCl7XG4gIHRoaXMuX3dpdGhDcmVkZW50aWFscyA9IHRydWU7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBJbml0aWF0ZSByZXF1ZXN0LCBpbnZva2luZyBjYWxsYmFjayBgZm4ocmVzKWBcbiAqIHdpdGggYW4gaW5zdGFuY2VvZiBgUmVzcG9uc2VgLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24oZm4pe1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciB4aHIgPSB0aGlzLnhociA9IHJlcXVlc3QuZ2V0WEhSKCk7XG4gIHZhciBxdWVyeSA9IHRoaXMuX3F1ZXJ5LmpvaW4oJyYnKTtcbiAgdmFyIHRpbWVvdXQgPSB0aGlzLl90aW1lb3V0O1xuICB2YXIgZGF0YSA9IHRoaXMuX2Zvcm1EYXRhIHx8IHRoaXMuX2RhdGE7XG5cbiAgLy8gc3RvcmUgY2FsbGJhY2tcbiAgdGhpcy5fY2FsbGJhY2sgPSBmbiB8fCBub29wO1xuXG4gIC8vIHN0YXRlIGNoYW5nZVxuICB4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24oKXtcbiAgICBpZiAoNCAhPSB4aHIucmVhZHlTdGF0ZSkgcmV0dXJuO1xuXG4gICAgLy8gSW4gSUU5LCByZWFkcyB0byBhbnkgcHJvcGVydHkgKGUuZy4gc3RhdHVzKSBvZmYgb2YgYW4gYWJvcnRlZCBYSFIgd2lsbFxuICAgIC8vIHJlc3VsdCBpbiB0aGUgZXJyb3IgXCJDb3VsZCBub3QgY29tcGxldGUgdGhlIG9wZXJhdGlvbiBkdWUgdG8gZXJyb3IgYzAwYzAyM2ZcIlxuICAgIHZhciBzdGF0dXM7XG4gICAgdHJ5IHsgc3RhdHVzID0geGhyLnN0YXR1cyB9IGNhdGNoKGUpIHsgc3RhdHVzID0gMDsgfVxuXG4gICAgaWYgKDAgPT0gc3RhdHVzKSB7XG4gICAgICBpZiAoc2VsZi50aW1lZG91dCkgcmV0dXJuIHNlbGYudGltZW91dEVycm9yKCk7XG4gICAgICBpZiAoc2VsZi5hYm9ydGVkKSByZXR1cm47XG4gICAgICByZXR1cm4gc2VsZi5jcm9zc0RvbWFpbkVycm9yKCk7XG4gICAgfVxuICAgIHNlbGYuZW1pdCgnZW5kJyk7XG4gIH07XG5cbiAgLy8gcHJvZ3Jlc3NcbiAgdmFyIGhhbmRsZVByb2dyZXNzID0gZnVuY3Rpb24oZSl7XG4gICAgaWYgKGUudG90YWwgPiAwKSB7XG4gICAgICBlLnBlcmNlbnQgPSBlLmxvYWRlZCAvIGUudG90YWwgKiAxMDA7XG4gICAgfVxuICAgIGUuZGlyZWN0aW9uID0gJ2Rvd25sb2FkJztcbiAgICBzZWxmLmVtaXQoJ3Byb2dyZXNzJywgZSk7XG4gIH07XG4gIGlmICh0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xuICAgIHhoci5vbnByb2dyZXNzID0gaGFuZGxlUHJvZ3Jlc3M7XG4gIH1cbiAgdHJ5IHtcbiAgICBpZiAoeGhyLnVwbG9hZCAmJiB0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xuICAgICAgeGhyLnVwbG9hZC5vbnByb2dyZXNzID0gaGFuZGxlUHJvZ3Jlc3M7XG4gICAgfVxuICB9IGNhdGNoKGUpIHtcbiAgICAvLyBBY2Nlc3NpbmcgeGhyLnVwbG9hZCBmYWlscyBpbiBJRSBmcm9tIGEgd2ViIHdvcmtlciwgc28ganVzdCBwcmV0ZW5kIGl0IGRvZXNuJ3QgZXhpc3QuXG4gICAgLy8gUmVwb3J0ZWQgaGVyZTpcbiAgICAvLyBodHRwczovL2Nvbm5lY3QubWljcm9zb2Z0LmNvbS9JRS9mZWVkYmFjay9kZXRhaWxzLzgzNzI0NS94bWxodHRwcmVxdWVzdC11cGxvYWQtdGhyb3dzLWludmFsaWQtYXJndW1lbnQtd2hlbi11c2VkLWZyb20td2ViLXdvcmtlci1jb250ZXh0XG4gIH1cblxuICAvLyB0aW1lb3V0XG4gIGlmICh0aW1lb3V0ICYmICF0aGlzLl90aW1lcikge1xuICAgIHRoaXMuX3RpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgc2VsZi50aW1lZG91dCA9IHRydWU7XG4gICAgICBzZWxmLmFib3J0KCk7XG4gICAgfSwgdGltZW91dCk7XG4gIH1cblxuICAvLyBxdWVyeXN0cmluZ1xuICBpZiAocXVlcnkpIHtcbiAgICBxdWVyeSA9IHJlcXVlc3Quc2VyaWFsaXplT2JqZWN0KHF1ZXJ5KTtcbiAgICB0aGlzLnVybCArPSB+dGhpcy51cmwuaW5kZXhPZignPycpXG4gICAgICA/ICcmJyArIHF1ZXJ5XG4gICAgICA6ICc/JyArIHF1ZXJ5O1xuICB9XG5cbiAgLy8gaW5pdGlhdGUgcmVxdWVzdFxuICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmwsIHRydWUpO1xuXG4gIC8vIENPUlNcbiAgaWYgKHRoaXMuX3dpdGhDcmVkZW50aWFscykgeGhyLndpdGhDcmVkZW50aWFscyA9IHRydWU7XG5cbiAgLy8gYm9keVxuICBpZiAoJ0dFVCcgIT0gdGhpcy5tZXRob2QgJiYgJ0hFQUQnICE9IHRoaXMubWV0aG9kICYmICdzdHJpbmcnICE9IHR5cGVvZiBkYXRhICYmICFpc0hvc3QoZGF0YSkpIHtcbiAgICAvLyBzZXJpYWxpemUgc3R1ZmZcbiAgICB2YXIgY29udGVudFR5cGUgPSB0aGlzLmdldEhlYWRlcignQ29udGVudC1UeXBlJyk7XG4gICAgdmFyIHNlcmlhbGl6ZSA9IHRoaXMuX3BhcnNlciB8fCByZXF1ZXN0LnNlcmlhbGl6ZVtjb250ZW50VHlwZSA/IGNvbnRlbnRUeXBlLnNwbGl0KCc7JylbMF0gOiAnJ107XG4gICAgaWYgKCFzZXJpYWxpemUgJiYgaXNKU09OKGNvbnRlbnRUeXBlKSkgc2VyaWFsaXplID0gcmVxdWVzdC5zZXJpYWxpemVbJ2FwcGxpY2F0aW9uL2pzb24nXTtcbiAgICBpZiAoc2VyaWFsaXplKSBkYXRhID0gc2VyaWFsaXplKGRhdGEpO1xuICB9XG5cbiAgLy8gc2V0IGhlYWRlciBmaWVsZHNcbiAgZm9yICh2YXIgZmllbGQgaW4gdGhpcy5oZWFkZXIpIHtcbiAgICBpZiAobnVsbCA9PSB0aGlzLmhlYWRlcltmaWVsZF0pIGNvbnRpbnVlO1xuICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGZpZWxkLCB0aGlzLmhlYWRlcltmaWVsZF0pO1xuICB9XG5cbiAgLy8gc2VuZCBzdHVmZlxuICB0aGlzLmVtaXQoJ3JlcXVlc3QnLCB0aGlzKTtcblxuICAvLyBJRTExIHhoci5zZW5kKHVuZGVmaW5lZCkgc2VuZHMgJ3VuZGVmaW5lZCcgc3RyaW5nIGFzIFBPU1QgcGF5bG9hZCAoaW5zdGVhZCBvZiBub3RoaW5nKVxuICAvLyBXZSBuZWVkIG51bGwgaGVyZSBpZiBkYXRhIGlzIHVuZGVmaW5lZFxuICB4aHIuc2VuZCh0eXBlb2YgZGF0YSAhPT0gJ3VuZGVmaW5lZCcgPyBkYXRhIDogbnVsbCk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBGYXV4IHByb21pc2Ugc3VwcG9ydFxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bGZpbGxcbiAqIEBwYXJhbSB7RnVuY3Rpb259IHJlamVjdFxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50aGVuID0gZnVuY3Rpb24gKGZ1bGZpbGwsIHJlamVjdCkge1xuICByZXR1cm4gdGhpcy5lbmQoZnVuY3Rpb24oZXJyLCByZXMpIHtcbiAgICBlcnIgPyByZWplY3QoZXJyKSA6IGZ1bGZpbGwocmVzKTtcbiAgfSk7XG59XG5cbi8qKlxuICogRXhwb3NlIGBSZXF1ZXN0YC5cbiAqL1xuXG5yZXF1ZXN0LlJlcXVlc3QgPSBSZXF1ZXN0O1xuXG4vKipcbiAqIElzc3VlIGEgcmVxdWVzdDpcbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICByZXF1ZXN0KCdHRVQnLCAnL3VzZXJzJykuZW5kKGNhbGxiYWNrKVxuICogICAgcmVxdWVzdCgnL3VzZXJzJykuZW5kKGNhbGxiYWNrKVxuICogICAgcmVxdWVzdCgnL3VzZXJzJywgY2FsbGJhY2spXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZFxuICogQHBhcmFtIHtTdHJpbmd8RnVuY3Rpb259IHVybCBvciBjYWxsYmFja1xuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gcmVxdWVzdChtZXRob2QsIHVybCkge1xuICAvLyBjYWxsYmFja1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgdXJsKSB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0KCdHRVQnLCBtZXRob2QpLmVuZCh1cmwpO1xuICB9XG5cbiAgLy8gdXJsIGZpcnN0XG4gIGlmICgxID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3QoJ0dFVCcsIG1ldGhvZCk7XG4gIH1cblxuICByZXR1cm4gbmV3IFJlcXVlc3QobWV0aG9kLCB1cmwpO1xufVxuXG4vKipcbiAqIEdFVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfEZ1bmN0aW9ufSBkYXRhIG9yIGZuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5nZXQgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ0dFVCcsIHVybCk7XG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiBkYXRhKSBmbiA9IGRhdGEsIGRhdGEgPSBudWxsO1xuICBpZiAoZGF0YSkgcmVxLnF1ZXJ5KGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBIRUFEIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IGRhdGEgb3IgZm5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LmhlYWQgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ0hFQUQnLCB1cmwpO1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgZGF0YSkgZm4gPSBkYXRhLCBkYXRhID0gbnVsbDtcbiAgaWYgKGRhdGEpIHJlcS5zZW5kKGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBERUxFVEUgYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGRlbCh1cmwsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ0RFTEVURScsIHVybCk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG5yZXF1ZXN0WydkZWwnXSA9IGRlbDtcbnJlcXVlc3RbJ2RlbGV0ZSddID0gZGVsO1xuXG4vKipcbiAqIFBBVENIIGB1cmxgIHdpdGggb3B0aW9uYWwgYGRhdGFgIGFuZCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZH0gZGF0YVxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QucGF0Y2ggPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ1BBVENIJywgdXJsKTtcbiAgaWYgKCdmdW5jdGlvbicgPT0gdHlwZW9mIGRhdGEpIGZuID0gZGF0YSwgZGF0YSA9IG51bGw7XG4gIGlmIChkYXRhKSByZXEuc2VuZChkYXRhKTtcbiAgaWYgKGZuKSByZXEuZW5kKGZuKTtcbiAgcmV0dXJuIHJlcTtcbn07XG5cbi8qKlxuICogUE9TVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR9IGRhdGFcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LnBvc3QgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ1BPU1QnLCB1cmwpO1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgZGF0YSkgZm4gPSBkYXRhLCBkYXRhID0gbnVsbDtcbiAgaWYgKGRhdGEpIHJlcS5zZW5kKGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBQVVQgYHVybGAgd2l0aCBvcHRpb25hbCBgZGF0YWAgYW5kIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfEZ1bmN0aW9ufSBkYXRhIG9yIGZuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5wdXQgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ1BVVCcsIHVybCk7XG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiBkYXRhKSBmbiA9IGRhdGEsIGRhdGEgPSBudWxsO1xuICBpZiAoZGF0YSkgcmVxLnNlbmQoZGF0YSk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG4vKipcbiAqIEV4cG9zZSBgcmVxdWVzdGAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSByZXF1ZXN0O1xuIiwiLyohIGh0dHBzOi8vbXRocy5iZS9wdW55Y29kZSB2MS4zLjIgYnkgQG1hdGhpYXMsIG1vZGlmaWVkIGZvciBVUkkuanMgKi9cclxuXHJcbnZhciBwdW55Y29kZSA9IChmdW5jdGlvbiAoKSB7XHJcblxyXG5cdC8qKlxyXG5cdCAqIFRoZSBgcHVueWNvZGVgIG9iamVjdC5cclxuXHQgKiBAbmFtZSBwdW55Y29kZVxyXG5cdCAqIEB0eXBlIE9iamVjdFxyXG5cdCAqL1xyXG5cdHZhciBwdW55Y29kZSxcclxuXHJcblx0LyoqIEhpZ2hlc3QgcG9zaXRpdmUgc2lnbmVkIDMyLWJpdCBmbG9hdCB2YWx1ZSAqL1xyXG5cdG1heEludCA9IDIxNDc0ODM2NDcsIC8vIGFrYS4gMHg3RkZGRkZGRiBvciAyXjMxLTFcclxuXHJcblx0LyoqIEJvb3RzdHJpbmcgcGFyYW1ldGVycyAqL1xyXG5cdGJhc2UgPSAzNixcclxuXHR0TWluID0gMSxcclxuXHR0TWF4ID0gMjYsXHJcblx0c2tldyA9IDM4LFxyXG5cdGRhbXAgPSA3MDAsXHJcblx0aW5pdGlhbEJpYXMgPSA3MixcclxuXHRpbml0aWFsTiA9IDEyOCwgLy8gMHg4MFxyXG5cdGRlbGltaXRlciA9ICctJywgLy8gJ1xceDJEJ1xyXG5cclxuXHQvKiogUmVndWxhciBleHByZXNzaW9ucyAqL1xyXG5cdHJlZ2V4UHVueWNvZGUgPSAvXnhuLS0vLFxyXG5cdHJlZ2V4Tm9uQVNDSUkgPSAvW15cXHgyMC1cXHg3RV0vLCAvLyB1bnByaW50YWJsZSBBU0NJSSBjaGFycyArIG5vbi1BU0NJSSBjaGFyc1xyXG5cdHJlZ2V4U2VwYXJhdG9ycyA9IC9bXFx4MkVcXHUzMDAyXFx1RkYwRVxcdUZGNjFdL2csIC8vIFJGQyAzNDkwIHNlcGFyYXRvcnNcclxuXHJcblx0LyoqIEVycm9yIG1lc3NhZ2VzICovXHJcblx0ZXJyb3JzID0ge1xyXG5cdFx0J292ZXJmbG93JzogJ092ZXJmbG93OiBpbnB1dCBuZWVkcyB3aWRlciBpbnRlZ2VycyB0byBwcm9jZXNzJyxcclxuXHRcdCdub3QtYmFzaWMnOiAnSWxsZWdhbCBpbnB1dCA+PSAweDgwIChub3QgYSBiYXNpYyBjb2RlIHBvaW50KScsXHJcblx0XHQnaW52YWxpZC1pbnB1dCc6ICdJbnZhbGlkIGlucHV0J1xyXG5cdH0sXHJcblxyXG5cdC8qKiBDb252ZW5pZW5jZSBzaG9ydGN1dHMgKi9cclxuXHRiYXNlTWludXNUTWluID0gYmFzZSAtIHRNaW4sXHJcblx0Zmxvb3IgPSBNYXRoLmZsb29yLFxyXG5cdHN0cmluZ0Zyb21DaGFyQ29kZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUsXHJcblxyXG5cdC8qKiBUZW1wb3JhcnkgdmFyaWFibGUgKi9cclxuXHRrZXk7XHJcblxyXG5cdC8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xyXG5cclxuXHQvKipcclxuXHQgKiBBIGdlbmVyaWMgZXJyb3IgdXRpbGl0eSBmdW5jdGlvbi5cclxuXHQgKiBAcHJpdmF0ZVxyXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlIFRoZSBlcnJvciB0eXBlLlxyXG5cdCAqIEByZXR1cm5zIHtFcnJvcn0gVGhyb3dzIGEgYFJhbmdlRXJyb3JgIHdpdGggdGhlIGFwcGxpY2FibGUgZXJyb3IgbWVzc2FnZS5cclxuXHQgKi9cclxuXHRmdW5jdGlvbiBlcnJvcih0eXBlKSB7XHJcblx0XHR0aHJvdyBuZXcgUmFuZ2VFcnJvcihlcnJvcnNbdHlwZV0pO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQSBnZW5lcmljIGBBcnJheSNtYXBgIHV0aWxpdHkgZnVuY3Rpb24uXHJcblx0ICogQHByaXZhdGVcclxuXHQgKiBAcGFyYW0ge0FycmF5fSBhcnJheSBUaGUgYXJyYXkgdG8gaXRlcmF0ZSBvdmVyLlxyXG5cdCAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0aGF0IGdldHMgY2FsbGVkIGZvciBldmVyeSBhcnJheVxyXG5cdCAqIGl0ZW0uXHJcblx0ICogQHJldHVybnMge0FycmF5fSBBIG5ldyBhcnJheSBvZiB2YWx1ZXMgcmV0dXJuZWQgYnkgdGhlIGNhbGxiYWNrIGZ1bmN0aW9uLlxyXG5cdCAqL1xyXG5cdGZ1bmN0aW9uIG1hcChhcnJheSwgZm4pIHtcclxuXHRcdHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XHJcblx0XHR2YXIgcmVzdWx0ID0gW107XHJcblx0XHR3aGlsZSAobGVuZ3RoLS0pIHtcclxuXHRcdFx0cmVzdWx0W2xlbmd0aF0gPSBmbihhcnJheVtsZW5ndGhdKTtcclxuXHRcdH1cclxuXHRcdHJldHVybiByZXN1bHQ7XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBBIHNpbXBsZSBgQXJyYXkjbWFwYC1saWtlIHdyYXBwZXIgdG8gd29yayB3aXRoIGRvbWFpbiBuYW1lIHN0cmluZ3Mgb3IgZW1haWxcclxuXHQgKiBhZGRyZXNzZXMuXHJcblx0ICogQHByaXZhdGVcclxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZG9tYWluIFRoZSBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzLlxyXG5cdCAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0aGF0IGdldHMgY2FsbGVkIGZvciBldmVyeVxyXG5cdCAqIGNoYXJhY3Rlci5cclxuXHQgKiBAcmV0dXJucyB7QXJyYXl9IEEgbmV3IHN0cmluZyBvZiBjaGFyYWN0ZXJzIHJldHVybmVkIGJ5IHRoZSBjYWxsYmFja1xyXG5cdCAqIGZ1bmN0aW9uLlxyXG5cdCAqL1xyXG5cdGZ1bmN0aW9uIG1hcERvbWFpbihzdHJpbmcsIGZuKSB7XHJcblx0XHR2YXIgcGFydHMgPSBzdHJpbmcuc3BsaXQoJ0AnKTtcclxuXHRcdHZhciByZXN1bHQgPSAnJztcclxuXHRcdGlmIChwYXJ0cy5sZW5ndGggPiAxKSB7XHJcblx0XHRcdC8vIEluIGVtYWlsIGFkZHJlc3Nlcywgb25seSB0aGUgZG9tYWluIG5hbWUgc2hvdWxkIGJlIHB1bnljb2RlZC4gTGVhdmVcclxuXHRcdFx0Ly8gdGhlIGxvY2FsIHBhcnQgKGkuZS4gZXZlcnl0aGluZyB1cCB0byBgQGApIGludGFjdC5cclxuXHRcdFx0cmVzdWx0ID0gcGFydHNbMF0gKyAnQCc7XHJcblx0XHRcdHN0cmluZyA9IHBhcnRzWzFdO1xyXG5cdFx0fVxyXG5cdFx0Ly8gQXZvaWQgYHNwbGl0KHJlZ2V4KWAgZm9yIElFOCBjb21wYXRpYmlsaXR5LiBTZWUgIzE3LlxyXG5cdFx0c3RyaW5nID0gc3RyaW5nLnJlcGxhY2UocmVnZXhTZXBhcmF0b3JzLCAnXFx4MkUnKTtcclxuXHRcdHZhciBsYWJlbHMgPSBzdHJpbmcuc3BsaXQoJy4nKTtcclxuXHRcdHZhciBlbmNvZGVkID0gbWFwKGxhYmVscywgZm4pLmpvaW4oJy4nKTtcclxuXHRcdHJldHVybiByZXN1bHQgKyBlbmNvZGVkO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQ3JlYXRlcyBhbiBhcnJheSBjb250YWluaW5nIHRoZSBudW1lcmljIGNvZGUgcG9pbnRzIG9mIGVhY2ggVW5pY29kZVxyXG5cdCAqIGNoYXJhY3RlciBpbiB0aGUgc3RyaW5nLiBXaGlsZSBKYXZhU2NyaXB0IHVzZXMgVUNTLTIgaW50ZXJuYWxseSxcclxuXHQgKiB0aGlzIGZ1bmN0aW9uIHdpbGwgY29udmVydCBhIHBhaXIgb2Ygc3Vycm9nYXRlIGhhbHZlcyAoZWFjaCBvZiB3aGljaFxyXG5cdCAqIFVDUy0yIGV4cG9zZXMgYXMgc2VwYXJhdGUgY2hhcmFjdGVycykgaW50byBhIHNpbmdsZSBjb2RlIHBvaW50LFxyXG5cdCAqIG1hdGNoaW5nIFVURi0xNi5cclxuXHQgKiBAc2VlIGBwdW55Y29kZS51Y3MyLmVuY29kZWBcclxuXHQgKiBAc2VlIDxodHRwczovL21hdGhpYXNieW5lbnMuYmUvbm90ZXMvamF2YXNjcmlwdC1lbmNvZGluZz5cclxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGUudWNzMlxyXG5cdCAqIEBuYW1lIGRlY29kZVxyXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBzdHJpbmcgVGhlIFVuaWNvZGUgaW5wdXQgc3RyaW5nIChVQ1MtMikuXHJcblx0ICogQHJldHVybnMge0FycmF5fSBUaGUgbmV3IGFycmF5IG9mIGNvZGUgcG9pbnRzLlxyXG5cdCAqL1xyXG5cdGZ1bmN0aW9uIHVjczJkZWNvZGUoc3RyaW5nKSB7XHJcblx0XHR2YXIgb3V0cHV0ID0gW10sXHJcblx0XHQgICAgY291bnRlciA9IDAsXHJcblx0XHQgICAgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aCxcclxuXHRcdCAgICB2YWx1ZSxcclxuXHRcdCAgICBleHRyYTtcclxuXHRcdHdoaWxlIChjb3VudGVyIDwgbGVuZ3RoKSB7XHJcblx0XHRcdHZhbHVlID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcclxuXHRcdFx0aWYgKHZhbHVlID49IDB4RDgwMCAmJiB2YWx1ZSA8PSAweERCRkYgJiYgY291bnRlciA8IGxlbmd0aCkge1xyXG5cdFx0XHRcdC8vIGhpZ2ggc3Vycm9nYXRlLCBhbmQgdGhlcmUgaXMgYSBuZXh0IGNoYXJhY3RlclxyXG5cdFx0XHRcdGV4dHJhID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcclxuXHRcdFx0XHRpZiAoKGV4dHJhICYgMHhGQzAwKSA9PSAweERDMDApIHsgLy8gbG93IHN1cnJvZ2F0ZVxyXG5cdFx0XHRcdFx0b3V0cHV0LnB1c2goKCh2YWx1ZSAmIDB4M0ZGKSA8PCAxMCkgKyAoZXh0cmEgJiAweDNGRikgKyAweDEwMDAwKTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0Ly8gdW5tYXRjaGVkIHN1cnJvZ2F0ZTsgb25seSBhcHBlbmQgdGhpcyBjb2RlIHVuaXQsIGluIGNhc2UgdGhlIG5leHRcclxuXHRcdFx0XHRcdC8vIGNvZGUgdW5pdCBpcyB0aGUgaGlnaCBzdXJyb2dhdGUgb2YgYSBzdXJyb2dhdGUgcGFpclxyXG5cdFx0XHRcdFx0b3V0cHV0LnB1c2godmFsdWUpO1xyXG5cdFx0XHRcdFx0Y291bnRlci0tO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRvdXRwdXQucHVzaCh2YWx1ZSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBvdXRwdXQ7XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBDcmVhdGVzIGEgc3RyaW5nIGJhc2VkIG9uIGFuIGFycmF5IG9mIG51bWVyaWMgY29kZSBwb2ludHMuXHJcblx0ICogQHNlZSBgcHVueWNvZGUudWNzMi5kZWNvZGVgXHJcblx0ICogQG1lbWJlck9mIHB1bnljb2RlLnVjczJcclxuXHQgKiBAbmFtZSBlbmNvZGVcclxuXHQgKiBAcGFyYW0ge0FycmF5fSBjb2RlUG9pbnRzIFRoZSBhcnJheSBvZiBudW1lcmljIGNvZGUgcG9pbnRzLlxyXG5cdCAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBuZXcgVW5pY29kZSBzdHJpbmcgKFVDUy0yKS5cclxuXHQgKi9cclxuXHRmdW5jdGlvbiB1Y3MyZW5jb2RlKGFycmF5KSB7XHJcblx0XHRyZXR1cm4gbWFwKGFycmF5LCBmdW5jdGlvbih2YWx1ZSkge1xyXG5cdFx0XHR2YXIgb3V0cHV0ID0gJyc7XHJcblx0XHRcdGlmICh2YWx1ZSA+IDB4RkZGRikge1xyXG5cdFx0XHRcdHZhbHVlIC09IDB4MTAwMDA7XHJcblx0XHRcdFx0b3V0cHV0ICs9IHN0cmluZ0Zyb21DaGFyQ29kZSh2YWx1ZSA+Pj4gMTAgJiAweDNGRiB8IDB4RDgwMCk7XHJcblx0XHRcdFx0dmFsdWUgPSAweERDMDAgfCB2YWx1ZSAmIDB4M0ZGO1xyXG5cdFx0XHR9XHJcblx0XHRcdG91dHB1dCArPSBzdHJpbmdGcm9tQ2hhckNvZGUodmFsdWUpO1xyXG5cdFx0XHRyZXR1cm4gb3V0cHV0O1xyXG5cdFx0fSkuam9pbignJyk7XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBDb252ZXJ0cyBhIGJhc2ljIGNvZGUgcG9pbnQgaW50byBhIGRpZ2l0L2ludGVnZXIuXHJcblx0ICogQHNlZSBgZGlnaXRUb0Jhc2ljKClgXHJcblx0ICogQHByaXZhdGVcclxuXHQgKiBAcGFyYW0ge051bWJlcn0gY29kZVBvaW50IFRoZSBiYXNpYyBudW1lcmljIGNvZGUgcG9pbnQgdmFsdWUuXHJcblx0ICogQHJldHVybnMge051bWJlcn0gVGhlIG51bWVyaWMgdmFsdWUgb2YgYSBiYXNpYyBjb2RlIHBvaW50IChmb3IgdXNlIGluXHJcblx0ICogcmVwcmVzZW50aW5nIGludGVnZXJzKSBpbiB0aGUgcmFuZ2UgYDBgIHRvIGBiYXNlIC0gMWAsIG9yIGBiYXNlYCBpZlxyXG5cdCAqIHRoZSBjb2RlIHBvaW50IGRvZXMgbm90IHJlcHJlc2VudCBhIHZhbHVlLlxyXG5cdCAqL1xyXG5cdGZ1bmN0aW9uIGJhc2ljVG9EaWdpdChjb2RlUG9pbnQpIHtcclxuXHRcdGlmIChjb2RlUG9pbnQgLSA0OCA8IDEwKSB7XHJcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSAyMjtcclxuXHRcdH1cclxuXHRcdGlmIChjb2RlUG9pbnQgLSA2NSA8IDI2KSB7XHJcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSA2NTtcclxuXHRcdH1cclxuXHRcdGlmIChjb2RlUG9pbnQgLSA5NyA8IDI2KSB7XHJcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSA5NztcclxuXHRcdH1cclxuXHRcdHJldHVybiBiYXNlO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQ29udmVydHMgYSBkaWdpdC9pbnRlZ2VyIGludG8gYSBiYXNpYyBjb2RlIHBvaW50LlxyXG5cdCAqIEBzZWUgYGJhc2ljVG9EaWdpdCgpYFxyXG5cdCAqIEBwcml2YXRlXHJcblx0ICogQHBhcmFtIHtOdW1iZXJ9IGRpZ2l0IFRoZSBudW1lcmljIHZhbHVlIG9mIGEgYmFzaWMgY29kZSBwb2ludC5cclxuXHQgKiBAcmV0dXJucyB7TnVtYmVyfSBUaGUgYmFzaWMgY29kZSBwb2ludCB3aG9zZSB2YWx1ZSAod2hlbiB1c2VkIGZvclxyXG5cdCAqIHJlcHJlc2VudGluZyBpbnRlZ2VycykgaXMgYGRpZ2l0YCwgd2hpY2ggbmVlZHMgdG8gYmUgaW4gdGhlIHJhbmdlXHJcblx0ICogYDBgIHRvIGBiYXNlIC0gMWAuIElmIGBmbGFnYCBpcyBub24temVybywgdGhlIHVwcGVyY2FzZSBmb3JtIGlzXHJcblx0ICogdXNlZDsgZWxzZSwgdGhlIGxvd2VyY2FzZSBmb3JtIGlzIHVzZWQuIFRoZSBiZWhhdmlvciBpcyB1bmRlZmluZWRcclxuXHQgKiBpZiBgZmxhZ2AgaXMgbm9uLXplcm8gYW5kIGBkaWdpdGAgaGFzIG5vIHVwcGVyY2FzZSBmb3JtLlxyXG5cdCAqL1xyXG5cdGZ1bmN0aW9uIGRpZ2l0VG9CYXNpYyhkaWdpdCwgZmxhZykge1xyXG5cdFx0Ly8gIDAuLjI1IG1hcCB0byBBU0NJSSBhLi56IG9yIEEuLlpcclxuXHRcdC8vIDI2Li4zNSBtYXAgdG8gQVNDSUkgMC4uOVxyXG5cdFx0cmV0dXJuIGRpZ2l0ICsgMjIgKyA3NSAqIChkaWdpdCA8IDI2KSAtICgoZmxhZyAhPSAwKSA8PCA1KTtcclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIEJpYXMgYWRhcHRhdGlvbiBmdW5jdGlvbiBhcyBwZXIgc2VjdGlvbiAzLjQgb2YgUkZDIDM0OTIuXHJcblx0ICogaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM0OTIjc2VjdGlvbi0zLjRcclxuXHQgKiBAcHJpdmF0ZVxyXG5cdCAqL1xyXG5cdGZ1bmN0aW9uIGFkYXB0KGRlbHRhLCBudW1Qb2ludHMsIGZpcnN0VGltZSkge1xyXG5cdFx0dmFyIGsgPSAwO1xyXG5cdFx0ZGVsdGEgPSBmaXJzdFRpbWUgPyBmbG9vcihkZWx0YSAvIGRhbXApIDogZGVsdGEgPj4gMTtcclxuXHRcdGRlbHRhICs9IGZsb29yKGRlbHRhIC8gbnVtUG9pbnRzKTtcclxuXHRcdGZvciAoLyogbm8gaW5pdGlhbGl6YXRpb24gKi87IGRlbHRhID4gYmFzZU1pbnVzVE1pbiAqIHRNYXggPj4gMTsgayArPSBiYXNlKSB7XHJcblx0XHRcdGRlbHRhID0gZmxvb3IoZGVsdGEgLyBiYXNlTWludXNUTWluKTtcclxuXHRcdH1cclxuXHRcdHJldHVybiBmbG9vcihrICsgKGJhc2VNaW51c1RNaW4gKyAxKSAqIGRlbHRhIC8gKGRlbHRhICsgc2tldykpO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQ29udmVydHMgYSBQdW55Y29kZSBzdHJpbmcgb2YgQVNDSUktb25seSBzeW1ib2xzIHRvIGEgc3RyaW5nIG9mIFVuaWNvZGVcclxuXHQgKiBzeW1ib2xzLlxyXG5cdCAqIEBtZW1iZXJPZiBwdW55Y29kZVxyXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scy5cclxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgcmVzdWx0aW5nIHN0cmluZyBvZiBVbmljb2RlIHN5bWJvbHMuXHJcblx0ICovXHJcblx0ZnVuY3Rpb24gZGVjb2RlKGlucHV0KSB7XHJcblx0XHQvLyBEb24ndCB1c2UgVUNTLTJcclxuXHRcdHZhciBvdXRwdXQgPSBbXSxcclxuXHRcdCAgICBpbnB1dExlbmd0aCA9IGlucHV0Lmxlbmd0aCxcclxuXHRcdCAgICBvdXQsXHJcblx0XHQgICAgaSA9IDAsXHJcblx0XHQgICAgbiA9IGluaXRpYWxOLFxyXG5cdFx0ICAgIGJpYXMgPSBpbml0aWFsQmlhcyxcclxuXHRcdCAgICBiYXNpYyxcclxuXHRcdCAgICBqLFxyXG5cdFx0ICAgIGluZGV4LFxyXG5cdFx0ICAgIG9sZGksXHJcblx0XHQgICAgdyxcclxuXHRcdCAgICBrLFxyXG5cdFx0ICAgIGRpZ2l0LFxyXG5cdFx0ICAgIHQsXHJcblx0XHQgICAgLyoqIENhY2hlZCBjYWxjdWxhdGlvbiByZXN1bHRzICovXHJcblx0XHQgICAgYmFzZU1pbnVzVDtcclxuXHJcblx0XHQvLyBIYW5kbGUgdGhlIGJhc2ljIGNvZGUgcG9pbnRzOiBsZXQgYGJhc2ljYCBiZSB0aGUgbnVtYmVyIG9mIGlucHV0IGNvZGVcclxuXHRcdC8vIHBvaW50cyBiZWZvcmUgdGhlIGxhc3QgZGVsaW1pdGVyLCBvciBgMGAgaWYgdGhlcmUgaXMgbm9uZSwgdGhlbiBjb3B5XHJcblx0XHQvLyB0aGUgZmlyc3QgYmFzaWMgY29kZSBwb2ludHMgdG8gdGhlIG91dHB1dC5cclxuXHJcblx0XHRiYXNpYyA9IGlucHV0Lmxhc3RJbmRleE9mKGRlbGltaXRlcik7XHJcblx0XHRpZiAoYmFzaWMgPCAwKSB7XHJcblx0XHRcdGJhc2ljID0gMDtcclxuXHRcdH1cclxuXHJcblx0XHRmb3IgKGogPSAwOyBqIDwgYmFzaWM7ICsraikge1xyXG5cdFx0XHQvLyBpZiBpdCdzIG5vdCBhIGJhc2ljIGNvZGUgcG9pbnRcclxuXHRcdFx0aWYgKGlucHV0LmNoYXJDb2RlQXQoaikgPj0gMHg4MCkge1xyXG5cdFx0XHRcdGVycm9yKCdub3QtYmFzaWMnKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRvdXRwdXQucHVzaChpbnB1dC5jaGFyQ29kZUF0KGopKTtcclxuXHRcdH1cclxuXHJcblx0XHQvLyBNYWluIGRlY29kaW5nIGxvb3A6IHN0YXJ0IGp1c3QgYWZ0ZXIgdGhlIGxhc3QgZGVsaW1pdGVyIGlmIGFueSBiYXNpYyBjb2RlXHJcblx0XHQvLyBwb2ludHMgd2VyZSBjb3BpZWQ7IHN0YXJ0IGF0IHRoZSBiZWdpbm5pbmcgb3RoZXJ3aXNlLlxyXG5cclxuXHRcdGZvciAoaW5kZXggPSBiYXNpYyA+IDAgPyBiYXNpYyArIDEgOiAwOyBpbmRleCA8IGlucHV0TGVuZ3RoOyAvKiBubyBmaW5hbCBleHByZXNzaW9uICovKSB7XHJcblxyXG5cdFx0XHQvLyBgaW5kZXhgIGlzIHRoZSBpbmRleCBvZiB0aGUgbmV4dCBjaGFyYWN0ZXIgdG8gYmUgY29uc3VtZWQuXHJcblx0XHRcdC8vIERlY29kZSBhIGdlbmVyYWxpemVkIHZhcmlhYmxlLWxlbmd0aCBpbnRlZ2VyIGludG8gYGRlbHRhYCxcclxuXHRcdFx0Ly8gd2hpY2ggZ2V0cyBhZGRlZCB0byBgaWAuIFRoZSBvdmVyZmxvdyBjaGVja2luZyBpcyBlYXNpZXJcclxuXHRcdFx0Ly8gaWYgd2UgaW5jcmVhc2UgYGlgIGFzIHdlIGdvLCB0aGVuIHN1YnRyYWN0IG9mZiBpdHMgc3RhcnRpbmdcclxuXHRcdFx0Ly8gdmFsdWUgYXQgdGhlIGVuZCB0byBvYnRhaW4gYGRlbHRhYC5cclxuXHRcdFx0Zm9yIChvbGRpID0gaSwgdyA9IDEsIGsgPSBiYXNlOyAvKiBubyBjb25kaXRpb24gKi87IGsgKz0gYmFzZSkge1xyXG5cclxuXHRcdFx0XHRpZiAoaW5kZXggPj0gaW5wdXRMZW5ndGgpIHtcclxuXHRcdFx0XHRcdGVycm9yKCdpbnZhbGlkLWlucHV0Jyk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRkaWdpdCA9IGJhc2ljVG9EaWdpdChpbnB1dC5jaGFyQ29kZUF0KGluZGV4KyspKTtcclxuXHJcblx0XHRcdFx0aWYgKGRpZ2l0ID49IGJhc2UgfHwgZGlnaXQgPiBmbG9vcigobWF4SW50IC0gaSkgLyB3KSkge1xyXG5cdFx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRpICs9IGRpZ2l0ICogdztcclxuXHRcdFx0XHR0ID0gayA8PSBiaWFzID8gdE1pbiA6IChrID49IGJpYXMgKyB0TWF4ID8gdE1heCA6IGsgLSBiaWFzKTtcclxuXHJcblx0XHRcdFx0aWYgKGRpZ2l0IDwgdCkge1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRiYXNlTWludXNUID0gYmFzZSAtIHQ7XHJcblx0XHRcdFx0aWYgKHcgPiBmbG9vcihtYXhJbnQgLyBiYXNlTWludXNUKSkge1xyXG5cdFx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHR3ICo9IGJhc2VNaW51c1Q7XHJcblxyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRvdXQgPSBvdXRwdXQubGVuZ3RoICsgMTtcclxuXHRcdFx0YmlhcyA9IGFkYXB0KGkgLSBvbGRpLCBvdXQsIG9sZGkgPT0gMCk7XHJcblxyXG5cdFx0XHQvLyBgaWAgd2FzIHN1cHBvc2VkIHRvIHdyYXAgYXJvdW5kIGZyb20gYG91dGAgdG8gYDBgLFxyXG5cdFx0XHQvLyBpbmNyZW1lbnRpbmcgYG5gIGVhY2ggdGltZSwgc28gd2UnbGwgZml4IHRoYXQgbm93OlxyXG5cdFx0XHRpZiAoZmxvb3IoaSAvIG91dCkgPiBtYXhJbnQgLSBuKSB7XHJcblx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdG4gKz0gZmxvb3IoaSAvIG91dCk7XHJcblx0XHRcdGkgJT0gb3V0O1xyXG5cclxuXHRcdFx0Ly8gSW5zZXJ0IGBuYCBhdCBwb3NpdGlvbiBgaWAgb2YgdGhlIG91dHB1dFxyXG5cdFx0XHRvdXRwdXQuc3BsaWNlKGkrKywgMCwgbik7XHJcblxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiB1Y3MyZW5jb2RlKG91dHB1dCk7XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBDb252ZXJ0cyBhIHN0cmluZyBvZiBVbmljb2RlIHN5bWJvbHMgKGUuZy4gYSBkb21haW4gbmFtZSBsYWJlbCkgdG8gYVxyXG5cdCAqIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMuXHJcblx0ICogQG1lbWJlck9mIHB1bnljb2RlXHJcblx0ICogQHBhcmFtIHtTdHJpbmd9IGlucHV0IFRoZSBzdHJpbmcgb2YgVW5pY29kZSBzeW1ib2xzLlxyXG5cdCAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSByZXN1bHRpbmcgUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scy5cclxuXHQgKi9cclxuXHRmdW5jdGlvbiBlbmNvZGUoaW5wdXQpIHtcclxuXHRcdHZhciBuLFxyXG5cdFx0ICAgIGRlbHRhLFxyXG5cdFx0ICAgIGhhbmRsZWRDUENvdW50LFxyXG5cdFx0ICAgIGJhc2ljTGVuZ3RoLFxyXG5cdFx0ICAgIGJpYXMsXHJcblx0XHQgICAgaixcclxuXHRcdCAgICBtLFxyXG5cdFx0ICAgIHEsXHJcblx0XHQgICAgayxcclxuXHRcdCAgICB0LFxyXG5cdFx0ICAgIGN1cnJlbnRWYWx1ZSxcclxuXHRcdCAgICBvdXRwdXQgPSBbXSxcclxuXHRcdCAgICAvKiogYGlucHV0TGVuZ3RoYCB3aWxsIGhvbGQgdGhlIG51bWJlciBvZiBjb2RlIHBvaW50cyBpbiBgaW5wdXRgLiAqL1xyXG5cdFx0ICAgIGlucHV0TGVuZ3RoLFxyXG5cdFx0ICAgIC8qKiBDYWNoZWQgY2FsY3VsYXRpb24gcmVzdWx0cyAqL1xyXG5cdFx0ICAgIGhhbmRsZWRDUENvdW50UGx1c09uZSxcclxuXHRcdCAgICBiYXNlTWludXNULFxyXG5cdFx0ICAgIHFNaW51c1Q7XHJcblxyXG5cdFx0Ly8gQ29udmVydCB0aGUgaW5wdXQgaW4gVUNTLTIgdG8gVW5pY29kZVxyXG5cdFx0aW5wdXQgPSB1Y3MyZGVjb2RlKGlucHV0KTtcclxuXHJcblx0XHQvLyBDYWNoZSB0aGUgbGVuZ3RoXHJcblx0XHRpbnB1dExlbmd0aCA9IGlucHV0Lmxlbmd0aDtcclxuXHJcblx0XHQvLyBJbml0aWFsaXplIHRoZSBzdGF0ZVxyXG5cdFx0biA9IGluaXRpYWxOO1xyXG5cdFx0ZGVsdGEgPSAwO1xyXG5cdFx0YmlhcyA9IGluaXRpYWxCaWFzO1xyXG5cclxuXHRcdC8vIEhhbmRsZSB0aGUgYmFzaWMgY29kZSBwb2ludHNcclxuXHRcdGZvciAoaiA9IDA7IGogPCBpbnB1dExlbmd0aDsgKytqKSB7XHJcblx0XHRcdGN1cnJlbnRWYWx1ZSA9IGlucHV0W2pdO1xyXG5cdFx0XHRpZiAoY3VycmVudFZhbHVlIDwgMHg4MCkge1xyXG5cdFx0XHRcdG91dHB1dC5wdXNoKHN0cmluZ0Zyb21DaGFyQ29kZShjdXJyZW50VmFsdWUpKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdGhhbmRsZWRDUENvdW50ID0gYmFzaWNMZW5ndGggPSBvdXRwdXQubGVuZ3RoO1xyXG5cclxuXHRcdC8vIGBoYW5kbGVkQ1BDb3VudGAgaXMgdGhlIG51bWJlciBvZiBjb2RlIHBvaW50cyB0aGF0IGhhdmUgYmVlbiBoYW5kbGVkO1xyXG5cdFx0Ly8gYGJhc2ljTGVuZ3RoYCBpcyB0aGUgbnVtYmVyIG9mIGJhc2ljIGNvZGUgcG9pbnRzLlxyXG5cclxuXHRcdC8vIEZpbmlzaCB0aGUgYmFzaWMgc3RyaW5nIC0gaWYgaXQgaXMgbm90IGVtcHR5IC0gd2l0aCBhIGRlbGltaXRlclxyXG5cdFx0aWYgKGJhc2ljTGVuZ3RoKSB7XHJcblx0XHRcdG91dHB1dC5wdXNoKGRlbGltaXRlcik7XHJcblx0XHR9XHJcblxyXG5cdFx0Ly8gTWFpbiBlbmNvZGluZyBsb29wOlxyXG5cdFx0d2hpbGUgKGhhbmRsZWRDUENvdW50IDwgaW5wdXRMZW5ndGgpIHtcclxuXHJcblx0XHRcdC8vIEFsbCBub24tYmFzaWMgY29kZSBwb2ludHMgPCBuIGhhdmUgYmVlbiBoYW5kbGVkIGFscmVhZHkuIEZpbmQgdGhlIG5leHRcclxuXHRcdFx0Ly8gbGFyZ2VyIG9uZTpcclxuXHRcdFx0Zm9yIChtID0gbWF4SW50LCBqID0gMDsgaiA8IGlucHV0TGVuZ3RoOyArK2opIHtcclxuXHRcdFx0XHRjdXJyZW50VmFsdWUgPSBpbnB1dFtqXTtcclxuXHRcdFx0XHRpZiAoY3VycmVudFZhbHVlID49IG4gJiYgY3VycmVudFZhbHVlIDwgbSkge1xyXG5cdFx0XHRcdFx0bSA9IGN1cnJlbnRWYWx1ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIEluY3JlYXNlIGBkZWx0YWAgZW5vdWdoIHRvIGFkdmFuY2UgdGhlIGRlY29kZXIncyA8bixpPiBzdGF0ZSB0byA8bSwwPixcclxuXHRcdFx0Ly8gYnV0IGd1YXJkIGFnYWluc3Qgb3ZlcmZsb3dcclxuXHRcdFx0aGFuZGxlZENQQ291bnRQbHVzT25lID0gaGFuZGxlZENQQ291bnQgKyAxO1xyXG5cdFx0XHRpZiAobSAtIG4gPiBmbG9vcigobWF4SW50IC0gZGVsdGEpIC8gaGFuZGxlZENQQ291bnRQbHVzT25lKSkge1xyXG5cdFx0XHRcdGVycm9yKCdvdmVyZmxvdycpO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRkZWx0YSArPSAobSAtIG4pICogaGFuZGxlZENQQ291bnRQbHVzT25lO1xyXG5cdFx0XHRuID0gbTtcclxuXHJcblx0XHRcdGZvciAoaiA9IDA7IGogPCBpbnB1dExlbmd0aDsgKytqKSB7XHJcblx0XHRcdFx0Y3VycmVudFZhbHVlID0gaW5wdXRbal07XHJcblxyXG5cdFx0XHRcdGlmIChjdXJyZW50VmFsdWUgPCBuICYmICsrZGVsdGEgPiBtYXhJbnQpIHtcclxuXHRcdFx0XHRcdGVycm9yKCdvdmVyZmxvdycpO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0aWYgKGN1cnJlbnRWYWx1ZSA9PSBuKSB7XHJcblx0XHRcdFx0XHQvLyBSZXByZXNlbnQgZGVsdGEgYXMgYSBnZW5lcmFsaXplZCB2YXJpYWJsZS1sZW5ndGggaW50ZWdlclxyXG5cdFx0XHRcdFx0Zm9yIChxID0gZGVsdGEsIGsgPSBiYXNlOyAvKiBubyBjb25kaXRpb24gKi87IGsgKz0gYmFzZSkge1xyXG5cdFx0XHRcdFx0XHR0ID0gayA8PSBiaWFzID8gdE1pbiA6IChrID49IGJpYXMgKyB0TWF4ID8gdE1heCA6IGsgLSBiaWFzKTtcclxuXHRcdFx0XHRcdFx0aWYgKHEgPCB0KSB7XHJcblx0XHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0cU1pbnVzVCA9IHEgLSB0O1xyXG5cdFx0XHRcdFx0XHRiYXNlTWludXNUID0gYmFzZSAtIHQ7XHJcblx0XHRcdFx0XHRcdG91dHB1dC5wdXNoKFxyXG5cdFx0XHRcdFx0XHRcdHN0cmluZ0Zyb21DaGFyQ29kZShkaWdpdFRvQmFzaWModCArIHFNaW51c1QgJSBiYXNlTWludXNULCAwKSlcclxuXHRcdFx0XHRcdFx0KTtcclxuXHRcdFx0XHRcdFx0cSA9IGZsb29yKHFNaW51c1QgLyBiYXNlTWludXNUKTtcclxuXHRcdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0XHRvdXRwdXQucHVzaChzdHJpbmdGcm9tQ2hhckNvZGUoZGlnaXRUb0Jhc2ljKHEsIDApKSk7XHJcblx0XHRcdFx0XHRiaWFzID0gYWRhcHQoZGVsdGEsIGhhbmRsZWRDUENvdW50UGx1c09uZSwgaGFuZGxlZENQQ291bnQgPT0gYmFzaWNMZW5ndGgpO1xyXG5cdFx0XHRcdFx0ZGVsdGEgPSAwO1xyXG5cdFx0XHRcdFx0KytoYW5kbGVkQ1BDb3VudDtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdCsrZGVsdGE7XHJcblx0XHRcdCsrbjtcclxuXHJcblx0XHR9XHJcblx0XHRyZXR1cm4gb3V0cHV0LmpvaW4oJycpO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQ29udmVydHMgYSBQdW55Y29kZSBzdHJpbmcgcmVwcmVzZW50aW5nIGEgZG9tYWluIG5hbWUgb3IgYW4gZW1haWwgYWRkcmVzc1xyXG5cdCAqIHRvIFVuaWNvZGUuIE9ubHkgdGhlIFB1bnljb2RlZCBwYXJ0cyBvZiB0aGUgaW5wdXQgd2lsbCBiZSBjb252ZXJ0ZWQsIGkuZS5cclxuXHQgKiBpdCBkb2Vzbid0IG1hdHRlciBpZiB5b3UgY2FsbCBpdCBvbiBhIHN0cmluZyB0aGF0IGhhcyBhbHJlYWR5IGJlZW5cclxuXHQgKiBjb252ZXJ0ZWQgdG8gVW5pY29kZS5cclxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGVcclxuXHQgKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIFB1bnljb2RlZCBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzIHRvXHJcblx0ICogY29udmVydCB0byBVbmljb2RlLlxyXG5cdCAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBVbmljb2RlIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBnaXZlbiBQdW55Y29kZVxyXG5cdCAqIHN0cmluZy5cclxuXHQgKi9cclxuXHRmdW5jdGlvbiB0b1VuaWNvZGUoaW5wdXQpIHtcclxuXHRcdHJldHVybiBtYXBEb21haW4oaW5wdXQsIGZ1bmN0aW9uKHN0cmluZykge1xyXG5cdFx0XHRyZXR1cm4gcmVnZXhQdW55Y29kZS50ZXN0KHN0cmluZylcclxuXHRcdFx0XHQ/IGRlY29kZShzdHJpbmcuc2xpY2UoNCkudG9Mb3dlckNhc2UoKSlcclxuXHRcdFx0XHQ6IHN0cmluZztcclxuXHRcdH0pO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQ29udmVydHMgYSBVbmljb2RlIHN0cmluZyByZXByZXNlbnRpbmcgYSBkb21haW4gbmFtZSBvciBhbiBlbWFpbCBhZGRyZXNzIHRvXHJcblx0ICogUHVueWNvZGUuIE9ubHkgdGhlIG5vbi1BU0NJSSBwYXJ0cyBvZiB0aGUgZG9tYWluIG5hbWUgd2lsbCBiZSBjb252ZXJ0ZWQsXHJcblx0ICogaS5lLiBpdCBkb2Vzbid0IG1hdHRlciBpZiB5b3UgY2FsbCBpdCB3aXRoIGEgZG9tYWluIHRoYXQncyBhbHJlYWR5IGluXHJcblx0ICogQVNDSUkuXHJcblx0ICogQG1lbWJlck9mIHB1bnljb2RlXHJcblx0ICogQHBhcmFtIHtTdHJpbmd9IGlucHV0IFRoZSBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzIHRvIGNvbnZlcnQsIGFzIGFcclxuXHQgKiBVbmljb2RlIHN0cmluZy5cclxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgUHVueWNvZGUgcmVwcmVzZW50YXRpb24gb2YgdGhlIGdpdmVuIGRvbWFpbiBuYW1lIG9yXHJcblx0ICogZW1haWwgYWRkcmVzcy5cclxuXHQgKi9cclxuXHRmdW5jdGlvbiB0b0FTQ0lJKGlucHV0KSB7XHJcblx0XHRyZXR1cm4gbWFwRG9tYWluKGlucHV0LCBmdW5jdGlvbihzdHJpbmcpIHtcclxuXHRcdFx0cmV0dXJuIHJlZ2V4Tm9uQVNDSUkudGVzdChzdHJpbmcpXHJcblx0XHRcdFx0PyAneG4tLScgKyBlbmNvZGUoc3RyaW5nKVxyXG5cdFx0XHRcdDogc3RyaW5nO1xyXG5cdFx0fSk7XHJcblx0fVxyXG5cclxuXHQvKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cclxuXHJcblx0LyoqIERlZmluZSB0aGUgcHVibGljIEFQSSAqL1xyXG5cdHB1bnljb2RlID0ge1xyXG5cdFx0LyoqXHJcblx0XHQgKiBBIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIGN1cnJlbnQgUHVueWNvZGUuanMgdmVyc2lvbiBudW1iZXIuXHJcblx0XHQgKiBAbWVtYmVyT2YgcHVueWNvZGVcclxuXHRcdCAqIEB0eXBlIFN0cmluZ1xyXG5cdFx0ICovXHJcblx0XHR2ZXJzaW9uOiAnMS4zLjInLFxyXG5cdFx0LyoqXHJcblx0XHQgKiBBbiBvYmplY3Qgb2YgbWV0aG9kcyB0byBjb252ZXJ0IGZyb20gSmF2YVNjcmlwdCdzIGludGVybmFsIGNoYXJhY3RlclxyXG5cdFx0ICogcmVwcmVzZW50YXRpb24gKFVDUy0yKSB0byBVbmljb2RlIGNvZGUgcG9pbnRzLCBhbmQgYmFjay5cclxuXHRcdCAqIEBzZWUgPGh0dHBzOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LWVuY29kaW5nPlxyXG5cdFx0ICogQG1lbWJlck9mIHB1bnljb2RlXHJcblx0XHQgKiBAdHlwZSBPYmplY3RcclxuXHRcdCAqL1xyXG5cdFx0dWNzMjoge1xyXG5cdFx0XHRkZWNvZGU6IHVjczJkZWNvZGUsXHJcblx0XHRcdGVuY29kZTogdWNzMmVuY29kZVxyXG5cdFx0fSxcclxuXHRcdGRlY29kZTogZGVjb2RlLFxyXG5cdFx0ZW5jb2RlOiBlbmNvZGUsXHJcblx0XHR0b0FTQ0lJOiB0b0FTQ0lJLFxyXG5cdFx0dG9Vbmljb2RlOiB0b1VuaWNvZGVcclxuXHR9O1xyXG5cclxuXHRyZXR1cm4gcHVueWNvZGU7XHJcbn0oKSk7XHJcblxyXG5pZiAodHlwZW9mIENPTVBJTEVEID09PSBcInVuZGVmaW5lZFwiICYmIHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIG1vZHVsZS5leHBvcnRzID0gcHVueWNvZGU7IiwiLy8vPHJlZmVyZW5jZSBwYXRoPVwiY29tbW9uanMuZC50c1wiLz5cclxucmVxdWlyZShcIi4vc2NoZW1lcy9odHRwXCIpO1xyXG5yZXF1aXJlKFwiLi9zY2hlbWVzL3VyblwiKTtcclxucmVxdWlyZShcIi4vc2NoZW1lcy9tYWlsdG9cIik7XHJcbiIsIi8vLzxyZWZlcmVuY2UgcGF0aD1cIi4uL3VyaS50c1wiLz5cclxuaWYgKHR5cGVvZiBDT01QSUxFRCA9PT0gXCJ1bmRlZmluZWRcIiAmJiB0eXBlb2YgVVJJID09PSBcInVuZGVmaW5lZFwiICYmIHR5cGVvZiByZXF1aXJlID09PSBcImZ1bmN0aW9uXCIpXHJcbiAgICB2YXIgVVJJID0gcmVxdWlyZShcIi4uL3VyaVwiKTtcclxuVVJJLlNDSEVNRVNbXCJodHRwXCJdID0gVVJJLlNDSEVNRVNbXCJodHRwc1wiXSA9IHtcclxuICAgIGRvbWFpbkhvc3Q6IHRydWUsXHJcbiAgICBwYXJzZTogZnVuY3Rpb24gKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcclxuICAgICAgICAvL3JlcG9ydCBtaXNzaW5nIGhvc3RcclxuICAgICAgICBpZiAoIWNvbXBvbmVudHMuaG9zdCkge1xyXG4gICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIkhUVFAgVVJJcyBtdXN0IGhhdmUgYSBob3N0LlwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcclxuICAgIH0sXHJcbiAgICBzZXJpYWxpemU6IGZ1bmN0aW9uIChjb21wb25lbnRzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgLy9ub3JtYWxpemUgdGhlIGRlZmF1bHQgcG9ydFxyXG4gICAgICAgIGlmIChjb21wb25lbnRzLnBvcnQgPT09IChTdHJpbmcoY29tcG9uZW50cy5zY2hlbWUpLnRvTG93ZXJDYXNlKCkgIT09IFwiaHR0cHNcIiA/IDgwIDogNDQzKSB8fCBjb21wb25lbnRzLnBvcnQgPT09IFwiXCIpIHtcclxuICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gdW5kZWZpbmVkO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvL25vcm1hbGl6ZSB0aGUgZW1wdHkgcGF0aFxyXG4gICAgICAgIGlmICghY29tcG9uZW50cy5wYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbXBvbmVudHMucGF0aCA9IFwiL1wiO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvL05PVEU6IFdlIGRvIG5vdCBwYXJzZSBxdWVyeSBzdHJpbmdzIGZvciBIVFRQIFVSSXNcclxuICAgICAgICAvL2FzIFdXVyBGb3JtIFVybCBFbmNvZGVkIHF1ZXJ5IHN0cmluZ3MgYXJlIHBhcnQgb2YgdGhlIEhUTUw0KyBzcGVjLFxyXG4gICAgICAgIC8vYW5kIG5vdCB0aGUgSFRUUCBzcGVjLiBcclxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcclxuICAgIH1cclxufTtcclxuIiwiLy8vPHJlZmVyZW5jZSBwYXRoPVwiLi4vdXJpLnRzXCIvPlxyXG5pZiAodHlwZW9mIENPTVBJTEVEID09PSBcInVuZGVmaW5lZFwiICYmIHR5cGVvZiBVUkkgPT09IFwidW5kZWZpbmVkXCIgJiYgdHlwZW9mIHJlcXVpcmUgPT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgdmFyIFVSSSA9IHJlcXVpcmUoXCIuLi91cmlcIiksIHB1bnljb2RlID0gcmVxdWlyZShcIi4uL3B1bnljb2RlXCIpO1xyXG59XHJcbihmdW5jdGlvbiAoKSB7XHJcbiAgICBmdW5jdGlvbiBtZXJnZSgpIHtcclxuICAgICAgICB2YXIgc2V0cyA9IFtdO1xyXG4gICAgICAgIGZvciAodmFyIF9pID0gMDsgX2kgPCBhcmd1bWVudHMubGVuZ3RoOyBfaSsrKSB7XHJcbiAgICAgICAgICAgIHNldHNbX2kgLSAwXSA9IGFyZ3VtZW50c1tfaV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChzZXRzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAgICAgc2V0c1swXSA9IHNldHNbMF0uc2xpY2UoMCwgLTEpO1xyXG4gICAgICAgICAgICB2YXIgeGwgPSBzZXRzLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAxOyB4IDwgeGw7ICsreCkge1xyXG4gICAgICAgICAgICAgICAgc2V0c1t4XSA9IHNldHNbeF0uc2xpY2UoMSwgLTEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHNldHNbeGxdID0gc2V0c1t4bF0uc2xpY2UoMSk7XHJcbiAgICAgICAgICAgIHJldHVybiBzZXRzLmpvaW4oJycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgcmV0dXJuIHNldHNbMF07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgZnVuY3Rpb24gc3ViZXhwKHN0cikge1xyXG4gICAgICAgIHJldHVybiBcIig/OlwiICsgc3RyICsgXCIpXCI7XHJcbiAgICB9XHJcbiAgICB2YXIgTyA9IHt9LCBpc0lSSSA9IFVSSS5JUklfU1VQUE9SVCwgXHJcbiAgICAvL1JGQyAzOTg2XHJcbiAgICBVTlJFU0VSVkVEJCQgPSBcIltBLVphLXowLTlcXFxcLVxcXFwuXFxcXF9cXFxcflwiICsgKGlzSVJJID8gXCJcXFxceEEwLVxcXFx1MjAwRFxcXFx1MjAxMC1cXFxcdTIwMjlcXFxcdTIwMkYtXFxcXHVEN0ZGXFxcXHVGOTAwLVxcXFx1RkRDRlxcXFx1RkRGMC1cXFxcdUZGRUZcIiA6IFwiXCIpICsgXCJdXCIsIEhFWERJRyQkID0gXCJbMC05QS1GYS1mXVwiLCBQQ1RfRU5DT0RFRCQgPSBzdWJleHAoc3ViZXhwKFwiJVtFRmVmXVwiICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIlWzg5QS1GYS1mXVwiICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIlXCIgKyBIRVhESUckJCArIEhFWERJRyQkKSksIFxyXG4gICAgLy9SRkMgNTMyMiwgZXhjZXB0IHRoZXNlIHN5bWJvbHMgYXMgcGVyIFJGQyA2MDY4OiBAIDogLyA/ICMgWyBdICYgOyA9IFxyXG4gICAgLy9BVEVYVCQkID0gXCJbQS1aYS16MC05XFxcXCFcXFxcI1xcXFwkXFxcXCVcXFxcJlxcXFwnXFxcXCpcXFxcK1xcXFwtXFxcXC9cXFxcPVxcXFw/XFxcXF5cXFxcX1xcXFxgXFxcXHtcXFxcfFxcXFx9XFxcXH5dXCIsXHJcbiAgICAvL1dTUCQkID0gXCJbXFxcXHgyMFxcXFx4MDldXCIsXHJcbiAgICAvL09CU19RVEVYVCQkID0gXCJbXFxcXHgwMS1cXFxceDA4XFxcXHgwQlxcXFx4MENcXFxceDBFLVxcXFx4MUZcXFxceDdGXVwiLCAgLy8oJWQxLTggLyAlZDExLTEyIC8gJWQxNC0zMSAvICVkMTI3KVxyXG4gICAgLy9RVEVYVCQkID0gbWVyZ2UoXCJbXFxcXHgyMVxcXFx4MjMtXFxcXHg1QlxcXFx4NUQtXFxcXHg3RV1cIiwgT0JTX1FURVhUJCQpLCAgLy8lZDMzIC8gJWQzNS05MSAvICVkOTMtMTI2IC8gb2JzLXF0ZXh0XHJcbiAgICAvL1ZDSEFSJCQgPSBcIltcXFxceDIxLVxcXFx4N0VdXCIsXHJcbiAgICAvL1dTUCQkID0gXCJbXFxcXHgyMFxcXFx4MDldXCIsXHJcbiAgICAvL09CU19RUCQgPSBzdWJleHAoXCJcXFxcXFxcXFwiICsgbWVyZ2UoXCJbXFxcXHgwMFxcXFx4MERcXFxceDBBXVwiLCBPQlNfUVRFWFQkJCkpLCAgLy8lZDAgLyBDUiAvIExGIC8gb2JzLXF0ZXh0XHJcbiAgICAvL0ZXUyQgPSBzdWJleHAoc3ViZXhwKFdTUCQkICsgXCIqXCIgKyBcIlxcXFx4MERcXFxceDBBXCIpICsgXCI/XCIgKyBXU1AkJCArIFwiK1wiKSxcclxuICAgIC8vUVVPVEVEX1BBSVIkID0gc3ViZXhwKHN1YmV4cChcIlxcXFxcXFxcXCIgKyBzdWJleHAoVkNIQVIkJCArIFwifFwiICsgV1NQJCQpKSArIFwifFwiICsgT0JTX1FQJCksXHJcbiAgICAvL1FVT1RFRF9TVFJJTkckID0gc3ViZXhwKCdcXFxcXCInICsgc3ViZXhwKEZXUyQgKyBcIj9cIiArIFFDT05URU5UJCkgKyBcIipcIiArIEZXUyQgKyBcIj9cIiArICdcXFxcXCInKSxcclxuICAgIEFURVhUJCQgPSBcIltBLVphLXowLTlcXFxcIVxcXFwkXFxcXCVcXFxcJ1xcXFwqXFxcXCtcXFxcLVxcXFxeXFxcXF9cXFxcYFxcXFx7XFxcXHxcXFxcfVxcXFx+XVwiLCBRVEVYVCQkID0gXCJbXFxcXCFcXFxcJFxcXFwlXFxcXCdcXFxcKFxcXFwpXFxcXCpcXFxcK1xcXFwsXFxcXC1cXFxcLjAtOVxcXFw8XFxcXD5BLVpcXFxceDVFLVxcXFx4N0VdXCIsIFZDSEFSJCQgPSBtZXJnZShRVEVYVCQkLCBcIltcXFxcXFxcIlxcXFxcXFxcXVwiKSwgRE9UX0FUT01fVEVYVCQgPSBzdWJleHAoQVRFWFQkJCArIFwiK1wiICsgc3ViZXhwKFwiXFxcXC5cIiArIEFURVhUJCQgKyBcIitcIikgKyBcIipcIiksIFFVT1RFRF9QQUlSJCA9IHN1YmV4cChcIlxcXFxcXFxcXCIgKyBWQ0hBUiQkKSwgUUNPTlRFTlQkID0gc3ViZXhwKFFURVhUJCQgKyBcInxcIiArIFFVT1RFRF9QQUlSJCksIFFVT1RFRF9TVFJJTkckID0gc3ViZXhwKCdcXFxcXCInICsgUUNPTlRFTlQkICsgXCIqXCIgKyAnXFxcXFwiJyksIFxyXG4gICAgLy9SRkMgNjA2OFxyXG4gICAgRFRFWFRfTk9fT0JTJCQgPSBcIltcXFxceDIxLVxcXFx4NUFcXFxceDVFLVxcXFx4N0VdXCIsIFNPTUVfREVMSU1TJCQgPSBcIltcXFxcIVxcXFwkXFxcXCdcXFxcKFxcXFwpXFxcXCpcXFxcK1xcXFwsXFxcXDtcXFxcOlxcXFxAXVwiLCBRQ0hBUiQgPSBzdWJleHAoVU5SRVNFUlZFRCQkICsgXCJ8XCIgKyBQQ1RfRU5DT0RFRCQgKyBcInxcIiArIFNPTUVfREVMSU1TJCQpLCBET01BSU4kID0gc3ViZXhwKERPVF9BVE9NX1RFWFQkICsgXCJ8XCIgKyBcIlxcXFxbXCIgKyBEVEVYVF9OT19PQlMkJCArIFwiKlwiICsgXCJcXFxcXVwiKSwgTE9DQUxfUEFSVCQgPSBzdWJleHAoRE9UX0FUT01fVEVYVCQgKyBcInxcIiArIFFVT1RFRF9TVFJJTkckKSwgQUREUl9TUEVDJCA9IHN1YmV4cChMT0NBTF9QQVJUJCArIFwiXFxcXEBcIiArIERPTUFJTiQpLCBUTyQgPSBzdWJleHAoQUREUl9TUEVDJCArIHN1YmV4cChcIlxcXFwsXCIgKyBBRERSX1NQRUMkKSArIFwiKlwiKSwgSEZOQU1FJCA9IHN1YmV4cChRQ0hBUiQgKyBcIipcIiksIEhGVkFMVUUkID0gSEZOQU1FJCwgSEZJRUxEJCA9IHN1YmV4cChIRk5BTUUkICsgXCJcXFxcPVwiICsgSEZWQUxVRSQpLCBIRklFTERTMiQgPSBzdWJleHAoSEZJRUxEJCArIHN1YmV4cChcIlxcXFwmXCIgKyBIRklFTEQkKSArIFwiKlwiKSwgSEZJRUxEUyQgPSBzdWJleHAoXCJcXFxcP1wiICsgSEZJRUxEUzIkKSwgTUFJTFRPX1VSSSA9IFVSSS5WQUxJREFURV9TVVBQT1JUICYmIG5ldyBSZWdFeHAoXCJebWFpbHRvXFxcXDpcIiArIFRPJCArIFwiP1wiICsgSEZJRUxEUyQgKyBcIj8kXCIpLCBVTlJFU0VSVkVEID0gbmV3IFJlZ0V4cChVTlJFU0VSVkVEJCQsIFwiZ1wiKSwgUENUX0VOQ09ERUQgPSBuZXcgUmVnRXhwKFBDVF9FTkNPREVEJCwgXCJnXCIpLCBOT1RfTE9DQUxfUEFSVCA9IG5ldyBSZWdFeHAobWVyZ2UoXCJbXl1cIiwgQVRFWFQkJCwgXCJbXFxcXC5dXCIsICdbXFxcXFwiXScsIFZDSEFSJCQpLCBcImdcIiksIE5PVF9ET01BSU4gPSBuZXcgUmVnRXhwKG1lcmdlKFwiW15dXCIsIEFURVhUJCQsIFwiW1xcXFwuXVwiLCBcIltcXFxcW11cIiwgRFRFWFRfTk9fT0JTJCQsIFwiW1xcXFxdXVwiKSwgXCJnXCIpLCBOT1RfSEZOQU1FID0gbmV3IFJlZ0V4cChtZXJnZShcIlteXVwiLCBVTlJFU0VSVkVEJCQsIFNPTUVfREVMSU1TJCQpLCBcImdcIiksIE5PVF9IRlZBTFVFID0gTk9UX0hGTkFNRSwgVE8gPSBVUkkuVkFMSURBVEVfU1VQUE9SVCAmJiBuZXcgUmVnRXhwKFwiXlwiICsgVE8kICsgXCIkXCIpLCBIRklFTERTID0gVVJJLlZBTElEQVRFX1NVUFBPUlQgJiYgbmV3IFJlZ0V4cChcIl5cIiArIEhGSUVMRFMyJCArIFwiJFwiKTtcclxuICAgIGZ1bmN0aW9uIHRvVXBwZXJDYXNlKHN0cikge1xyXG4gICAgICAgIHJldHVybiBzdHIudG9VcHBlckNhc2UoKTtcclxuICAgIH1cclxuICAgIGZ1bmN0aW9uIGRlY29kZVVucmVzZXJ2ZWQoc3RyKSB7XHJcbiAgICAgICAgdmFyIGRlY1N0ciA9IFVSSS5wY3REZWNDaGFycyhzdHIpO1xyXG4gICAgICAgIHJldHVybiAoIWRlY1N0ci5tYXRjaChVTlJFU0VSVkVEKSA/IHN0ciA6IGRlY1N0cik7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiB0b0FycmF5KG9iaikge1xyXG4gICAgICAgIHJldHVybiBvYmogIT09IHVuZGVmaW5lZCAmJiBvYmogIT09IG51bGwgPyAob2JqIGluc3RhbmNlb2YgQXJyYXkgJiYgIW9iai5jYWxsZWUgPyBvYmogOiAodHlwZW9mIG9iai5sZW5ndGggIT09IFwibnVtYmVyXCIgfHwgb2JqLnNwbGl0IHx8IG9iai5zZXRJbnRlcnZhbCB8fCBvYmouY2FsbCA/IFtvYmpdIDogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwob2JqKSkpIDogW107XHJcbiAgICB9XHJcbiAgICBVUkkuU0NIRU1FU1tcIm1haWx0b1wiXSA9IHtcclxuICAgICAgICBwYXJzZTogZnVuY3Rpb24gKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgaWYgKFVSSS5WQUxJREFURV9TVVBQT1JUICYmICFjb21wb25lbnRzLmVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY29tcG9uZW50cy5wYXRoICYmICFUTy50ZXN0KGNvbXBvbmVudHMucGF0aCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gXCJFbWFpbCBhZGRyZXNzIGlzIG5vdCB2YWxpZFwiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoY29tcG9uZW50cy5xdWVyeSAmJiAhSEZJRUxEUy50ZXN0KGNvbXBvbmVudHMucXVlcnkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IFwiSGVhZGVyIGZpZWxkcyBhcmUgaW52YWxpZFwiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZhciB0byA9IGNvbXBvbmVudHMudG8gPSAoY29tcG9uZW50cy5wYXRoID8gY29tcG9uZW50cy5wYXRoLnNwbGl0KFwiLFwiKSA6IFtdKTtcclxuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBpZiAoY29tcG9uZW50cy5xdWVyeSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHVua25vd25IZWFkZXJzID0gZmFsc2UsIGhlYWRlcnMgPSB7fTtcclxuICAgICAgICAgICAgICAgIHZhciBoZmllbGRzID0gY29tcG9uZW50cy5xdWVyeS5zcGxpdChcIiZcIik7XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciB4ID0gMCwgeGwgPSBoZmllbGRzLmxlbmd0aDsgeCA8IHhsOyArK3gpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgaGZpZWxkID0gaGZpZWxkc1t4XS5zcGxpdChcIj1cIik7XHJcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChoZmllbGRbMF0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSBcInRvXCI6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgdG9BZGRycyA9IGhmaWVsZFsxXS5zcGxpdChcIixcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciB4XzEgPSAwLCB4bF8xID0gdG9BZGRycy5sZW5ndGg7IHhfMSA8IHhsXzE7ICsreF8xKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG8ucHVzaCh0b0FkZHJzW3hfMV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgXCJzdWJqZWN0XCI6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLnN1YmplY3QgPSBVUkkudW5lc2NhcGVDb21wb25lbnQoaGZpZWxkWzFdLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlIFwiYm9keVwiOlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5ib2R5ID0gVVJJLnVuZXNjYXBlQ29tcG9uZW50KGhmaWVsZFsxXSwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVua25vd25IZWFkZXJzID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhlYWRlcnNbVVJJLnVuZXNjYXBlQ29tcG9uZW50KGhmaWVsZFswXSwgb3B0aW9ucyldID0gVVJJLnVuZXNjYXBlQ29tcG9uZW50KGhmaWVsZFsxXSwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodW5rbm93bkhlYWRlcnMpXHJcbiAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5oZWFkZXJzID0gaGVhZGVycztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb21wb25lbnRzLnF1ZXJ5ID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBmb3IgKHZhciB4ID0gMCwgeGwgPSB0by5sZW5ndGg7IHggPCB4bDsgKyt4KSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgYWRkciA9IHRvW3hdLnNwbGl0KFwiQFwiKTtcclxuICAgICAgICAgICAgICAgIGFkZHJbMF0gPSBVUkkudW5lc2NhcGVDb21wb25lbnQoYWRkclswXSk7XHJcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHB1bnljb2RlICE9PSBcInVuZGVmaW5lZFwiICYmICFvcHRpb25zLnVuaWNvZGVTdXBwb3J0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy9jb252ZXJ0IFVuaWNvZGUgSUROIC0+IEFTQ0lJIElETlxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFkZHJbMV0gPSBwdW55Y29kZS50b0FTQ0lJKFVSSS51bmVzY2FwZUNvbXBvbmVudChhZGRyWzFdLCBvcHRpb25zKS50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJFbWFpbCBhZGRyZXNzJ3MgZG9tYWluIG5hbWUgY2FuIG5vdCBiZSBjb252ZXJ0ZWQgdG8gQVNDSUkgdmlhIHB1bnljb2RlOiBcIiArIGU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYWRkclsxXSA9IFVSSS51bmVzY2FwZUNvbXBvbmVudChhZGRyWzFdLCBvcHRpb25zKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgdG9beF0gPSBhZGRyLmpvaW4oXCJAXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnRzO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2VyaWFsaXplOiBmdW5jdGlvbiAoY29tcG9uZW50cywgb3B0aW9ucykge1xyXG4gICAgICAgICAgICB2YXIgdG8gPSB0b0FycmF5KGNvbXBvbmVudHMudG8pO1xyXG4gICAgICAgICAgICBpZiAodG8pIHtcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIHggPSAwLCB4bCA9IHRvLmxlbmd0aDsgeCA8IHhsOyArK3gpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgdG9BZGRyID0gU3RyaW5nKHRvW3hdKTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgYXRJZHggPSB0b0FkZHIubGFzdEluZGV4T2YoXCJAXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBsb2NhbFBhcnQgPSB0b0FkZHIuc2xpY2UoMCwgYXRJZHgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBkb21haW4gPSB0b0FkZHIuc2xpY2UoYXRJZHggKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICBsb2NhbFBhcnQgPSBsb2NhbFBhcnQucmVwbGFjZShQQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkucmVwbGFjZShQQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpLnJlcGxhY2UoTk9UX0xPQ0FMX1BBUlQsIFVSSS5wY3RFbmNDaGFyKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHB1bnljb2RlICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vY29udmVydCBJRE4gdmlhIHB1bnljb2RlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb21haW4gPSAoIW9wdGlvbnMuaXJpID8gcHVueWNvZGUudG9BU0NJSShVUkkudW5lc2NhcGVDb21wb25lbnQoZG9tYWluLCBvcHRpb25zKS50b0xvd2VyQ2FzZSgpKSA6IHB1bnljb2RlLnRvVW5pY29kZShkb21haW4pKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJFbWFpbCBhZGRyZXNzJ3MgZG9tYWluIG5hbWUgY2FuIG5vdCBiZSBjb252ZXJ0ZWQgdG8gXCIgKyAoIW9wdGlvbnMuaXJpID8gXCJBU0NJSVwiIDogXCJVbmljb2RlXCIpICsgXCIgdmlhIHB1bnljb2RlOiBcIiArIGU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRvbWFpbiA9IGRvbWFpbi5yZXBsYWNlKFBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKS5yZXBsYWNlKE5PVF9ET01BSU4sIFVSSS5wY3RFbmNDaGFyKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgdG9beF0gPSBsb2NhbFBhcnQgKyBcIkBcIiArIGRvbWFpbjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMucGF0aCA9IHRvLmpvaW4oXCIsXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gY29tcG9uZW50cy5oZWFkZXJzID0gY29tcG9uZW50cy5oZWFkZXJzIHx8IHt9O1xyXG4gICAgICAgICAgICBpZiAoY29tcG9uZW50cy5zdWJqZWN0KVxyXG4gICAgICAgICAgICAgICAgaGVhZGVyc1tcInN1YmplY3RcIl0gPSBjb21wb25lbnRzLnN1YmplY3Q7XHJcbiAgICAgICAgICAgIGlmIChjb21wb25lbnRzLmJvZHkpXHJcbiAgICAgICAgICAgICAgICBoZWFkZXJzW1wiYm9keVwiXSA9IGNvbXBvbmVudHMuYm9keTtcclxuICAgICAgICAgICAgdmFyIGZpZWxkcyA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBuYW1lXzEgaW4gaGVhZGVycykge1xyXG4gICAgICAgICAgICAgICAgaWYgKGhlYWRlcnNbbmFtZV8xXSAhPT0gT1tuYW1lXzFdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmllbGRzLnB1c2gobmFtZV8xLnJlcGxhY2UoUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UoUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKS5yZXBsYWNlKE5PVF9IRk5BTUUsIFVSSS5wY3RFbmNDaGFyKSArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiPVwiICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGVyc1tuYW1lXzFdLnJlcGxhY2UoUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UoUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKS5yZXBsYWNlKE5PVF9IRlZBTFVFLCBVUkkucGN0RW5jQ2hhcikpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChmaWVsZHMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnF1ZXJ5ID0gZmllbGRzLmpvaW4oXCImXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnRzO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbn0pKCk7XHJcbiIsIi8vLzxyZWZlcmVuY2UgcGF0aD1cIi4uL3VyaS50c1wiLz5cclxuaWYgKHR5cGVvZiBDT01QSUxFRCA9PT0gXCJ1bmRlZmluZWRcIiAmJiB0eXBlb2YgVVJJID09PSBcInVuZGVmaW5lZFwiICYmIHR5cGVvZiByZXF1aXJlID09PSBcImZ1bmN0aW9uXCIpXHJcbiAgICB2YXIgVVJJID0gcmVxdWlyZShcIi4uL3VyaVwiKTtcclxuKGZ1bmN0aW9uICgpIHtcclxuICAgIHZhciBwY3RFbmNDaGFyID0gVVJJLnBjdEVuY0NoYXIsIE5JRCQgPSBcIig/OlswLTlBLVphLXpdWzAtOUEtWmEtelxcXFwtXXsxLDMxfSlcIiwgUENUX0VOQ09ERUQkID0gXCIoPzpcXFxcJVswLTlBLUZhLWZdezJ9KVwiLCBUUkFOUyQkID0gXCJbMC05QS1aYS16XFxcXChcXFxcKVxcXFwrXFxcXCxcXFxcLVxcXFwuXFxcXDpcXFxcPVxcXFxAXFxcXDtcXFxcJFxcXFxfXFxcXCFcXFxcKlxcXFwnXFxcXC9cXFxcP1xcXFwjXVwiLCBOU1MkID0gXCIoPzooPzpcIiArIFBDVF9FTkNPREVEJCArIFwifFwiICsgVFJBTlMkJCArIFwiKSspXCIsIFVSTl9TQ0hFTUUgPSBuZXcgUmVnRXhwKFwiXnVyblxcXFw6KFwiICsgTklEJCArIFwiKSRcIiksIFVSTl9QQVRIID0gbmV3IFJlZ0V4cChcIl4oXCIgKyBOSUQkICsgXCIpXFxcXDooXCIgKyBOU1MkICsgXCIpJFwiKSwgVVJOX1BBUlNFID0gL14oW15cXDpdKylcXDooLiopLywgVVJOX0VYQ0xVREVEID0gL1tcXHgwMC1cXHgyMFxcXFxcXFwiXFwmXFw8XFw+XFxbXFxdXFxeXFxgXFx7XFx8XFx9XFx+XFx4N0YtXFx4RkZdL2csIFVVSUQgPSAvXlswLTlBLUZhLWZdezh9KD86XFwtWzAtOUEtRmEtZl17NH0pezN9XFwtWzAtOUEtRmEtZl17MTJ9JC87XHJcbiAgICAvL1JGQyAyMTQxXHJcbiAgICBVUkkuU0NIRU1FU1tcInVyblwiXSA9IHtcclxuICAgICAgICBwYXJzZTogZnVuY3Rpb24gKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdmFyIG1hdGNoZXMgPSBjb21wb25lbnRzLnBhdGgubWF0Y2goVVJOX1BBVEgpLCBzY2hlbWUsIHNjaGVtZUhhbmRsZXI7XHJcbiAgICAgICAgICAgIGlmICghbWF0Y2hlcykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFvcHRpb25zLnRvbGVyYW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJVUk4gaXMgbm90IHN0cmljdGx5IHZhbGlkLlwiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbWF0Y2hlcyA9IGNvbXBvbmVudHMucGF0aC5tYXRjaChVUk5fUEFSU0UpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtYXRjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICBzY2hlbWUgPSBcInVybjpcIiArIG1hdGNoZXNbMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgICAgICAgIHNjaGVtZUhhbmRsZXIgPSBVUkkuU0NIRU1FU1tzY2hlbWVdO1xyXG4gICAgICAgICAgICAgICAgLy9pbiBvcmRlciB0byBzZXJpYWxpemUgcHJvcGVybHksIFxyXG4gICAgICAgICAgICAgICAgLy9ldmVyeSBVUk4gbXVzdCBoYXZlIGEgc2VyaWFsaXplciB0aGF0IGNhbGxzIHRoZSBVUk4gc2VyaWFsaXplciBcclxuICAgICAgICAgICAgICAgIGlmICghc2NoZW1lSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vY3JlYXRlIGZha2Ugc2NoZW1lIGhhbmRsZXJcclxuICAgICAgICAgICAgICAgICAgICBzY2hlbWVIYW5kbGVyID0gVVJJLlNDSEVNRVNbc2NoZW1lXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2U6IGZ1bmN0aW9uIChjb21wb25lbnRzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gY29tcG9uZW50cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VyaWFsaXplOiBVUkkuU0NIRU1FU1tcInVyblwiXS5zZXJpYWxpemVcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBzY2hlbWU7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSBtYXRjaGVzWzJdO1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cyA9IHNjaGVtZUhhbmRsZXIucGFyc2UoY29tcG9uZW50cywgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVSTiBjYW4gbm90IGJlIHBhcnNlZC5cIjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50cztcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNlcmlhbGl6ZTogZnVuY3Rpb24gKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdmFyIHNjaGVtZSA9IGNvbXBvbmVudHMuc2NoZW1lIHx8IG9wdGlvbnMuc2NoZW1lLCBtYXRjaGVzO1xyXG4gICAgICAgICAgICBpZiAoc2NoZW1lICYmIHNjaGVtZSAhPT0gXCJ1cm5cIikge1xyXG4gICAgICAgICAgICAgICAgdmFyIG1hdGNoZXMgPSBzY2hlbWUubWF0Y2goVVJOX1NDSEVNRSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoIW1hdGNoZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICBtYXRjaGVzID0gW1widXJuOlwiICsgc2NoZW1lLCBzY2hlbWVdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBcInVyblwiO1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gbWF0Y2hlc1sxXSArIFwiOlwiICsgKGNvbXBvbmVudHMucGF0aCA/IGNvbXBvbmVudHMucGF0aC5yZXBsYWNlKFVSTl9FWENMVURFRCwgcGN0RW5jQ2hhcikgOiBcIlwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50cztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgLy9SRkMgNDEyMlxyXG4gICAgVVJJLlNDSEVNRVNbXCJ1cm46dXVpZFwiXSA9IHtcclxuICAgICAgICBwYXJzZTogZnVuY3Rpb24gKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgaWYgKCFvcHRpb25zLnRvbGVyYW50ICYmICghY29tcG9uZW50cy5wYXRoIHx8ICFjb21wb25lbnRzLnBhdGgubWF0Y2goVVVJRCkpKSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVVSUQgaXMgbm90IHZhbGlkLlwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnRzO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2VyaWFsaXplOiBmdW5jdGlvbiAoY29tcG9uZW50cywgb3B0aW9ucykge1xyXG4gICAgICAgICAgICAvL2Vuc3VyZSBVVUlEIGlzIHZhbGlkXHJcbiAgICAgICAgICAgIGlmICghb3B0aW9ucy50b2xlcmFudCAmJiAoIWNvbXBvbmVudHMucGF0aCB8fCAhY29tcG9uZW50cy5wYXRoLm1hdGNoKFVVSUQpKSkge1xyXG4gICAgICAgICAgICAgICAgLy9pbnZhbGlkIFVVSURzIGNhbiBub3QgaGF2ZSB0aGlzIHNjaGVtZVxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvL25vcm1hbGl6ZSBVVUlEXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSAoY29tcG9uZW50cy5wYXRoIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIFVSSS5TQ0hFTUVTW1widXJuXCJdLnNlcmlhbGl6ZShjb21wb25lbnRzLCBvcHRpb25zKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59KCkpO1xyXG4iLCIvKipcclxuICogVVJJLmpzXHJcbiAqXHJcbiAqIEBmaWxlb3ZlcnZpZXcgQW4gUkZDIDM5ODYgY29tcGxpYW50LCBzY2hlbWUgZXh0ZW5kYWJsZSBVUkkgcGFyc2luZy92YWxpZGF0aW5nL3Jlc29sdmluZyBsaWJyYXJ5IGZvciBKYXZhU2NyaXB0LlxyXG4gKiBAYXV0aG9yIDxhIGhyZWY9XCJtYWlsdG86Z2FyeS5jb3VydEBnbWFpbC5jb21cIj5HYXJ5IENvdXJ0PC9hPlxyXG4gKiBAdmVyc2lvbiAyLjAuMFxyXG4gKiBAc2VlIGh0dHA6Ly9naXRodWIuY29tL2dhcnljb3VydC91cmktanNcclxuICogQGxpY2Vuc2UgVVJJLmpzIHYyLjAuMCAoYykgMjAxMSBHYXJ5IENvdXJ0LiBMaWNlbnNlOiBodHRwOi8vZ2l0aHViLmNvbS9nYXJ5Y291cnQvdXJpLWpzXHJcbiAqL1xyXG4vKipcclxuICogQ29weXJpZ2h0IDIwMTEgR2FyeSBDb3VydC4gQWxsIHJpZ2h0cyByZXNlcnZlZC5cclxuICpcclxuICogUmVkaXN0cmlidXRpb24gYW5kIHVzZSBpbiBzb3VyY2UgYW5kIGJpbmFyeSBmb3Jtcywgd2l0aCBvciB3aXRob3V0IG1vZGlmaWNhdGlvbiwgYXJlXHJcbiAqIHBlcm1pdHRlZCBwcm92aWRlZCB0aGF0IHRoZSBmb2xsb3dpbmcgY29uZGl0aW9ucyBhcmUgbWV0OlxyXG4gKlxyXG4gKiAgICAxLiBSZWRpc3RyaWJ1dGlvbnMgb2Ygc291cmNlIGNvZGUgbXVzdCByZXRhaW4gdGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UsIHRoaXMgbGlzdCBvZlxyXG4gKiAgICAgICBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIuXHJcbiAqXHJcbiAqICAgIDIuIFJlZGlzdHJpYnV0aW9ucyBpbiBiaW5hcnkgZm9ybSBtdXN0IHJlcHJvZHVjZSB0aGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSwgdGhpcyBsaXN0XHJcbiAqICAgICAgIG9mIGNvbmRpdGlvbnMgYW5kIHRoZSBmb2xsb3dpbmcgZGlzY2xhaW1lciBpbiB0aGUgZG9jdW1lbnRhdGlvbiBhbmQvb3Igb3RoZXIgbWF0ZXJpYWxzXHJcbiAqICAgICAgIHByb3ZpZGVkIHdpdGggdGhlIGRpc3RyaWJ1dGlvbi5cclxuICpcclxuICogVEhJUyBTT0ZUV0FSRSBJUyBQUk9WSURFRCBCWSBHQVJZIENPVVJUIGBgQVMgSVMnJyBBTkQgQU5ZIEVYUFJFU1MgT1IgSU1QTElFRFxyXG4gKiBXQVJSQU5USUVTLCBJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgVEhFIElNUExJRUQgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFkgQU5EXHJcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFSRSBESVNDTEFJTUVELiBJTiBOTyBFVkVOVCBTSEFMTCBHQVJZIENPVVJUIE9SXHJcbiAqIENPTlRSSUJVVE9SUyBCRSBMSUFCTEUgRk9SIEFOWSBESVJFQ1QsIElORElSRUNULCBJTkNJREVOVEFMLCBTUEVDSUFMLCBFWEVNUExBUlksIE9SXHJcbiAqIENPTlNFUVVFTlRJQUwgREFNQUdFUyAoSU5DTFVESU5HLCBCVVQgTk9UIExJTUlURUQgVE8sIFBST0NVUkVNRU5UIE9GIFNVQlNUSVRVVEUgR09PRFMgT1JcclxuICogU0VSVklDRVM7IExPU1MgT0YgVVNFLCBEQVRBLCBPUiBQUk9GSVRTOyBPUiBCVVNJTkVTUyBJTlRFUlJVUFRJT04pIEhPV0VWRVIgQ0FVU0VEIEFORCBPTlxyXG4gKiBBTlkgVEhFT1JZIE9GIExJQUJJTElUWSwgV0hFVEhFUiBJTiBDT05UUkFDVCwgU1RSSUNUIExJQUJJTElUWSwgT1IgVE9SVCAoSU5DTFVESU5HXHJcbiAqIE5FR0xJR0VOQ0UgT1IgT1RIRVJXSVNFKSBBUklTSU5HIElOIEFOWSBXQVkgT1VUIE9GIFRIRSBVU0UgT0YgVEhJUyBTT0ZUV0FSRSwgRVZFTiBJRlxyXG4gKiBBRFZJU0VEIE9GIFRIRSBQT1NTSUJJTElUWSBPRiBTVUNIIERBTUFHRS5cclxuICpcclxuICogVGhlIHZpZXdzIGFuZCBjb25jbHVzaW9ucyBjb250YWluZWQgaW4gdGhlIHNvZnR3YXJlIGFuZCBkb2N1bWVudGF0aW9uIGFyZSB0aG9zZSBvZiB0aGVcclxuICogYXV0aG9ycyBhbmQgc2hvdWxkIG5vdCBiZSBpbnRlcnByZXRlZCBhcyByZXByZXNlbnRpbmcgb2ZmaWNpYWwgcG9saWNpZXMsIGVpdGhlciBleHByZXNzZWRcclxuICogb3IgaW1wbGllZCwgb2YgR2FyeSBDb3VydC5cclxuICovXHJcbi8vLzxyZWZlcmVuY2UgcGF0aD1cInB1bnljb2RlLmQudHNcIi8+XHJcbi8vLzxyZWZlcmVuY2UgcGF0aD1cImNvbW1vbmpzLmQudHNcIi8+XHJcbi8qKlxyXG4gKiBDb21waWxlciBzd2l0Y2ggZm9yIGluZGljYXRpbmcgY29kZSBpcyBjb21waWxlZFxyXG4gKiBAZGVmaW5lIHtib29sZWFufVxyXG4gKi9cclxudmFyIENPTVBJTEVEID0gZmFsc2U7XHJcbi8qKlxyXG4gKiBDb21waWxlciBzd2l0Y2ggZm9yIHN1cHBvcnRpbmcgSVJJIFVSSXNcclxuICogQGRlZmluZSB7Ym9vbGVhbn1cclxuICovXHJcbnZhciBVUklfX0lSSV9TVVBQT1JUID0gdHJ1ZTtcclxuLyoqXHJcbiAqIENvbXBpbGVyIHN3aXRjaCBmb3Igc3VwcG9ydGluZyBVUkkgdmFsaWRhdGlvblxyXG4gKiBAZGVmaW5lIHtib29sZWFufVxyXG4gKi9cclxudmFyIFVSSV9fVkFMSURBVEVfU1VQUE9SVCA9IHRydWU7XHJcbnZhciBVUkkgPSAoZnVuY3Rpb24gKCkge1xyXG4gICAgZnVuY3Rpb24gbWVyZ2UoKSB7XHJcbiAgICAgICAgdmFyIHNldHMgPSBbXTtcclxuICAgICAgICBmb3IgKHZhciBfaSA9IDA7IF9pIDwgYXJndW1lbnRzLmxlbmd0aDsgX2krKykge1xyXG4gICAgICAgICAgICBzZXRzW19pIC0gMF0gPSBhcmd1bWVudHNbX2ldO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoc2V0cy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgICAgIHNldHNbMF0gPSBzZXRzWzBdLnNsaWNlKDAsIC0xKTtcclxuICAgICAgICAgICAgdmFyIHhsID0gc2V0cy5sZW5ndGggLSAxO1xyXG4gICAgICAgICAgICBmb3IgKHZhciB4ID0gMTsgeCA8IHhsOyArK3gpIHtcclxuICAgICAgICAgICAgICAgIHNldHNbeF0gPSBzZXRzW3hdLnNsaWNlKDEsIC0xKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzZXRzW3hsXSA9IHNldHNbeGxdLnNsaWNlKDEpO1xyXG4gICAgICAgICAgICByZXR1cm4gc2V0cy5qb2luKCcnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIHJldHVybiBzZXRzWzBdO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGZ1bmN0aW9uIHN1YmV4cChzdHIpIHtcclxuICAgICAgICByZXR1cm4gXCIoPzpcIiArIHN0ciArIFwiKVwiO1xyXG4gICAgfVxyXG4gICAgZnVuY3Rpb24gYnVpbGRFeHBzKGlzSVJJKSB7XHJcbiAgICAgICAgdmFyIEFMUEhBJCQgPSBcIltBLVphLXpdXCIsIENSJCA9IFwiW1xcXFx4MERdXCIsIERJR0lUJCQgPSBcIlswLTldXCIsIERRVU9URSQkID0gXCJbXFxcXHgyMl1cIiwgSEVYRElHJCQgPSBtZXJnZShESUdJVCQkLCBcIltBLUZhLWZdXCIpLCBMRiQkID0gXCJbXFxcXHgwQV1cIiwgU1AkJCA9IFwiW1xcXFx4MjBdXCIsIFBDVF9FTkNPREVEJCA9IHN1YmV4cChzdWJleHAoXCIlW0VGZWZdXCIgKyBIRVhESUckJCArIFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCArIFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCkgKyBcInxcIiArIHN1YmV4cChcIiVbODlBLUZhLWZdXCIgKyBIRVhESUckJCArIFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCkgKyBcInxcIiArIHN1YmV4cChcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpKSwgR0VOX0RFTElNUyQkID0gXCJbXFxcXDpcXFxcL1xcXFw/XFxcXCNcXFxcW1xcXFxdXFxcXEBdXCIsIFNVQl9ERUxJTVMkJCA9IFwiW1xcXFwhXFxcXCRcXFxcJlxcXFwnXFxcXChcXFxcKVxcXFwqXFxcXCtcXFxcLFxcXFw7XFxcXD1dXCIsIFJFU0VSVkVEJCQgPSBtZXJnZShHRU5fREVMSU1TJCQsIFNVQl9ERUxJTVMkJCksIFVDU0NIQVIkJCA9IGlzSVJJID8gXCJbXFxcXHhBMC1cXFxcdTIwMERcXFxcdTIwMTAtXFxcXHUyMDI5XFxcXHUyMDJGLVxcXFx1RDdGRlxcXFx1RjkwMC1cXFxcdUZEQ0ZcXFxcdUZERjAtXFxcXHVGRkVGXVwiIDogXCJbXVwiLCBJUFJJVkFURSQkID0gaXNJUkkgPyBcIltcXFxcdUUwMDAtXFxcXHVGOEZGXVwiIDogXCJbXVwiLCBVTlJFU0VSVkVEJCQgPSBtZXJnZShBTFBIQSQkLCBESUdJVCQkLCBcIltcXFxcLVxcXFwuXFxcXF9cXFxcfl1cIiwgVUNTQ0hBUiQkKSwgU0NIRU1FJCA9IHN1YmV4cChBTFBIQSQkICsgbWVyZ2UoQUxQSEEkJCwgRElHSVQkJCwgXCJbXFxcXCtcXFxcLVxcXFwuXVwiKSArIFwiKlwiKSwgVVNFUklORk8kID0gc3ViZXhwKHN1YmV4cChQQ1RfRU5DT0RFRCQgKyBcInxcIiArIG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcOl1cIikpICsgXCIqXCIpLCBERUNfT0NURVQkID0gc3ViZXhwKHN1YmV4cChcIjI1WzAtNV1cIikgKyBcInxcIiArIHN1YmV4cChcIjJbMC00XVwiICsgRElHSVQkJCkgKyBcInxcIiArIHN1YmV4cChcIjFcIiArIERJR0lUJCQgKyBESUdJVCQkKSArIFwifFwiICsgc3ViZXhwKFwiWzEtOV1cIiArIERJR0lUJCQpICsgXCJ8XCIgKyBESUdJVCQkKSwgSVBWNEFERFJFU1MkID0gc3ViZXhwKERFQ19PQ1RFVCQgKyBcIlxcXFwuXCIgKyBERUNfT0NURVQkICsgXCJcXFxcLlwiICsgREVDX09DVEVUJCArIFwiXFxcXC5cIiArIERFQ19PQ1RFVCQpLCBIMTYkID0gc3ViZXhwKEhFWERJRyQkICsgXCJ7MSw0fVwiKSwgTFMzMiQgPSBzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIgKyBIMTYkKSArIFwifFwiICsgSVBWNEFERFJFU1MkKSwgSVBWNkFERFJFU1MkID0gc3ViZXhwKG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcOl1cIikgKyBcIitcIiksIElQVkZVVFVSRSQgPSBzdWJleHAoXCJ2XCIgKyBIRVhESUckJCArIFwiK1xcXFwuXCIgKyBtZXJnZShVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCwgXCJbXFxcXDpdXCIpICsgXCIrXCIpLCBJUF9MSVRFUkFMJCA9IHN1YmV4cChcIlxcXFxbXCIgKyBzdWJleHAoSVBWNkFERFJFU1MkICsgXCJ8XCIgKyBJUFZGVVRVUkUkKSArIFwiXFxcXF1cIiksIFJFR19OQU1FJCA9IHN1YmV4cChzdWJleHAoUENUX0VOQ09ERUQkICsgXCJ8XCIgKyBtZXJnZShVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCkpICsgXCIqXCIpLCBIT1NUJCA9IHN1YmV4cChJUF9MSVRFUkFMJCArIFwifFwiICsgSVBWNEFERFJFU1MkICsgXCIoPyFcIiArIFJFR19OQU1FJCArIFwiKVwiICsgXCJ8XCIgKyBSRUdfTkFNRSQpLCBQT1JUJCA9IHN1YmV4cChESUdJVCQkICsgXCIqXCIpLCBBVVRIT1JJVFkkID0gc3ViZXhwKHN1YmV4cChVU0VSSU5GTyQgKyBcIkBcIikgKyBcIj9cIiArIEhPU1QkICsgc3ViZXhwKFwiXFxcXDpcIiArIFBPUlQkKSArIFwiP1wiKSwgUENIQVIkID0gc3ViZXhwKFBDVF9FTkNPREVEJCArIFwifFwiICsgbWVyZ2UoVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQsIFwiW1xcXFw6XFxcXEBdXCIpKSwgU0VHTUVOVCQgPSBzdWJleHAoUENIQVIkICsgXCIqXCIpLCBTRUdNRU5UX05aJCA9IHN1YmV4cChQQ0hBUiQgKyBcIitcIiksIFNFR01FTlRfTlpfTkMkID0gc3ViZXhwKHN1YmV4cChQQ1RfRU5DT0RFRCQgKyBcInxcIiArIG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcQF1cIikpICsgXCIrXCIpLCBQQVRIX0FCRU1QVFkkID0gc3ViZXhwKHN1YmV4cChcIlxcXFwvXCIgKyBTRUdNRU5UJCkgKyBcIipcIiksIFBBVEhfQUJTT0xVVEUkID0gc3ViZXhwKFwiXFxcXC9cIiArIHN1YmV4cChTRUdNRU5UX05aJCArIFBBVEhfQUJFTVBUWSQpICsgXCI/XCIpLCBQQVRIX05PU0NIRU1FJCA9IHN1YmV4cChTRUdNRU5UX05aX05DJCArIFBBVEhfQUJFTVBUWSQpLCBQQVRIX1JPT1RMRVNTJCA9IHN1YmV4cChTRUdNRU5UX05aJCArIFBBVEhfQUJFTVBUWSQpLCBQQVRIX0VNUFRZJCA9IFwiKD8hXCIgKyBQQ0hBUiQgKyBcIilcIiwgUEFUSCQgPSBzdWJleHAoUEFUSF9BQkVNUFRZJCArIFwifFwiICsgUEFUSF9BQlNPTFVURSQgKyBcInxcIiArIFBBVEhfTk9TQ0hFTUUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQpLCBRVUVSWSQgPSBzdWJleHAoc3ViZXhwKFBDSEFSJCArIFwifFwiICsgbWVyZ2UoXCJbXFxcXC9cXFxcP11cIiwgSVBSSVZBVEUkJCkpICsgXCIqXCIpLCBGUkFHTUVOVCQgPSBzdWJleHAoc3ViZXhwKFBDSEFSJCArIFwifFtcXFxcL1xcXFw/XVwiKSArIFwiKlwiKSwgSElFUl9QQVJUJCA9IHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvXCIgKyBBVVRIT1JJVFkkICsgUEFUSF9BQkVNUFRZJCkgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQpLCBVUkkkID0gc3ViZXhwKFNDSEVNRSQgKyBcIlxcXFw6XCIgKyBISUVSX1BBUlQkICsgc3ViZXhwKFwiXFxcXD9cIiArIFFVRVJZJCkgKyBcIj9cIiArIHN1YmV4cChcIlxcXFwjXCIgKyBGUkFHTUVOVCQpICsgXCI/XCIpLCBSRUxBVElWRV9QQVJUJCA9IHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvXCIgKyBBVVRIT1JJVFkkICsgUEFUSF9BQkVNUFRZJCkgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX05PU0NIRU1FJCArIFwifFwiICsgUEFUSF9FTVBUWSQpLCBSRUxBVElWRSQgPSBzdWJleHAoUkVMQVRJVkVfUEFSVCQgKyBzdWJleHAoXCJcXFxcP1wiICsgUVVFUlkkKSArIFwiP1wiICsgc3ViZXhwKFwiXFxcXCNcIiArIEZSQUdNRU5UJCkgKyBcIj9cIiksIFVSSV9SRUZFUkVOQ0UkID0gc3ViZXhwKFVSSSQgKyBcInxcIiArIFJFTEFUSVZFJCksIEFCU09MVVRFX1VSSSQgPSBzdWJleHAoU0NIRU1FJCArIFwiXFxcXDpcIiArIEhJRVJfUEFSVCQgKyBzdWJleHAoXCJcXFxcP1wiICsgUVVFUlkkKSArIFwiP1wiKSwgR0VORVJJQ19SRUYkID0gXCJeKFwiICsgU0NIRU1FJCArIFwiKVxcXFw6XCIgKyBzdWJleHAoc3ViZXhwKFwiXFxcXC9cXFxcLyhcIiArIHN1YmV4cChcIihcIiArIFVTRVJJTkZPJCArIFwiKUBcIikgKyBcIj8oXCIgKyBIT1NUJCArIFwiKVwiICsgc3ViZXhwKFwiXFxcXDooXCIgKyBQT1JUJCArIFwiKVwiKSArIFwiPylcIikgKyBcIj8oXCIgKyBQQVRIX0FCRU1QVFkkICsgXCJ8XCIgKyBQQVRIX0FCU09MVVRFJCArIFwifFwiICsgUEFUSF9ST09UTEVTUyQgKyBcInxcIiArIFBBVEhfRU1QVFkkICsgXCIpXCIpICsgc3ViZXhwKFwiXFxcXD8oXCIgKyBRVUVSWSQgKyBcIilcIikgKyBcIj9cIiArIHN1YmV4cChcIlxcXFwjKFwiICsgRlJBR01FTlQkICsgXCIpXCIpICsgXCI/JFwiLCBSRUxBVElWRV9SRUYkID0gXCJeKCl7MH1cIiArIHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvKFwiICsgc3ViZXhwKFwiKFwiICsgVVNFUklORk8kICsgXCIpQFwiKSArIFwiPyhcIiArIEhPU1QkICsgXCIpXCIgKyBzdWJleHAoXCJcXFxcOihcIiArIFBPUlQkICsgXCIpXCIpICsgXCI/KVwiKSArIFwiPyhcIiArIFBBVEhfQUJFTVBUWSQgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX05PU0NIRU1FJCArIFwifFwiICsgUEFUSF9FTVBUWSQgKyBcIilcIikgKyBzdWJleHAoXCJcXFxcPyhcIiArIFFVRVJZJCArIFwiKVwiKSArIFwiP1wiICsgc3ViZXhwKFwiXFxcXCMoXCIgKyBGUkFHTUVOVCQgKyBcIilcIikgKyBcIj8kXCIsIEFCU09MVVRFX1JFRiQgPSBcIl4oXCIgKyBTQ0hFTUUkICsgXCIpXFxcXDpcIiArIHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvKFwiICsgc3ViZXhwKFwiKFwiICsgVVNFUklORk8kICsgXCIpQFwiKSArIFwiPyhcIiArIEhPU1QkICsgXCIpXCIgKyBzdWJleHAoXCJcXFxcOihcIiArIFBPUlQkICsgXCIpXCIpICsgXCI/KVwiKSArIFwiPyhcIiArIFBBVEhfQUJFTVBUWSQgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQgKyBcIilcIikgKyBzdWJleHAoXCJcXFxcPyhcIiArIFFVRVJZJCArIFwiKVwiKSArIFwiPyRcIiwgU0FNRURPQ19SRUYkID0gXCJeXCIgKyBzdWJleHAoXCJcXFxcIyhcIiArIEZSQUdNRU5UJCArIFwiKVwiKSArIFwiPyRcIiwgQVVUSE9SSVRZX1JFRiQgPSBcIl5cIiArIHN1YmV4cChcIihcIiArIFVTRVJJTkZPJCArIFwiKUBcIikgKyBcIj8oXCIgKyBIT1NUJCArIFwiKVwiICsgc3ViZXhwKFwiXFxcXDooXCIgKyBQT1JUJCArIFwiKVwiKSArIFwiPyRcIjtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBVUklfUkVGOiBVUklfX1ZBTElEQVRFX1NVUFBPUlQgJiYgbmV3IFJlZ0V4cChcIihcIiArIEdFTkVSSUNfUkVGJCArIFwiKXwoXCIgKyBSRUxBVElWRV9SRUYkICsgXCIpXCIpLFxyXG4gICAgICAgICAgICBOT1RfU0NIRU1FOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15dXCIsIEFMUEhBJCQsIERJR0lUJCQsIFwiW1xcXFwrXFxcXC1cXFxcLl1cIiksIFwiZ1wiKSxcclxuICAgICAgICAgICAgTk9UX1VTRVJJTkZPOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJVxcXFw6XVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcclxuICAgICAgICAgICAgTk9UX0hPU1Q6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcclxuICAgICAgICAgICAgTk9UX1BBVEg6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXFxcXC9cXFxcOlxcXFxAXVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcclxuICAgICAgICAgICAgTk9UX1BBVEhfTk9TQ0hFTUU6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXFxcXC9cXFxcQF1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQpLCBcImdcIiksXHJcbiAgICAgICAgICAgIE5PVF9RVUVSWTogbmV3IFJlZ0V4cChtZXJnZShcIlteXFxcXCVdXCIsIFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcOlxcXFxAXFxcXC9cXFxcP11cIiwgSVBSSVZBVEUkJCksIFwiZ1wiKSxcclxuICAgICAgICAgICAgTk9UX0ZSQUdNRU5UOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJV1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQsIFwiW1xcXFw6XFxcXEBcXFxcL1xcXFw/XVwiKSwgXCJnXCIpLFxyXG4gICAgICAgICAgICBFU0NBUEU6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXl1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQpLCBcImdcIiksXHJcbiAgICAgICAgICAgIFVOUkVTRVJWRUQ6IG5ldyBSZWdFeHAoVU5SRVNFUlZFRCQkLCBcImdcIiksXHJcbiAgICAgICAgICAgIE9USEVSX0NIQVJTOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJV1cIiwgVU5SRVNFUlZFRCQkLCBSRVNFUlZFRCQkKSwgXCJnXCIpLFxyXG4gICAgICAgICAgICBQQ1RfRU5DT0RFRDogbmV3IFJlZ0V4cChQQ1RfRU5DT0RFRCQsIFwiZ1wiKVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICB2YXIgVVJJX1BST1RPQ09MID0gYnVpbGRFeHBzKGZhbHNlKSwgSVJJX1BST1RPQ09MID0gVVJJX19JUklfU1VQUE9SVCA/IGJ1aWxkRXhwcyh0cnVlKSA6IHVuZGVmaW5lZCwgVVJJX1BBUlNFID0gL14oPzooW146XFwvPyNdKyk6KT8oPzpcXC9cXC8oKD86KFteXFwvPyNAXSopQCk/KFteXFwvPyM6XSopKD86XFw6KFxcZCopKT8pKT8oW14/I10qKSg/OlxcPyhbXiNdKikpPyg/OiMoKD86LnxcXG4pKikpPy9pLCBSRFMxID0gL15cXC5cXC4/XFwvLywgUkRTMiA9IC9eXFwvXFwuKFxcL3wkKS8sIFJEUzMgPSAvXlxcL1xcLlxcLihcXC98JCkvLCBSRFM0ID0gL15cXC5cXC4/JC8sIFJEUzUgPSAvXlxcLz8oPzoufFxcbikqPyg/PVxcL3wkKS8sIE5PX01BVENIX0lTX1VOREVGSU5FRCA9IChcIlwiKS5tYXRjaCgvKCl7MH0vKVsxXSA9PT0gdW5kZWZpbmVkO1xyXG4gICAgZnVuY3Rpb24gcGN0RW5jQ2hhcihjaHIpIHtcclxuICAgICAgICB2YXIgYyA9IGNoci5jaGFyQ29kZUF0KDApLCBlO1xyXG4gICAgICAgIGlmIChjIDwgMTYpXHJcbiAgICAgICAgICAgIGUgPSBcIiUwXCIgKyBjLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAgIGVsc2UgaWYgKGMgPCAxMjgpXHJcbiAgICAgICAgICAgIGUgPSBcIiVcIiArIGMudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgICAgZWxzZSBpZiAoYyA8IDIwNDgpXHJcbiAgICAgICAgICAgIGUgPSBcIiVcIiArICgoYyA+PiA2KSB8IDE5MikudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkgKyBcIiVcIiArICgoYyAmIDYzKSB8IDEyOCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICBlID0gXCIlXCIgKyAoKGMgPj4gMTIpIHwgMjI0KS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKSArIFwiJVwiICsgKCgoYyA+PiA2KSAmIDYzKSB8IDEyOCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkgKyBcIiVcIiArICgoYyAmIDYzKSB8IDEyOCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgICAgcmV0dXJuIGU7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiBwY3REZWNDaGFycyhzdHIpIHtcclxuICAgICAgICB2YXIgbmV3U3RyID0gXCJcIiwgaSA9IDAsIGlsID0gc3RyLmxlbmd0aCwgYywgYzIsIGMzO1xyXG4gICAgICAgIHdoaWxlIChpIDwgaWwpIHtcclxuICAgICAgICAgICAgYyA9IHBhcnNlSW50KHN0ci5zdWJzdHIoaSArIDEsIDIpLCAxNik7XHJcbiAgICAgICAgICAgIGlmIChjIDwgMTI4KSB7XHJcbiAgICAgICAgICAgICAgICBuZXdTdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjKTtcclxuICAgICAgICAgICAgICAgIGkgKz0gMztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmIChjID49IDE5NCAmJiBjIDwgMjI0KSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoKGlsIC0gaSkgPj0gNikge1xyXG4gICAgICAgICAgICAgICAgICAgIGMyID0gcGFyc2VJbnQoc3RyLnN1YnN0cihpICsgNCwgMiksIDE2KTtcclxuICAgICAgICAgICAgICAgICAgICBuZXdTdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoKGMgJiAzMSkgPDwgNikgfCAoYzIgJiA2MykpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmV3U3RyICs9IHN0ci5zdWJzdHIoaSwgNik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpICs9IDY7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSBpZiAoYyA+PSAyMjQpIHtcclxuICAgICAgICAgICAgICAgIGlmICgoaWwgLSBpKSA+PSA5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYzIgPSBwYXJzZUludChzdHIuc3Vic3RyKGkgKyA0LCAyKSwgMTYpO1xyXG4gICAgICAgICAgICAgICAgICAgIGMzID0gcGFyc2VJbnQoc3RyLnN1YnN0cihpICsgNywgMiksIDE2KTtcclxuICAgICAgICAgICAgICAgICAgICBuZXdTdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoKGMgJiAxNSkgPDwgMTIpIHwgKChjMiAmIDYzKSA8PCA2KSB8IChjMyAmIDYzKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBuZXdTdHIgKz0gc3RyLnN1YnN0cihpLCA5KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGkgKz0gOTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgIG5ld1N0ciArPSBzdHIuc3Vic3RyKGksIDMpO1xyXG4gICAgICAgICAgICAgICAgaSArPSAzO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBuZXdTdHI7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiB0eXBlT2Yobykge1xyXG4gICAgICAgIHJldHVybiBvID09PSB1bmRlZmluZWQgPyBcInVuZGVmaW5lZFwiIDogKG8gPT09IG51bGwgPyBcIm51bGxcIiA6IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKS5zcGxpdChcIiBcIikucG9wKCkuc3BsaXQoXCJdXCIpLnNoaWZ0KCkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiB0b1VwcGVyQ2FzZShzdHIpIHtcclxuICAgICAgICByZXR1cm4gc3RyLnRvVXBwZXJDYXNlKCk7XHJcbiAgICB9XHJcbiAgICB2YXIgU0NIRU1FUyA9IHt9O1xyXG4gICAgZnVuY3Rpb24gX25vcm1hbGl6ZUNvbXBvbmVudEVuY29kaW5nKGNvbXBvbmVudHMsIHByb3RvY29sKSB7XHJcbiAgICAgICAgZnVuY3Rpb24gZGVjb2RlVW5yZXNlcnZlZChzdHIpIHtcclxuICAgICAgICAgICAgdmFyIGRlY1N0ciA9IHBjdERlY0NoYXJzKHN0cik7XHJcbiAgICAgICAgICAgIHJldHVybiAoIWRlY1N0ci5tYXRjaChwcm90b2NvbC5VTlJFU0VSVkVEKSA/IHN0ciA6IGRlY1N0cik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjb21wb25lbnRzLnNjaGVtZSlcclxuICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBTdHJpbmcoY29tcG9uZW50cy5zY2hlbWUpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnRvTG93ZXJDYXNlKCkucmVwbGFjZShwcm90b2NvbC5OT1RfU0NIRU1FLCBcIlwiKTtcclxuICAgICAgICBpZiAoY29tcG9uZW50cy51c2VyaW5mbyAhPT0gdW5kZWZpbmVkKVxyXG4gICAgICAgICAgICBjb21wb25lbnRzLnVzZXJpbmZvID0gU3RyaW5nKGNvbXBvbmVudHMudXNlcmluZm8pLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UocHJvdG9jb2wuTk9UX1VTRVJJTkZPLCBwY3RFbmNDaGFyKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSk7XHJcbiAgICAgICAgaWYgKGNvbXBvbmVudHMuaG9zdCAhPT0gdW5kZWZpbmVkKVxyXG4gICAgICAgICAgICBjb21wb25lbnRzLmhvc3QgPSBTdHJpbmcoY29tcG9uZW50cy5ob3N0KS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UocHJvdG9jb2wuTk9UX0hPU1QsIHBjdEVuY0NoYXIpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKTtcclxuICAgICAgICBpZiAoY29tcG9uZW50cy5wYXRoICE9PSB1bmRlZmluZWQpXHJcbiAgICAgICAgICAgIGNvbXBvbmVudHMucGF0aCA9IFN0cmluZyhjb21wb25lbnRzLnBhdGgpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UoKGNvbXBvbmVudHMuc2NoZW1lID8gcHJvdG9jb2wuTk9UX1BBVEggOiBwcm90b2NvbC5OT1RfUEFUSF9OT1NDSEVNRSksIHBjdEVuY0NoYXIpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKTtcclxuICAgICAgICBpZiAoY29tcG9uZW50cy5xdWVyeSAhPT0gdW5kZWZpbmVkKVxyXG4gICAgICAgICAgICBjb21wb25lbnRzLnF1ZXJ5ID0gU3RyaW5nKGNvbXBvbmVudHMucXVlcnkpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UocHJvdG9jb2wuTk9UX1FVRVJZLCBwY3RFbmNDaGFyKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSk7XHJcbiAgICAgICAgaWYgKGNvbXBvbmVudHMuZnJhZ21lbnQgIT09IHVuZGVmaW5lZClcclxuICAgICAgICAgICAgY29tcG9uZW50cy5mcmFnbWVudCA9IFN0cmluZyhjb21wb25lbnRzLmZyYWdtZW50KS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS5yZXBsYWNlKHByb3RvY29sLk5PVF9GUkFHTUVOVCwgcGN0RW5jQ2hhcikucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpO1xyXG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgZnVuY3Rpb24gcGFyc2UodXJpU3RyaW5nLCBvcHRpb25zKSB7XHJcbiAgICAgICAgaWYgKG9wdGlvbnMgPT09IHZvaWQgMCkgeyBvcHRpb25zID0ge307IH1cclxuICAgICAgICB2YXIgcHJvdG9jb2wgPSAoVVJJX19JUklfU1VQUE9SVCAmJiBvcHRpb25zLmlyaSAhPT0gZmFsc2UgPyBJUklfUFJPVE9DT0wgOiBVUklfUFJPVE9DT0wpLCBtYXRjaGVzLCBwYXJzZUVycm9yID0gZmFsc2UsIGNvbXBvbmVudHMgPSB7fSwgc2NoZW1lSGFuZGxlcjtcclxuICAgICAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgPT09IFwic3VmZml4XCIpXHJcbiAgICAgICAgICAgIHVyaVN0cmluZyA9IChvcHRpb25zLnNjaGVtZSA/IG9wdGlvbnMuc2NoZW1lICsgXCI6XCIgOiBcIlwiKSArIFwiLy9cIiArIHVyaVN0cmluZztcclxuICAgICAgICBpZiAoVVJJX19WQUxJREFURV9TVVBQT1JUKSB7XHJcbiAgICAgICAgICAgIG1hdGNoZXMgPSB1cmlTdHJpbmcubWF0Y2gocHJvdG9jb2wuVVJJX1JFRik7XHJcbiAgICAgICAgICAgIGlmIChtYXRjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAobWF0Y2hlc1sxXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vZ2VuZXJpYyBVUklcclxuICAgICAgICAgICAgICAgICAgICBtYXRjaGVzID0gbWF0Y2hlcy5zbGljZSgxLCAxMCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAvL3JlbGF0aXZlIFVSSVxyXG4gICAgICAgICAgICAgICAgICAgIG1hdGNoZXMgPSBtYXRjaGVzLnNsaWNlKDEwLCAxOSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCFtYXRjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICBwYXJzZUVycm9yID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGlmICghb3B0aW9ucy50b2xlcmFudClcclxuICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVSSSBpcyBub3Qgc3RyaWN0bHkgdmFsaWQuXCI7XHJcbiAgICAgICAgICAgICAgICBtYXRjaGVzID0gdXJpU3RyaW5nLm1hdGNoKFVSSV9QQVJTRSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIG1hdGNoZXMgPSB1cmlTdHJpbmcubWF0Y2goVVJJX1BBUlNFKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcclxuICAgICAgICAgICAgaWYgKE5PX01BVENIX0lTX1VOREVGSU5FRCkge1xyXG4gICAgICAgICAgICAgICAgLy9zdG9yZSBlYWNoIGNvbXBvbmVudFxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBtYXRjaGVzWzFdO1xyXG4gICAgICAgICAgICAgICAgLy9jb21wb25lbnRzLmF1dGhvcml0eSA9IG1hdGNoZXNbMl07XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnVzZXJpbmZvID0gbWF0Y2hlc1szXTtcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuaG9zdCA9IG1hdGNoZXNbNF07XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnBvcnQgPSBwYXJzZUludChtYXRjaGVzWzVdLCAxMCk7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSBtYXRjaGVzWzZdIHx8IFwiXCI7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnF1ZXJ5ID0gbWF0Y2hlc1s3XTtcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuZnJhZ21lbnQgPSBtYXRjaGVzWzhdO1xyXG4gICAgICAgICAgICAgICAgLy9maXggcG9ydCBudW1iZXJcclxuICAgICAgICAgICAgICAgIGlmIChpc05hTihjb21wb25lbnRzLnBvcnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gbWF0Y2hlc1s1XTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vc3RvcmUgZWFjaCBjb21wb25lbnRcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuc2NoZW1lID0gbWF0Y2hlc1sxXSB8fCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgICAgICAvL2NvbXBvbmVudHMuYXV0aG9yaXR5ID0gKHVyaVN0cmluZy5pbmRleE9mKFwiLy9cIikgIT09IC0xID8gbWF0Y2hlc1syXSA6IHVuZGVmaW5lZCk7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnVzZXJpbmZvID0gKHVyaVN0cmluZy5pbmRleE9mKFwiQFwiKSAhPT0gLTEgPyBtYXRjaGVzWzNdIDogdW5kZWZpbmVkKTtcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuaG9zdCA9ICh1cmlTdHJpbmcuaW5kZXhPZihcIi8vXCIpICE9PSAtMSA/IG1hdGNoZXNbNF0gOiB1bmRlZmluZWQpO1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gcGFyc2VJbnQobWF0Y2hlc1s1XSwgMTApO1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gbWF0Y2hlc1s2XSB8fCBcIlwiO1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5xdWVyeSA9ICh1cmlTdHJpbmcuaW5kZXhPZihcIj9cIikgIT09IC0xID8gbWF0Y2hlc1s3XSA6IHVuZGVmaW5lZCk7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLmZyYWdtZW50ID0gKHVyaVN0cmluZy5pbmRleE9mKFwiI1wiKSAhPT0gLTEgPyBtYXRjaGVzWzhdIDogdW5kZWZpbmVkKTtcclxuICAgICAgICAgICAgICAgIC8vZml4IHBvcnQgbnVtYmVyXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNOYU4oY29tcG9uZW50cy5wb3J0KSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMucG9ydCA9ICh1cmlTdHJpbmcubWF0Y2goL1xcL1xcLyg/Oi58XFxuKSpcXDooPzpcXC98XFw/fFxcI3wkKS8pID8gbWF0Y2hlc1s0XSA6IHVuZGVmaW5lZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy9kZXRlcm1pbmUgcmVmZXJlbmNlIHR5cGVcclxuICAgICAgICAgICAgaWYgKGNvbXBvbmVudHMuc2NoZW1lID09PSB1bmRlZmluZWQgJiYgY29tcG9uZW50cy51c2VyaW5mbyA9PT0gdW5kZWZpbmVkICYmIGNvbXBvbmVudHMuaG9zdCA9PT0gdW5kZWZpbmVkICYmIGNvbXBvbmVudHMucG9ydCA9PT0gdW5kZWZpbmVkICYmICFjb21wb25lbnRzLnBhdGggJiYgY29tcG9uZW50cy5xdWVyeSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnJlZmVyZW5jZSA9IFwic2FtZS1kb2N1bWVudFwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2UgaWYgKGNvbXBvbmVudHMuc2NoZW1lID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMucmVmZXJlbmNlID0gXCJyZWxhdGl2ZVwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2UgaWYgKGNvbXBvbmVudHMuZnJhZ21lbnQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5yZWZlcmVuY2UgPSBcImFic29sdXRlXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnJlZmVyZW5jZSA9IFwidXJpXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy9jaGVjayBmb3IgcmVmZXJlbmNlIGVycm9yc1xyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgJiYgb3B0aW9ucy5yZWZlcmVuY2UgIT09IFwic3VmZml4XCIgJiYgb3B0aW9ucy5yZWZlcmVuY2UgIT09IGNvbXBvbmVudHMucmVmZXJlbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVSSSBpcyBub3QgYSBcIiArIG9wdGlvbnMucmVmZXJlbmNlICsgXCIgcmVmZXJlbmNlLlwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vZmluZCBzY2hlbWUgaGFuZGxlclxyXG4gICAgICAgICAgICBzY2hlbWVIYW5kbGVyID0gU0NIRU1FU1sob3B0aW9ucy5zY2hlbWUgfHwgY29tcG9uZW50cy5zY2hlbWUgfHwgXCJcIikudG9Mb3dlckNhc2UoKV07XHJcbiAgICAgICAgICAgIC8vY2hlY2sgaWYgc2NoZW1lIGNhbid0IGhhbmRsZSBJUklzXHJcbiAgICAgICAgICAgIGlmIChVUklfX0lSSV9TVVBQT1JUICYmIHR5cGVvZiBwdW55Y29kZSAhPT0gXCJ1bmRlZmluZWRcIiAmJiAhb3B0aW9ucy51bmljb2RlU3VwcG9ydCAmJiAoIXNjaGVtZUhhbmRsZXIgfHwgIXNjaGVtZUhhbmRsZXIudW5pY29kZVN1cHBvcnQpKSB7XHJcbiAgICAgICAgICAgICAgICAvL2lmIGhvc3QgY29tcG9uZW50IGlzIGEgZG9tYWluIG5hbWVcclxuICAgICAgICAgICAgICAgIGlmIChjb21wb25lbnRzLmhvc3QgJiYgKG9wdGlvbnMuZG9tYWluSG9zdCB8fCAoc2NoZW1lSGFuZGxlciAmJiBzY2hlbWVIYW5kbGVyLmRvbWFpbkhvc3QpKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vY29udmVydCBVbmljb2RlIElETiAtPiBBU0NJSSBJRE5cclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLmhvc3QgPSBwdW55Y29kZS50b0FTQ0lJKGNvbXBvbmVudHMuaG9zdC5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBwY3REZWNDaGFycykudG9Mb3dlckNhc2UoKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiSG9zdCdzIGRvbWFpbiBuYW1lIGNhbiBub3QgYmUgY29udmVydGVkIHRvIEFTQ0lJIHZpYSBwdW55Y29kZTogXCIgKyBlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIC8vY29udmVydCBJUkkgLT4gVVJJXHJcbiAgICAgICAgICAgICAgICBfbm9ybWFsaXplQ29tcG9uZW50RW5jb2RpbmcoY29tcG9uZW50cywgVVJJX1BST1RPQ09MKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vbm9ybWFsaXplIGVuY29kaW5nc1xyXG4gICAgICAgICAgICAgICAgX25vcm1hbGl6ZUNvbXBvbmVudEVuY29kaW5nKGNvbXBvbmVudHMsIHByb3RvY29sKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvL3BlcmZvcm0gc2NoZW1lIHNwZWNpZmljIHBhcnNpbmdcclxuICAgICAgICAgICAgaWYgKHNjaGVtZUhhbmRsZXIgJiYgc2NoZW1lSGFuZGxlci5wYXJzZSkge1xyXG4gICAgICAgICAgICAgICAgc2NoZW1lSGFuZGxlci5wYXJzZShjb21wb25lbnRzLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgcGFyc2VFcnJvciA9IHRydWU7XHJcbiAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiVVJJIGNhbiBub3QgYmUgcGFyc2VkLlwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcclxuICAgIH1cclxuICAgIDtcclxuICAgIGZ1bmN0aW9uIF9yZWNvbXBvc2VBdXRob3JpdHkoY29tcG9uZW50cywgb3B0aW9ucykge1xyXG4gICAgICAgIHZhciB1cmlUb2tlbnMgPSBbXTtcclxuICAgICAgICBpZiAoY29tcG9uZW50cy51c2VyaW5mbyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMudXNlcmluZm8pO1xyXG4gICAgICAgICAgICB1cmlUb2tlbnMucHVzaChcIkBcIik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjb21wb25lbnRzLmhvc3QgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB1cmlUb2tlbnMucHVzaChjb21wb25lbnRzLmhvc3QpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodHlwZW9mIGNvbXBvbmVudHMucG9ydCA9PT0gXCJudW1iZXJcIikge1xyXG4gICAgICAgICAgICB1cmlUb2tlbnMucHVzaChcIjpcIik7XHJcbiAgICAgICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMucG9ydC50b1N0cmluZygxMCkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdXJpVG9rZW5zLmxlbmd0aCA/IHVyaVRva2Vucy5qb2luKFwiXCIpIDogdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgZnVuY3Rpb24gcmVtb3ZlRG90U2VnbWVudHMoaW5wdXQpIHtcclxuICAgICAgICB2YXIgb3V0cHV0ID0gW10sIHM7XHJcbiAgICAgICAgd2hpbGUgKGlucHV0Lmxlbmd0aCkge1xyXG4gICAgICAgICAgICBpZiAoaW5wdXQubWF0Y2goUkRTMSkpIHtcclxuICAgICAgICAgICAgICAgIGlucHV0ID0gaW5wdXQucmVwbGFjZShSRFMxLCBcIlwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmIChpbnB1dC5tYXRjaChSRFMyKSkge1xyXG4gICAgICAgICAgICAgICAgaW5wdXQgPSBpbnB1dC5yZXBsYWNlKFJEUzIsIFwiL1wiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmIChpbnB1dC5tYXRjaChSRFMzKSkge1xyXG4gICAgICAgICAgICAgICAgaW5wdXQgPSBpbnB1dC5yZXBsYWNlKFJEUzMsIFwiL1wiKTtcclxuICAgICAgICAgICAgICAgIG91dHB1dC5wb3AoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlIGlmIChpbnB1dCA9PT0gXCIuXCIgfHwgaW5wdXQgPT09IFwiLi5cIikge1xyXG4gICAgICAgICAgICAgICAgaW5wdXQgPSBcIlwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcyA9IGlucHV0Lm1hdGNoKFJEUzUpWzBdO1xyXG4gICAgICAgICAgICAgICAgaW5wdXQgPSBpbnB1dC5zbGljZShzLmxlbmd0aCk7XHJcbiAgICAgICAgICAgICAgICBvdXRwdXQucHVzaChzKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gb3V0cHV0LmpvaW4oXCJcIik7XHJcbiAgICB9XHJcbiAgICA7XHJcbiAgICBmdW5jdGlvbiBzZXJpYWxpemUoY29tcG9uZW50cywgb3B0aW9ucykge1xyXG4gICAgICAgIGlmIChvcHRpb25zID09PSB2b2lkIDApIHsgb3B0aW9ucyA9IHt9OyB9XHJcbiAgICAgICAgdmFyIHByb3RvY29sID0gKFVSSV9fSVJJX1NVUFBPUlQgJiYgb3B0aW9ucy5pcmkgPyBJUklfUFJPVE9DT0wgOiBVUklfUFJPVE9DT0wpLCB1cmlUb2tlbnMgPSBbXSwgc2NoZW1lSGFuZGxlciwgYXV0aG9yaXR5LCBzO1xyXG4gICAgICAgIC8vZmluZCBzY2hlbWUgaGFuZGxlclxyXG4gICAgICAgIHNjaGVtZUhhbmRsZXIgPSBTQ0hFTUVTWyhvcHRpb25zLnNjaGVtZSB8fCBjb21wb25lbnRzLnNjaGVtZSB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpXTtcclxuICAgICAgICAvL3BlcmZvcm0gc2NoZW1lIHNwZWNpZmljIHNlcmlhbGl6YXRpb25cclxuICAgICAgICBpZiAoc2NoZW1lSGFuZGxlciAmJiBzY2hlbWVIYW5kbGVyLnNlcmlhbGl6ZSlcclxuICAgICAgICAgICAgc2NoZW1lSGFuZGxlci5zZXJpYWxpemUoY29tcG9uZW50cywgb3B0aW9ucyk7XHJcbiAgICAgICAgLy9pZiBob3N0IGNvbXBvbmVudCBpcyBhIGRvbWFpbiBuYW1lXHJcbiAgICAgICAgaWYgKFVSSV9fSVJJX1NVUFBPUlQgJiYgdHlwZW9mIHB1bnljb2RlICE9PSBcInVuZGVmaW5lZFwiICYmIGNvbXBvbmVudHMuaG9zdCAmJiAob3B0aW9ucy5kb21haW5Ib3N0IHx8IChzY2hlbWVIYW5kbGVyICYmIHNjaGVtZUhhbmRsZXIuZG9tYWluSG9zdCkpKSB7XHJcbiAgICAgICAgICAgIC8vY29udmVydCBJRE4gdmlhIHB1bnljb2RlXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLmhvc3QgPSAoIW9wdGlvbnMuaXJpID8gcHVueWNvZGUudG9BU0NJSShjb21wb25lbnRzLmhvc3QucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgcGN0RGVjQ2hhcnMpLnRvTG93ZXJDYXNlKCkpIDogcHVueWNvZGUudG9Vbmljb2RlKGNvbXBvbmVudHMuaG9zdCkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIkhvc3QncyBkb21haW4gbmFtZSBjYW4gbm90IGJlIGNvbnZlcnRlZCB0byBcIiArICghb3B0aW9ucy5pcmkgPyBcIkFTQ0lJXCIgOiBcIlVuaWNvZGVcIikgKyBcIiB2aWEgcHVueWNvZGU6IFwiICsgZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICAvL25vcm1hbGl6ZSBlbmNvZGluZ1xyXG4gICAgICAgIF9ub3JtYWxpemVDb21wb25lbnRFbmNvZGluZyhjb21wb25lbnRzLCBwcm90b2NvbCk7XHJcbiAgICAgICAgaWYgKG9wdGlvbnMucmVmZXJlbmNlICE9PSBcInN1ZmZpeFwiICYmIGNvbXBvbmVudHMuc2NoZW1lKSB7XHJcbiAgICAgICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMuc2NoZW1lKTtcclxuICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2goXCI6XCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhdXRob3JpdHkgPSBfcmVjb21wb3NlQXV0aG9yaXR5KGNvbXBvbmVudHMsIG9wdGlvbnMpO1xyXG4gICAgICAgIGlmIChhdXRob3JpdHkgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgIT09IFwic3VmZml4XCIpIHtcclxuICAgICAgICAgICAgICAgIHVyaVRva2Vucy5wdXNoKFwiLy9cIik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2goYXV0aG9yaXR5KTtcclxuICAgICAgICAgICAgaWYgKGNvbXBvbmVudHMucGF0aCAmJiBjb21wb25lbnRzLnBhdGguY2hhckF0KDApICE9PSBcIi9cIikge1xyXG4gICAgICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2goXCIvXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjb21wb25lbnRzLnBhdGggIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBzID0gY29tcG9uZW50cy5wYXRoO1xyXG4gICAgICAgICAgICBpZiAoIW9wdGlvbnMuYWJzb2x1dGVQYXRoICYmICghc2NoZW1lSGFuZGxlciB8fCAhc2NoZW1lSGFuZGxlci5hYnNvbHV0ZVBhdGgpKSB7XHJcbiAgICAgICAgICAgICAgICBzID0gcmVtb3ZlRG90U2VnbWVudHMocyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGF1dGhvcml0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBzID0gcy5yZXBsYWNlKC9eXFwvXFwvLywgXCIvJTJGXCIpOyAvL2Rvbid0IGFsbG93IHRoZSBwYXRoIHRvIHN0YXJ0IHdpdGggXCIvL1wiXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2gocyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjb21wb25lbnRzLnF1ZXJ5ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2goXCI/XCIpO1xyXG4gICAgICAgICAgICB1cmlUb2tlbnMucHVzaChjb21wb25lbnRzLnF1ZXJ5KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGNvbXBvbmVudHMuZnJhZ21lbnQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB1cmlUb2tlbnMucHVzaChcIiNcIik7XHJcbiAgICAgICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMuZnJhZ21lbnQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdXJpVG9rZW5zLmpvaW4oJycpOyAvL21lcmdlIHRva2VucyBpbnRvIGEgc3RyaW5nXHJcbiAgICB9XHJcbiAgICA7XHJcbiAgICBmdW5jdGlvbiByZXNvbHZlQ29tcG9uZW50cyhiYXNlLCByZWxhdGl2ZSwgb3B0aW9ucywgc2tpcE5vcm1hbGl6YXRpb24pIHtcclxuICAgICAgICBpZiAob3B0aW9ucyA9PT0gdm9pZCAwKSB7IG9wdGlvbnMgPSB7fTsgfVxyXG4gICAgICAgIHZhciB0YXJnZXQgPSB7fTtcclxuICAgICAgICBpZiAoIXNraXBOb3JtYWxpemF0aW9uKSB7XHJcbiAgICAgICAgICAgIGJhc2UgPSBwYXJzZShzZXJpYWxpemUoYmFzZSwgb3B0aW9ucyksIG9wdGlvbnMpOyAvL25vcm1hbGl6ZSBiYXNlIGNvbXBvbmVudHNcclxuICAgICAgICAgICAgcmVsYXRpdmUgPSBwYXJzZShzZXJpYWxpemUocmVsYXRpdmUsIG9wdGlvbnMpLCBvcHRpb25zKTsgLy9ub3JtYWxpemUgcmVsYXRpdmUgY29tcG9uZW50c1xyXG4gICAgICAgIH1cclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBpZiAoIW9wdGlvbnMudG9sZXJhbnQgJiYgcmVsYXRpdmUuc2NoZW1lKSB7XHJcbiAgICAgICAgICAgIHRhcmdldC5zY2hlbWUgPSByZWxhdGl2ZS5zY2hlbWU7XHJcbiAgICAgICAgICAgIC8vdGFyZ2V0LmF1dGhvcml0eSA9IHJlbGF0aXZlLmF1dGhvcml0eTtcclxuICAgICAgICAgICAgdGFyZ2V0LnVzZXJpbmZvID0gcmVsYXRpdmUudXNlcmluZm87XHJcbiAgICAgICAgICAgIHRhcmdldC5ob3N0ID0gcmVsYXRpdmUuaG9zdDtcclxuICAgICAgICAgICAgdGFyZ2V0LnBvcnQgPSByZWxhdGl2ZS5wb3J0O1xyXG4gICAgICAgICAgICB0YXJnZXQucGF0aCA9IHJlbW92ZURvdFNlZ21lbnRzKHJlbGF0aXZlLnBhdGgpO1xyXG4gICAgICAgICAgICB0YXJnZXQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgIGlmIChyZWxhdGl2ZS51c2VyaW5mbyAhPT0gdW5kZWZpbmVkIHx8IHJlbGF0aXZlLmhvc3QgIT09IHVuZGVmaW5lZCB8fCByZWxhdGl2ZS5wb3J0ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIC8vdGFyZ2V0LmF1dGhvcml0eSA9IHJlbGF0aXZlLmF1dGhvcml0eTtcclxuICAgICAgICAgICAgICAgIHRhcmdldC51c2VyaW5mbyA9IHJlbGF0aXZlLnVzZXJpbmZvO1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0Lmhvc3QgPSByZWxhdGl2ZS5ob3N0O1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0LnBvcnQgPSByZWxhdGl2ZS5wb3J0O1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0LnBhdGggPSByZW1vdmVEb3RTZWdtZW50cyhyZWxhdGl2ZS5wYXRoKTtcclxuICAgICAgICAgICAgICAgIHRhcmdldC5xdWVyeSA9IHJlbGF0aXZlLnF1ZXJ5O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFyZWxhdGl2ZS5wYXRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LnBhdGggPSBiYXNlLnBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlbGF0aXZlLnF1ZXJ5ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LnF1ZXJ5ID0gcmVsYXRpdmUucXVlcnk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucXVlcnkgPSBiYXNlLnF1ZXJ5O1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChyZWxhdGl2ZS5wYXRoLmNoYXJBdCgwKSA9PT0gXCIvXCIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LnBhdGggPSByZW1vdmVEb3RTZWdtZW50cyhyZWxhdGl2ZS5wYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgoYmFzZS51c2VyaW5mbyAhPT0gdW5kZWZpbmVkIHx8IGJhc2UuaG9zdCAhPT0gdW5kZWZpbmVkIHx8IGJhc2UucG9ydCAhPT0gdW5kZWZpbmVkKSAmJiAhYmFzZS5wYXRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IFwiL1wiICsgcmVsYXRpdmUucGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICghYmFzZS5wYXRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IHJlbGF0aXZlLnBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IGJhc2UucGF0aC5zbGljZSgwLCBiYXNlLnBhdGgubGFzdEluZGV4T2YoXCIvXCIpICsgMSkgKyByZWxhdGl2ZS5wYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gcmVtb3ZlRG90U2VnbWVudHModGFyZ2V0LnBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0YXJnZXQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIC8vdGFyZ2V0LmF1dGhvcml0eSA9IGJhc2UuYXV0aG9yaXR5O1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0LnVzZXJpbmZvID0gYmFzZS51c2VyaW5mbztcclxuICAgICAgICAgICAgICAgIHRhcmdldC5ob3N0ID0gYmFzZS5ob3N0O1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0LnBvcnQgPSBiYXNlLnBvcnQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGFyZ2V0LnNjaGVtZSA9IGJhc2Uuc2NoZW1lO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0YXJnZXQuZnJhZ21lbnQgPSByZWxhdGl2ZS5mcmFnbWVudDtcclxuICAgICAgICByZXR1cm4gdGFyZ2V0O1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgZnVuY3Rpb24gcmVzb2x2ZShiYXNlVVJJLCByZWxhdGl2ZVVSSSwgb3B0aW9ucykge1xyXG4gICAgICAgIHJldHVybiBzZXJpYWxpemUocmVzb2x2ZUNvbXBvbmVudHMocGFyc2UoYmFzZVVSSSwgb3B0aW9ucyksIHBhcnNlKHJlbGF0aXZlVVJJLCBvcHRpb25zKSwgb3B0aW9ucywgdHJ1ZSksIG9wdGlvbnMpO1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplKHVyaSwgb3B0aW9ucykge1xyXG4gICAgICAgIGlmICh0eXBlb2YgdXJpID09PSBcInN0cmluZ1wiKSB7XHJcbiAgICAgICAgICAgIHVyaSA9IHNlcmlhbGl6ZShwYXJzZSh1cmksIG9wdGlvbnMpLCBvcHRpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAodHlwZU9mKHVyaSkgPT09IFwib2JqZWN0XCIpIHtcclxuICAgICAgICAgICAgdXJpID0gcGFyc2Uoc2VyaWFsaXplKHVyaSwgb3B0aW9ucyksIG9wdGlvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdXJpO1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgZnVuY3Rpb24gZXF1YWwodXJpQSwgdXJpQiwgb3B0aW9ucykge1xyXG4gICAgICAgIGlmICh0eXBlb2YgdXJpQSA9PT0gXCJzdHJpbmdcIikge1xyXG4gICAgICAgICAgICB1cmlBID0gc2VyaWFsaXplKHBhcnNlKHVyaUEsIG9wdGlvbnMpLCBvcHRpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAodHlwZU9mKHVyaUEpID09PSBcIm9iamVjdFwiKSB7XHJcbiAgICAgICAgICAgIHVyaUEgPSBzZXJpYWxpemUodXJpQSwgb3B0aW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0eXBlb2YgdXJpQiA9PT0gXCJzdHJpbmdcIikge1xyXG4gICAgICAgICAgICB1cmlCID0gc2VyaWFsaXplKHBhcnNlKHVyaUIsIG9wdGlvbnMpLCBvcHRpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAodHlwZU9mKHVyaUIpID09PSBcIm9iamVjdFwiKSB7XHJcbiAgICAgICAgICAgIHVyaUIgPSBzZXJpYWxpemUodXJpQiwgb3B0aW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB1cmlBID09PSB1cmlCO1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgZnVuY3Rpb24gZXNjYXBlQ29tcG9uZW50KHN0ciwgb3B0aW9ucykge1xyXG4gICAgICAgIHJldHVybiBzdHIgJiYgc3RyLnRvU3RyaW5nKCkucmVwbGFjZSgoIVVSSV9fSVJJX1NVUFBPUlQgfHwgIW9wdGlvbnMgfHwgIW9wdGlvbnMuaXJpID8gVVJJX1BST1RPQ09MLkVTQ0FQRSA6IElSSV9QUk9UT0NPTC5FU0NBUEUpLCBwY3RFbmNDaGFyKTtcclxuICAgIH1cclxuICAgIDtcclxuICAgIGZ1bmN0aW9uIHVuZXNjYXBlQ29tcG9uZW50KHN0ciwgb3B0aW9ucykge1xyXG4gICAgICAgIHJldHVybiBzdHIgJiYgc3RyLnRvU3RyaW5nKCkucmVwbGFjZSgoIVVSSV9fSVJJX1NVUFBPUlQgfHwgIW9wdGlvbnMgfHwgIW9wdGlvbnMuaXJpID8gVVJJX1BST1RPQ09MLlBDVF9FTkNPREVEIDogSVJJX1BST1RPQ09MLlBDVF9FTkNPREVEKSwgcGN0RGVjQ2hhcnMpO1xyXG4gICAgfVxyXG4gICAgO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBJUklfU1VQUE9SVDogVVJJX19JUklfU1VQUE9SVCxcclxuICAgICAgICBWQUxJREFURV9TVVBQT1JUOiBVUklfX1ZBTElEQVRFX1NVUFBPUlQsXHJcbiAgICAgICAgcGN0RW5jQ2hhcjogcGN0RW5jQ2hhcixcclxuICAgICAgICBwY3REZWNDaGFyczogcGN0RGVjQ2hhcnMsXHJcbiAgICAgICAgU0NIRU1FUzogU0NIRU1FUyxcclxuICAgICAgICBwYXJzZTogcGFyc2UsXHJcbiAgICAgICAgX3JlY29tcG9zZUF1dGhvcml0eTogX3JlY29tcG9zZUF1dGhvcml0eSxcclxuICAgICAgICByZW1vdmVEb3RTZWdtZW50czogcmVtb3ZlRG90U2VnbWVudHMsXHJcbiAgICAgICAgc2VyaWFsaXplOiBzZXJpYWxpemUsXHJcbiAgICAgICAgcmVzb2x2ZUNvbXBvbmVudHM6IHJlc29sdmVDb21wb25lbnRzLFxyXG4gICAgICAgIHJlc29sdmU6IHJlc29sdmUsXHJcbiAgICAgICAgbm9ybWFsaXplOiBub3JtYWxpemUsXHJcbiAgICAgICAgZXF1YWw6IGVxdWFsLFxyXG4gICAgICAgIGVzY2FwZUNvbXBvbmVudDogZXNjYXBlQ29tcG9uZW50LFxyXG4gICAgICAgIHVuZXNjYXBlQ29tcG9uZW50OiB1bmVzY2FwZUNvbXBvbmVudFxyXG4gICAgfTtcclxufSkoKTtcclxuaWYgKCFDT01QSUxFRCAmJiB0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiICYmIHR5cGVvZiByZXF1aXJlID09PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgIHZhciBwdW55Y29kZSA9IHJlcXVpcmUoXCIuL3B1bnljb2RlXCIpO1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBVUkk7XHJcbiAgICByZXF1aXJlKFwiLi9zY2hlbWVzXCIpO1xyXG59XHJcbiJdfQ==
