(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.JsonRefs = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global){
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

// Cherry-pick lodash components to help with size
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var gl = (typeof window !== "undefined" ? window['graphlib'] : typeof global !== "undefined" ? global['graphlib'] : null);
var path = require('path');
var PathLoader = (typeof window !== "undefined" ? window['PathLoader'] : typeof global !== "undefined" ? global['PathLoader'] : null);
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

function combineQueryParams (qs1, qs2) {
  var combined = {};

  function mergeQueryParams (obj) {
    _.each(obj, function (val, key) {
      combined[key] = val;
    });
  }

  mergeQueryParams(qs.parse(qs1 || ''));
  mergeQueryParams(qs.parse(qs2 || ''));

  return Object.keys(combined).length === 0 ? undefined : qs.stringify(combined);
}

function combineURIs (u1, u2) {
  // Convert Windows paths
  if (_.isString(u1)) {
    u1 = slash(u1);
  }

  if (_.isString(u2)) {
    u2 = slash(u2);
  }

  var u2Details = parseURI(_.isUndefined(u2) ? '' : u2);
  var u1Details;
  var combinedDetails;

  if (remoteUriTypes.indexOf(u2Details.reference) > -1) {
    combinedDetails = u2Details;
  } else {
    u1Details = _.isUndefined(u1) ? undefined : parseURI(u1);

    if (!_.isUndefined(u1Details)) {
      combinedDetails = u1Details;

      // Join the paths
      combinedDetails.path = slash(path.join(u1Details.path, u2Details.path));

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

function isRemote (refDetails) {
  return remoteTypes.indexOf(getRefType(refDetails)) > -1;
}

function isValid (refDetails) {
  return _.isUndefined(refDetails.error) && refDetails.type !== 'invalid';
}

function findValue (obj, path) {
  var value = obj;

  // Using this manual approach instead of _.get since we have to decodeURI the segments
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
  var loaderOptions = _.cloneDeep(options.loaderOptions || {});

  if (_.isUndefined(cacheEntry)) {
    // If there is no content processor, default to processing the raw response as JSON
    if (_.isUndefined(loaderOptions.processContent)) {
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
      if (_.isError(cacheEntry.error)) {
        throw cacheEntry.error;
      } else {
        return cacheEntry.value;
      }
    });
  }

  // Return a cloned version to avoid updating the cache
  allTasks = allTasks.then(function (res) {
    return _.cloneDeep(res);
  });

  return allTasks;
}

function isRefLike (obj, throwWithDetails) {
  var refLike = true;

  try {
    if (!_.isPlainObject(obj)) {
      throw new Error('obj is not an Object');
    } else if (!_.isString(obj.$ref)) {
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

function makeAbsolute (location) {
  if (location.indexOf('://') === -1 && !path.isAbsolute(location)) {
    return path.resolve(process.cwd(), location);
  } else {
    return location;
  }
}

function makeRefFilter (options) {
  var refFilter;
  var validTypes;

  if (_.isArray(options.filter) || _.isString(options.filter)) {
    validTypes = _.isString(options.filter) ? [options.filter] : options.filter;
    refFilter = function (refDetails) {
      // Check the exact type or for invalid URIs, check its original type
      return validTypes.indexOf(refDetails.type) > -1 || validTypes.indexOf(getRefType(refDetails)) > -1;
    };
  } else if (_.isFunction(options.filter)) {
    refFilter = options.filter;
  } else if (_.isUndefined(options.filter)) {
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

  if (_.isArray(options.subDocPath)) {
    subDocPath = options.subDocPath;
  } else if (_.isString(options.subDocPath)) {
    subDocPath = pathFromPtr(options.subDocPath);
  } else if (_.isUndefined(options.subDocPath)) {
    subDocPath = [];
  }

  return subDocPath;
}

function markMissing (refDetails, err) {
  refDetails.error = err.message;
  refDetails.missing = true;
}

function parseURI (uri) {
  // We decode first to avoid doubly encoding
  return URI.parse(encodeURI(decodeURI(uri)));
}

function buildRefModel (document, options, metadata) {
  var allTasks = Promise.resolve();
  var subDocPtr = pathToPtr(options.subDocPath);
  var absLocation = makeAbsolute(options.location);
  var relativeBase = path.dirname(options.location);
  var docDepKey = absLocation + subDocPtr;
  var refs;
  var rOptions;

  // Store the document in the metadata if necessary
  if (_.isUndefined(metadata.docs[absLocation])) {
    metadata.docs[absLocation] = document;
  }

  // If there are no dependencies stored for the location+subDocPath, we've never seen it before and will process it
  if (_.isUndefined(metadata.deps[docDepKey])) {
    metadata.deps[docDepKey] = {};

    // Find the references based on the options
    refs = findRefs(document, options);

    // Iterate over the references and process
    _.each(refs, function (refDetails, refPtr) {
      var refKey = makeAbsolute(options.location) + refPtr;
      var refdKey = refDetails.refdId = makeAbsolute(isRemote(refDetails) ?
                                                       combineURIs(relativeBase, refDetails.uri) :
                                                       options.location) + '#' +
                                          (refDetails.uri.indexOf('#') > -1 ?
                                             refDetails.uri.split('#')[1] :
                                             '');

      // Record reference metadata
      metadata.refs[refKey] = refDetails;

      // Do not process invalid references
      if (!isValid(refDetails)) {
        return;
      }

      // Record dependency (relative to the document's sub-document path)
      metadata.deps[docDepKey][refPtr === subDocPtr ? '#' : refPtr.replace(subDocPtr + '/', '#/')] = refdKey;

      // Do not process directly-circular references (to an ancestor or self)
      if (refKey.indexOf(refdKey + '/') === 0) {
        refDetails.circular = true;

        return;
      }

      // Prepare the options for subsequent processDocument calls
      rOptions = _.cloneDeep(options);

      rOptions.subDocPath = _.isUndefined(refDetails.uriDetails.fragment) ?
                                     [] :
                                     pathFromPtr(decodeURI(refDetails.uriDetails.fragment));

      // Resolve the reference
      if (isRemote(refDetails)) {
        // Delete filter.options because all remote references should be fully resolved
        delete rOptions.filter;
        // The new location being referenced
        rOptions.location = refdKey.split('#')[0];

        allTasks = allTasks
          .then(function (nMetadata, nOptions) {
            return function () {
              var rAbsLocation = makeAbsolute(nOptions.location);
              var rDoc = nMetadata.docs[rAbsLocation];

              if (_.isUndefined(rDoc)) {
                // We have no cache so we must retrieve the document
                return getRemoteDocument(rAbsLocation, nOptions)
                        .catch(function (err) {
                          // Store the response in the document cache
                          nMetadata.docs[rAbsLocation] = err;

                          // Return the error to allow the subsequent `then` to handle both errors and successes
                          return err;
                        });
              } else {
                // We have already retrieved (or attempted to) the document and should use the cached version in the
                // metadata since it could already be processed some.
                return Promise.resolve()
                  .then(function () {
                    return rDoc;
                  });
              }
            };
          }(metadata, rOptions));
      } else {
        allTasks = allTasks
          .then(function () {
            return document;
          });
      }

      // Process the remote document or the referenced portion of the local document
      allTasks = allTasks
        .then(function (nMetadata, nOptions, nRefDetails) {
          return function (doc) {
            if (_.isError(doc)) {
              markMissing(nRefDetails, doc);
            } else {
              // Wrapped in a try/catch since findRefs throws
              try {
                return buildRefModel(doc, nOptions, nMetadata)
                  .catch(function (err) {
                    markMissing(nRefDetails, err);
                  });
              } catch (err) {
                markMissing(nRefDetails, err);
              }
            }
          };
        }(metadata, rOptions, refDetails));
    });
  }

  return allTasks;
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
  if (_.isFunction(fn)) {
    processChildren = fn(ancestors, node, path);
  }

  // We do not process circular objects again
  if (ancestors.indexOf(node) === -1) {
    ancestors.push(node);

    if (processChildren !== false) {
      if (_.isArray(node)) {
        node.forEach(function (member, index) {
          walkItem(member, index.toString());
        });
      } else if (_.isObject(node)) {
        _.each(node, function (cNode, key) {
          walkItem(cNode, key);
        });
      }
    }

    ancestors.pop();
  }
}

function validateOptions (options, obj) {
  var locationParts;

  if (_.isUndefined(options)) {
    // Default to an empty options object
    options = {};
  } else {
    // Clone the options so we do not alter the ones passed in
    options = _.cloneDeep(options);
  }

  if (!_.isObject(options)) {
    throw new TypeError('options must be an Object');
  } else if (!_.isUndefined(options.resolveCirculars) &&
             !_.isBoolean(options.resolveCirculars)) {
    throw new TypeError('options.resolveCirculars must be a Boolean');
  } else if (!_.isUndefined(options.filter) &&
             !_.isArray(options.filter) &&
             !_.isFunction(options.filter) &&
             !_.isString(options.filter)) {
    throw new TypeError('options.filter must be an Array, a Function of a String');
  } else if (!_.isUndefined(options.includeInvalid) &&
             !_.isBoolean(options.includeInvalid)) {
    throw new TypeError('options.includeInvalid must be a Boolean');
  } else if (!_.isUndefined(options.location) &&
             !_.isString(options.location)) {
    throw new TypeError('options.location must be a String');
  } else if (!_.isUndefined(options.refPreProcessor) &&
             !_.isFunction(options.refPreProcessor)) {
    throw new TypeError('options.refPreProcessor must be a Function');
  } else if (!_.isUndefined(options.refPostProcessor) &&
             !_.isFunction(options.refPostProcessor)) {
    throw new TypeError('options.refPostProcessor must be a Function');
  } else if (!_.isUndefined(options.subDocPath) &&
             !_.isArray(options.subDocPath) &&
             !isPtr(options.subDocPath)) {
    // If a pointer is provided, throw an error if it's not the proper type
    throw new TypeError('options.subDocPath must be an Array of path segments or a valid JSON Pointer');
  }

  // Default to false for allowing circulars
  if (_.isUndefined(options.resolveCirculars)) {
    options.resolveCirculars = false;
  }

  options.filter = makeRefFilter(options);

  // options.location is not officially supported yet but will be when Issue 88 is complete
  if (_.isUndefined(options.location)) {
    options.location = makeAbsolute('./root.json');
  }

  locationParts = options.location.split('#');

  // If options.location contains a fragment, turn it into an options.subDocPath
  if (locationParts.length > 1) {
    options.subDocPath = '#' + locationParts[1];
  }

  // Just to be safe, remove any accidental fragment as it would break things
  options.location = combineURIs(options.location, undefined);

  // Set the subDocPath to avoid everyone else having to compute it
  options.subDocPath = makeSubDocPath(options);

  if (!_.isUndefined(obj)) {
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
 * @param {string} [location=root.json] - The location of the document being processed  *(This property is only useful
 * when resolving references as it will be used to locate relative references found within the document being resolved.
 * If this value is relative, {@link https://github.com/whitlockjc/path-loader|path-loader} will use
 * `window.location.href` for the browser and `process.cwd()` for Node.js.)*
 * @param {module:JsonRefs~RefPreProcessor} [refPreProcessor] - The callback used to pre-process a JSON Reference like
 * object *(This is called prior to validating the JSON Reference like object and getting its details)*
 * @param {module:JsonRefs~RefPostProcessor} [refPostProcessor] - The callback used to post-process the JSON Reference
 * metadata *(This is called prior filtering the references)*
 * @param {boolean} [resolveCirculars=false] - Whether to resolve circular references
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
 * @typedef {module:JsonRefs~UnresolvedRefDetails} ResolvedRefDetails
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
 * @property {object} resolved - The array/object with its JSON References fully resolved
 */

/**
 * An object containing the retrieved document and detailed information about its JSON References.
 *
 * @typedef {module:JsonRefs~ResolvedRefsResults} RetrievedRefsResults
 *
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
  if (!_.isArray(path)) {
    throw new TypeError('path must be an array');
  }

  return path.map(function (seg) {
    if (!_.isString(seg)) {
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
  if (!_.isArray(path)) {
    throw new TypeError('path must be an array');
  }

  return path.map(function (seg) {
    if (!_.isString(seg)) {
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
  if (!_.isArray(obj) && !_.isObject(obj)) {
    throw new TypeError('obj must be an Array or an Object');
  }

  // Validate options
  options = validateOptions(options, obj);

  // Walk the document (or sub document) and find all JSON References
  walk(findAncestors(obj, options.subDocPath),
       findValue(obj, options.subDocPath),
       _.cloneDeep(options.subDocPath),
       function (ancestors, node, path) {
         var processChildren = true;
         var refDetails;
         var refPtr;

         if (isRefLike(node)) {
           // Pre-process the node when necessary
           if (!_.isUndefined(options.refPreProcessor)) {
             node = options.refPreProcessor(_.cloneDeep(node), path);
           }

           refDetails = getRefDetails(node);

           // Post-process the reference details
           if (!_.isUndefined(options.refPostProcessor)) {
             refDetails = options.refPostProcessor(refDetails, path);
           }

           if (options.filter(refDetails, path)) {
             refPtr = pathToPtr(path);

             refs[refPtr] = refDetails;
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
      if (!_.isString(location)) {
        throw new TypeError('location must be a string');
      }

      if (_.isUndefined(options)) {
        options = {};
      }

      if (_.isObject(options)) {
        // Add the location to the options for processing/validation
        options.location = location;
      }

      // Validate options
      options = validateOptions(options);

      return getRemoteDocument(options.location, options);
    })
    .then(function (res) {
      var cacheEntry = _.cloneDeep(remoteCache[options.location]);
      var cOptions = _.cloneDeep(options);
      var uriDetails = parseURI(options.location);

      if (_.isUndefined(cacheEntry.refs)) {
        // Do not filter any references so the cache is complete
        delete cOptions.filter;
        delete cOptions.subDocPath;

        cOptions.includeInvalid = true;

        remoteCache[options.location].refs = findRefs(res, cOptions);
      }

      // Add the filter options back
      if (!_.isUndefined(options.filter)) {
        cOptions.filter = options.filter;
      }

      if (!_.isUndefined(uriDetails.fragment)) {
        cOptions.subDocPath = pathFromPtr(decodeURI(uriDetails.fragment));
      } else if (!_.isUndefined(uriDetails.subDocPath)) {
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

      if (_.isUndefined(uriDetails)) {
        uriDetails = uriDetailsCache[cacheKey] = parseURI(cacheKey);
      }

      details.uri = cacheKey;
      details.uriDetails = uriDetails;

      if (_.isUndefined(uriDetails.error)) {
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
    if (_.isString(ptr)) {
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
  try {
    isPtr(ptr, true);
  } catch (err) {
    throw new Error('ptr must be a JSON Pointer: ' + err.message);
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
  if (!_.isArray(path)) {
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
      if (!_.isArray(obj) && !_.isObject(obj)) {
        throw new TypeError('obj must be an Array or an Object');
      }

      // Validate options
      options = validateOptions(options, obj);

      // Clone the input so we do not alter it
      obj = _.cloneDeep(obj);
    })
    .then(function () {
      var metadata = {
        deps: {}, // To avoid processing the same refernece twice, and for circular reference identification
        docs: {}, // Cache to avoid processing the same document more than once
        refs: {} // Reference locations and their metadata
      };

      return buildRefModel(obj, options, metadata)
        .then(function () {
          return metadata;
        });
    })
    .then(function (results) {
      var allRefs = {};
      var circularPaths = [];
      var circulars = [];
      var depGraph = new gl.Graph();
      var fullLocation = makeAbsolute(options.location);
      var refsRoot = fullLocation + pathToPtr(options.subDocPath);

      // Identify circulars

      // Add nodes first
      Object.keys(results.deps).forEach(function (node) {
        depGraph.setNode(node);
      });

      // Add edges
      _.each(results.deps, function (props, node) {
        _.each(props, function (dep) {
          depGraph.setEdge(node, dep);
        });
      });

      circularPaths = gl.alg.findCycles(depGraph);

      // Create a unique list of circulars
      circularPaths.forEach(function (path) {
        path.forEach(function (seg) {
          if (circulars.indexOf(seg) === -1) {
            circulars.push(seg);
          }
        });
      });

      // Process circulars
      _.each(results.deps, function (props, node) {
        _.each(props, function (dep, prop) {
          var isCircular = false;
          var refPtr = node + prop.slice(1);
          var refDetails = results.refs[node + prop.slice(1)];
          var remote = isRemote(refDetails);
          var pathIndex;

          if (circulars.indexOf(dep) > -1) {
            // Figure out if the circular is part of a circular chain or just a reference to a circular
            circularPaths.forEach(function (path) {
              // Short circuit
              if (isCircular) {
                return;
              }

              pathIndex = path.indexOf(dep);

              if (pathIndex > -1) {
                // Check each path segment to see if the reference location is beneath one of its segments
                path.forEach(function (seg) {
                  // Short circuit
                  if (isCircular) {
                    return;
                  }

                  if (refPtr.indexOf(seg + '/') === 0) {
                    // If the reference is local, mark it as circular but if it's a remote reference, only mark it
                    // circular if the matching path is the last path segment.
                    if ((remote && pathIndex === path.length - 1) || !remote) {
                      isCircular = true;
                    }
                  }
                });
              }
            });
          }

          if (isCircular) {
            // Update all references and reference details
            refDetails.circular = true;
          }
        });
      });

      // Resolve the references
      _.each(results.deps, function (deps, parentPtr) {
        var pPtrParts = parentPtr.split('#');
        var pDocument = results.docs[pPtrParts[0]];
        var pPtrPath = pathFromPtr(pPtrParts[1]);

        _.each(deps, function (dep, prop) {
          var depParts = dep.split('#');
          var dDocument = results.docs[depParts[0]];
          var dPtrPath = pPtrPath.concat(pathFromPtr(prop));
          var refDetails = results.refs[pPtrParts[0] + pathToPtr(dPtrPath)];

          // Resolve reference if valid
          if (_.isUndefined(refDetails.error) && _.isUndefined(refDetails.missing)) {
            if (!options.resolveCirculars && refDetails.circular) {
              refDetails.value = refDetails.def;
            } else {
              try {
                refDetails.value = findValue(dDocument, pathFromPtr(depParts[1]));
              } catch (err) {
                markMissing(refDetails, err);

                return;
              }

              // If the reference is at the root of the document, replace the document in the cache.  Otherwise, replace
              // the value in the appropriate location in the document cache.
              if (pPtrParts[1] === '' && prop === '#') {
                results.docs[pPtrParts[0]] = refDetails.value;
              } else {
                setValue(pDocument, dPtrPath, refDetails.value);
              }
            }
          }
        });
      });

      function walkRefs (root, refPtr, refPath) {
        var refPtrParts = refPtr.split('#');
        var refDetails = results.refs[refPtr];
        var refDeps;

        // Record the reference (relative to the root document unless the reference is in the root document)
        allRefs[refPtrParts[0] === options.location ?
                  '#' + refPtrParts[1] :
                  pathToPtr(options.subDocPath.concat(refPath))] = refDetails;

        // Do not walk invalid references
        if (refDetails.circular || !isValid(refDetails)) {
          // Sanitize errors
          if (!refDetails.circular && refDetails.error) {
            // The way we use findRefs now results in an error that doesn't match the expectation
            refDetails.error = refDetails.error.replace('options.subDocPath', 'JSON Pointer');

            // Update the error to use the appropriate JSON Pointer
            if (refDetails.error.indexOf('#') > -1) {
              refDetails.error = refDetails.error.replace(refDetails.uri.substr(refDetails.uri.indexOf('#')),
                                                          refDetails.uri);
            }

            // Report errors opening files as JSON Pointer errors
            if (refDetails.error.indexOf('ENOENT:') === 0 || refDetails.error.indexOf('Not Found') === 0) {
              refDetails.error = 'JSON Pointer points to missing location: ' + refDetails.uri;
            }
          }

          return;
        }

        refDeps = results.deps[refDetails.refdId];

        if (refDetails.refdId.indexOf(root) !== 0) {
          Object.keys(refDeps).forEach(function (prop) {
            walkRefs(refDetails.refdId, refDetails.refdId + prop.substr(1), refPath.concat(pathFromPtr(prop)));
          });
        }
      }

      // For performance reasons, we only process a document (or sub document) and each reference once ever.  This means
      // that if we want to provide the full picture as to what paths in the resolved document were created as a result
      // of a reference, we have to take our fully-qualified reference locations and expand them to be all local based
      // on the original document.
      Object.keys(results.refs).forEach(function (refPtr) {
        // We only want to process references found at or beneath the provided document and sub-document path
        if (refPtr.indexOf(refsRoot) !== 0) {
          return;
        }

        walkRefs(refsRoot, refPtr, pathFromPtr(refPtr.substr(refsRoot.length)));
      });

      // Sanitize the reference details
      _.each(results.refs, function (refDetails) {
        // Delete the reference id used for dependency tracking and circular identification
        delete refDetails.refdId;
      });

      return {
        refs: allRefs,
        resolved: results.docs[fullLocation]
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
      if (!_.isString(location)) {
        throw new TypeError('location must be a string');
      }

      if (_.isUndefined(options)) {
        options = {};
      }

      if (_.isObject(options)) {
        // Add the location to the options for processing/validation
        options.location = location;
      }

      // Validate options
      options = validateOptions(options);

      return getRemoteDocument(options.location, options);
    })
    .then(function (res) {
      var cOptions = _.cloneDeep(options);
      var uriDetails = parseURI(options.location);

      // Set the sub document path if necessary
      if (!_.isUndefined(uriDetails.fragment)) {
        cOptions.subDocPath = pathFromPtr(decodeURI(uriDetails.fragment));
      }

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

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"_process":4,"native-promise-only":2,"path":3,"querystring":7,"slash":8,"uri-js":9}],2:[function(require,module,exports){
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

},{}],3:[function(require,module,exports){
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

},{"_process":4}],4:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
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
    var timeout = runTimeout(cleanUpNextTick);
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
    runClearTimeout(timeout);
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
        runTimeout(drainQueue);
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
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],5:[function(require,module,exports){
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

},{}],6:[function(require,module,exports){
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

},{}],7:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":5,"./encode":6}],8:[function(require,module,exports){
'use strict';
module.exports = function (str) {
	var isExtendedLengthPath = /^\\\\\?\\/.test(str);
	var hasNonAscii = /[^\x00-\x80]+/.test(str);

	if (isExtendedLengthPath || hasNonAscii) {
		return str;
	}

	return str.replace(/\\/g, '/');
};

},{}],9:[function(require,module,exports){
/** @license URI.js v3.0.1 (c) 2011 Gary Court. License: http://github.com/garycourt/uri-js */
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.URI = global.URI || {})));
}(this, (function (exports) { 'use strict';

function merge() {
    for (var _len = arguments.length, sets = Array(_len), _key = 0; _key < _len; _key++) {
        sets[_key] = arguments[_key];
    }

    if (sets.length > 1) {
        sets[0] = sets[0].slice(0, -1);
        var xl = sets.length - 1;
        for (var x = 1; x < xl; ++x) {
            sets[x] = sets[x].slice(1, -1);
        }
        sets[xl] = sets[xl].slice(1);
        return sets.join('');
    } else {
        return sets[0];
    }
}
function subexp(str) {
    return "(?:" + str + ")";
}
function typeOf(o) {
    return o === undefined ? "undefined" : o === null ? "null" : Object.prototype.toString.call(o).split(" ").pop().split("]").shift().toLowerCase();
}
function toUpperCase(str) {
    return str.toUpperCase();
}
function toArray(obj) {
    return obj !== undefined && obj !== null ? obj instanceof Array ? obj : typeof obj.length !== "number" || obj.split || obj.setInterval || obj.call ? [obj] : Array.prototype.slice.call(obj) : [];
}

function buildExps(isIRI) {
    var ALPHA$$ = "[A-Za-z]",
        CR$ = "[\\x0D]",
        DIGIT$$ = "[0-9]",
        DQUOTE$$ = "[\\x22]",
        HEXDIG$$ = merge(DIGIT$$, "[A-Fa-f]"),
        //case-insensitive
    LF$$ = "[\\x0A]",
        SP$$ = "[\\x20]",
        PCT_ENCODED$ = subexp(subexp("%[EFef]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%[89A-Fa-f]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%" + HEXDIG$$ + HEXDIG$$)),
        //expanded
    GEN_DELIMS$$ = "[\\:\\/\\?\\#\\[\\]\\@]",
        SUB_DELIMS$$ = "[\\!\\$\\&\\'\\(\\)\\*\\+\\,\\;\\=]",
        RESERVED$$ = merge(GEN_DELIMS$$, SUB_DELIMS$$),
        UCSCHAR$$ = isIRI ? "[\\xA0-\\u200D\\u2010-\\u2029\\u202F-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF]" : "[]",
        //subset, excludes bidi control characters
    IPRIVATE$$ = isIRI ? "[\\uE000-\\uF8FF]" : "[]",
        //subset
    UNRESERVED$$ = merge(ALPHA$$, DIGIT$$, "[\\-\\.\\_\\~]", UCSCHAR$$),
        SCHEME$ = subexp(ALPHA$$ + merge(ALPHA$$, DIGIT$$, "[\\+\\-\\.]") + "*"),
        USERINFO$ = subexp(subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:]")) + "*"),
        DEC_OCTET$ = subexp(subexp("25[0-5]") + "|" + subexp("2[0-4]" + DIGIT$$) + "|" + subexp("1" + DIGIT$$ + DIGIT$$) + "|" + subexp("[1-9]" + DIGIT$$) + "|" + DIGIT$$),
        IPV4ADDRESS$ = subexp(DEC_OCTET$ + "\\." + DEC_OCTET$ + "\\." + DEC_OCTET$ + "\\." + DEC_OCTET$),
        H16$ = subexp(HEXDIG$$ + "{1,4}"),
        LS32$ = subexp(subexp(H16$ + "\\:" + H16$) + "|" + IPV4ADDRESS$),
        IPV6ADDRESS1$ = subexp(subexp(H16$ + "\\:") + "{6}" + LS32$),
        //                           6( h16 ":" ) ls32
    IPV6ADDRESS2$ = subexp("\\:\\:" + subexp(H16$ + "\\:") + "{5}" + LS32$),
        //                      "::" 5( h16 ":" ) ls32
    IPV6ADDRESS3$ = subexp(subexp(H16$) + "?\\:\\:" + subexp(H16$ + "\\:") + "{4}" + LS32$),
        //[               h16 ] "::" 4( h16 ":" ) ls32
    IPV6ADDRESS4$ = subexp(subexp(subexp(H16$ + "\\:") + "{0,1}" + H16$) + "?\\:\\:" + subexp(H16$ + "\\:") + "{3}" + LS32$),
        //[ *1( h16 ":" ) h16 ] "::" 3( h16 ":" ) ls32
    IPV6ADDRESS5$ = subexp(subexp(subexp(H16$ + "\\:") + "{0,2}" + H16$) + "?\\:\\:" + subexp(H16$ + "\\:") + "{2}" + LS32$),
        //[ *2( h16 ":" ) h16 ] "::" 2( h16 ":" ) ls32
    IPV6ADDRESS6$ = subexp(subexp(subexp(H16$ + "\\:") + "{0,3}" + H16$) + "?\\:\\:" + H16$ + "\\:" + LS32$),
        //[ *3( h16 ":" ) h16 ] "::"    h16 ":"   ls32
    IPV6ADDRESS7$ = subexp(subexp(subexp(H16$ + "\\:") + "{0,4}" + H16$) + "?\\:\\:" + LS32$),
        //[ *4( h16 ":" ) h16 ] "::"              ls32
    IPV6ADDRESS8$ = subexp(subexp(subexp(H16$ + "\\:") + "{0,5}" + H16$) + "?\\:\\:" + H16$),
        //[ *5( h16 ":" ) h16 ] "::"              h16
    IPV6ADDRESS9$ = subexp(subexp(subexp(H16$ + "\\:") + "{0,6}" + H16$) + "?\\:\\:"),
        //[ *6( h16 ":" ) h16 ] "::"
    IPV6ADDRESS$ = subexp([IPV6ADDRESS1$, IPV6ADDRESS2$, IPV6ADDRESS3$, IPV6ADDRESS4$, IPV6ADDRESS5$, IPV6ADDRESS6$, IPV6ADDRESS7$, IPV6ADDRESS8$, IPV6ADDRESS9$].join("|")),
        IPVFUTURE$ = subexp("[vV]" + HEXDIG$$ + "+\\." + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:]") + "+"),
        IP_LITERAL$ = subexp("\\[" + subexp(IPV6ADDRESS$ + "|" + IPVFUTURE$) + "\\]"),
        REG_NAME$ = subexp(subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$)) + "*"),
        HOST$ = subexp(IP_LITERAL$ + "|" + IPV4ADDRESS$ + "(?!" + REG_NAME$ + ")" + "|" + REG_NAME$),
        PORT$ = subexp(DIGIT$$ + "*"),
        AUTHORITY$ = subexp(subexp(USERINFO$ + "@") + "?" + HOST$ + subexp("\\:" + PORT$) + "?"),
        PCHAR$ = subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\:\\@]")),
        SEGMENT$ = subexp(PCHAR$ + "*"),
        SEGMENT_NZ$ = subexp(PCHAR$ + "+"),
        SEGMENT_NZ_NC$ = subexp(subexp(PCT_ENCODED$ + "|" + merge(UNRESERVED$$, SUB_DELIMS$$, "[\\@]")) + "+"),
        PATH_ABEMPTY$ = subexp(subexp("\\/" + SEGMENT$) + "*"),
        PATH_ABSOLUTE$ = subexp("\\/" + subexp(SEGMENT_NZ$ + PATH_ABEMPTY$) + "?"),
        //simplified
    PATH_NOSCHEME$ = subexp(SEGMENT_NZ_NC$ + PATH_ABEMPTY$),
        //simplified
    PATH_ROOTLESS$ = subexp(SEGMENT_NZ$ + PATH_ABEMPTY$),
        //simplified
    PATH_EMPTY$ = "(?!" + PCHAR$ + ")",
        PATH$ = subexp(PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_NOSCHEME$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$),
        QUERY$ = subexp(subexp(PCHAR$ + "|" + merge("[\\/\\?]", IPRIVATE$$)) + "*"),
        FRAGMENT$ = subexp(subexp(PCHAR$ + "|[\\/\\?]") + "*"),
        HIER_PART$ = subexp(subexp("\\/\\/" + AUTHORITY$ + PATH_ABEMPTY$) + "|" + PATH_ABSOLUTE$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$),
        URI$ = subexp(SCHEME$ + "\\:" + HIER_PART$ + subexp("\\?" + QUERY$) + "?" + subexp("\\#" + FRAGMENT$) + "?"),
        RELATIVE_PART$ = subexp(subexp("\\/\\/" + AUTHORITY$ + PATH_ABEMPTY$) + "|" + PATH_ABSOLUTE$ + "|" + PATH_NOSCHEME$ + "|" + PATH_EMPTY$),
        RELATIVE$ = subexp(RELATIVE_PART$ + subexp("\\?" + QUERY$) + "?" + subexp("\\#" + FRAGMENT$) + "?"),
        URI_REFERENCE$ = subexp(URI$ + "|" + RELATIVE$),
        ABSOLUTE_URI$ = subexp(SCHEME$ + "\\:" + HIER_PART$ + subexp("\\?" + QUERY$) + "?"),
        GENERIC_REF$ = "^(" + SCHEME$ + ")\\:" + subexp(subexp("\\/\\/(" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?)") + "?(" + PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$ + ")") + subexp("\\?(" + QUERY$ + ")") + "?" + subexp("\\#(" + FRAGMENT$ + ")") + "?$",
        RELATIVE_REF$ = "^(){0}" + subexp(subexp("\\/\\/(" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?)") + "?(" + PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_NOSCHEME$ + "|" + PATH_EMPTY$ + ")") + subexp("\\?(" + QUERY$ + ")") + "?" + subexp("\\#(" + FRAGMENT$ + ")") + "?$",
        ABSOLUTE_REF$ = "^(" + SCHEME$ + ")\\:" + subexp(subexp("\\/\\/(" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?)") + "?(" + PATH_ABEMPTY$ + "|" + PATH_ABSOLUTE$ + "|" + PATH_ROOTLESS$ + "|" + PATH_EMPTY$ + ")") + subexp("\\?(" + QUERY$ + ")") + "?$",
        SAMEDOC_REF$ = "^" + subexp("\\#(" + FRAGMENT$ + ")") + "?$",
        AUTHORITY_REF$ = "^" + subexp("(" + USERINFO$ + ")@") + "?(" + HOST$ + ")" + subexp("\\:(" + PORT$ + ")") + "?$";
    return {
        NOT_SCHEME: new RegExp(merge("[^]", ALPHA$$, DIGIT$$, "[\\+\\-\\.]"), "g"),
        NOT_USERINFO: new RegExp(merge("[^\\%\\:]", UNRESERVED$$, SUB_DELIMS$$), "g"),
        NOT_HOST: new RegExp(merge("[^\\%\\[\\]\\:]", UNRESERVED$$, SUB_DELIMS$$), "g"),
        NOT_PATH: new RegExp(merge("[^\\%\\/\\:\\@]", UNRESERVED$$, SUB_DELIMS$$), "g"),
        NOT_PATH_NOSCHEME: new RegExp(merge("[^\\%\\/\\@]", UNRESERVED$$, SUB_DELIMS$$), "g"),
        NOT_QUERY: new RegExp(merge("[^\\%]", UNRESERVED$$, SUB_DELIMS$$, "[\\:\\@\\/\\?]", IPRIVATE$$), "g"),
        NOT_FRAGMENT: new RegExp(merge("[^\\%]", UNRESERVED$$, SUB_DELIMS$$, "[\\:\\@\\/\\?]"), "g"),
        ESCAPE: new RegExp(merge("[^]", UNRESERVED$$, SUB_DELIMS$$), "g"),
        UNRESERVED: new RegExp(UNRESERVED$$, "g"),
        OTHER_CHARS: new RegExp(merge("[^\\%]", UNRESERVED$$, RESERVED$$), "g"),
        PCT_ENCODED: new RegExp(PCT_ENCODED$, "g"),
        IPV6ADDRESS: new RegExp("\\[?(" + IPV6ADDRESS$ + ")\\]?", "g")
    };
}
var URI_PROTOCOL = buildExps(false);

var IRI_PROTOCOL = buildExps(true);

var toConsumableArray = function (arr) {
  if (Array.isArray(arr)) {
    for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];

    return arr2;
  } else {
    return Array.from(arr);
  }
};

/** Highest positive signed 32-bit float value */

var maxInt = 2147483647; // aka. 0x7FFFFFFF or 2^31-1

/** Bootstring parameters */
var base = 36;
var tMin = 1;
var tMax = 26;
var skew = 38;
var damp = 700;
var initialBias = 72;
var initialN = 128; // 0x80
var delimiter = '-'; // '\x2D'

/** Regular expressions */
var regexPunycode = /^xn--/;
var regexNonASCII = /[^\0-\x7E]/; // non-ASCII chars
var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g; // RFC 3490 separators

/** Error messages */
var errors = {
	'overflow': 'Overflow: input needs wider integers to process',
	'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
	'invalid-input': 'Invalid input'
};

/** Convenience shortcuts */
var baseMinusTMin = base - tMin;
var floor = Math.floor;
var stringFromCharCode = String.fromCharCode;

/*--------------------------------------------------------------------------*/

/**
 * A generic error utility function.
 * @private
 * @param {String} type The error type.
 * @returns {Error} Throws a `RangeError` with the applicable error message.
 */
function error$1(type) {
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
	var result = [];
	var length = array.length;
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
	var output = [];
	var counter = 0;
	var length = string.length;
	while (counter < length) {
		var value = string.charCodeAt(counter++);
		if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
			// It's a high surrogate, and there is a next character.
			var extra = string.charCodeAt(counter++);
			if ((extra & 0xFC00) == 0xDC00) {
				// Low surrogate.
				output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
			} else {
				// It's an unmatched surrogate; only append this code unit, in case the
				// next code unit is the high surrogate of a surrogate pair.
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
var ucs2encode = function ucs2encode(array) {
	return String.fromCodePoint.apply(String, toConsumableArray(array));
};

/**
 * Converts a basic code point into a digit/integer.
 * @see `digitToBasic()`
 * @private
 * @param {Number} codePoint The basic numeric code point value.
 * @returns {Number} The numeric value of a basic code point (for use in
 * representing integers) in the range `0` to `base - 1`, or `base` if
 * the code point does not represent a value.
 */
var basicToDigit = function basicToDigit(codePoint) {
	if (codePoint - 0x30 < 0x0A) {
		return codePoint - 0x16;
	}
	if (codePoint - 0x41 < 0x1A) {
		return codePoint - 0x41;
	}
	if (codePoint - 0x61 < 0x1A) {
		return codePoint - 0x61;
	}
	return base;
};

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
var digitToBasic = function digitToBasic(digit, flag) {
	//  0..25 map to ASCII a..z or A..Z
	// 26..35 map to ASCII 0..9
	return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
};

/**
 * Bias adaptation function as per section 3.4 of RFC 3492.
 * https://tools.ietf.org/html/rfc3492#section-3.4
 * @private
 */
var adapt = function adapt(delta, numPoints, firstTime) {
	var k = 0;
	delta = firstTime ? floor(delta / damp) : delta >> 1;
	delta += floor(delta / numPoints);
	for (; /* no initialization */delta > baseMinusTMin * tMax >> 1; k += base) {
		delta = floor(delta / baseMinusTMin);
	}
	return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
};

/**
 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
 * symbols.
 * @memberOf punycode
 * @param {String} input The Punycode string of ASCII-only symbols.
 * @returns {String} The resulting string of Unicode symbols.
 */
var decode = function decode(input) {
	// Don't use UCS-2.
	var output = [];
	var inputLength = input.length;
	var i = 0;
	var n = initialN;
	var bias = initialBias;

	// Handle the basic code points: let `basic` be the number of input code
	// points before the last delimiter, or `0` if there is none, then copy
	// the first basic code points to the output.

	var basic = input.lastIndexOf(delimiter);
	if (basic < 0) {
		basic = 0;
	}

	for (var j = 0; j < basic; ++j) {
		// if it's not a basic code point
		if (input.charCodeAt(j) >= 0x80) {
			error$1('not-basic');
		}
		output.push(input.charCodeAt(j));
	}

	// Main decoding loop: start just after the last delimiter if any basic code
	// points were copied; start at the beginning otherwise.

	for (var index = basic > 0 ? basic + 1 : 0; index < inputLength;) /* no final expression */{

		// `index` is the index of the next character to be consumed.
		// Decode a generalized variable-length integer into `delta`,
		// which gets added to `i`. The overflow checking is easier
		// if we increase `i` as we go, then subtract off its starting
		// value at the end to obtain `delta`.
		var oldi = i;
		for (var w = 1, k = base;; /* no condition */k += base) {

			if (index >= inputLength) {
				error$1('invalid-input');
			}

			var digit = basicToDigit(input.charCodeAt(index++));

			if (digit >= base || digit > floor((maxInt - i) / w)) {
				error$1('overflow');
			}

			i += digit * w;
			var t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;

			if (digit < t) {
				break;
			}

			var baseMinusT = base - t;
			if (w > floor(maxInt / baseMinusT)) {
				error$1('overflow');
			}

			w *= baseMinusT;
		}

		var out = output.length + 1;
		bias = adapt(i - oldi, out, oldi == 0);

		// `i` was supposed to wrap around from `out` to `0`,
		// incrementing `n` each time, so we'll fix that now:
		if (floor(i / out) > maxInt - n) {
			error$1('overflow');
		}

		n += floor(i / out);
		i %= out;

		// Insert `n` at position `i` of the output.
		output.splice(i++, 0, n);
	}

	return String.fromCodePoint.apply(String, output);
};

/**
 * Converts a string of Unicode symbols (e.g. a domain name label) to a
 * Punycode string of ASCII-only symbols.
 * @memberOf punycode
 * @param {String} input The string of Unicode symbols.
 * @returns {String} The resulting Punycode string of ASCII-only symbols.
 */
var encode = function encode(input) {
	var output = [];

	// Convert the input in UCS-2 to an array of Unicode code points.
	input = ucs2decode(input);

	// Cache the length.
	var inputLength = input.length;

	// Initialize the state.
	var n = initialN;
	var delta = 0;
	var bias = initialBias;

	// Handle the basic code points.
	var _iteratorNormalCompletion = true;
	var _didIteratorError = false;
	var _iteratorError = undefined;

	try {
		for (var _iterator = input[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
			var _currentValue2 = _step.value;

			if (_currentValue2 < 0x80) {
				output.push(stringFromCharCode(_currentValue2));
			}
		}
	} catch (err) {
		_didIteratorError = true;
		_iteratorError = err;
	} finally {
		try {
			if (!_iteratorNormalCompletion && _iterator.return) {
				_iterator.return();
			}
		} finally {
			if (_didIteratorError) {
				throw _iteratorError;
			}
		}
	}

	var basicLength = output.length;
	var handledCPCount = basicLength;

	// `handledCPCount` is the number of code points that have been handled;
	// `basicLength` is the number of basic code points.

	// Finish the basic string with a delimiter unless it's empty.
	if (basicLength) {
		output.push(delimiter);
	}

	// Main encoding loop:
	while (handledCPCount < inputLength) {

		// All non-basic code points < n have been handled already. Find the next
		// larger one:
		var m = maxInt;
		var _iteratorNormalCompletion2 = true;
		var _didIteratorError2 = false;
		var _iteratorError2 = undefined;

		try {
			for (var _iterator2 = input[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
				var currentValue = _step2.value;

				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow.
		} catch (err) {
			_didIteratorError2 = true;
			_iteratorError2 = err;
		} finally {
			try {
				if (!_iteratorNormalCompletion2 && _iterator2.return) {
					_iterator2.return();
				}
			} finally {
				if (_didIteratorError2) {
					throw _iteratorError2;
				}
			}
		}

		var handledCPCountPlusOne = handledCPCount + 1;
		if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
			error$1('overflow');
		}

		delta += (m - n) * handledCPCountPlusOne;
		n = m;

		var _iteratorNormalCompletion3 = true;
		var _didIteratorError3 = false;
		var _iteratorError3 = undefined;

		try {
			for (var _iterator3 = input[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
				var _currentValue = _step3.value;

				if (_currentValue < n && ++delta > maxInt) {
					error$1('overflow');
				}
				if (_currentValue == n) {
					// Represent delta as a generalized variable-length integer.
					var q = delta;
					for (var k = base;; /* no condition */k += base) {
						var t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
						if (q < t) {
							break;
						}
						var qMinusT = q - t;
						var baseMinusT = base - t;
						output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}
		} catch (err) {
			_didIteratorError3 = true;
			_iteratorError3 = err;
		} finally {
			try {
				if (!_iteratorNormalCompletion3 && _iterator3.return) {
					_iterator3.return();
				}
			} finally {
				if (_didIteratorError3) {
					throw _iteratorError3;
				}
			}
		}

		++delta;
		++n;
	}
	return output.join('');
};

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
var toUnicode = function toUnicode(input) {
	return mapDomain(input, function (string) {
		return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string;
	});
};

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
var toASCII = function toASCII(input) {
	return mapDomain(input, function (string) {
		return regexNonASCII.test(string) ? 'xn--' + encode(string) : string;
	});
};

/*--------------------------------------------------------------------------*/

/** Define the public API */
var punycode = {
	/**
  * A string representing the current Punycode.js version number.
  * @memberOf punycode
  * @type String
  */
	'version': '2.1.0',
	/**
  * An object of methods to convert from JavaScript's internal character
  * representation (UCS-2) to Unicode code points, and back.
  * @see <https://mathiasbynens.be/notes/javascript-encoding>
  * @memberOf punycode
  * @type Object
  */
	'ucs2': {
		'decode': ucs2decode,
		'encode': ucs2encode
	},
	'decode': decode,
	'encode': encode,
	'toASCII': toASCII,
	'toUnicode': toUnicode
};

/**
 * URI.js
 *
 * @fileoverview An RFC 3986 compliant, scheme extendable URI parsing/validating/resolving library for JavaScript.
 * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
 * @see http://github.com/garycourt/uri-js
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
var SCHEMES = {};
function pctEncChar(chr) {
    var c = chr.charCodeAt(0);
    var e = void 0;
    if (c < 16) e = "%0" + c.toString(16).toUpperCase();else if (c < 128) e = "%" + c.toString(16).toUpperCase();else if (c < 2048) e = "%" + (c >> 6 | 192).toString(16).toUpperCase() + "%" + (c & 63 | 128).toString(16).toUpperCase();else e = "%" + (c >> 12 | 224).toString(16).toUpperCase() + "%" + (c >> 6 & 63 | 128).toString(16).toUpperCase() + "%" + (c & 63 | 128).toString(16).toUpperCase();
    return e;
}
function pctDecChars(str) {
    var newStr = "";
    var i = 0;
    var il = str.length;
    while (i < il) {
        var c = parseInt(str.substr(i + 1, 2), 16);
        if (c < 128) {
            newStr += String.fromCharCode(c);
            i += 3;
        } else if (c >= 194 && c < 224) {
            if (il - i >= 6) {
                var c2 = parseInt(str.substr(i + 4, 2), 16);
                newStr += String.fromCharCode((c & 31) << 6 | c2 & 63);
            } else {
                newStr += str.substr(i, 6);
            }
            i += 6;
        } else if (c >= 224) {
            if (il - i >= 9) {
                var _c = parseInt(str.substr(i + 4, 2), 16);
                var c3 = parseInt(str.substr(i + 7, 2), 16);
                newStr += String.fromCharCode((c & 15) << 12 | (_c & 63) << 6 | c3 & 63);
            } else {
                newStr += str.substr(i, 9);
            }
            i += 9;
        } else {
            newStr += str.substr(i, 3);
            i += 3;
        }
    }
    return newStr;
}
function _normalizeComponentEncoding(components, protocol) {
    function decodeUnreserved(str) {
        var decStr = pctDecChars(str);
        return !decStr.match(protocol.UNRESERVED) ? str : decStr;
    }
    if (components.scheme) components.scheme = String(components.scheme).replace(protocol.PCT_ENCODED, decodeUnreserved).toLowerCase().replace(protocol.NOT_SCHEME, "");
    if (components.userinfo !== undefined) components.userinfo = String(components.userinfo).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_USERINFO, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.host !== undefined) components.host = String(components.host).replace(protocol.PCT_ENCODED, decodeUnreserved).toLowerCase().replace(protocol.NOT_HOST, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.path !== undefined) components.path = String(components.path).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(components.scheme ? protocol.NOT_PATH : protocol.NOT_PATH_NOSCHEME, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.query !== undefined) components.query = String(components.query).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_QUERY, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    if (components.fragment !== undefined) components.fragment = String(components.fragment).replace(protocol.PCT_ENCODED, decodeUnreserved).replace(protocol.NOT_FRAGMENT, pctEncChar).replace(protocol.PCT_ENCODED, toUpperCase);
    return components;
}

var URI_PARSE = /^(?:([^:\/?#]+):)?(?:\/\/((?:([^\/?#@]*)@)?(\[[\dA-F:.]+\]|[^\/?#:]*)(?:\:(\d*))?))?([^?#]*)(?:\?([^#]*))?(?:#((?:.|\n|\r)*))?/i;
var NO_MATCH_IS_UNDEFINED = "".match(/(){0}/)[1] === undefined;
function parse(uriString) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var components = {};
    var protocol = options.iri !== false ? IRI_PROTOCOL : URI_PROTOCOL;
    if (options.reference === "suffix") uriString = (options.scheme ? options.scheme + ":" : "") + "//" + uriString;
    var matches = uriString.match(URI_PARSE);
    if (matches) {
        if (NO_MATCH_IS_UNDEFINED) {
            //store each component
            components.scheme = matches[1];
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
        } else {
            //store each component
            components.scheme = matches[1] || undefined;
            components.userinfo = uriString.indexOf("@") !== -1 ? matches[3] : undefined;
            components.host = uriString.indexOf("//") !== -1 ? matches[4] : undefined;
            components.port = parseInt(matches[5], 10);
            components.path = matches[6] || "";
            components.query = uriString.indexOf("?") !== -1 ? matches[7] : undefined;
            components.fragment = uriString.indexOf("#") !== -1 ? matches[8] : undefined;
            //fix port number
            if (isNaN(components.port)) {
                components.port = uriString.match(/\/\/(?:.|\n)*\:(?:\/|\?|\#|$)/) ? matches[4] : undefined;
            }
        }
        //strip brackets from IPv6 hosts
        if (components.host) {
            components.host = components.host.replace(protocol.IPV6ADDRESS, "$1");
        }
        //determine reference type
        if (components.scheme === undefined && components.userinfo === undefined && components.host === undefined && components.port === undefined && !components.path && components.query === undefined) {
            components.reference = "same-document";
        } else if (components.scheme === undefined) {
            components.reference = "relative";
        } else if (components.fragment === undefined) {
            components.reference = "absolute";
        } else {
            components.reference = "uri";
        }
        //check for reference errors
        if (options.reference && options.reference !== "suffix" && options.reference !== components.reference) {
            components.error = components.error || "URI is not a " + options.reference + " reference.";
        }
        //find scheme handler
        var schemeHandler = SCHEMES[(options.scheme || components.scheme || "").toLowerCase()];
        //check if scheme can't handle IRIs
        if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
            //if host component is a domain name
            if (components.host && (options.domainHost || schemeHandler && schemeHandler.domainHost)) {
                //convert Unicode IDN -> ASCII IDN
                try {
                    components.host = punycode.toASCII(components.host.replace(protocol.PCT_ENCODED, pctDecChars).toLowerCase());
                } catch (e) {
                    components.error = components.error || "Host's domain name can not be converted to ASCII via punycode: " + e;
                }
            }
            //convert IRI -> URI
            _normalizeComponentEncoding(components, URI_PROTOCOL);
        } else {
            //normalize encodings
            _normalizeComponentEncoding(components, protocol);
        }
        //perform scheme specific parsing
        if (schemeHandler && schemeHandler.parse) {
            schemeHandler.parse(components, options);
        }
    } else {
        components.error = components.error || "URI can not be parsed.";
    }
    return components;
}

function _recomposeAuthority(components, options) {
    var protocol = options.iri !== false ? IRI_PROTOCOL : URI_PROTOCOL;
    var uriTokens = [];
    if (components.userinfo !== undefined) {
        uriTokens.push(components.userinfo);
        uriTokens.push("@");
    }
    if (components.host !== undefined) {
        //ensure IPv6 addresses are bracketed
        uriTokens.push(String(components.host).replace(protocol.IPV6ADDRESS, "[$1]"));
    }
    if (typeof components.port === "number") {
        uriTokens.push(":");
        uriTokens.push(components.port.toString(10));
    }
    return uriTokens.length ? uriTokens.join("") : undefined;
}

var RDS1 = /^\.\.?\//;
var RDS2 = /^\/\.(\/|$)/;
var RDS3 = /^\/\.\.(\/|$)/;
var RDS5 = /^\/?(?:.|\n)*?(?=\/|$)/;
function removeDotSegments(input) {
    var output = [];
    while (input.length) {
        if (input.match(RDS1)) {
            input = input.replace(RDS1, "");
        } else if (input.match(RDS2)) {
            input = input.replace(RDS2, "/");
        } else if (input.match(RDS3)) {
            input = input.replace(RDS3, "/");
            output.pop();
        } else if (input === "." || input === "..") {
            input = "";
        } else {
            var im = input.match(RDS5);
            if (im) {
                var s = im[0];
                input = input.slice(s.length);
                output.push(s);
            } else {
                throw new Error("Unexpected dot segment condition");
            }
        }
    }
    return output.join("");
}

function serialize(components) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var protocol = options.iri ? IRI_PROTOCOL : URI_PROTOCOL;
    var uriTokens = [];
    //find scheme handler
    var schemeHandler = SCHEMES[(options.scheme || components.scheme || "").toLowerCase()];
    //perform scheme specific serialization
    if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(components, options);
    if (components.host) {
        //if host component is an IPv6 address
        if (protocol.IPV6ADDRESS.test(components.host)) {
            //TODO: normalize IPv6 address as per RFC 5952
        } else if (options.domainHost || schemeHandler && schemeHandler.domainHost) {
            //convert IDN via punycode
            try {
                components.host = !options.iri ? punycode.toASCII(components.host.replace(protocol.PCT_ENCODED, pctDecChars).toLowerCase()) : punycode.toUnicode(components.host);
            } catch (e) {
                components.error = components.error || "Host's domain name can not be converted to " + (!options.iri ? "ASCII" : "Unicode") + " via punycode: " + e;
            }
        }
    }
    //normalize encoding
    _normalizeComponentEncoding(components, protocol);
    if (options.reference !== "suffix" && components.scheme) {
        uriTokens.push(components.scheme);
        uriTokens.push(":");
    }
    var authority = _recomposeAuthority(components, options);
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
        var s = components.path;
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
    return uriTokens.join(""); //merge tokens into a string
}

function resolveComponents(base, relative) {
    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    var skipNormalization = arguments[3];

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
        target.path = removeDotSegments(relative.path || "");
        target.query = relative.query;
    } else {
        if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
            //target.authority = relative.authority;
            target.userinfo = relative.userinfo;
            target.host = relative.host;
            target.port = relative.port;
            target.path = removeDotSegments(relative.path || "");
            target.query = relative.query;
        } else {
            if (!relative.path) {
                target.path = base.path;
                if (relative.query !== undefined) {
                    target.query = relative.query;
                } else {
                    target.query = base.query;
                }
            } else {
                if (relative.path.charAt(0) === "/") {
                    target.path = removeDotSegments(relative.path);
                } else {
                    if ((base.userinfo !== undefined || base.host !== undefined || base.port !== undefined) && !base.path) {
                        target.path = "/" + relative.path;
                    } else if (!base.path) {
                        target.path = relative.path;
                    } else {
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

function resolve(baseURI, relativeURI, options) {
    return serialize(resolveComponents(parse(baseURI, options), parse(relativeURI, options), options, true), options);
}

function normalize(uri, options) {
    if (typeof uri === "string") {
        uri = serialize(parse(uri, options), options);
    } else if (typeOf(uri) === "object") {
        uri = parse(serialize(uri, options), options);
    }
    return uri;
}

function equal(uriA, uriB, options) {
    if (typeof uriA === "string") {
        uriA = serialize(parse(uriA, options), options);
    } else if (typeOf(uriA) === "object") {
        uriA = serialize(uriA, options);
    }
    if (typeof uriB === "string") {
        uriB = serialize(parse(uriB, options), options);
    } else if (typeOf(uriB) === "object") {
        uriB = serialize(uriB, options);
    }
    return uriA === uriB;
}

function escapeComponent(str, options) {
    return str && str.toString().replace(!options || !options.iri ? URI_PROTOCOL.ESCAPE : IRI_PROTOCOL.ESCAPE, pctEncChar);
}

function unescapeComponent(str, options) {
    return str && str.toString().replace(!options || !options.iri ? URI_PROTOCOL.PCT_ENCODED : IRI_PROTOCOL.PCT_ENCODED, pctDecChars);
}

var http = {
    scheme: "http",
    domainHost: true,
    parse: function parse(components, options) {
        //report missing host
        if (!components.host) {
            components.error = components.error || "HTTP URIs must have a host.";
        }
        return components;
    },
    serialize: function serialize(components, options) {
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

var https = {
    scheme: "https",
    domainHost: http.domainHost,
    parse: http.parse,
    serialize: http.serialize
};

var O = {};
var isIRI = true;
//RFC 3986
var UNRESERVED$$ = "[A-Za-z0-9\\-\\.\\_\\~" + (isIRI ? "\\xA0-\\u200D\\u2010-\\u2029\\u202F-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF" : "") + "]";
var HEXDIG$$ = "[0-9A-Fa-f]"; //case-insensitive
var PCT_ENCODED$ = subexp(subexp("%[EFef]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%[89A-Fa-f]" + HEXDIG$$ + "%" + HEXDIG$$ + HEXDIG$$) + "|" + subexp("%" + HEXDIG$$ + HEXDIG$$)); //expanded
//RFC 5322, except these symbols as per RFC 6068: @ : / ? # [ ] & ; =
//const ATEXT$$ = "[A-Za-z0-9\\!\\#\\$\\%\\&\\'\\*\\+\\-\\/\\=\\?\\^\\_\\`\\{\\|\\}\\~]";
//const WSP$$ = "[\\x20\\x09]";
//const OBS_QTEXT$$ = "[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]";  //(%d1-8 / %d11-12 / %d14-31 / %d127)
//const QTEXT$$ = merge("[\\x21\\x23-\\x5B\\x5D-\\x7E]", OBS_QTEXT$$);  //%d33 / %d35-91 / %d93-126 / obs-qtext
//const VCHAR$$ = "[\\x21-\\x7E]";
//const WSP$$ = "[\\x20\\x09]";
//const OBS_QP$ = subexp("\\\\" + merge("[\\x00\\x0D\\x0A]", OBS_QTEXT$$));  //%d0 / CR / LF / obs-qtext
//const FWS$ = subexp(subexp(WSP$$ + "*" + "\\x0D\\x0A") + "?" + WSP$$ + "+");
//const QUOTED_PAIR$ = subexp(subexp("\\\\" + subexp(VCHAR$$ + "|" + WSP$$)) + "|" + OBS_QP$);
//const QUOTED_STRING$ = subexp('\\"' + subexp(FWS$ + "?" + QCONTENT$) + "*" + FWS$ + "?" + '\\"');
var ATEXT$$ = "[A-Za-z0-9\\!\\$\\%\\'\\*\\+\\-\\^\\_\\`\\{\\|\\}\\~]";
var QTEXT$$ = "[\\!\\$\\%\\'\\(\\)\\*\\+\\,\\-\\.0-9\\<\\>A-Z\\x5E-\\x7E]";
var VCHAR$$ = merge(QTEXT$$, "[\\\"\\\\]");
var SOME_DELIMS$$ = "[\\!\\$\\'\\(\\)\\*\\+\\,\\;\\:\\@]";
var UNRESERVED = new RegExp(UNRESERVED$$, "g");
var PCT_ENCODED = new RegExp(PCT_ENCODED$, "g");
var NOT_LOCAL_PART = new RegExp(merge("[^]", ATEXT$$, "[\\.]", '[\\"]', VCHAR$$), "g");
var NOT_HFNAME = new RegExp(merge("[^]", UNRESERVED$$, SOME_DELIMS$$), "g");
var NOT_HFVALUE = NOT_HFNAME;
function decodeUnreserved(str) {
    var decStr = pctDecChars(str);
    return !decStr.match(UNRESERVED) ? str : decStr;
}
var mailto = {
    scheme: "mailto",
    parse: function parse$$1(components, options) {
        var to = components.to = components.path ? components.path.split(",") : [];
        components.path = undefined;
        if (components.query) {
            var unknownHeaders = false;
            var headers = {};
            var hfields = components.query.split("&");
            for (var x = 0, xl = hfields.length; x < xl; ++x) {
                var hfield = hfields[x].split("=");
                switch (hfield[0]) {
                    case "to":
                        var toAddrs = hfield[1].split(",");
                        for (var _x = 0, _xl = toAddrs.length; _x < _xl; ++_x) {
                            to.push(toAddrs[_x]);
                        }
                        break;
                    case "subject":
                        components.subject = unescapeComponent(hfield[1], options);
                        break;
                    case "body":
                        components.body = unescapeComponent(hfield[1], options);
                        break;
                    default:
                        unknownHeaders = true;
                        headers[unescapeComponent(hfield[0], options)] = unescapeComponent(hfield[1], options);
                        break;
                }
            }
            if (unknownHeaders) components.headers = headers;
        }
        components.query = undefined;
        for (var _x2 = 0, _xl2 = to.length; _x2 < _xl2; ++_x2) {
            var addr = to[_x2].split("@");
            addr[0] = unescapeComponent(addr[0]);
            if (!options.unicodeSupport) {
                //convert Unicode IDN -> ASCII IDN
                try {
                    addr[1] = punycode.toASCII(unescapeComponent(addr[1], options).toLowerCase());
                } catch (e) {
                    components.error = components.error || "Email address's domain name can not be converted to ASCII via punycode: " + e;
                }
            } else {
                addr[1] = unescapeComponent(addr[1], options).toLowerCase();
            }
            to[_x2] = addr.join("@");
        }
        return components;
    },
    serialize: function serialize$$1(components, options) {
        var to = toArray(components.to);
        if (to) {
            for (var x = 0, xl = to.length; x < xl; ++x) {
                var toAddr = String(to[x]);
                var atIdx = toAddr.lastIndexOf("@");
                var localPart = toAddr.slice(0, atIdx).replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_LOCAL_PART, pctEncChar);
                var domain = toAddr.slice(atIdx + 1);
                //convert IDN via punycode
                try {
                    domain = !options.iri ? punycode.toASCII(unescapeComponent(domain, options).toLowerCase()) : punycode.toUnicode(domain);
                } catch (e) {
                    components.error = components.error || "Email address's domain name can not be converted to " + (!options.iri ? "ASCII" : "Unicode") + " via punycode: " + e;
                }
                to[x] = localPart + "@" + domain;
            }
            components.path = to.join(",");
        }
        var headers = components.headers = components.headers || {};
        if (components.subject) headers["subject"] = components.subject;
        if (components.body) headers["body"] = components.body;
        var fields = [];
        for (var name in headers) {
            if (headers[name] !== O[name]) {
                fields.push(name.replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_HFNAME, pctEncChar) + "=" + headers[name].replace(PCT_ENCODED, decodeUnreserved).replace(PCT_ENCODED, toUpperCase).replace(NOT_HFVALUE, pctEncChar));
            }
        }
        if (fields.length) {
            components.query = fields.join("&");
        }
        return components;
    }
};

var NID$ = "(?:[0-9A-Za-z][0-9A-Za-z\\-]{1,31})";
var URN_SCHEME = new RegExp("^urn\\:(" + NID$ + ")$");
var URN_PARSE = /^([^\:]+)\:(.*)/;
var URN_EXCLUDED = /[\x00-\x20\\\"\&\<\>\[\]\^\`\{\|\}\~\x7F-\xFF]/g;
//RFC 2141
var urn = {
    scheme: "urn",
    parse: function parse$$1(components, options) {
        var matches = components.path && components.path.match(URN_PARSE);
        if (matches) {
            var scheme = "urn:" + matches[1].toLowerCase();
            var schemeHandler = SCHEMES[scheme];
            //in order to serialize properly,
            //every URN must have a serializer that calls the URN serializer
            if (!schemeHandler) {
                //create fake scheme handler
                schemeHandler = SCHEMES[scheme] = {
                    scheme: scheme,
                    parse: function parse$$1(components, options) {
                        return components;
                    },
                    serialize: SCHEMES["urn"].serialize
                };
            }
            components.scheme = scheme;
            components.path = matches[2];
            components = schemeHandler.parse(components, options);
        } else {
            components.error = components.error || "URN can not be parsed.";
        }
        return components;
    },
    serialize: function serialize$$1(components, options) {
        var scheme = components.scheme || options.scheme;
        if (scheme && scheme !== "urn") {
            var matches = scheme.match(URN_SCHEME) || ["urn:" + scheme, scheme];
            components.scheme = "urn";
            components.path = matches[1] + ":" + (components.path ? components.path.replace(URN_EXCLUDED, pctEncChar) : "");
        }
        return components;
    }
};

var UUID = /^[0-9A-Fa-f]{8}(?:\-[0-9A-Fa-f]{4}){3}\-[0-9A-Fa-f]{12}$/;
//RFC 4122
var uuid = {
    scheme: "urn:uuid",
    parse: function parse$$1(components, options) {
        if (!options.tolerant && (!components.path || !components.path.match(UUID))) {
            components.error = components.error || "UUID is not valid.";
        }
        return components;
    },
    serialize: function serialize$$1(components, options) {
        //ensure UUID is valid
        if (!options.tolerant && (!components.path || !components.path.match(UUID))) {
            //invalid UUIDs can not have this scheme
            components.scheme = undefined;
        } else {
            //normalize UUID
            components.path = (components.path || "").toLowerCase();
        }
        return SCHEMES["urn"].serialize(components, options);
    }
};

SCHEMES["http"] = http;
SCHEMES["https"] = https;
SCHEMES["mailto"] = mailto;
SCHEMES["urn"] = urn;
SCHEMES["urn:uuid"] = uuid;

exports.SCHEMES = SCHEMES;
exports.pctEncChar = pctEncChar;
exports.pctDecChars = pctDecChars;
exports.parse = parse;
exports.removeDotSegments = removeDotSegments;
exports.serialize = serialize;
exports.resolveComponents = resolveComponents;
exports.resolve = resolve;
exports.normalize = normalize;
exports.equal = equal;
exports.escapeComponent = escapeComponent;
exports.unescapeComponent = unescapeComponent;

Object.defineProperty(exports, '__esModule', { value: true });

})));


},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L2xpYi9ucG8uc3JjLmpzIiwibm9kZV9tb2R1bGVzL3BhdGgtYnJvd3NlcmlmeS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcXVlcnlzdHJpbmctZXMzL2RlY29kZS5qcyIsIm5vZGVfbW9kdWxlcy9xdWVyeXN0cmluZy1lczMvZW5jb2RlLmpzIiwibm9kZV9tb2R1bGVzL3F1ZXJ5c3RyaW5nLWVzMy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9zbGFzaC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy91cmktanMvZGlzdC9lczUvdXJpLmFsbC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3g1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNyWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDaE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIFZhcmlvdXMgdXRpbGl0aWVzIGZvciBKU09OIFJlZmVyZW5jZXMgKihodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzKSogYW5kXG4gKiBKU09OIFBvaW50ZXJzICooaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEpKi5cbiAqXG4gKiBAbW9kdWxlIEpzb25SZWZzXG4gKi9cblxuLy8gQ2hlcnJ5LXBpY2sgbG9kYXNoIGNvbXBvbmVudHMgdG8gaGVscCB3aXRoIHNpemVcbnZhciBfID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ18nXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ18nXSA6IG51bGwpO1xudmFyIGdsID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ2dyYXBobGliJ10gOiB0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsWydncmFwaGxpYiddIDogbnVsbCk7XG52YXIgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcbnZhciBQYXRoTG9hZGVyID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ1BhdGhMb2FkZXInXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ1BhdGhMb2FkZXInXSA6IG51bGwpO1xudmFyIHFzID0gcmVxdWlyZSgncXVlcnlzdHJpbmcnKTtcbnZhciBzbGFzaCA9IHJlcXVpcmUoJ3NsYXNoJyk7XG52YXIgVVJJID0gcmVxdWlyZSgndXJpLWpzJyk7XG5cbnZhciBiYWRQdHJUb2tlblJlZ2V4ID0gL34oPzpbXjAxXXwkKS9nO1xudmFyIHJlbW90ZUNhY2hlID0ge307XG52YXIgcmVtb3RlVHlwZXMgPSBbJ3JlbGF0aXZlJywgJ3JlbW90ZSddO1xudmFyIHJlbW90ZVVyaVR5cGVzID0gWydhYnNvbHV0ZScsICd1cmknXTtcbnZhciB1cmlEZXRhaWxzQ2FjaGUgPSB7fTtcblxuLy8gTG9hZCBwcm9taXNlcyBwb2x5ZmlsbCBpZiBuZWNlc3Nhcnlcbi8qIGlzdGFuYnVsIGlnbm9yZSBpZiAqL1xuaWYgKHR5cGVvZiBQcm9taXNlID09PSAndW5kZWZpbmVkJykge1xuICByZXF1aXJlKCduYXRpdmUtcHJvbWlzZS1vbmx5Jyk7XG59XG5cbi8qIEludGVybmFsIEZ1bmN0aW9ucyAqL1xuXG5mdW5jdGlvbiBjb21iaW5lUXVlcnlQYXJhbXMgKHFzMSwgcXMyKSB7XG4gIHZhciBjb21iaW5lZCA9IHt9O1xuXG4gIGZ1bmN0aW9uIG1lcmdlUXVlcnlQYXJhbXMgKG9iaikge1xuICAgIF8uZWFjaChvYmosIGZ1bmN0aW9uICh2YWwsIGtleSkge1xuICAgICAgY29tYmluZWRba2V5XSA9IHZhbDtcbiAgICB9KTtcbiAgfVxuXG4gIG1lcmdlUXVlcnlQYXJhbXMocXMucGFyc2UocXMxIHx8ICcnKSk7XG4gIG1lcmdlUXVlcnlQYXJhbXMocXMucGFyc2UocXMyIHx8ICcnKSk7XG5cbiAgcmV0dXJuIE9iamVjdC5rZXlzKGNvbWJpbmVkKS5sZW5ndGggPT09IDAgPyB1bmRlZmluZWQgOiBxcy5zdHJpbmdpZnkoY29tYmluZWQpO1xufVxuXG5mdW5jdGlvbiBjb21iaW5lVVJJcyAodTEsIHUyKSB7XG4gIC8vIENvbnZlcnQgV2luZG93cyBwYXRoc1xuICBpZiAoXy5pc1N0cmluZyh1MSkpIHtcbiAgICB1MSA9IHNsYXNoKHUxKTtcbiAgfVxuXG4gIGlmIChfLmlzU3RyaW5nKHUyKSkge1xuICAgIHUyID0gc2xhc2godTIpO1xuICB9XG5cbiAgdmFyIHUyRGV0YWlscyA9IHBhcnNlVVJJKF8uaXNVbmRlZmluZWQodTIpID8gJycgOiB1Mik7XG4gIHZhciB1MURldGFpbHM7XG4gIHZhciBjb21iaW5lZERldGFpbHM7XG5cbiAgaWYgKHJlbW90ZVVyaVR5cGVzLmluZGV4T2YodTJEZXRhaWxzLnJlZmVyZW5jZSkgPiAtMSkge1xuICAgIGNvbWJpbmVkRGV0YWlscyA9IHUyRGV0YWlscztcbiAgfSBlbHNlIHtcbiAgICB1MURldGFpbHMgPSBfLmlzVW5kZWZpbmVkKHUxKSA/IHVuZGVmaW5lZCA6IHBhcnNlVVJJKHUxKTtcblxuICAgIGlmICghXy5pc1VuZGVmaW5lZCh1MURldGFpbHMpKSB7XG4gICAgICBjb21iaW5lZERldGFpbHMgPSB1MURldGFpbHM7XG5cbiAgICAgIC8vIEpvaW4gdGhlIHBhdGhzXG4gICAgICBjb21iaW5lZERldGFpbHMucGF0aCA9IHNsYXNoKHBhdGguam9pbih1MURldGFpbHMucGF0aCwgdTJEZXRhaWxzLnBhdGgpKTtcblxuICAgICAgLy8gSm9pbiBxdWVyeSBwYXJhbWV0ZXJzXG4gICAgICBjb21iaW5lZERldGFpbHMucXVlcnkgPSBjb21iaW5lUXVlcnlQYXJhbXModTFEZXRhaWxzLnF1ZXJ5LCB1MkRldGFpbHMucXVlcnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb21iaW5lZERldGFpbHMgPSB1MkRldGFpbHM7XG4gICAgfVxuICB9XG5cbiAgLy8gUmVtb3ZlIHRoZSBmcmFnbWVudFxuICBjb21iaW5lZERldGFpbHMuZnJhZ21lbnQgPSB1bmRlZmluZWQ7XG5cbiAgLy8gRm9yIHJlbGF0aXZlIFVSSXMsIGFkZCBiYWNrIHRoZSAnLi4nIHNpbmNlIGl0IHdhcyByZW1vdmVkIGFib3ZlXG4gIHJldHVybiAocmVtb3RlVXJpVHlwZXMuaW5kZXhPZihjb21iaW5lZERldGFpbHMucmVmZXJlbmNlKSA9PT0gLTEgJiZcbiAgICAgICAgICBjb21iaW5lZERldGFpbHMucGF0aC5pbmRleE9mKCcuLi8nKSA9PT0gMCA/ICcuLi8nIDogJycpICsgVVJJLnNlcmlhbGl6ZShjb21iaW5lZERldGFpbHMpO1xufVxuXG5mdW5jdGlvbiBmaW5kQW5jZXN0b3JzIChvYmosIHBhdGgpIHtcbiAgdmFyIGFuY2VzdG9ycyA9IFtdO1xuICB2YXIgbm9kZTtcblxuICBpZiAocGF0aC5sZW5ndGggPiAwKSB7XG4gICAgbm9kZSA9IG9iajtcblxuICAgIHBhdGguc2xpY2UoMCwgcGF0aC5sZW5ndGggLSAxKS5mb3JFYWNoKGZ1bmN0aW9uIChzZWcpIHtcbiAgICAgIGlmIChzZWcgaW4gbm9kZSkge1xuICAgICAgICBub2RlID0gbm9kZVtzZWddO1xuXG4gICAgICAgIGFuY2VzdG9ycy5wdXNoKG5vZGUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGFuY2VzdG9ycztcbn1cblxuZnVuY3Rpb24gaXNSZW1vdGUgKHJlZkRldGFpbHMpIHtcbiAgcmV0dXJuIHJlbW90ZVR5cGVzLmluZGV4T2YoZ2V0UmVmVHlwZShyZWZEZXRhaWxzKSkgPiAtMTtcbn1cblxuZnVuY3Rpb24gaXNWYWxpZCAocmVmRGV0YWlscykge1xuICByZXR1cm4gXy5pc1VuZGVmaW5lZChyZWZEZXRhaWxzLmVycm9yKSAmJiByZWZEZXRhaWxzLnR5cGUgIT09ICdpbnZhbGlkJztcbn1cblxuZnVuY3Rpb24gZmluZFZhbHVlIChvYmosIHBhdGgpIHtcbiAgdmFyIHZhbHVlID0gb2JqO1xuXG4gIC8vIFVzaW5nIHRoaXMgbWFudWFsIGFwcHJvYWNoIGluc3RlYWQgb2YgXy5nZXQgc2luY2Ugd2UgaGF2ZSB0byBkZWNvZGVVUkkgdGhlIHNlZ21lbnRzXG4gIHBhdGguZm9yRWFjaChmdW5jdGlvbiAoc2VnKSB7XG4gICAgc2VnID0gZGVjb2RlVVJJKHNlZyk7XG5cbiAgICBpZiAoc2VnIGluIHZhbHVlKSB7XG4gICAgICB2YWx1ZSA9IHZhbHVlW3NlZ107XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IEVycm9yKCdKU09OIFBvaW50ZXIgcG9pbnRzIHRvIG1pc3NpbmcgbG9jYXRpb246ICcgKyBwYXRoVG9QdHIocGF0aCkpO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBnZXRFeHRyYVJlZktleXMgKHJlZikge1xuICByZXR1cm4gT2JqZWN0LmtleXMocmVmKS5maWx0ZXIoZnVuY3Rpb24gKGtleSkge1xuICAgIHJldHVybiBrZXkgIT09ICckcmVmJztcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldFJlZlR5cGUgKHJlZkRldGFpbHMpIHtcbiAgdmFyIHR5cGU7XG5cbiAgLy8gQ29udmVydCB0aGUgVVJJIHJlZmVyZW5jZSB0byBvbmUgb2Ygb3VyIHR5cGVzXG4gIHN3aXRjaCAocmVmRGV0YWlscy51cmlEZXRhaWxzLnJlZmVyZW5jZSkge1xuICBjYXNlICdhYnNvbHV0ZSc6XG4gIGNhc2UgJ3VyaSc6XG4gICAgdHlwZSA9ICdyZW1vdGUnO1xuICAgIGJyZWFrO1xuICBjYXNlICdzYW1lLWRvY3VtZW50JzpcbiAgICB0eXBlID0gJ2xvY2FsJztcbiAgICBicmVhaztcbiAgZGVmYXVsdDpcbiAgICB0eXBlID0gcmVmRGV0YWlscy51cmlEZXRhaWxzLnJlZmVyZW5jZTtcbiAgfVxuXG4gIHJldHVybiB0eXBlO1xufVxuXG5mdW5jdGlvbiBnZXRSZW1vdGVEb2N1bWVudCAodXJsLCBvcHRpb25zKSB7XG4gIHZhciBjYWNoZUVudHJ5ID0gcmVtb3RlQ2FjaGVbdXJsXTtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHZhciBsb2FkZXJPcHRpb25zID0gXy5jbG9uZURlZXAob3B0aW9ucy5sb2FkZXJPcHRpb25zIHx8IHt9KTtcblxuICBpZiAoXy5pc1VuZGVmaW5lZChjYWNoZUVudHJ5KSkge1xuICAgIC8vIElmIHRoZXJlIGlzIG5vIGNvbnRlbnQgcHJvY2Vzc29yLCBkZWZhdWx0IHRvIHByb2Nlc3NpbmcgdGhlIHJhdyByZXNwb25zZSBhcyBKU09OXG4gICAgaWYgKF8uaXNVbmRlZmluZWQobG9hZGVyT3B0aW9ucy5wcm9jZXNzQ29udGVudCkpIHtcbiAgICAgIGxvYWRlck9wdGlvbnMucHJvY2Vzc0NvbnRlbnQgPSBmdW5jdGlvbiAocmVzLCBjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjayh1bmRlZmluZWQsIEpTT04ucGFyc2UocmVzLnRleHQpKTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQXR0ZW1wdCB0byBsb2FkIHRoZSByZXNvdXJjZSB1c2luZyBwYXRoLWxvYWRlclxuICAgIGFsbFRhc2tzID0gUGF0aExvYWRlci5sb2FkKGRlY29kZVVSSSh1cmwpLCBsb2FkZXJPcHRpb25zKTtcblxuICAgIC8vIFVwZGF0ZSB0aGUgY2FjaGVcbiAgICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgICAudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICAgIHJlbW90ZUNhY2hlW3VybF0gPSB7XG4gICAgICAgICAgdmFsdWU6IHJlc1xuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiByZXM7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgcmVtb3RlQ2FjaGVbdXJsXSA9IHtcbiAgICAgICAgICBlcnJvcjogZXJyXG4gICAgICAgIH07XG5cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gUmV0dXJuIHRoZSBjYWNoZWQgdmVyc2lvblxuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoXy5pc0Vycm9yKGNhY2hlRW50cnkuZXJyb3IpKSB7XG4gICAgICAgIHRocm93IGNhY2hlRW50cnkuZXJyb3I7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gY2FjaGVFbnRyeS52YWx1ZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIGNsb25lZCB2ZXJzaW9uIHRvIGF2b2lkIHVwZGF0aW5nIHRoZSBjYWNoZVxuICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgIHJldHVybiBfLmNsb25lRGVlcChyZXMpO1xuICB9KTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbmZ1bmN0aW9uIGlzUmVmTGlrZSAob2JqLCB0aHJvd1dpdGhEZXRhaWxzKSB7XG4gIHZhciByZWZMaWtlID0gdHJ1ZTtcblxuICB0cnkge1xuICAgIGlmICghXy5pc1BsYWluT2JqZWN0KG9iaikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb2JqIGlzIG5vdCBhbiBPYmplY3QnKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzU3RyaW5nKG9iai4kcmVmKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvYmouJHJlZiBpcyBub3QgYSBTdHJpbmcnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmICh0aHJvd1dpdGhEZXRhaWxzKSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgcmVmTGlrZSA9IGZhbHNlO1xuICB9XG5cbiAgcmV0dXJuIHJlZkxpa2U7XG59XG5cbmZ1bmN0aW9uIG1ha2VBYnNvbHV0ZSAobG9jYXRpb24pIHtcbiAgaWYgKGxvY2F0aW9uLmluZGV4T2YoJzovLycpID09PSAtMSAmJiAhcGF0aC5pc0Fic29sdXRlKGxvY2F0aW9uKSkge1xuICAgIHJldHVybiBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgbG9jYXRpb24pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBsb2NhdGlvbjtcbiAgfVxufVxuXG5mdW5jdGlvbiBtYWtlUmVmRmlsdGVyIChvcHRpb25zKSB7XG4gIHZhciByZWZGaWx0ZXI7XG4gIHZhciB2YWxpZFR5cGVzO1xuXG4gIGlmIChfLmlzQXJyYXkob3B0aW9ucy5maWx0ZXIpIHx8IF8uaXNTdHJpbmcob3B0aW9ucy5maWx0ZXIpKSB7XG4gICAgdmFsaWRUeXBlcyA9IF8uaXNTdHJpbmcob3B0aW9ucy5maWx0ZXIpID8gW29wdGlvbnMuZmlsdGVyXSA6IG9wdGlvbnMuZmlsdGVyO1xuICAgIHJlZkZpbHRlciA9IGZ1bmN0aW9uIChyZWZEZXRhaWxzKSB7XG4gICAgICAvLyBDaGVjayB0aGUgZXhhY3QgdHlwZSBvciBmb3IgaW52YWxpZCBVUklzLCBjaGVjayBpdHMgb3JpZ2luYWwgdHlwZVxuICAgICAgcmV0dXJuIHZhbGlkVHlwZXMuaW5kZXhPZihyZWZEZXRhaWxzLnR5cGUpID4gLTEgfHwgdmFsaWRUeXBlcy5pbmRleE9mKGdldFJlZlR5cGUocmVmRGV0YWlscykpID4gLTE7XG4gICAgfTtcbiAgfSBlbHNlIGlmIChfLmlzRnVuY3Rpb24ob3B0aW9ucy5maWx0ZXIpKSB7XG4gICAgcmVmRmlsdGVyID0gb3B0aW9ucy5maWx0ZXI7XG4gIH0gZWxzZSBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zLmZpbHRlcikpIHtcbiAgICByZWZGaWx0ZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIChyZWZEZXRhaWxzLCBwYXRoKSB7XG4gICAgcmV0dXJuIChyZWZEZXRhaWxzLnR5cGUgIT09ICdpbnZhbGlkJyB8fCBvcHRpb25zLmluY2x1ZGVJbnZhbGlkID09PSB0cnVlKSAmJiByZWZGaWx0ZXIocmVmRGV0YWlscywgcGF0aCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIG1ha2VTdWJEb2NQYXRoIChvcHRpb25zKSB7XG4gIHZhciBzdWJEb2NQYXRoO1xuXG4gIGlmIChfLmlzQXJyYXkob3B0aW9ucy5zdWJEb2NQYXRoKSkge1xuICAgIHN1YkRvY1BhdGggPSBvcHRpb25zLnN1YkRvY1BhdGg7XG4gIH0gZWxzZSBpZiAoXy5pc1N0cmluZyhvcHRpb25zLnN1YkRvY1BhdGgpKSB7XG4gICAgc3ViRG9jUGF0aCA9IHBhdGhGcm9tUHRyKG9wdGlvbnMuc3ViRG9jUGF0aCk7XG4gIH0gZWxzZSBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zLnN1YkRvY1BhdGgpKSB7XG4gICAgc3ViRG9jUGF0aCA9IFtdO1xuICB9XG5cbiAgcmV0dXJuIHN1YkRvY1BhdGg7XG59XG5cbmZ1bmN0aW9uIG1hcmtNaXNzaW5nIChyZWZEZXRhaWxzLCBlcnIpIHtcbiAgcmVmRGV0YWlscy5lcnJvciA9IGVyci5tZXNzYWdlO1xuICByZWZEZXRhaWxzLm1pc3NpbmcgPSB0cnVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZVVSSSAodXJpKSB7XG4gIC8vIFdlIGRlY29kZSBmaXJzdCB0byBhdm9pZCBkb3VibHkgZW5jb2RpbmdcbiAgcmV0dXJuIFVSSS5wYXJzZShlbmNvZGVVUkkoZGVjb2RlVVJJKHVyaSkpKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRSZWZNb2RlbCAoZG9jdW1lbnQsIG9wdGlvbnMsIG1ldGFkYXRhKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuICB2YXIgc3ViRG9jUHRyID0gcGF0aFRvUHRyKG9wdGlvbnMuc3ViRG9jUGF0aCk7XG4gIHZhciBhYnNMb2NhdGlvbiA9IG1ha2VBYnNvbHV0ZShvcHRpb25zLmxvY2F0aW9uKTtcbiAgdmFyIHJlbGF0aXZlQmFzZSA9IHBhdGguZGlybmFtZShvcHRpb25zLmxvY2F0aW9uKTtcbiAgdmFyIGRvY0RlcEtleSA9IGFic0xvY2F0aW9uICsgc3ViRG9jUHRyO1xuICB2YXIgcmVmcztcbiAgdmFyIHJPcHRpb25zO1xuXG4gIC8vIFN0b3JlIHRoZSBkb2N1bWVudCBpbiB0aGUgbWV0YWRhdGEgaWYgbmVjZXNzYXJ5XG4gIGlmIChfLmlzVW5kZWZpbmVkKG1ldGFkYXRhLmRvY3NbYWJzTG9jYXRpb25dKSkge1xuICAgIG1ldGFkYXRhLmRvY3NbYWJzTG9jYXRpb25dID0gZG9jdW1lbnQ7XG4gIH1cblxuICAvLyBJZiB0aGVyZSBhcmUgbm8gZGVwZW5kZW5jaWVzIHN0b3JlZCBmb3IgdGhlIGxvY2F0aW9uK3N1YkRvY1BhdGgsIHdlJ3ZlIG5ldmVyIHNlZW4gaXQgYmVmb3JlIGFuZCB3aWxsIHByb2Nlc3MgaXRcbiAgaWYgKF8uaXNVbmRlZmluZWQobWV0YWRhdGEuZGVwc1tkb2NEZXBLZXldKSkge1xuICAgIG1ldGFkYXRhLmRlcHNbZG9jRGVwS2V5XSA9IHt9O1xuXG4gICAgLy8gRmluZCB0aGUgcmVmZXJlbmNlcyBiYXNlZCBvbiB0aGUgb3B0aW9uc1xuICAgIHJlZnMgPSBmaW5kUmVmcyhkb2N1bWVudCwgb3B0aW9ucyk7XG5cbiAgICAvLyBJdGVyYXRlIG92ZXIgdGhlIHJlZmVyZW5jZXMgYW5kIHByb2Nlc3NcbiAgICBfLmVhY2gocmVmcywgZnVuY3Rpb24gKHJlZkRldGFpbHMsIHJlZlB0cikge1xuICAgICAgdmFyIHJlZktleSA9IG1ha2VBYnNvbHV0ZShvcHRpb25zLmxvY2F0aW9uKSArIHJlZlB0cjtcbiAgICAgIHZhciByZWZkS2V5ID0gcmVmRGV0YWlscy5yZWZkSWQgPSBtYWtlQWJzb2x1dGUoaXNSZW1vdGUocmVmRGV0YWlscykgP1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbWJpbmVVUklzKHJlbGF0aXZlQmFzZSwgcmVmRGV0YWlscy51cmkpIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLmxvY2F0aW9uKSArICcjJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocmVmRGV0YWlscy51cmkuaW5kZXhPZignIycpID4gLTEgP1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmRGV0YWlscy51cmkuc3BsaXQoJyMnKVsxXSA6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnJyk7XG5cbiAgICAgIC8vIFJlY29yZCByZWZlcmVuY2UgbWV0YWRhdGFcbiAgICAgIG1ldGFkYXRhLnJlZnNbcmVmS2V5XSA9IHJlZkRldGFpbHM7XG5cbiAgICAgIC8vIERvIG5vdCBwcm9jZXNzIGludmFsaWQgcmVmZXJlbmNlc1xuICAgICAgaWYgKCFpc1ZhbGlkKHJlZkRldGFpbHMpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gUmVjb3JkIGRlcGVuZGVuY3kgKHJlbGF0aXZlIHRvIHRoZSBkb2N1bWVudCdzIHN1Yi1kb2N1bWVudCBwYXRoKVxuICAgICAgbWV0YWRhdGEuZGVwc1tkb2NEZXBLZXldW3JlZlB0ciA9PT0gc3ViRG9jUHRyID8gJyMnIDogcmVmUHRyLnJlcGxhY2Uoc3ViRG9jUHRyICsgJy8nLCAnIy8nKV0gPSByZWZkS2V5O1xuXG4gICAgICAvLyBEbyBub3QgcHJvY2VzcyBkaXJlY3RseS1jaXJjdWxhciByZWZlcmVuY2VzICh0byBhbiBhbmNlc3RvciBvciBzZWxmKVxuICAgICAgaWYgKHJlZktleS5pbmRleE9mKHJlZmRLZXkgKyAnLycpID09PSAwKSB7XG4gICAgICAgIHJlZkRldGFpbHMuY2lyY3VsYXIgPSB0cnVlO1xuXG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gUHJlcGFyZSB0aGUgb3B0aW9ucyBmb3Igc3Vic2VxdWVudCBwcm9jZXNzRG9jdW1lbnQgY2FsbHNcbiAgICAgIHJPcHRpb25zID0gXy5jbG9uZURlZXAob3B0aW9ucyk7XG5cbiAgICAgIHJPcHRpb25zLnN1YkRvY1BhdGggPSBfLmlzVW5kZWZpbmVkKHJlZkRldGFpbHMudXJpRGV0YWlscy5mcmFnbWVudCkgP1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtdIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoRnJvbVB0cihkZWNvZGVVUkkocmVmRGV0YWlscy51cmlEZXRhaWxzLmZyYWdtZW50KSk7XG5cbiAgICAgIC8vIFJlc29sdmUgdGhlIHJlZmVyZW5jZVxuICAgICAgaWYgKGlzUmVtb3RlKHJlZkRldGFpbHMpKSB7XG4gICAgICAgIC8vIERlbGV0ZSBmaWx0ZXIub3B0aW9ucyBiZWNhdXNlIGFsbCByZW1vdGUgcmVmZXJlbmNlcyBzaG91bGQgYmUgZnVsbHkgcmVzb2x2ZWRcbiAgICAgICAgZGVsZXRlIHJPcHRpb25zLmZpbHRlcjtcbiAgICAgICAgLy8gVGhlIG5ldyBsb2NhdGlvbiBiZWluZyByZWZlcmVuY2VkXG4gICAgICAgIHJPcHRpb25zLmxvY2F0aW9uID0gcmVmZEtleS5zcGxpdCgnIycpWzBdO1xuXG4gICAgICAgIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAgICAgICAudGhlbihmdW5jdGlvbiAobk1ldGFkYXRhLCBuT3B0aW9ucykge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgdmFyIHJBYnNMb2NhdGlvbiA9IG1ha2VBYnNvbHV0ZShuT3B0aW9ucy5sb2NhdGlvbik7XG4gICAgICAgICAgICAgIHZhciByRG9jID0gbk1ldGFkYXRhLmRvY3NbckFic0xvY2F0aW9uXTtcblxuICAgICAgICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChyRG9jKSkge1xuICAgICAgICAgICAgICAgIC8vIFdlIGhhdmUgbm8gY2FjaGUgc28gd2UgbXVzdCByZXRyaWV2ZSB0aGUgZG9jdW1lbnRcbiAgICAgICAgICAgICAgICByZXR1cm4gZ2V0UmVtb3RlRG9jdW1lbnQockFic0xvY2F0aW9uLCBuT3B0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFN0b3JlIHRoZSByZXNwb25zZSBpbiB0aGUgZG9jdW1lbnQgY2FjaGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbk1ldGFkYXRhLmRvY3NbckFic0xvY2F0aW9uXSA9IGVycjtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBSZXR1cm4gdGhlIGVycm9yIHRvIGFsbG93IHRoZSBzdWJzZXF1ZW50IGB0aGVuYCB0byBoYW5kbGUgYm90aCBlcnJvcnMgYW5kIHN1Y2Nlc3Nlc1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZXJyO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gV2UgaGF2ZSBhbHJlYWR5IHJldHJpZXZlZCAob3IgYXR0ZW1wdGVkIHRvKSB0aGUgZG9jdW1lbnQgYW5kIHNob3VsZCB1c2UgdGhlIGNhY2hlZCB2ZXJzaW9uIGluIHRoZVxuICAgICAgICAgICAgICAgIC8vIG1ldGFkYXRhIHNpbmNlIGl0IGNvdWxkIGFscmVhZHkgYmUgcHJvY2Vzc2VkIHNvbWUuXG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByRG9jO1xuICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfShtZXRhZGF0YSwgck9wdGlvbnMpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAgICAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZG9jdW1lbnQ7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFByb2Nlc3MgdGhlIHJlbW90ZSBkb2N1bWVudCBvciB0aGUgcmVmZXJlbmNlZCBwb3J0aW9uIG9mIHRoZSBsb2NhbCBkb2N1bWVudFxuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgICAudGhlbihmdW5jdGlvbiAobk1ldGFkYXRhLCBuT3B0aW9ucywgblJlZkRldGFpbHMpIHtcbiAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGRvYykge1xuICAgICAgICAgICAgaWYgKF8uaXNFcnJvcihkb2MpKSB7XG4gICAgICAgICAgICAgIG1hcmtNaXNzaW5nKG5SZWZEZXRhaWxzLCBkb2MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gV3JhcHBlZCBpbiBhIHRyeS9jYXRjaCBzaW5jZSBmaW5kUmVmcyB0aHJvd3NcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYnVpbGRSZWZNb2RlbChkb2MsIG5PcHRpb25zLCBuTWV0YWRhdGEpXG4gICAgICAgICAgICAgICAgICAuY2F0Y2goZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgICAgICBtYXJrTWlzc2luZyhuUmVmRGV0YWlscywgZXJyKTtcbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBtYXJrTWlzc2luZyhuUmVmRGV0YWlscywgZXJyKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgIH0obWV0YWRhdGEsIHJPcHRpb25zLCByZWZEZXRhaWxzKSk7XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbmZ1bmN0aW9uIHNldFZhbHVlIChvYmosIHJlZlBhdGgsIHZhbHVlKSB7XG4gIGZpbmRWYWx1ZShvYmosIHJlZlBhdGguc2xpY2UoMCwgcmVmUGF0aC5sZW5ndGggLSAxKSlbZGVjb2RlVVJJKHJlZlBhdGhbcmVmUGF0aC5sZW5ndGggLSAxXSldID0gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHdhbGsgKGFuY2VzdG9ycywgbm9kZSwgcGF0aCwgZm4pIHtcbiAgdmFyIHByb2Nlc3NDaGlsZHJlbiA9IHRydWU7XG5cbiAgZnVuY3Rpb24gd2Fsa0l0ZW0gKGl0ZW0sIHNlZ21lbnQpIHtcbiAgICBwYXRoLnB1c2goc2VnbWVudCk7XG4gICAgd2FsayhhbmNlc3RvcnMsIGl0ZW0sIHBhdGgsIGZuKTtcbiAgICBwYXRoLnBvcCgpO1xuICB9XG5cbiAgLy8gQ2FsbCB0aGUgaXRlcmF0ZWVcbiAgaWYgKF8uaXNGdW5jdGlvbihmbikpIHtcbiAgICBwcm9jZXNzQ2hpbGRyZW4gPSBmbihhbmNlc3RvcnMsIG5vZGUsIHBhdGgpO1xuICB9XG5cbiAgLy8gV2UgZG8gbm90IHByb2Nlc3MgY2lyY3VsYXIgb2JqZWN0cyBhZ2FpblxuICBpZiAoYW5jZXN0b3JzLmluZGV4T2Yobm9kZSkgPT09IC0xKSB7XG4gICAgYW5jZXN0b3JzLnB1c2gobm9kZSk7XG5cbiAgICBpZiAocHJvY2Vzc0NoaWxkcmVuICE9PSBmYWxzZSkge1xuICAgICAgaWYgKF8uaXNBcnJheShub2RlKSkge1xuICAgICAgICBub2RlLmZvckVhY2goZnVuY3Rpb24gKG1lbWJlciwgaW5kZXgpIHtcbiAgICAgICAgICB3YWxrSXRlbShtZW1iZXIsIGluZGV4LnRvU3RyaW5nKCkpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAoXy5pc09iamVjdChub2RlKSkge1xuICAgICAgICBfLmVhY2gobm9kZSwgZnVuY3Rpb24gKGNOb2RlLCBrZXkpIHtcbiAgICAgICAgICB3YWxrSXRlbShjTm9kZSwga2V5KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYW5jZXN0b3JzLnBvcCgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlT3B0aW9ucyAob3B0aW9ucywgb2JqKSB7XG4gIHZhciBsb2NhdGlvblBhcnRzO1xuXG4gIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMpKSB7XG4gICAgLy8gRGVmYXVsdCB0byBhbiBlbXB0eSBvcHRpb25zIG9iamVjdFxuICAgIG9wdGlvbnMgPSB7fTtcbiAgfSBlbHNlIHtcbiAgICAvLyBDbG9uZSB0aGUgb3B0aW9ucyBzbyB3ZSBkbyBub3QgYWx0ZXIgdGhlIG9uZXMgcGFzc2VkIGluXG4gICAgb3B0aW9ucyA9IF8uY2xvbmVEZWVwKG9wdGlvbnMpO1xuICB9XG5cbiAgaWYgKCFfLmlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBtdXN0IGJlIGFuIE9iamVjdCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucmVzb2x2ZUNpcmN1bGFycykgJiZcbiAgICAgICAgICAgICAhXy5pc0Jvb2xlYW4ob3B0aW9ucy5yZXNvbHZlQ2lyY3VsYXJzKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMucmVzb2x2ZUNpcmN1bGFycyBtdXN0IGJlIGEgQm9vbGVhbicpO1xuICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZmlsdGVyKSAmJlxuICAgICAgICAgICAgICFfLmlzQXJyYXkob3B0aW9ucy5maWx0ZXIpICYmXG4gICAgICAgICAgICAgIV8uaXNGdW5jdGlvbihvcHRpb25zLmZpbHRlcikgJiZcbiAgICAgICAgICAgICAhXy5pc1N0cmluZyhvcHRpb25zLmZpbHRlcikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zLmZpbHRlciBtdXN0IGJlIGFuIEFycmF5LCBhIEZ1bmN0aW9uIG9mIGEgU3RyaW5nJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5pbmNsdWRlSW52YWxpZCkgJiZcbiAgICAgICAgICAgICAhXy5pc0Jvb2xlYW4ob3B0aW9ucy5pbmNsdWRlSW52YWxpZCkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zLmluY2x1ZGVJbnZhbGlkIG11c3QgYmUgYSBCb29sZWFuJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5sb2NhdGlvbikgJiZcbiAgICAgICAgICAgICAhXy5pc1N0cmluZyhvcHRpb25zLmxvY2F0aW9uKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMubG9jYXRpb24gbXVzdCBiZSBhIFN0cmluZycpO1xuICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucmVmUHJlUHJvY2Vzc29yKSAmJlxuICAgICAgICAgICAgICFfLmlzRnVuY3Rpb24ob3B0aW9ucy5yZWZQcmVQcm9jZXNzb3IpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5yZWZQcmVQcm9jZXNzb3IgbXVzdCBiZSBhIEZ1bmN0aW9uJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yKSAmJlxuICAgICAgICAgICAgICFfLmlzRnVuY3Rpb24ob3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMucmVmUG9zdFByb2Nlc3NvciBtdXN0IGJlIGEgRnVuY3Rpb24nKTtcbiAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLnN1YkRvY1BhdGgpICYmXG4gICAgICAgICAgICAgIV8uaXNBcnJheShvcHRpb25zLnN1YkRvY1BhdGgpICYmXG4gICAgICAgICAgICAgIWlzUHRyKG9wdGlvbnMuc3ViRG9jUGF0aCkpIHtcbiAgICAvLyBJZiBhIHBvaW50ZXIgaXMgcHJvdmlkZWQsIHRocm93IGFuIGVycm9yIGlmIGl0J3Mgbm90IHRoZSBwcm9wZXIgdHlwZVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMuc3ViRG9jUGF0aCBtdXN0IGJlIGFuIEFycmF5IG9mIHBhdGggc2VnbWVudHMgb3IgYSB2YWxpZCBKU09OIFBvaW50ZXInKTtcbiAgfVxuXG4gIC8vIERlZmF1bHQgdG8gZmFsc2UgZm9yIGFsbG93aW5nIGNpcmN1bGFyc1xuICBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zLnJlc29sdmVDaXJjdWxhcnMpKSB7XG4gICAgb3B0aW9ucy5yZXNvbHZlQ2lyY3VsYXJzID0gZmFsc2U7XG4gIH1cblxuICBvcHRpb25zLmZpbHRlciA9IG1ha2VSZWZGaWx0ZXIob3B0aW9ucyk7XG5cbiAgLy8gb3B0aW9ucy5sb2NhdGlvbiBpcyBub3Qgb2ZmaWNpYWxseSBzdXBwb3J0ZWQgeWV0IGJ1dCB3aWxsIGJlIHdoZW4gSXNzdWUgODggaXMgY29tcGxldGVcbiAgaWYgKF8uaXNVbmRlZmluZWQob3B0aW9ucy5sb2NhdGlvbikpIHtcbiAgICBvcHRpb25zLmxvY2F0aW9uID0gbWFrZUFic29sdXRlKCcuL3Jvb3QuanNvbicpO1xuICB9XG5cbiAgbG9jYXRpb25QYXJ0cyA9IG9wdGlvbnMubG9jYXRpb24uc3BsaXQoJyMnKTtcblxuICAvLyBJZiBvcHRpb25zLmxvY2F0aW9uIGNvbnRhaW5zIGEgZnJhZ21lbnQsIHR1cm4gaXQgaW50byBhbiBvcHRpb25zLnN1YkRvY1BhdGhcbiAgaWYgKGxvY2F0aW9uUGFydHMubGVuZ3RoID4gMSkge1xuICAgIG9wdGlvbnMuc3ViRG9jUGF0aCA9ICcjJyArIGxvY2F0aW9uUGFydHNbMV07XG4gIH1cblxuICAvLyBKdXN0IHRvIGJlIHNhZmUsIHJlbW92ZSBhbnkgYWNjaWRlbnRhbCBmcmFnbWVudCBhcyBpdCB3b3VsZCBicmVhayB0aGluZ3NcbiAgb3B0aW9ucy5sb2NhdGlvbiA9IGNvbWJpbmVVUklzKG9wdGlvbnMubG9jYXRpb24sIHVuZGVmaW5lZCk7XG5cbiAgLy8gU2V0IHRoZSBzdWJEb2NQYXRoIHRvIGF2b2lkIGV2ZXJ5b25lIGVsc2UgaGF2aW5nIHRvIGNvbXB1dGUgaXRcbiAgb3B0aW9ucy5zdWJEb2NQYXRoID0gbWFrZVN1YkRvY1BhdGgob3B0aW9ucyk7XG5cbiAgaWYgKCFfLmlzVW5kZWZpbmVkKG9iaikpIHtcbiAgICB0cnkge1xuICAgICAgZmluZFZhbHVlKG9iaiwgb3B0aW9ucy5zdWJEb2NQYXRoKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGVyci5tZXNzYWdlID0gZXJyLm1lc3NhZ2UucmVwbGFjZSgnSlNPTiBQb2ludGVyJywgJ29wdGlvbnMuc3ViRG9jUGF0aCcpO1xuXG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG9wdGlvbnM7XG59XG5cbi8qIE1vZHVsZSBNZW1iZXJzICovXG5cbi8qXG4gKiBFYWNoIG9mIHRoZSBmdW5jdGlvbnMgYmVsb3cgYXJlIGRlZmluZWQgYXMgZnVuY3Rpb24gc3RhdGVtZW50cyBhbmQgKnRoZW4qIGV4cG9ydGVkIGluIHR3byBzdGVwcyBpbnN0ZWFkIG9mIG9uZSBkdWVcbiAqIHRvIGEgYnVnIGluIGpzZG9jIChodHRwczovL2dpdGh1Yi5jb20vanNkb2MybWQvanNkb2MtcGFyc2UvaXNzdWVzLzE4KSB0aGF0IGNhdXNlcyBvdXIgZG9jdW1lbnRhdGlvbiB0byBiZVxuICogZ2VuZXJhdGVkIGltcHJvcGVybHkuICBUaGUgaW1wYWN0IHRvIHRoZSB1c2VyIGlzIHNpZ25pZmljYW50IGVub3VnaCBmb3IgdXMgdG8gd2FycmFudCB3b3JraW5nIGFyb3VuZCBpdCB1bnRpbCB0aGlzXG4gKiBpcyBmaXhlZC5cbiAqL1xuXG4vKipcbiAqIFRoZSBvcHRpb25zIHVzZWQgZm9yIHZhcmlvdXMgSnNvblJlZnMgQVBJcy5cbiAqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBKc29uUmVmc09wdGlvbnNcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xzdHJpbmdbXXxmdW5jdGlvbn0gW2ZpbHRlcj1mdW5jdGlvbiAoKSB7cmV0dXJuIHRydWU7fV0gLSBUaGUgZmlsdGVyIHRvIHVzZSB3aGVuIGdhdGhlcmluZyBKU09OXG4gKiBSZWZlcmVuY2VzICooSWYgdGhpcyB2YWx1ZSBpcyBhIHNpbmdsZSBzdHJpbmcgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncywgdGhlIHZhbHVlKHMpIGFyZSBleHBlY3RlZCB0byBiZSB0aGUgYHR5cGUocylgXG4gKiB5b3UgYXJlIGludGVyZXN0ZWQgaW4gY29sbGVjdGluZyBhcyBkZXNjcmliZWQgaW4ge0BsaW5rIG1vZHVsZTpKc29uUmVmcy5nZXRSZWZEZXRhaWxzfS4gIElmIGl0IGlzIGEgZnVuY3Rpb24sIGl0IGlzXG4gKiBleHBlY3RlZCB0aGF0IHRoZSBmdW5jdGlvbiBiZWhhdmVzIGxpa2Uge0BsaW5rIG1vZHVsZTpKc29uUmVmc35SZWZEZXRhaWxzRmlsdGVyfS4pKlxuICogQHBhcmFtIHtib29sZWFufSBbaW5jbHVkZUludmFsaWQ9ZmFsc2VdIC0gV2hldGhlciBvciBub3QgdG8gaW5jbHVkZSBpbnZhbGlkIEpTT04gUmVmZXJlbmNlIGRldGFpbHMgKihUaGlzIHdpbGwgbWFrZVxuICogaXQgc28gdGhhdCBvYmplY3RzIHRoYXQgYXJlIGxpa2UgSlNPTiBSZWZlcmVuY2Ugb2JqZWN0cywgYXMgaW4gdGhleSBhcmUgYW4gYE9iamVjdGAgYW5kIHRoZSBoYXZlIGEgYCRyZWZgIHByb3BlcnR5LFxuICogYnV0IGZhaWwgdmFsaWRhdGlvbiB3aWxsIGJlIGluY2x1ZGVkLiAgVGhpcyBpcyB2ZXJ5IHVzZWZ1bCBmb3Igd2hlbiB5b3Ugd2FudCB0byBrbm93IGlmIHlvdSBoYXZlIGludmFsaWQgSlNPTlxuICogUmVmZXJlbmNlIGRlZmluaXRpb25zLiAgVGhpcyB3aWxsIG5vdCBtZWFuIHRoYXQgQVBJcyB3aWxsIHByb2Nlc3MgaW52YWxpZCBKU09OIFJlZmVyZW5jZXMgYnV0IHRoZSByZWFzb25zIGFzIHRvIHdoeVxuICogdGhlIEpTT04gUmVmZXJlbmNlcyBhcmUgaW52YWxpZCB3aWxsIGJlIGluY2x1ZGVkIGluIHRoZSByZXR1cm5lZCBtZXRhZGF0YS4pKlxuICogQHBhcmFtIHtvYmplY3R9IFtsb2FkZXJPcHRpb25zXSAtIFRoZSBvcHRpb25zIHRvIHBhc3MgdG9cbiAqIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vd2hpdGxvY2tqYy9wYXRoLWxvYWRlci9ibG9iL21hc3Rlci9kb2NzL0FQSS5tZCNtb2R1bGVfUGF0aExvYWRlci5sb2FkfFBhdGhMb2FkZXJ+bG9hZH1cbiAqIEBwYXJhbSB7c3RyaW5nfSBbbG9jYXRpb249cm9vdC5qc29uXSAtIFRoZSBsb2NhdGlvbiBvZiB0aGUgZG9jdW1lbnQgYmVpbmcgcHJvY2Vzc2VkICAqKFRoaXMgcHJvcGVydHkgaXMgb25seSB1c2VmdWxcbiAqIHdoZW4gcmVzb2x2aW5nIHJlZmVyZW5jZXMgYXMgaXQgd2lsbCBiZSB1c2VkIHRvIGxvY2F0ZSByZWxhdGl2ZSByZWZlcmVuY2VzIGZvdW5kIHdpdGhpbiB0aGUgZG9jdW1lbnQgYmVpbmcgcmVzb2x2ZWQuXG4gKiBJZiB0aGlzIHZhbHVlIGlzIHJlbGF0aXZlLCB7QGxpbmsgaHR0cHM6Ly9naXRodWIuY29tL3doaXRsb2NramMvcGF0aC1sb2FkZXJ8cGF0aC1sb2FkZXJ9IHdpbGwgdXNlXG4gKiBgd2luZG93LmxvY2F0aW9uLmhyZWZgIGZvciB0aGUgYnJvd3NlciBhbmQgYHByb2Nlc3MuY3dkKClgIGZvciBOb2RlLmpzLikqXG4gKiBAcGFyYW0ge21vZHVsZTpKc29uUmVmc35SZWZQcmVQcm9jZXNzb3J9IFtyZWZQcmVQcm9jZXNzb3JdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJlLXByb2Nlc3MgYSBKU09OIFJlZmVyZW5jZSBsaWtlXG4gKiBvYmplY3QgKihUaGlzIGlzIGNhbGxlZCBwcmlvciB0byB2YWxpZGF0aW5nIHRoZSBKU09OIFJlZmVyZW5jZSBsaWtlIG9iamVjdCBhbmQgZ2V0dGluZyBpdHMgZGV0YWlscykqXG4gKiBAcGFyYW0ge21vZHVsZTpKc29uUmVmc35SZWZQb3N0UHJvY2Vzc29yfSBbcmVmUG9zdFByb2Nlc3Nvcl0gLSBUaGUgY2FsbGJhY2sgdXNlZCB0byBwb3N0LXByb2Nlc3MgdGhlIEpTT04gUmVmZXJlbmNlXG4gKiBtZXRhZGF0YSAqKFRoaXMgaXMgY2FsbGVkIHByaW9yIGZpbHRlcmluZyB0aGUgcmVmZXJlbmNlcykqXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtyZXNvbHZlQ2lyY3VsYXJzPWZhbHNlXSAtIFdoZXRoZXIgdG8gcmVzb2x2ZSBjaXJjdWxhciByZWZlcmVuY2VzXG4gKiBAcGFyYW0ge3N0cmluZ3xzdHJpbmdbXX0gW29wdGlvbnMuc3ViRG9jUGF0aD1bXV0gLSBUaGUgSlNPTiBQb2ludGVyIG9yIGFycmF5IG9mIHBhdGggc2VnbWVudHMgdG8gdGhlIHN1YiBkb2N1bWVudFxuICogbG9jYXRpb24gdG8gc2VhcmNoIGZyb21cbiAqL1xuXG4vKipcbiAqIFNpbXBsZSBmdW5jdGlvbiB1c2VkIHRvIGZpbHRlciBvdXQgSlNPTiBSZWZlcmVuY2VzLlxuICpcbiAqIEB0eXBlZGVmIHtmdW5jdGlvbn0gUmVmRGV0YWlsc0ZpbHRlclxuICpcbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzflVucmVzb2x2ZWRSZWZEZXRhaWxzfSByZWZEZXRhaWxzIC0gVGhlIEpTT04gUmVmZXJlbmNlIGRldGFpbHMgdG8gdGVzdFxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFRoZSBwYXRoIHRvIHRoZSBKU09OIFJlZmVyZW5jZVxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSB3aGV0aGVyIHRoZSBKU09OIFJlZmVyZW5jZSBzaG91bGQgYmUgZmlsdGVyZWQgKihvdXQpKiBvciBub3RcbiAqL1xuXG4vKipcbiAqIFNpbXBsZSBmdW5jdGlvbiB1c2VkIHRvIHByZS1wcm9jZXNzIGEgSlNPTiBSZWZlcmVuY2UgbGlrZSBvYmplY3QuXG4gKlxuICogQHR5cGVkZWYge2Z1bmN0aW9ufSBSZWZQcmVQcm9jZXNzb3JcbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gb2JqIC0gVGhlIEpTT04gUmVmZXJlbmNlIGxpa2Ugb2JqZWN0XG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIHBhdGggdG8gdGhlIEpTT04gUmVmZXJlbmNlIGxpa2Ugb2JqZWN0XG4gKlxuICogQHJldHVybnMge29iamVjdH0gdGhlIHByb2Nlc3NlZCBKU09OIFJlZmVyZW5jZSBsaWtlIG9iamVjdFxuICovXG5cbi8qKlxuICogU2ltcGxlIGZ1bmN0aW9uIHVzZWQgdG8gcG9zdC1wcm9jZXNzIGEgSlNPTiBSZWZlcmVuY2UgZGV0YWlscy5cbiAqXG4gKiBAdHlwZWRlZiB7ZnVuY3Rpb259IFJlZlBvc3RQcm9jZXNzb3JcbiAqXG4gKiBAcGFyYW0ge21vZHVsZTpKc29uUmVmc35VbnJlc29sdmVkUmVmRGV0YWlsc30gcmVmRGV0YWlscyAtIFRoZSBKU09OIFJlZmVyZW5jZSBkZXRhaWxzIHRvIHRlc3RcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgcGF0aCB0byB0aGUgSlNPTiBSZWZlcmVuY2VcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSB0aGUgcHJvY2Vzc2VkIEpTT04gUmVmZXJlbmNlIGRldGFpbHMgb2JqZWN0XG4gKi9cblxuLyoqXG4gKiBEZXRhaWxlZCBpbmZvcm1hdGlvbiBhYm91dCByZXNvbHZlZCBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge21vZHVsZTpKc29uUmVmc35VbnJlc29sdmVkUmVmRGV0YWlsc30gUmVzb2x2ZWRSZWZEZXRhaWxzXG4gKlxuICogQHByb3BlcnR5IHtib29sZWFufSBbY2lyY3VsYXJdIC0gV2hldGhlciBvciBub3QgdGhlIEpTT04gUmVmZXJlbmNlIGlzIGNpcmN1bGFyICooV2lsbCBub3QgYmUgc2V0IGlmIHRoZSBKU09OXG4gKiBSZWZlcmVuY2UgaXMgbm90IGNpcmN1bGFyKSpcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW21pc3NpbmddIC0gV2hldGhlciBvciBub3QgdGhlIHJlZmVyZW5jZWQgdmFsdWUgd2FzIG1pc3Npbmcgb3Igbm90ICooV2lsbCBub3QgYmUgc2V0IGlmIHRoZVxuICogcmVmZXJlbmNlZCB2YWx1ZSBpcyBub3QgbWlzc2luZykqXG4gKiBAcHJvcGVydHkgeyp9IFt2YWx1ZV0gLSBUaGUgcmVmZXJlbmNlZCB2YWx1ZSAqKFdpbGwgbm90IGJlIHNldCBpZiB0aGUgcmVmZXJlbmNlZCB2YWx1ZSBpcyBtaXNzaW5nKSpcbiAqL1xuXG4vKipcbiAqIFRoZSByZXN1bHRzIG9mIHJlc29sdmluZyB0aGUgSlNPTiBSZWZlcmVuY2VzIG9mIGFuIGFycmF5L29iamVjdC5cbiAqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvbHZlZFJlZnNSZXN1bHRzXG4gKlxuICogQHByb3BlcnR5IHttb2R1bGU6SnNvblJlZnN+UmVzb2x2ZWRSZWZEZXRhaWxzfSByZWZzIC0gQW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgKihmcmFnbWVudCB2ZXJzaW9uKSpcbiAqIHRvIHdoZXJlIHRoZSBKU09OIFJlZmVyZW5jZSBpcyBkZWZpbmVkIGFuZCB3aG9zZSB2YWx1ZXMgYXJlIHtAbGluayBtb2R1bGU6SnNvblJlZnN+UmVzb2x2ZWRSZWZEZXRhaWxzfVxuICogQHByb3BlcnR5IHtvYmplY3R9IHJlc29sdmVkIC0gVGhlIGFycmF5L29iamVjdCB3aXRoIGl0cyBKU09OIFJlZmVyZW5jZXMgZnVsbHkgcmVzb2x2ZWRcbiAqL1xuXG4vKipcbiAqIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZG9jdW1lbnQgYW5kIGRldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IGl0cyBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge21vZHVsZTpKc29uUmVmc35SZXNvbHZlZFJlZnNSZXN1bHRzfSBSZXRyaWV2ZWRSZWZzUmVzdWx0c1xuICpcbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSB2YWx1ZSAtIFRoZSByZXRyaWV2ZWQgZG9jdW1lbnRcbiAqL1xuXG4vKipcbiAqIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZG9jdW1lbnQsIHRoZSBkb2N1bWVudCB3aXRoIGl0cyByZWZlcmVuY2VzIHJlc29sdmVkIGFuZCAgZGV0YWlsZWQgaW5mb3JtYXRpb25cbiAqIGFib3V0IGl0cyBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge29iamVjdH0gUmV0cmlldmVkUmVzb2x2ZWRSZWZzUmVzdWx0c1xuICpcbiAqIEBwcm9wZXJ0eSB7bW9kdWxlOkpzb25SZWZzflVucmVzb2x2ZWRSZWZEZXRhaWxzfSByZWZzIC0gQW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgKihmcmFnbWVudCB2ZXJzaW9uKSpcbiAqIHRvIHdoZXJlIHRoZSBKU09OIFJlZmVyZW5jZSBpcyBkZWZpbmVkIGFuZCB3aG9zZSB2YWx1ZXMgYXJlIHtAbGluayBtb2R1bGU6SnNvblJlZnN+VW5yZXNvbHZlZFJlZkRldGFpbHN9XG4gKiBAcHJvcGVydHkge1Jlc29sdmVkUmVmc1Jlc3VsdHN9IC0gQW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgKihmcmFnbWVudCB2ZXJzaW9uKSpcbiAqIHRvIHdoZXJlIHRoZSBKU09OIFJlZmVyZW5jZSBpcyBkZWZpbmVkIGFuZCB3aG9zZSB2YWx1ZXMgYXJlIHtAbGluayBtb2R1bGU6SnNvblJlZnN+UmVzb2x2ZWRSZWZEZXRhaWxzfVxuICogQHByb3BlcnR5IHtvYmplY3R9IHZhbHVlIC0gVGhlIHJldHJpZXZlZCBkb2N1bWVudFxuICovXG5cbi8qKlxuICogRGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgdW5yZXNvbHZlZCBKU09OIFJlZmVyZW5jZXMuXG4gKlxuICogQHR5cGVkZWYge29iamVjdH0gVW5yZXNvbHZlZFJlZkRldGFpbHNcbiAqXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGVmIC0gVGhlIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZXJyb3JdIC0gVGhlIGVycm9yIGluZm9ybWF0aW9uIGZvciBpbnZhbGlkIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb24gKihPbmx5IHByZXNlbnQgd2hlbiB0aGVcbiAqIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb24gaXMgaW52YWxpZCBvciB0aGVyZSB3YXMgYSBwcm9ibGVtIHJldHJpZXZpbmcgYSByZW1vdGUgcmVmZXJlbmNlIGR1cmluZyByZXNvbHV0aW9uKSpcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB1cmkgLSBUaGUgVVJJIHBvcnRpb24gb2YgdGhlIEpTT04gUmVmZXJlbmNlXG4gKiBAcHJvcGVydHkge29iamVjdH0gdXJpRGV0YWlscyAtIERldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHRoZSBVUkkgYXMgcHJvdmlkZWQgYnlcbiAqIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vZ2FyeWNvdXJ0L3VyaS1qc3xVUkkucGFyc2V9LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBUaGUgSlNPTiBSZWZlcmVuY2UgdHlwZSAqKFRoaXMgdmFsdWUgY2FuIGJlIG9uZSBvZiB0aGUgZm9sbG93aW5nOiBgaW52YWxpZGAsIGBsb2NhbGAsXG4gKiBgcmVsYXRpdmVgIG9yIGByZW1vdGVgLikqXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dhcm5pbmddIC0gVGhlIHdhcm5pbmcgaW5mb3JtYXRpb24gKihPbmx5IHByZXNlbnQgd2hlbiB0aGUgSlNPTiBSZWZlcmVuY2UgZGVmaW5pdGlvbiBwcm9kdWNlcyBhXG4gKiB3YXJuaW5nKSpcbiAqL1xuXG4vKipcbiAqIENsZWFycyB0aGUgaW50ZXJuYWwgY2FjaGUgb2YgcmVtb3RlIGRvY3VtZW50cywgcmVmZXJlbmNlIGRldGFpbHMsIGV0Yy5cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmNsZWFyQ2FjaGVcbiAqL1xuZnVuY3Rpb24gY2xlYXJDYWNoZSAoKSB7XG4gIHJlbW90ZUNhY2hlID0ge307XG59XG5cbi8qKlxuICogVGFrZXMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cyBhbmQgZGVjb2RlcyB0aGUgSlNPTiBQb2ludGVyIHRva2VucyBpbiB0aGVtLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50c1xuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIHdpdGggdGhlaXIgSlNPTiBQb2ludGVyIHRva2VucyBkZWNvZGVkXG4gKlxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZSBwYXRoIGlzIG5vdCBhbiBgQXJyYXlgXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEjc2VjdGlvbi0zfVxuICpcbiAqIEBhbGlhcyBtb2R1bGU6SnNvblJlZnMuZGVjb2RlUGF0aFxuICovXG5mdW5jdGlvbiBkZWNvZGVQYXRoIChwYXRoKSB7XG4gIGlmICghXy5pc0FycmF5KHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF0aCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gIH1cblxuICByZXR1cm4gcGF0aC5tYXAoZnVuY3Rpb24gKHNlZykge1xuICAgIGlmICghXy5pc1N0cmluZyhzZWcpKSB7XG4gICAgICBzZWcgPSBKU09OLnN0cmluZ2lmeShzZWcpO1xuICAgIH1cblxuICAgIHJldHVybiBkZWNvZGVVUkkoc2VnLnJlcGxhY2UoL34xL2csICcvJykucmVwbGFjZSgvfjAvZywgJ34nKSk7XG4gIH0pO1xufVxuXG4vKipcbiAqIFRha2VzIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgYW5kIGVuY29kZXMgdGhlIHNwZWNpYWwgSlNPTiBQb2ludGVyIGNoYXJhY3RlcnMgaW4gdGhlbS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIGFycmF5IG9mIHBhdGggc2VnbWVudHNcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSB0aGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50cyB3aXRoIHRoZWlyIEpTT04gUG9pbnRlciB0b2tlbnMgZW5jb2RlZFxuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGUgcGF0aCBpcyBub3QgYW4gYEFycmF5YFxuICpcbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxI3NlY3Rpb24tM31cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmVuY29kZVBhdGhcbiAqL1xuZnVuY3Rpb24gZW5jb2RlUGF0aCAocGF0aCkge1xuICBpZiAoIV8uaXNBcnJheShwYXRoKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3BhdGggbXVzdCBiZSBhbiBhcnJheScpO1xuICB9XG5cbiAgcmV0dXJuIHBhdGgubWFwKGZ1bmN0aW9uIChzZWcpIHtcbiAgICBpZiAoIV8uaXNTdHJpbmcoc2VnKSkge1xuICAgICAgc2VnID0gSlNPTi5zdHJpbmdpZnkoc2VnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnLnJlcGxhY2UoL34vZywgJ34wJykucmVwbGFjZSgvXFwvL2csICd+MScpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBGaW5kcyBKU09OIFJlZmVyZW5jZXMgZGVmaW5lZCB3aXRoaW4gdGhlIHByb3ZpZGVkIGFycmF5L29iamVjdC5cbiAqXG4gKiBAcGFyYW0ge2FycmF5fG9iamVjdH0gb2JqIC0gVGhlIHN0cnVjdHVyZSB0byBmaW5kIEpTT04gUmVmZXJlbmNlcyB3aXRoaW5cbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzfkpzb25SZWZzT3B0aW9uc30gW29wdGlvbnNdIC0gVGhlIEpzb25SZWZzIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBhbiBvYmplY3Qgd2hvc2Uga2V5cyBhcmUgSlNPTiBQb2ludGVycyAqKGZyYWdtZW50IHZlcnNpb24pKiB0byB3aGVyZSB0aGUgSlNPTiBSZWZlcmVuY2UgaXMgZGVmaW5lZFxuICogYW5kIHdob3NlIHZhbHVlcyBhcmUge0BsaW5rIG1vZHVsZTpKc29uUmVmc35VbnJlc29sdmVkUmVmRGV0YWlsc30uXG4gKlxuICogQHRocm93cyB7RXJyb3J9IHdoZW4gdGhlIGlucHV0IGFyZ3VtZW50cyBmYWlsIHZhbGlkYXRpb24gb3IgaWYgYG9wdGlvbnMuc3ViRG9jUGF0aGAgcG9pbnRzIHRvIGFuIGludmFsaWQgbG9jYXRpb25cbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmZpbmRSZWZzXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEZpbmRpbmcgYWxsIHZhbGlkIHJlZmVyZW5jZXNcbiAqIHZhciBhbGxSZWZzID0gSnNvblJlZnMuZmluZFJlZnMob2JqKTtcbiAqIC8vIEZpbmRpbmcgYWxsIHJlbW90ZSByZWZlcmVuY2VzXG4gKiB2YXIgcmVtb3RlUmVmcyA9IEpzb25SZWZzLmZpbmRSZWZzKG9iaiwge2ZpbHRlcjogWydyZWxhdGl2ZScsICdyZW1vdGUnXX0pO1xuICogLy8gRmluZGluZyBhbGwgaW52YWxpZCByZWZlcmVuY2VzXG4gKiB2YXIgaW52YWxpZFJlZnMgPSBKc29uUmVmcy5maW5kUmVmcyhvYmosIHtmaWx0ZXI6ICdpbnZhbGlkJywgaW5jbHVkZUludmFsaWQ6IHRydWV9KTtcbiAqL1xuZnVuY3Rpb24gZmluZFJlZnMgKG9iaiwgb3B0aW9ucykge1xuICB2YXIgcmVmcyA9IHt9O1xuXG4gIC8vIFZhbGlkYXRlIHRoZSBwcm92aWRlZCBkb2N1bWVudFxuICBpZiAoIV8uaXNBcnJheShvYmopICYmICFfLmlzT2JqZWN0KG9iaikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvYmogbXVzdCBiZSBhbiBBcnJheSBvciBhbiBPYmplY3QnKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIG9wdGlvbnNcbiAgb3B0aW9ucyA9IHZhbGlkYXRlT3B0aW9ucyhvcHRpb25zLCBvYmopO1xuXG4gIC8vIFdhbGsgdGhlIGRvY3VtZW50IChvciBzdWIgZG9jdW1lbnQpIGFuZCBmaW5kIGFsbCBKU09OIFJlZmVyZW5jZXNcbiAgd2FsayhmaW5kQW5jZXN0b3JzKG9iaiwgb3B0aW9ucy5zdWJEb2NQYXRoKSxcbiAgICAgICBmaW5kVmFsdWUob2JqLCBvcHRpb25zLnN1YkRvY1BhdGgpLFxuICAgICAgIF8uY2xvbmVEZWVwKG9wdGlvbnMuc3ViRG9jUGF0aCksXG4gICAgICAgZnVuY3Rpb24gKGFuY2VzdG9ycywgbm9kZSwgcGF0aCkge1xuICAgICAgICAgdmFyIHByb2Nlc3NDaGlsZHJlbiA9IHRydWU7XG4gICAgICAgICB2YXIgcmVmRGV0YWlscztcbiAgICAgICAgIHZhciByZWZQdHI7XG5cbiAgICAgICAgIGlmIChpc1JlZkxpa2Uobm9kZSkpIHtcbiAgICAgICAgICAgLy8gUHJlLXByb2Nlc3MgdGhlIG5vZGUgd2hlbiBuZWNlc3NhcnlcbiAgICAgICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucmVmUHJlUHJvY2Vzc29yKSkge1xuICAgICAgICAgICAgIG5vZGUgPSBvcHRpb25zLnJlZlByZVByb2Nlc3NvcihfLmNsb25lRGVlcChub2RlKSwgcGF0aCk7XG4gICAgICAgICAgIH1cblxuICAgICAgICAgICByZWZEZXRhaWxzID0gZ2V0UmVmRGV0YWlscyhub2RlKTtcblxuICAgICAgICAgICAvLyBQb3N0LXByb2Nlc3MgdGhlIHJlZmVyZW5jZSBkZXRhaWxzXG4gICAgICAgICAgIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLnJlZlBvc3RQcm9jZXNzb3IpKSB7XG4gICAgICAgICAgICAgcmVmRGV0YWlscyA9IG9wdGlvbnMucmVmUG9zdFByb2Nlc3NvcihyZWZEZXRhaWxzLCBwYXRoKTtcbiAgICAgICAgICAgfVxuXG4gICAgICAgICAgIGlmIChvcHRpb25zLmZpbHRlcihyZWZEZXRhaWxzLCBwYXRoKSkge1xuICAgICAgICAgICAgIHJlZlB0ciA9IHBhdGhUb1B0cihwYXRoKTtcblxuICAgICAgICAgICAgIHJlZnNbcmVmUHRyXSA9IHJlZkRldGFpbHM7XG4gICAgICAgICAgIH1cblxuICAgICAgICAgICAvLyBXaGVuZXZlciBhIEpTT04gUmVmZXJlbmNlIGhhcyBleHRyYSBjaGlsZHJlbiwgaXRzIGNoaWxkcmVuIHNob3VsZCBub3QgYmUgcHJvY2Vzc2VkLlxuICAgICAgICAgICAvLyAgIFNlZTogaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtcGJyeWFuLXp5cC1qc29uLXJlZi0wMyNzZWN0aW9uLTNcbiAgICAgICAgICAgaWYgKGdldEV4dHJhUmVmS2V5cyhub2RlKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgcHJvY2Vzc0NoaWxkcmVuID0gZmFsc2U7XG4gICAgICAgICAgIH1cbiAgICAgICAgIH1cblxuICAgICAgICAgcmV0dXJuIHByb2Nlc3NDaGlsZHJlbjtcbiAgICAgICB9KTtcblxuICByZXR1cm4gcmVmcztcbn1cblxuLyoqXG4gKiBGaW5kcyBKU09OIFJlZmVyZW5jZXMgZGVmaW5lZCB3aXRoaW4gdGhlIGRvY3VtZW50IGF0IHRoZSBwcm92aWRlZCBsb2NhdGlvbi5cbiAqXG4gKiBUaGlzIEFQSSBpcyBpZGVudGljYWwgdG8ge0BsaW5rIG1vZHVsZTpKc29uUmVmcy5maW5kUmVmc30gZXhjZXB0IHRoaXMgQVBJIHdpbGwgcmV0cmlldmUgYSByZW1vdGUgZG9jdW1lbnQgYW5kIHRoZW5cbiAqIHJldHVybiB0aGUgcmVzdWx0IG9mIHtAbGluayBtb2R1bGU6SnNvblJlZnMuZmluZFJlZnN9IG9uIHRoZSByZXRyaWV2ZWQgZG9jdW1lbnQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2F0aW9uIC0gVGhlIGxvY2F0aW9uIHRvIHJldHJpZXZlICooQ2FuIGJlIHJlbGF0aXZlIG9yIGFic29sdXRlLCBqdXN0IG1ha2Ugc3VyZSB5b3UgbG9vayBhdCB0aGVcbiAqIHtAbGluayBtb2R1bGU6SnNvblJlZnN+SnNvblJlZnNPcHRpb25zfG9wdGlvbnMgZG9jdW1lbnRhdGlvbn0gdG8gc2VlIGhvdyByZWxhdGl2ZSByZWZlcmVuY2VzIGFyZSBoYW5kbGVkLikqXG4gKiBAcGFyYW0ge21vZHVsZTpKc29uUmVmc35Kc29uUmVmc09wdGlvbnN9IFtvcHRpb25zXSAtIFRoZSBKc29uUmVmcyBvcHRpb25zXG4gKlxuICogQHJldHVybnMge1Byb21pc2V9IGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIGEge0BsaW5rIG1vZHVsZTpKc29uUmVmc35SZXRyaWV2ZWRSZWZzUmVzdWx0c30gYW5kIHJlamVjdHMgd2l0aCBhblxuICogYEVycm9yYCB3aGVuIHRoZSBpbnB1dCBhcmd1bWVudHMgZmFpbCB2YWxpZGF0aW9uLCB3aGVuIGBvcHRpb25zLnN1YkRvY1BhdGhgIHBvaW50cyB0byBhbiBpbnZhbGlkIGxvY2F0aW9uIG9yIHdoZW5cbiAqICB0aGUgbG9jYXRpb24gYXJndW1lbnQgcG9pbnRzIHRvIGFuIHVubG9hZGFibGUgcmVzb3VyY2VcbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmZpbmRSZWZzQXRcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB0aGF0IG9ubHkgcmVzb2x2ZXMgcmVmZXJlbmNlcyB3aXRoaW4gYSBzdWIgZG9jdW1lbnRcbiAqIEpzb25SZWZzLmZpbmRSZWZzQXQoJ2h0dHA6Ly9wZXRzdG9yZS5zd2FnZ2VyLmlvL3YyL3N3YWdnZXIuanNvbicsIHtcbiAqICAgICBzdWJEb2NQYXRoOiAnIy9kZWZpbml0aW9ucydcbiAqICAgfSlcbiAqICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICogICAgICAvLyBEbyBzb21ldGhpbmcgd2l0aCB0aGUgcmVzcG9uc2VcbiAqICAgICAgLy9cbiAqICAgICAgLy8gcmVzLnJlZnM6IEpTT04gUmVmZXJlbmNlIGxvY2F0aW9ucyBhbmQgZGV0YWlsc1xuICogICAgICAvLyByZXMudmFsdWU6IFRoZSByZXRyaWV2ZWQgZG9jdW1lbnRcbiAqICAgfSwgZnVuY3Rpb24gKGVycikge1xuICogICAgIGNvbnNvbGUubG9nKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICovXG5mdW5jdGlvbiBmaW5kUmVmc0F0IChsb2NhdGlvbiwgb3B0aW9ucykge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgLy8gVmFsaWRhdGUgdGhlIHByb3ZpZGVkIGxvY2F0aW9uXG4gICAgICBpZiAoIV8uaXNTdHJpbmcobG9jYXRpb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xvY2F0aW9uIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICAgIH1cblxuICAgICAgaWYgKF8uaXNVbmRlZmluZWQob3B0aW9ucykpIHtcbiAgICAgICAgb3B0aW9ucyA9IHt9O1xuICAgICAgfVxuXG4gICAgICBpZiAoXy5pc09iamVjdChvcHRpb25zKSkge1xuICAgICAgICAvLyBBZGQgdGhlIGxvY2F0aW9uIHRvIHRoZSBvcHRpb25zIGZvciBwcm9jZXNzaW5nL3ZhbGlkYXRpb25cbiAgICAgICAgb3B0aW9ucy5sb2NhdGlvbiA9IGxvY2F0aW9uO1xuICAgICAgfVxuXG4gICAgICAvLyBWYWxpZGF0ZSBvcHRpb25zXG4gICAgICBvcHRpb25zID0gdmFsaWRhdGVPcHRpb25zKG9wdGlvbnMpO1xuXG4gICAgICByZXR1cm4gZ2V0UmVtb3RlRG9jdW1lbnQob3B0aW9ucy5sb2NhdGlvbiwgb3B0aW9ucyk7XG4gICAgfSlcbiAgICAudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICB2YXIgY2FjaGVFbnRyeSA9IF8uY2xvbmVEZWVwKHJlbW90ZUNhY2hlW29wdGlvbnMubG9jYXRpb25dKTtcbiAgICAgIHZhciBjT3B0aW9ucyA9IF8uY2xvbmVEZWVwKG9wdGlvbnMpO1xuICAgICAgdmFyIHVyaURldGFpbHMgPSBwYXJzZVVSSShvcHRpb25zLmxvY2F0aW9uKTtcblxuICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2FjaGVFbnRyeS5yZWZzKSkge1xuICAgICAgICAvLyBEbyBub3QgZmlsdGVyIGFueSByZWZlcmVuY2VzIHNvIHRoZSBjYWNoZSBpcyBjb21wbGV0ZVxuICAgICAgICBkZWxldGUgY09wdGlvbnMuZmlsdGVyO1xuICAgICAgICBkZWxldGUgY09wdGlvbnMuc3ViRG9jUGF0aDtcblxuICAgICAgICBjT3B0aW9ucy5pbmNsdWRlSW52YWxpZCA9IHRydWU7XG5cbiAgICAgICAgcmVtb3RlQ2FjaGVbb3B0aW9ucy5sb2NhdGlvbl0ucmVmcyA9IGZpbmRSZWZzKHJlcywgY09wdGlvbnMpO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgdGhlIGZpbHRlciBvcHRpb25zIGJhY2tcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmZpbHRlcikpIHtcbiAgICAgICAgY09wdGlvbnMuZmlsdGVyID0gb3B0aW9ucy5maWx0ZXI7XG4gICAgICB9XG5cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZCh1cmlEZXRhaWxzLmZyYWdtZW50KSkge1xuICAgICAgICBjT3B0aW9ucy5zdWJEb2NQYXRoID0gcGF0aEZyb21QdHIoZGVjb2RlVVJJKHVyaURldGFpbHMuZnJhZ21lbnQpKTtcbiAgICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQodXJpRGV0YWlscy5zdWJEb2NQYXRoKSkge1xuICAgICAgICBjT3B0aW9ucy5zdWJEb2NQYXRoID0gb3B0aW9ucy5zdWJEb2NQYXRoO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGlzIHdpbGwgdXNlIHRoZSBjYWNoZSBzbyBkb24ndCB3b3JyeSBhYm91dCBjYWxsaW5nIGl0IHR3aWNlXG4gICAgICByZXR1cm4ge1xuICAgICAgICByZWZzOiBmaW5kUmVmcyhyZXMsIGNPcHRpb25zKSxcbiAgICAgICAgdmFsdWU6IHJlc1xuICAgICAgfTtcbiAgICB9KTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbi8qKlxuICogUmV0dXJucyBkZXRhaWxlZCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgSlNPTiBSZWZlcmVuY2UuXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IG9iaiAtIFRoZSBKU09OIFJlZmVyZW5jZSBkZWZpbml0aW9uXG4gKlxuICogQHJldHVybnMge21vZHVsZTpKc29uUmVmc35VbnJlc29sdmVkUmVmRGV0YWlsc30gdGhlIGRldGFpbGVkIGluZm9ybWF0aW9uXG4gKlxuICogQGFsaWFzIG1vZHVsZTpKc29uUmVmcy5nZXRSZWZEZXRhaWxzXG4gKi9cbmZ1bmN0aW9uIGdldFJlZkRldGFpbHMgKG9iaikge1xuICB2YXIgZGV0YWlscyA9IHtcbiAgICBkZWY6IG9ialxuICB9O1xuICB2YXIgY2FjaGVLZXk7XG4gIHZhciBleHRyYUtleXM7XG4gIHZhciB1cmlEZXRhaWxzO1xuXG4gIHRyeSB7XG4gICAgaWYgKGlzUmVmTGlrZShvYmosIHRydWUpKSB7XG4gICAgICBjYWNoZUtleSA9IG9iai4kcmVmO1xuICAgICAgdXJpRGV0YWlscyA9IHVyaURldGFpbHNDYWNoZVtjYWNoZUtleV07XG5cbiAgICAgIGlmIChfLmlzVW5kZWZpbmVkKHVyaURldGFpbHMpKSB7XG4gICAgICAgIHVyaURldGFpbHMgPSB1cmlEZXRhaWxzQ2FjaGVbY2FjaGVLZXldID0gcGFyc2VVUkkoY2FjaGVLZXkpO1xuICAgICAgfVxuXG4gICAgICBkZXRhaWxzLnVyaSA9IGNhY2hlS2V5O1xuICAgICAgZGV0YWlscy51cmlEZXRhaWxzID0gdXJpRGV0YWlscztcblxuICAgICAgaWYgKF8uaXNVbmRlZmluZWQodXJpRGV0YWlscy5lcnJvcikpIHtcbiAgICAgICAgZGV0YWlscy50eXBlID0gZ2V0UmVmVHlwZShkZXRhaWxzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRldGFpbHMuZXJyb3IgPSBkZXRhaWxzLnVyaURldGFpbHMuZXJyb3I7XG4gICAgICAgIGRldGFpbHMudHlwZSA9ICdpbnZhbGlkJztcbiAgICAgIH1cblxuICAgICAgLy8gSWRlbnRpZnkgd2FybmluZ1xuICAgICAgZXh0cmFLZXlzID0gZ2V0RXh0cmFSZWZLZXlzKG9iaik7XG5cbiAgICAgIGlmIChleHRyYUtleXMubGVuZ3RoID4gMCkge1xuICAgICAgICBkZXRhaWxzLndhcm5pbmcgPSAnRXh0cmEgSlNPTiBSZWZlcmVuY2UgcHJvcGVydGllcyB3aWxsIGJlIGlnbm9yZWQ6ICcgKyBleHRyYUtleXMuam9pbignLCAnKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZGV0YWlscy50eXBlID0gJ2ludmFsaWQnO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgZGV0YWlscy5lcnJvciA9IGVyci5tZXNzYWdlO1xuICAgIGRldGFpbHMudHlwZSA9ICdpbnZhbGlkJztcbiAgfVxuXG4gIHJldHVybiBkZXRhaWxzO1xufVxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciB0aGUgYXJndW1lbnQgcmVwcmVzZW50cyBhIEpTT04gUG9pbnRlci5cbiAqXG4gKiBBIHN0cmluZyBpcyBhIEpTT04gUG9pbnRlciBpZiB0aGUgZm9sbG93aW5nIGFyZSBhbGwgdHJ1ZTpcbiAqXG4gKiAgICogVGhlIHN0cmluZyBpcyBvZiB0eXBlIGBTdHJpbmdgXG4gKiAgICogVGhlIHN0cmluZyBtdXN0IGJlIGVtcHR5LCBgI2Agb3Igc3RhcnQgd2l0aCBhIGAvYCBvciBgIy9gXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHB0ciAtIFRoZSBzdHJpbmcgdG8gY2hlY2tcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW3Rocm93V2l0aERldGFpbHM9ZmFsc2VdIC0gV2hldGhlciBvciBub3QgdG8gdGhyb3cgYW4gYEVycm9yYCB3aXRoIHRoZSBkZXRhaWxzIGFzIHRvIHdoeSB0aGUgdmFsdWVcbiAqIHByb3ZpZGVkIGlzIGludmFsaWRcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdGhlIHJlc3VsdCBvZiB0aGUgY2hlY2tcbiAqXG4gKiBAdGhyb3dzIHtlcnJvcn0gd2hlbiB0aGUgcHJvdmlkZWQgdmFsdWUgaXMgaW52YWxpZCBhbmQgdGhlIGB0aHJvd1dpdGhEZXRhaWxzYCBhcmd1bWVudCBpcyBgdHJ1ZWBcbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmlzUHRyXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEjc2VjdGlvbi0zfVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBTZXBhcmF0aW5nIHRoZSBkaWZmZXJlbnQgd2F5cyB0byBpbnZva2UgaXNQdHIgZm9yIGRlbW9uc3RyYXRpb24gcHVycG9zZXNcbiAqIGlmIChpc1B0cihzdHIpKSB7XG4gKiAgIC8vIEhhbmRsZSBhIHZhbGlkIEpTT04gUG9pbnRlclxuICogfSBlbHNlIHtcbiAqICAgLy8gR2V0IHRoZSByZWFzb24gYXMgdG8gd2h5IHRoZSB2YWx1ZSBpcyBub3QgYSBKU09OIFBvaW50ZXIgc28geW91IGNhbiBmaXgvcmVwb3J0IGl0XG4gKiAgIHRyeSB7XG4gKiAgICAgaXNQdHIoc3RyLCB0cnVlKTtcbiAqICAgfSBjYXRjaCAoZXJyKSB7XG4gKiAgICAgLy8gVGhlIGVycm9yIG1lc3NhZ2UgY29udGFpbnMgdGhlIGRldGFpbHMgYXMgdG8gd2h5IHRoZSBwcm92aWRlZCB2YWx1ZSBpcyBub3QgYSBKU09OIFBvaW50ZXJcbiAqICAgfVxuICogfVxuICovXG5mdW5jdGlvbiBpc1B0ciAocHRyLCB0aHJvd1dpdGhEZXRhaWxzKSB7XG4gIHZhciB2YWxpZCA9IHRydWU7XG4gIHZhciBmaXJzdENoYXI7XG5cbiAgdHJ5IHtcbiAgICBpZiAoXy5pc1N0cmluZyhwdHIpKSB7XG4gICAgICBpZiAocHRyICE9PSAnJykge1xuICAgICAgICBmaXJzdENoYXIgPSBwdHIuY2hhckF0KDApO1xuXG4gICAgICAgIGlmIChbJyMnLCAnLyddLmluZGV4T2YoZmlyc3RDaGFyKSA9PT0gLTEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IHN0YXJ0IHdpdGggYSAvIG9yICMvJyk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlyc3RDaGFyID09PSAnIycgJiYgcHRyICE9PSAnIycgJiYgcHRyLmNoYXJBdCgxKSAhPT0gJy8nKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgbXVzdCBzdGFydCB3aXRoIGEgLyBvciAjLycpO1xuICAgICAgICB9IGVsc2UgaWYgKHB0ci5tYXRjaChiYWRQdHJUb2tlblJlZ2V4KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcigncHRyIGhhcyBpbnZhbGlkIHRva2VuKHMpJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgaXMgbm90IGEgU3RyaW5nJyk7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAodGhyb3dXaXRoRGV0YWlscyA9PT0gdHJ1ZSkge1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cblxuICAgIHZhbGlkID0gZmFsc2U7XG4gIH1cblxuICByZXR1cm4gdmFsaWQ7XG59XG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIHRoZSBhcmd1bWVudCByZXByZXNlbnRzIGEgSlNPTiBSZWZlcmVuY2UuXG4gKlxuICogQW4gb2JqZWN0IGlzIGEgSlNPTiBSZWZlcmVuY2Ugb25seSBpZiB0aGUgZm9sbG93aW5nIGFyZSBhbGwgdHJ1ZTpcbiAqXG4gKiAgICogVGhlIG9iamVjdCBpcyBvZiB0eXBlIGBPYmplY3RgXG4gKiAgICogVGhlIG9iamVjdCBoYXMgYSBgJHJlZmAgcHJvcGVydHlcbiAqICAgKiBUaGUgYCRyZWZgIHByb3BlcnR5IGlzIGEgdmFsaWQgVVJJICooV2UgZG8gbm90IHJlcXVpcmUgMTAwJSBzdHJpY3QgVVJJcyBhbmQgd2lsbCBoYW5kbGUgdW5lc2NhcGVkIHNwZWNpYWxcbiAqICAgICBjaGFyYWN0ZXJzLikqXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IG9iaiAtIFRoZSBvYmplY3QgdG8gY2hlY2tcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW3Rocm93V2l0aERldGFpbHM9ZmFsc2VdIC0gV2hldGhlciBvciBub3QgdG8gdGhyb3cgYW4gYEVycm9yYCB3aXRoIHRoZSBkZXRhaWxzIGFzIHRvIHdoeSB0aGUgdmFsdWVcbiAqIHByb3ZpZGVkIGlzIGludmFsaWRcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdGhlIHJlc3VsdCBvZiB0aGUgY2hlY2tcbiAqXG4gKiBAdGhyb3dzIHtlcnJvcn0gd2hlbiB0aGUgcHJvdmlkZWQgdmFsdWUgaXMgaW52YWxpZCBhbmQgdGhlIGB0aHJvd1dpdGhEZXRhaWxzYCBhcmd1bWVudCBpcyBgdHJ1ZWBcbiAqXG4gKiBAYWxpYXMgbW9kdWxlOkpzb25SZWZzLmlzUmVmXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtcGJyeWFuLXp5cC1qc29uLXJlZi0wMyNzZWN0aW9uLTN9XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFNlcGFyYXRpbmcgdGhlIGRpZmZlcmVudCB3YXlzIHRvIGludm9rZSBpc1JlZiBmb3IgZGVtb25zdHJhdGlvbiBwdXJwb3Nlc1xuICogaWYgKGlzUmVmKG9iaikpIHtcbiAqICAgLy8gSGFuZGxlIGEgdmFsaWQgSlNPTiBSZWZlcmVuY2VcbiAqIH0gZWxzZSB7XG4gKiAgIC8vIEdldCB0aGUgcmVhc29uIGFzIHRvIHdoeSB0aGUgdmFsdWUgaXMgbm90IGEgSlNPTiBSZWZlcmVuY2Ugc28geW91IGNhbiBmaXgvcmVwb3J0IGl0XG4gKiAgIHRyeSB7XG4gKiAgICAgaXNSZWYoc3RyLCB0cnVlKTtcbiAqICAgfSBjYXRjaCAoZXJyKSB7XG4gKiAgICAgLy8gVGhlIGVycm9yIG1lc3NhZ2UgY29udGFpbnMgdGhlIGRldGFpbHMgYXMgdG8gd2h5IHRoZSBwcm92aWRlZCB2YWx1ZSBpcyBub3QgYSBKU09OIFJlZmVyZW5jZVxuICogICB9XG4gKiB9XG4gKi9cbmZ1bmN0aW9uIGlzUmVmIChvYmosIHRocm93V2l0aERldGFpbHMpIHtcbiAgcmV0dXJuIGlzUmVmTGlrZShvYmosIHRocm93V2l0aERldGFpbHMpICYmIGdldFJlZkRldGFpbHMob2JqLCB0aHJvd1dpdGhEZXRhaWxzKS50eXBlICE9PSAnaW52YWxpZCc7XG59XG5cbi8qKlxuICogUmV0dXJucyBhbiBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIGZvciB0aGUgcHJvdmlkZWQgSlNPTiBQb2ludGVyLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge3N0cmluZ1tdfSB0aGUgcGF0aCBzZWdtZW50c1xuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGUgcHJvdmlkZWQgYHB0cmAgYXJndW1lbnQgaXMgbm90IGEgSlNPTiBQb2ludGVyXG4gKlxuICogQGFsaWFzIG1vZHVsZTpKc29uUmVmcy5wYXRoRnJvbVB0clxuICovXG5mdW5jdGlvbiBwYXRoRnJvbVB0ciAocHRyKSB7XG4gIHRyeSB7XG4gICAgaXNQdHIocHRyLCB0cnVlKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgbXVzdCBiZSBhIEpTT04gUG9pbnRlcjogJyArIGVyci5tZXNzYWdlKTtcbiAgfVxuXG4gIHZhciBzZWdtZW50cyA9IHB0ci5zcGxpdCgnLycpO1xuXG4gIC8vIFJlbW92ZSB0aGUgZmlyc3Qgc2VnbWVudFxuICBzZWdtZW50cy5zaGlmdCgpO1xuXG4gIHJldHVybiBkZWNvZGVQYXRoKHNlZ21lbnRzKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgSlNPTiBQb2ludGVyIGZvciB0aGUgcHJvdmlkZWQgYXJyYXkgb2YgcGF0aCBzZWdtZW50cy5cbiAqXG4gKiAqKk5vdGU6KiogSWYgYSBwYXRoIHNlZ21lbnQgaW4gYHBhdGhgIGlzIG5vdCBhIGBTdHJpbmdgLCBpdCB3aWxsIGJlIGNvbnZlcnRlZCB0byBvbmUgdXNpbmcgYEpTT04uc3RyaW5naWZ5YC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIGFycmF5IG9mIHBhdGggc2VnbWVudHNcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2hhc2hQcmVmaXg9dHJ1ZV0gLSBXaGV0aGVyIG9yIG5vdCBjcmVhdGUgYSBoYXNoLXByZWZpeGVkIEpTT04gUG9pbnRlclxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSBjb3JyZXNwb25kaW5nIEpTT04gUG9pbnRlclxuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGUgYHBhdGhgIGFyZ3VtZW50IGlzIG5vdCBhbiBhcnJheVxuICpcbiAqIEBhbGlhcyBtb2R1bGU6SnNvblJlZnMucGF0aFRvUHRyXG4gKi9cbmZ1bmN0aW9uIHBhdGhUb1B0ciAocGF0aCwgaGFzaFByZWZpeCkge1xuICBpZiAoIV8uaXNBcnJheShwYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncGF0aCBtdXN0IGJlIGFuIEFycmF5Jyk7XG4gIH1cblxuICAvLyBFbmNvZGUgZWFjaCBzZWdtZW50IGFuZCByZXR1cm5cbiAgcmV0dXJuIChoYXNoUHJlZml4ICE9PSBmYWxzZSA/ICcjJyA6ICcnKSArIChwYXRoLmxlbmd0aCA+IDAgPyAnLycgOiAnJykgKyBlbmNvZGVQYXRoKHBhdGgpLmpvaW4oJy8nKTtcbn1cblxuLyoqXG4gKiBGaW5kcyBKU09OIFJlZmVyZW5jZXMgZGVmaW5lZCB3aXRoaW4gdGhlIHByb3ZpZGVkIGFycmF5L29iamVjdCBhbmQgcmVzb2x2ZXMgdGhlbS5cbiAqXG4gKiBAcGFyYW0ge2FycmF5fG9iamVjdH0gb2JqIC0gVGhlIHN0cnVjdHVyZSB0byBmaW5kIEpTT04gUmVmZXJlbmNlcyB3aXRoaW5cbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzfkpzb25SZWZzT3B0aW9uc30gW29wdGlvbnNdIC0gVGhlIEpzb25SZWZzIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgYSB7QGxpbmsgbW9kdWxlOkpzb25SZWZzflJlc29sdmVkUmVmc1Jlc3VsdHN9IGFuZCByZWplY3RzIHdpdGggYW5cbiAqIGBFcnJvcmAgd2hlbiB0aGUgaW5wdXQgYXJndW1lbnRzIGZhaWwgdmFsaWRhdGlvbiwgd2hlbiBgb3B0aW9ucy5zdWJEb2NQYXRoYCBwb2ludHMgdG8gYW4gaW52YWxpZCBsb2NhdGlvbiBvciB3aGVuXG4gKiAgdGhlIGxvY2F0aW9uIGFyZ3VtZW50IHBvaW50cyB0byBhbiB1bmxvYWRhYmxlIHJlc291cmNlXG4gKlxuICogQGFsaWFzIG1vZHVsZTpKc29uUmVmcy5yZXNvbHZlUmVmc1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIHRoYXQgb25seSByZXNvbHZlcyByZWxhdGl2ZSBhbmQgcmVtb3RlIHJlZmVyZW5jZXNcbiAqIEpzb25SZWZzLnJlc29sdmVSZWZzKHN3YWdnZXJPYmosIHtcbiAqICAgICBmaWx0ZXI6IFsncmVsYXRpdmUnLCAncmVtb3RlJ11cbiAqICAgfSlcbiAqICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICogICAgICAvLyBEbyBzb21ldGhpbmcgd2l0aCB0aGUgcmVzcG9uc2VcbiAqICAgICAgLy9cbiAqICAgICAgLy8gcmVzLnJlZnM6IEpTT04gUmVmZXJlbmNlIGxvY2F0aW9ucyBhbmQgZGV0YWlsc1xuICogICAgICAvLyByZXMucmVzb2x2ZWQ6IFRoZSBkb2N1bWVudCB3aXRoIHRoZSBhcHByb3ByaWF0ZSBKU09OIFJlZmVyZW5jZXMgcmVzb2x2ZWRcbiAqICAgfSwgZnVuY3Rpb24gKGVycikge1xuICogICAgIGNvbnNvbGUubG9nKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICovXG5mdW5jdGlvbiByZXNvbHZlUmVmcyAob2JqLCBvcHRpb25zKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcHJvdmlkZWQgZG9jdW1lbnRcbiAgICAgIGlmICghXy5pc0FycmF5KG9iaikgJiYgIV8uaXNPYmplY3Qob2JqKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvYmogbXVzdCBiZSBhbiBBcnJheSBvciBhbiBPYmplY3QnKTtcbiAgICAgIH1cblxuICAgICAgLy8gVmFsaWRhdGUgb3B0aW9uc1xuICAgICAgb3B0aW9ucyA9IHZhbGlkYXRlT3B0aW9ucyhvcHRpb25zLCBvYmopO1xuXG4gICAgICAvLyBDbG9uZSB0aGUgaW5wdXQgc28gd2UgZG8gbm90IGFsdGVyIGl0XG4gICAgICBvYmogPSBfLmNsb25lRGVlcChvYmopO1xuICAgIH0pXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIG1ldGFkYXRhID0ge1xuICAgICAgICBkZXBzOiB7fSwgLy8gVG8gYXZvaWQgcHJvY2Vzc2luZyB0aGUgc2FtZSByZWZlcm5lY2UgdHdpY2UsIGFuZCBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlIGlkZW50aWZpY2F0aW9uXG4gICAgICAgIGRvY3M6IHt9LCAvLyBDYWNoZSB0byBhdm9pZCBwcm9jZXNzaW5nIHRoZSBzYW1lIGRvY3VtZW50IG1vcmUgdGhhbiBvbmNlXG4gICAgICAgIHJlZnM6IHt9IC8vIFJlZmVyZW5jZSBsb2NhdGlvbnMgYW5kIHRoZWlyIG1ldGFkYXRhXG4gICAgICB9O1xuXG4gICAgICByZXR1cm4gYnVpbGRSZWZNb2RlbChvYmosIG9wdGlvbnMsIG1ldGFkYXRhKVxuICAgICAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmV0dXJuIG1ldGFkYXRhO1xuICAgICAgICB9KTtcbiAgICB9KVxuICAgIC50aGVuKGZ1bmN0aW9uIChyZXN1bHRzKSB7XG4gICAgICB2YXIgYWxsUmVmcyA9IHt9O1xuICAgICAgdmFyIGNpcmN1bGFyUGF0aHMgPSBbXTtcbiAgICAgIHZhciBjaXJjdWxhcnMgPSBbXTtcbiAgICAgIHZhciBkZXBHcmFwaCA9IG5ldyBnbC5HcmFwaCgpO1xuICAgICAgdmFyIGZ1bGxMb2NhdGlvbiA9IG1ha2VBYnNvbHV0ZShvcHRpb25zLmxvY2F0aW9uKTtcbiAgICAgIHZhciByZWZzUm9vdCA9IGZ1bGxMb2NhdGlvbiArIHBhdGhUb1B0cihvcHRpb25zLnN1YkRvY1BhdGgpO1xuXG4gICAgICAvLyBJZGVudGlmeSBjaXJjdWxhcnNcblxuICAgICAgLy8gQWRkIG5vZGVzIGZpcnN0XG4gICAgICBPYmplY3Qua2V5cyhyZXN1bHRzLmRlcHMpLmZvckVhY2goZnVuY3Rpb24gKG5vZGUpIHtcbiAgICAgICAgZGVwR3JhcGguc2V0Tm9kZShub2RlKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZWRnZXNcbiAgICAgIF8uZWFjaChyZXN1bHRzLmRlcHMsIGZ1bmN0aW9uIChwcm9wcywgbm9kZSkge1xuICAgICAgICBfLmVhY2gocHJvcHMsIGZ1bmN0aW9uIChkZXApIHtcbiAgICAgICAgICBkZXBHcmFwaC5zZXRFZGdlKG5vZGUsIGRlcCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGNpcmN1bGFyUGF0aHMgPSBnbC5hbGcuZmluZEN5Y2xlcyhkZXBHcmFwaCk7XG5cbiAgICAgIC8vIENyZWF0ZSBhIHVuaXF1ZSBsaXN0IG9mIGNpcmN1bGFyc1xuICAgICAgY2lyY3VsYXJQYXRocy5mb3JFYWNoKGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgICAgIHBhdGguZm9yRWFjaChmdW5jdGlvbiAoc2VnKSB7XG4gICAgICAgICAgaWYgKGNpcmN1bGFycy5pbmRleE9mKHNlZykgPT09IC0xKSB7XG4gICAgICAgICAgICBjaXJjdWxhcnMucHVzaChzZWcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gUHJvY2VzcyBjaXJjdWxhcnNcbiAgICAgIF8uZWFjaChyZXN1bHRzLmRlcHMsIGZ1bmN0aW9uIChwcm9wcywgbm9kZSkge1xuICAgICAgICBfLmVhY2gocHJvcHMsIGZ1bmN0aW9uIChkZXAsIHByb3ApIHtcbiAgICAgICAgICB2YXIgaXNDaXJjdWxhciA9IGZhbHNlO1xuICAgICAgICAgIHZhciByZWZQdHIgPSBub2RlICsgcHJvcC5zbGljZSgxKTtcbiAgICAgICAgICB2YXIgcmVmRGV0YWlscyA9IHJlc3VsdHMucmVmc1tub2RlICsgcHJvcC5zbGljZSgxKV07XG4gICAgICAgICAgdmFyIHJlbW90ZSA9IGlzUmVtb3RlKHJlZkRldGFpbHMpO1xuICAgICAgICAgIHZhciBwYXRoSW5kZXg7XG5cbiAgICAgICAgICBpZiAoY2lyY3VsYXJzLmluZGV4T2YoZGVwKSA+IC0xKSB7XG4gICAgICAgICAgICAvLyBGaWd1cmUgb3V0IGlmIHRoZSBjaXJjdWxhciBpcyBwYXJ0IG9mIGEgY2lyY3VsYXIgY2hhaW4gb3IganVzdCBhIHJlZmVyZW5jZSB0byBhIGNpcmN1bGFyXG4gICAgICAgICAgICBjaXJjdWxhclBhdGhzLmZvckVhY2goZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgICAgICAgICAgLy8gU2hvcnQgY2lyY3VpdFxuICAgICAgICAgICAgICBpZiAoaXNDaXJjdWxhcikge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIHBhdGhJbmRleCA9IHBhdGguaW5kZXhPZihkZXApO1xuXG4gICAgICAgICAgICAgIGlmIChwYXRoSW5kZXggPiAtMSkge1xuICAgICAgICAgICAgICAgIC8vIENoZWNrIGVhY2ggcGF0aCBzZWdtZW50IHRvIHNlZSBpZiB0aGUgcmVmZXJlbmNlIGxvY2F0aW9uIGlzIGJlbmVhdGggb25lIG9mIGl0cyBzZWdtZW50c1xuICAgICAgICAgICAgICAgIHBhdGguZm9yRWFjaChmdW5jdGlvbiAoc2VnKSB7XG4gICAgICAgICAgICAgICAgICAvLyBTaG9ydCBjaXJjdWl0XG4gICAgICAgICAgICAgICAgICBpZiAoaXNDaXJjdWxhcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgIGlmIChyZWZQdHIuaW5kZXhPZihzZWcgKyAnLycpID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSByZWZlcmVuY2UgaXMgbG9jYWwsIG1hcmsgaXQgYXMgY2lyY3VsYXIgYnV0IGlmIGl0J3MgYSByZW1vdGUgcmVmZXJlbmNlLCBvbmx5IG1hcmsgaXRcbiAgICAgICAgICAgICAgICAgICAgLy8gY2lyY3VsYXIgaWYgdGhlIG1hdGNoaW5nIHBhdGggaXMgdGhlIGxhc3QgcGF0aCBzZWdtZW50LlxuICAgICAgICAgICAgICAgICAgICBpZiAoKHJlbW90ZSAmJiBwYXRoSW5kZXggPT09IHBhdGgubGVuZ3RoIC0gMSkgfHwgIXJlbW90ZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGlzQ2lyY3VsYXIgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpc0NpcmN1bGFyKSB7XG4gICAgICAgICAgICAvLyBVcGRhdGUgYWxsIHJlZmVyZW5jZXMgYW5kIHJlZmVyZW5jZSBkZXRhaWxzXG4gICAgICAgICAgICByZWZEZXRhaWxzLmNpcmN1bGFyID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlc29sdmUgdGhlIHJlZmVyZW5jZXNcbiAgICAgIF8uZWFjaChyZXN1bHRzLmRlcHMsIGZ1bmN0aW9uIChkZXBzLCBwYXJlbnRQdHIpIHtcbiAgICAgICAgdmFyIHBQdHJQYXJ0cyA9IHBhcmVudFB0ci5zcGxpdCgnIycpO1xuICAgICAgICB2YXIgcERvY3VtZW50ID0gcmVzdWx0cy5kb2NzW3BQdHJQYXJ0c1swXV07XG4gICAgICAgIHZhciBwUHRyUGF0aCA9IHBhdGhGcm9tUHRyKHBQdHJQYXJ0c1sxXSk7XG5cbiAgICAgICAgXy5lYWNoKGRlcHMsIGZ1bmN0aW9uIChkZXAsIHByb3ApIHtcbiAgICAgICAgICB2YXIgZGVwUGFydHMgPSBkZXAuc3BsaXQoJyMnKTtcbiAgICAgICAgICB2YXIgZERvY3VtZW50ID0gcmVzdWx0cy5kb2NzW2RlcFBhcnRzWzBdXTtcbiAgICAgICAgICB2YXIgZFB0clBhdGggPSBwUHRyUGF0aC5jb25jYXQocGF0aEZyb21QdHIocHJvcCkpO1xuICAgICAgICAgIHZhciByZWZEZXRhaWxzID0gcmVzdWx0cy5yZWZzW3BQdHJQYXJ0c1swXSArIHBhdGhUb1B0cihkUHRyUGF0aCldO1xuXG4gICAgICAgICAgLy8gUmVzb2x2ZSByZWZlcmVuY2UgaWYgdmFsaWRcbiAgICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChyZWZEZXRhaWxzLmVycm9yKSAmJiBfLmlzVW5kZWZpbmVkKHJlZkRldGFpbHMubWlzc2luZykpIHtcbiAgICAgICAgICAgIGlmICghb3B0aW9ucy5yZXNvbHZlQ2lyY3VsYXJzICYmIHJlZkRldGFpbHMuY2lyY3VsYXIpIHtcbiAgICAgICAgICAgICAgcmVmRGV0YWlscy52YWx1ZSA9IHJlZkRldGFpbHMuZGVmO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZWZEZXRhaWxzLnZhbHVlID0gZmluZFZhbHVlKGREb2N1bWVudCwgcGF0aEZyb21QdHIoZGVwUGFydHNbMV0pKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgbWFya01pc3NpbmcocmVmRGV0YWlscywgZXJyKTtcblxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIElmIHRoZSByZWZlcmVuY2UgaXMgYXQgdGhlIHJvb3Qgb2YgdGhlIGRvY3VtZW50LCByZXBsYWNlIHRoZSBkb2N1bWVudCBpbiB0aGUgY2FjaGUuICBPdGhlcndpc2UsIHJlcGxhY2VcbiAgICAgICAgICAgICAgLy8gdGhlIHZhbHVlIGluIHRoZSBhcHByb3ByaWF0ZSBsb2NhdGlvbiBpbiB0aGUgZG9jdW1lbnQgY2FjaGUuXG4gICAgICAgICAgICAgIGlmIChwUHRyUGFydHNbMV0gPT09ICcnICYmIHByb3AgPT09ICcjJykge1xuICAgICAgICAgICAgICAgIHJlc3VsdHMuZG9jc1twUHRyUGFydHNbMF1dID0gcmVmRGV0YWlscy52YWx1ZTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZXRWYWx1ZShwRG9jdW1lbnQsIGRQdHJQYXRoLCByZWZEZXRhaWxzLnZhbHVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgZnVuY3Rpb24gd2Fsa1JlZnMgKHJvb3QsIHJlZlB0ciwgcmVmUGF0aCkge1xuICAgICAgICB2YXIgcmVmUHRyUGFydHMgPSByZWZQdHIuc3BsaXQoJyMnKTtcbiAgICAgICAgdmFyIHJlZkRldGFpbHMgPSByZXN1bHRzLnJlZnNbcmVmUHRyXTtcbiAgICAgICAgdmFyIHJlZkRlcHM7XG5cbiAgICAgICAgLy8gUmVjb3JkIHRoZSByZWZlcmVuY2UgKHJlbGF0aXZlIHRvIHRoZSByb290IGRvY3VtZW50IHVubGVzcyB0aGUgcmVmZXJlbmNlIGlzIGluIHRoZSByb290IGRvY3VtZW50KVxuICAgICAgICBhbGxSZWZzW3JlZlB0clBhcnRzWzBdID09PSBvcHRpb25zLmxvY2F0aW9uID9cbiAgICAgICAgICAgICAgICAgICcjJyArIHJlZlB0clBhcnRzWzFdIDpcbiAgICAgICAgICAgICAgICAgIHBhdGhUb1B0cihvcHRpb25zLnN1YkRvY1BhdGguY29uY2F0KHJlZlBhdGgpKV0gPSByZWZEZXRhaWxzO1xuXG4gICAgICAgIC8vIERvIG5vdCB3YWxrIGludmFsaWQgcmVmZXJlbmNlc1xuICAgICAgICBpZiAocmVmRGV0YWlscy5jaXJjdWxhciB8fCAhaXNWYWxpZChyZWZEZXRhaWxzKSkge1xuICAgICAgICAgIC8vIFNhbml0aXplIGVycm9yc1xuICAgICAgICAgIGlmICghcmVmRGV0YWlscy5jaXJjdWxhciAmJiByZWZEZXRhaWxzLmVycm9yKSB7XG4gICAgICAgICAgICAvLyBUaGUgd2F5IHdlIHVzZSBmaW5kUmVmcyBub3cgcmVzdWx0cyBpbiBhbiBlcnJvciB0aGF0IGRvZXNuJ3QgbWF0Y2ggdGhlIGV4cGVjdGF0aW9uXG4gICAgICAgICAgICByZWZEZXRhaWxzLmVycm9yID0gcmVmRGV0YWlscy5lcnJvci5yZXBsYWNlKCdvcHRpb25zLnN1YkRvY1BhdGgnLCAnSlNPTiBQb2ludGVyJyk7XG5cbiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgZXJyb3IgdG8gdXNlIHRoZSBhcHByb3ByaWF0ZSBKU09OIFBvaW50ZXJcbiAgICAgICAgICAgIGlmIChyZWZEZXRhaWxzLmVycm9yLmluZGV4T2YoJyMnKSA+IC0xKSB7XG4gICAgICAgICAgICAgIHJlZkRldGFpbHMuZXJyb3IgPSByZWZEZXRhaWxzLmVycm9yLnJlcGxhY2UocmVmRGV0YWlscy51cmkuc3Vic3RyKHJlZkRldGFpbHMudXJpLmluZGV4T2YoJyMnKSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmRGV0YWlscy51cmkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSZXBvcnQgZXJyb3JzIG9wZW5pbmcgZmlsZXMgYXMgSlNPTiBQb2ludGVyIGVycm9yc1xuICAgICAgICAgICAgaWYgKHJlZkRldGFpbHMuZXJyb3IuaW5kZXhPZignRU5PRU5UOicpID09PSAwIHx8IHJlZkRldGFpbHMuZXJyb3IuaW5kZXhPZignTm90IEZvdW5kJykgPT09IDApIHtcbiAgICAgICAgICAgICAgcmVmRGV0YWlscy5lcnJvciA9ICdKU09OIFBvaW50ZXIgcG9pbnRzIHRvIG1pc3NpbmcgbG9jYXRpb246ICcgKyByZWZEZXRhaWxzLnVyaTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICByZWZEZXBzID0gcmVzdWx0cy5kZXBzW3JlZkRldGFpbHMucmVmZElkXTtcblxuICAgICAgICBpZiAocmVmRGV0YWlscy5yZWZkSWQuaW5kZXhPZihyb290KSAhPT0gMCkge1xuICAgICAgICAgIE9iamVjdC5rZXlzKHJlZkRlcHMpLmZvckVhY2goZnVuY3Rpb24gKHByb3ApIHtcbiAgICAgICAgICAgIHdhbGtSZWZzKHJlZkRldGFpbHMucmVmZElkLCByZWZEZXRhaWxzLnJlZmRJZCArIHByb3Auc3Vic3RyKDEpLCByZWZQYXRoLmNvbmNhdChwYXRoRnJvbVB0cihwcm9wKSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEZvciBwZXJmb3JtYW5jZSByZWFzb25zLCB3ZSBvbmx5IHByb2Nlc3MgYSBkb2N1bWVudCAob3Igc3ViIGRvY3VtZW50KSBhbmQgZWFjaCByZWZlcmVuY2Ugb25jZSBldmVyLiAgVGhpcyBtZWFuc1xuICAgICAgLy8gdGhhdCBpZiB3ZSB3YW50IHRvIHByb3ZpZGUgdGhlIGZ1bGwgcGljdHVyZSBhcyB0byB3aGF0IHBhdGhzIGluIHRoZSByZXNvbHZlZCBkb2N1bWVudCB3ZXJlIGNyZWF0ZWQgYXMgYSByZXN1bHRcbiAgICAgIC8vIG9mIGEgcmVmZXJlbmNlLCB3ZSBoYXZlIHRvIHRha2Ugb3VyIGZ1bGx5LXF1YWxpZmllZCByZWZlcmVuY2UgbG9jYXRpb25zIGFuZCBleHBhbmQgdGhlbSB0byBiZSBhbGwgbG9jYWwgYmFzZWRcbiAgICAgIC8vIG9uIHRoZSBvcmlnaW5hbCBkb2N1bWVudC5cbiAgICAgIE9iamVjdC5rZXlzKHJlc3VsdHMucmVmcykuZm9yRWFjaChmdW5jdGlvbiAocmVmUHRyKSB7XG4gICAgICAgIC8vIFdlIG9ubHkgd2FudCB0byBwcm9jZXNzIHJlZmVyZW5jZXMgZm91bmQgYXQgb3IgYmVuZWF0aCB0aGUgcHJvdmlkZWQgZG9jdW1lbnQgYW5kIHN1Yi1kb2N1bWVudCBwYXRoXG4gICAgICAgIGlmIChyZWZQdHIuaW5kZXhPZihyZWZzUm9vdCkgIT09IDApIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB3YWxrUmVmcyhyZWZzUm9vdCwgcmVmUHRyLCBwYXRoRnJvbVB0cihyZWZQdHIuc3Vic3RyKHJlZnNSb290Lmxlbmd0aCkpKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTYW5pdGl6ZSB0aGUgcmVmZXJlbmNlIGRldGFpbHNcbiAgICAgIF8uZWFjaChyZXN1bHRzLnJlZnMsIGZ1bmN0aW9uIChyZWZEZXRhaWxzKSB7XG4gICAgICAgIC8vIERlbGV0ZSB0aGUgcmVmZXJlbmNlIGlkIHVzZWQgZm9yIGRlcGVuZGVuY3kgdHJhY2tpbmcgYW5kIGNpcmN1bGFyIGlkZW50aWZpY2F0aW9uXG4gICAgICAgIGRlbGV0ZSByZWZEZXRhaWxzLnJlZmRJZDtcbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICByZWZzOiBhbGxSZWZzLFxuICAgICAgICByZXNvbHZlZDogcmVzdWx0cy5kb2NzW2Z1bGxMb2NhdGlvbl1cbiAgICAgIH07XG4gICAgfSk7XG5cbiAgcmV0dXJuIGFsbFRhc2tzO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIEpTT04gUmVmZXJlbmNlcyBkZWZpbmVkIHdpdGhpbiB0aGUgZG9jdW1lbnQgYXQgdGhlIHByb3ZpZGVkIGxvY2F0aW9uLlxuICpcbiAqIFRoaXMgQVBJIGlzIGlkZW50aWNhbCB0byB7QGxpbmsgbW9kdWxlOkpzb25SZWZzLnJlc29sdmVSZWZzfSBleGNlcHQgdGhpcyBBUEkgd2lsbCByZXRyaWV2ZSBhIHJlbW90ZSBkb2N1bWVudCBhbmQgdGhlblxuICogcmV0dXJuIHRoZSByZXN1bHQgb2Yge0BsaW5rIG1vZHVsZTpKc29uUmVmcy5yZXNvbHZlUmVmc30gb24gdGhlIHJldHJpZXZlZCBkb2N1bWVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gdG8gcmV0cmlldmUgKihDYW4gYmUgcmVsYXRpdmUgb3IgYWJzb2x1dGUsIGp1c3QgbWFrZSBzdXJlIHlvdSBsb29rIGF0IHRoZVxuICoge0BsaW5rIG1vZHVsZTpKc29uUmVmc35Kc29uUmVmc09wdGlvbnN8b3B0aW9ucyBkb2N1bWVudGF0aW9ufSB0byBzZWUgaG93IHJlbGF0aXZlIHJlZmVyZW5jZXMgYXJlIGhhbmRsZWQuKSpcbiAqIEBwYXJhbSB7bW9kdWxlOkpzb25SZWZzfkpzb25SZWZzT3B0aW9uc30gW29wdGlvbnNdIC0gVGhlIEpzb25SZWZzIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgYSB7QGxpbmsgbW9kdWxlOkpzb25SZWZzflJldHJpZXZlZFJlc29sdmVkUmVmc1Jlc3VsdHN9IGFuZCByZWplY3RzIHdpdGggYW5cbiAqIGBFcnJvcmAgd2hlbiB0aGUgaW5wdXQgYXJndW1lbnRzIGZhaWwgdmFsaWRhdGlvbiwgd2hlbiBgb3B0aW9ucy5zdWJEb2NQYXRoYCBwb2ludHMgdG8gYW4gaW52YWxpZCBsb2NhdGlvbiBvciB3aGVuXG4gKiAgdGhlIGxvY2F0aW9uIGFyZ3VtZW50IHBvaW50cyB0byBhbiB1bmxvYWRhYmxlIHJlc291cmNlXG4gKlxuICogQGFsaWFzIG1vZHVsZTpKc29uUmVmcy5yZXNvbHZlUmVmc0F0XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdGhhdCBsb2FkcyBhIEpTT04gZG9jdW1lbnQgKE5vIG9wdGlvbnMubG9hZGVyT3B0aW9ucy5wcm9jZXNzQ29udGVudCByZXF1aXJlZCkgYW5kIHJlc29sdmVzIGFsbCByZWZlcmVuY2VzXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmc0F0KCcuL3N3YWdnZXIuanNvbicpXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAqICAgICAgLy8gRG8gc29tZXRoaW5nIHdpdGggdGhlIHJlc3BvbnNlXG4gKiAgICAgIC8vXG4gKiAgICAgIC8vIHJlcy5yZWZzOiBKU09OIFJlZmVyZW5jZSBsb2NhdGlvbnMgYW5kIGRldGFpbHNcbiAqICAgICAgLy8gcmVzLnJlc29sdmVkOiBUaGUgZG9jdW1lbnQgd2l0aCB0aGUgYXBwcm9wcmlhdGUgSlNPTiBSZWZlcmVuY2VzIHJlc29sdmVkXG4gKiAgICAgIC8vIHJlcy52YWx1ZTogVGhlIHJldHJpZXZlZCBkb2N1bWVudFxuICogICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gKiAgICAgY29uc29sZS5sb2coZXJyLnN0YWNrKTtcbiAqICAgfSk7XG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVSZWZzQXQgKGxvY2F0aW9uLCBvcHRpb25zKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcHJvdmlkZWQgbG9jYXRpb25cbiAgICAgIGlmICghXy5pc1N0cmluZyhsb2NhdGlvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbG9jYXRpb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgICAgfVxuXG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zKSkge1xuICAgICAgICBvcHRpb25zID0ge307XG4gICAgICB9XG5cbiAgICAgIGlmIChfLmlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICAgIC8vIEFkZCB0aGUgbG9jYXRpb24gdG8gdGhlIG9wdGlvbnMgZm9yIHByb2Nlc3NpbmcvdmFsaWRhdGlvblxuICAgICAgICBvcHRpb25zLmxvY2F0aW9uID0gbG9jYXRpb247XG4gICAgICB9XG5cbiAgICAgIC8vIFZhbGlkYXRlIG9wdGlvbnNcbiAgICAgIG9wdGlvbnMgPSB2YWxpZGF0ZU9wdGlvbnMob3B0aW9ucyk7XG5cbiAgICAgIHJldHVybiBnZXRSZW1vdGVEb2N1bWVudChvcHRpb25zLmxvY2F0aW9uLCBvcHRpb25zKTtcbiAgICB9KVxuICAgIC50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgIHZhciBjT3B0aW9ucyA9IF8uY2xvbmVEZWVwKG9wdGlvbnMpO1xuICAgICAgdmFyIHVyaURldGFpbHMgPSBwYXJzZVVSSShvcHRpb25zLmxvY2F0aW9uKTtcblxuICAgICAgLy8gU2V0IHRoZSBzdWIgZG9jdW1lbnQgcGF0aCBpZiBuZWNlc3NhcnlcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZCh1cmlEZXRhaWxzLmZyYWdtZW50KSkge1xuICAgICAgICBjT3B0aW9ucy5zdWJEb2NQYXRoID0gcGF0aEZyb21QdHIoZGVjb2RlVVJJKHVyaURldGFpbHMuZnJhZ21lbnQpKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc29sdmVSZWZzKHJlcywgY09wdGlvbnMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXMyKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJlZnM6IHJlczIucmVmcyxcbiAgICAgICAgICAgIHJlc29sdmVkOiByZXMyLnJlc29sdmVkLFxuICAgICAgICAgICAgdmFsdWU6IHJlc1xuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyogRXhwb3J0IHRoZSBtb2R1bGUgbWVtYmVycyAqL1xubW9kdWxlLmV4cG9ydHMuY2xlYXJDYWNoZSA9IGNsZWFyQ2FjaGU7XG5tb2R1bGUuZXhwb3J0cy5kZWNvZGVQYXRoID0gZGVjb2RlUGF0aDtcbm1vZHVsZS5leHBvcnRzLmVuY29kZVBhdGggPSBlbmNvZGVQYXRoO1xubW9kdWxlLmV4cG9ydHMuZmluZFJlZnMgPSBmaW5kUmVmcztcbm1vZHVsZS5leHBvcnRzLmZpbmRSZWZzQXQgPSBmaW5kUmVmc0F0O1xubW9kdWxlLmV4cG9ydHMuZ2V0UmVmRGV0YWlscyA9IGdldFJlZkRldGFpbHM7XG5tb2R1bGUuZXhwb3J0cy5pc1B0ciA9IGlzUHRyO1xubW9kdWxlLmV4cG9ydHMuaXNSZWYgPSBpc1JlZjtcbm1vZHVsZS5leHBvcnRzLnBhdGhGcm9tUHRyID0gcGF0aEZyb21QdHI7XG5tb2R1bGUuZXhwb3J0cy5wYXRoVG9QdHIgPSBwYXRoVG9QdHI7XG5tb2R1bGUuZXhwb3J0cy5yZXNvbHZlUmVmcyA9IHJlc29sdmVSZWZzO1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnNBdCA9IHJlc29sdmVSZWZzQXQ7XG4iLCIvKiEgTmF0aXZlIFByb21pc2UgT25seVxuICAgIHYwLjguMSAoYykgS3lsZSBTaW1wc29uXG4gICAgTUlUIExpY2Vuc2U6IGh0dHA6Ly9nZXRpZnkubWl0LWxpY2Vuc2Uub3JnXG4qL1xuXG4oZnVuY3Rpb24gVU1EKG5hbWUsY29udGV4dCxkZWZpbml0aW9uKXtcblx0Ly8gc3BlY2lhbCBmb3JtIG9mIFVNRCBmb3IgcG9seWZpbGxpbmcgYWNyb3NzIGV2aXJvbm1lbnRzXG5cdGNvbnRleHRbbmFtZV0gPSBjb250ZXh0W25hbWVdIHx8IGRlZmluaXRpb24oKTtcblx0aWYgKHR5cGVvZiBtb2R1bGUgIT0gXCJ1bmRlZmluZWRcIiAmJiBtb2R1bGUuZXhwb3J0cykgeyBtb2R1bGUuZXhwb3J0cyA9IGNvbnRleHRbbmFtZV07IH1cblx0ZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PSBcImZ1bmN0aW9uXCIgJiYgZGVmaW5lLmFtZCkgeyBkZWZpbmUoZnVuY3Rpb24gJEFNRCQoKXsgcmV0dXJuIGNvbnRleHRbbmFtZV07IH0pOyB9XG59KShcIlByb21pc2VcIix0eXBlb2YgZ2xvYmFsICE9IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0aGlzLGZ1bmN0aW9uIERFRigpe1xuXHQvKmpzaGludCB2YWxpZHRoaXM6dHJ1ZSAqL1xuXHRcInVzZSBzdHJpY3RcIjtcblxuXHR2YXIgYnVpbHRJblByb3AsIGN5Y2xlLCBzY2hlZHVsaW5nX3F1ZXVlLFxuXHRcdFRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyxcblx0XHR0aW1lciA9ICh0eXBlb2Ygc2V0SW1tZWRpYXRlICE9IFwidW5kZWZpbmVkXCIpID9cblx0XHRcdGZ1bmN0aW9uIHRpbWVyKGZuKSB7IHJldHVybiBzZXRJbW1lZGlhdGUoZm4pOyB9IDpcblx0XHRcdHNldFRpbWVvdXRcblx0O1xuXG5cdC8vIGRhbW1pdCwgSUU4LlxuXHR0cnkge1xuXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh7fSxcInhcIix7fSk7XG5cdFx0YnVpbHRJblByb3AgPSBmdW5jdGlvbiBidWlsdEluUHJvcChvYmosbmFtZSx2YWwsY29uZmlnKSB7XG5cdFx0XHRyZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaixuYW1lLHtcblx0XHRcdFx0dmFsdWU6IHZhbCxcblx0XHRcdFx0d3JpdGFibGU6IHRydWUsXG5cdFx0XHRcdGNvbmZpZ3VyYWJsZTogY29uZmlnICE9PSBmYWxzZVxuXHRcdFx0fSk7XG5cdFx0fTtcblx0fVxuXHRjYXRjaCAoZXJyKSB7XG5cdFx0YnVpbHRJblByb3AgPSBmdW5jdGlvbiBidWlsdEluUHJvcChvYmosbmFtZSx2YWwpIHtcblx0XHRcdG9ialtuYW1lXSA9IHZhbDtcblx0XHRcdHJldHVybiBvYmo7XG5cdFx0fTtcblx0fVxuXG5cdC8vIE5vdGU6IHVzaW5nIGEgcXVldWUgaW5zdGVhZCBvZiBhcnJheSBmb3IgZWZmaWNpZW5jeVxuXHRzY2hlZHVsaW5nX3F1ZXVlID0gKGZ1bmN0aW9uIFF1ZXVlKCkge1xuXHRcdHZhciBmaXJzdCwgbGFzdCwgaXRlbTtcblxuXHRcdGZ1bmN0aW9uIEl0ZW0oZm4sc2VsZikge1xuXHRcdFx0dGhpcy5mbiA9IGZuO1xuXHRcdFx0dGhpcy5zZWxmID0gc2VsZjtcblx0XHRcdHRoaXMubmV4dCA9IHZvaWQgMDtcblx0XHR9XG5cblx0XHRyZXR1cm4ge1xuXHRcdFx0YWRkOiBmdW5jdGlvbiBhZGQoZm4sc2VsZikge1xuXHRcdFx0XHRpdGVtID0gbmV3IEl0ZW0oZm4sc2VsZik7XG5cdFx0XHRcdGlmIChsYXN0KSB7XG5cdFx0XHRcdFx0bGFzdC5uZXh0ID0gaXRlbTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRmaXJzdCA9IGl0ZW07XG5cdFx0XHRcdH1cblx0XHRcdFx0bGFzdCA9IGl0ZW07XG5cdFx0XHRcdGl0ZW0gPSB2b2lkIDA7XG5cdFx0XHR9LFxuXHRcdFx0ZHJhaW46IGZ1bmN0aW9uIGRyYWluKCkge1xuXHRcdFx0XHR2YXIgZiA9IGZpcnN0O1xuXHRcdFx0XHRmaXJzdCA9IGxhc3QgPSBjeWNsZSA9IHZvaWQgMDtcblxuXHRcdFx0XHR3aGlsZSAoZikge1xuXHRcdFx0XHRcdGYuZm4uY2FsbChmLnNlbGYpO1xuXHRcdFx0XHRcdGYgPSBmLm5leHQ7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9O1xuXHR9KSgpO1xuXG5cdGZ1bmN0aW9uIHNjaGVkdWxlKGZuLHNlbGYpIHtcblx0XHRzY2hlZHVsaW5nX3F1ZXVlLmFkZChmbixzZWxmKTtcblx0XHRpZiAoIWN5Y2xlKSB7XG5cdFx0XHRjeWNsZSA9IHRpbWVyKHNjaGVkdWxpbmdfcXVldWUuZHJhaW4pO1xuXHRcdH1cblx0fVxuXG5cdC8vIHByb21pc2UgZHVjayB0eXBpbmdcblx0ZnVuY3Rpb24gaXNUaGVuYWJsZShvKSB7XG5cdFx0dmFyIF90aGVuLCBvX3R5cGUgPSB0eXBlb2YgbztcblxuXHRcdGlmIChvICE9IG51bGwgJiZcblx0XHRcdChcblx0XHRcdFx0b190eXBlID09IFwib2JqZWN0XCIgfHwgb190eXBlID09IFwiZnVuY3Rpb25cIlxuXHRcdFx0KVxuXHRcdCkge1xuXHRcdFx0X3RoZW4gPSBvLnRoZW47XG5cdFx0fVxuXHRcdHJldHVybiB0eXBlb2YgX3RoZW4gPT0gXCJmdW5jdGlvblwiID8gX3RoZW4gOiBmYWxzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIG5vdGlmeSgpIHtcblx0XHRmb3IgKHZhciBpPTA7IGk8dGhpcy5jaGFpbi5sZW5ndGg7IGkrKykge1xuXHRcdFx0bm90aWZ5SXNvbGF0ZWQoXG5cdFx0XHRcdHRoaXMsXG5cdFx0XHRcdCh0aGlzLnN0YXRlID09PSAxKSA/IHRoaXMuY2hhaW5baV0uc3VjY2VzcyA6IHRoaXMuY2hhaW5baV0uZmFpbHVyZSxcblx0XHRcdFx0dGhpcy5jaGFpbltpXVxuXHRcdFx0KTtcblx0XHR9XG5cdFx0dGhpcy5jaGFpbi5sZW5ndGggPSAwO1xuXHR9XG5cblx0Ly8gTk9URTogVGhpcyBpcyBhIHNlcGFyYXRlIGZ1bmN0aW9uIHRvIGlzb2xhdGVcblx0Ly8gdGhlIGB0cnkuLmNhdGNoYCBzbyB0aGF0IG90aGVyIGNvZGUgY2FuIGJlXG5cdC8vIG9wdGltaXplZCBiZXR0ZXJcblx0ZnVuY3Rpb24gbm90aWZ5SXNvbGF0ZWQoc2VsZixjYixjaGFpbikge1xuXHRcdHZhciByZXQsIF90aGVuO1xuXHRcdHRyeSB7XG5cdFx0XHRpZiAoY2IgPT09IGZhbHNlKSB7XG5cdFx0XHRcdGNoYWluLnJlamVjdChzZWxmLm1zZyk7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0aWYgKGNiID09PSB0cnVlKSB7XG5cdFx0XHRcdFx0cmV0ID0gc2VsZi5tc2c7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0cmV0ID0gY2IuY2FsbCh2b2lkIDAsc2VsZi5tc2cpO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKHJldCA9PT0gY2hhaW4ucHJvbWlzZSkge1xuXHRcdFx0XHRcdGNoYWluLnJlamVjdChUeXBlRXJyb3IoXCJQcm9taXNlLWNoYWluIGN5Y2xlXCIpKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIGlmIChfdGhlbiA9IGlzVGhlbmFibGUocmV0KSkge1xuXHRcdFx0XHRcdF90aGVuLmNhbGwocmV0LGNoYWluLnJlc29sdmUsY2hhaW4ucmVqZWN0KTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNlIHtcblx0XHRcdFx0XHRjaGFpbi5yZXNvbHZlKHJldCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0Y2F0Y2ggKGVycikge1xuXHRcdFx0Y2hhaW4ucmVqZWN0KGVycik7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gcmVzb2x2ZShtc2cpIHtcblx0XHR2YXIgX3RoZW4sIHNlbGYgPSB0aGlzO1xuXG5cdFx0Ly8gYWxyZWFkeSB0cmlnZ2VyZWQ/XG5cdFx0aWYgKHNlbGYudHJpZ2dlcmVkKSB7IHJldHVybjsgfVxuXG5cdFx0c2VsZi50cmlnZ2VyZWQgPSB0cnVlO1xuXG5cdFx0Ly8gdW53cmFwXG5cdFx0aWYgKHNlbGYuZGVmKSB7XG5cdFx0XHRzZWxmID0gc2VsZi5kZWY7XG5cdFx0fVxuXG5cdFx0dHJ5IHtcblx0XHRcdGlmIChfdGhlbiA9IGlzVGhlbmFibGUobXNnKSkge1xuXHRcdFx0XHRzY2hlZHVsZShmdW5jdGlvbigpe1xuXHRcdFx0XHRcdHZhciBkZWZfd3JhcHBlciA9IG5ldyBNYWtlRGVmV3JhcHBlcihzZWxmKTtcblx0XHRcdFx0XHR0cnkge1xuXHRcdFx0XHRcdFx0X3RoZW4uY2FsbChtc2csXG5cdFx0XHRcdFx0XHRcdGZ1bmN0aW9uICRyZXNvbHZlJCgpeyByZXNvbHZlLmFwcGx5KGRlZl93cmFwcGVyLGFyZ3VtZW50cyk7IH0sXG5cdFx0XHRcdFx0XHRcdGZ1bmN0aW9uICRyZWplY3QkKCl7IHJlamVjdC5hcHBseShkZWZfd3JhcHBlcixhcmd1bWVudHMpOyB9XG5cdFx0XHRcdFx0XHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRjYXRjaCAoZXJyKSB7XG5cdFx0XHRcdFx0XHRyZWplY3QuY2FsbChkZWZfd3JhcHBlcixlcnIpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSlcblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHRzZWxmLm1zZyA9IG1zZztcblx0XHRcdFx0c2VsZi5zdGF0ZSA9IDE7XG5cdFx0XHRcdGlmIChzZWxmLmNoYWluLmxlbmd0aCA+IDApIHtcblx0XHRcdFx0XHRzY2hlZHVsZShub3RpZnksc2VsZik7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0Y2F0Y2ggKGVycikge1xuXHRcdFx0cmVqZWN0LmNhbGwobmV3IE1ha2VEZWZXcmFwcGVyKHNlbGYpLGVycik7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gcmVqZWN0KG1zZykge1xuXHRcdHZhciBzZWxmID0gdGhpcztcblxuXHRcdC8vIGFscmVhZHkgdHJpZ2dlcmVkP1xuXHRcdGlmIChzZWxmLnRyaWdnZXJlZCkgeyByZXR1cm47IH1cblxuXHRcdHNlbGYudHJpZ2dlcmVkID0gdHJ1ZTtcblxuXHRcdC8vIHVud3JhcFxuXHRcdGlmIChzZWxmLmRlZikge1xuXHRcdFx0c2VsZiA9IHNlbGYuZGVmO1xuXHRcdH1cblxuXHRcdHNlbGYubXNnID0gbXNnO1xuXHRcdHNlbGYuc3RhdGUgPSAyO1xuXHRcdGlmIChzZWxmLmNoYWluLmxlbmd0aCA+IDApIHtcblx0XHRcdHNjaGVkdWxlKG5vdGlmeSxzZWxmKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBpdGVyYXRlUHJvbWlzZXMoQ29uc3RydWN0b3IsYXJyLHJlc29sdmVyLHJlamVjdGVyKSB7XG5cdFx0Zm9yICh2YXIgaWR4PTA7IGlkeDxhcnIubGVuZ3RoOyBpZHgrKykge1xuXHRcdFx0KGZ1bmN0aW9uIElJRkUoaWR4KXtcblx0XHRcdFx0Q29uc3RydWN0b3IucmVzb2x2ZShhcnJbaWR4XSlcblx0XHRcdFx0LnRoZW4oXG5cdFx0XHRcdFx0ZnVuY3Rpb24gJHJlc29sdmVyJChtc2cpe1xuXHRcdFx0XHRcdFx0cmVzb2x2ZXIoaWR4LG1zZyk7XG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRyZWplY3RlclxuXHRcdFx0XHQpO1xuXHRcdFx0fSkoaWR4KTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBNYWtlRGVmV3JhcHBlcihzZWxmKSB7XG5cdFx0dGhpcy5kZWYgPSBzZWxmO1xuXHRcdHRoaXMudHJpZ2dlcmVkID0gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBNYWtlRGVmKHNlbGYpIHtcblx0XHR0aGlzLnByb21pc2UgPSBzZWxmO1xuXHRcdHRoaXMuc3RhdGUgPSAwO1xuXHRcdHRoaXMudHJpZ2dlcmVkID0gZmFsc2U7XG5cdFx0dGhpcy5jaGFpbiA9IFtdO1xuXHRcdHRoaXMubXNnID0gdm9pZCAwO1xuXHR9XG5cblx0ZnVuY3Rpb24gUHJvbWlzZShleGVjdXRvcikge1xuXHRcdGlmICh0eXBlb2YgZXhlY3V0b3IgIT0gXCJmdW5jdGlvblwiKSB7XG5cdFx0XHR0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtcblx0XHR9XG5cblx0XHRpZiAodGhpcy5fX05QT19fICE9PSAwKSB7XG5cdFx0XHR0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBwcm9taXNlXCIpO1xuXHRcdH1cblxuXHRcdC8vIGluc3RhbmNlIHNoYWRvd2luZyB0aGUgaW5oZXJpdGVkIFwiYnJhbmRcIlxuXHRcdC8vIHRvIHNpZ25hbCBhbiBhbHJlYWR5IFwiaW5pdGlhbGl6ZWRcIiBwcm9taXNlXG5cdFx0dGhpcy5fX05QT19fID0gMTtcblxuXHRcdHZhciBkZWYgPSBuZXcgTWFrZURlZih0aGlzKTtcblxuXHRcdHRoaXNbXCJ0aGVuXCJdID0gZnVuY3Rpb24gdGhlbihzdWNjZXNzLGZhaWx1cmUpIHtcblx0XHRcdHZhciBvID0ge1xuXHRcdFx0XHRzdWNjZXNzOiB0eXBlb2Ygc3VjY2VzcyA9PSBcImZ1bmN0aW9uXCIgPyBzdWNjZXNzIDogdHJ1ZSxcblx0XHRcdFx0ZmFpbHVyZTogdHlwZW9mIGZhaWx1cmUgPT0gXCJmdW5jdGlvblwiID8gZmFpbHVyZSA6IGZhbHNlXG5cdFx0XHR9O1xuXHRcdFx0Ly8gTm90ZTogYHRoZW4oLi4pYCBpdHNlbGYgY2FuIGJlIGJvcnJvd2VkIHRvIGJlIHVzZWQgYWdhaW5zdFxuXHRcdFx0Ly8gYSBkaWZmZXJlbnQgcHJvbWlzZSBjb25zdHJ1Y3RvciBmb3IgbWFraW5nIHRoZSBjaGFpbmVkIHByb21pc2UsXG5cdFx0XHQvLyBieSBzdWJzdGl0dXRpbmcgYSBkaWZmZXJlbnQgYHRoaXNgIGJpbmRpbmcuXG5cdFx0XHRvLnByb21pc2UgPSBuZXcgdGhpcy5jb25zdHJ1Y3RvcihmdW5jdGlvbiBleHRyYWN0Q2hhaW4ocmVzb2x2ZSxyZWplY3QpIHtcblx0XHRcdFx0aWYgKHR5cGVvZiByZXNvbHZlICE9IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgcmVqZWN0ICE9IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0XHRcdHRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0by5yZXNvbHZlID0gcmVzb2x2ZTtcblx0XHRcdFx0by5yZWplY3QgPSByZWplY3Q7XG5cdFx0XHR9KTtcblx0XHRcdGRlZi5jaGFpbi5wdXNoKG8pO1xuXG5cdFx0XHRpZiAoZGVmLnN0YXRlICE9PSAwKSB7XG5cdFx0XHRcdHNjaGVkdWxlKG5vdGlmeSxkZWYpO1xuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gby5wcm9taXNlO1xuXHRcdH07XG5cdFx0dGhpc1tcImNhdGNoXCJdID0gZnVuY3Rpb24gJGNhdGNoJChmYWlsdXJlKSB7XG5cdFx0XHRyZXR1cm4gdGhpcy50aGVuKHZvaWQgMCxmYWlsdXJlKTtcblx0XHR9O1xuXG5cdFx0dHJ5IHtcblx0XHRcdGV4ZWN1dG9yLmNhbGwoXG5cdFx0XHRcdHZvaWQgMCxcblx0XHRcdFx0ZnVuY3Rpb24gcHVibGljUmVzb2x2ZShtc2cpe1xuXHRcdFx0XHRcdHJlc29sdmUuY2FsbChkZWYsbXNnKTtcblx0XHRcdFx0fSxcblx0XHRcdFx0ZnVuY3Rpb24gcHVibGljUmVqZWN0KG1zZykge1xuXHRcdFx0XHRcdHJlamVjdC5jYWxsKGRlZixtc2cpO1xuXHRcdFx0XHR9XG5cdFx0XHQpO1xuXHRcdH1cblx0XHRjYXRjaCAoZXJyKSB7XG5cdFx0XHRyZWplY3QuY2FsbChkZWYsZXJyKTtcblx0XHR9XG5cdH1cblxuXHR2YXIgUHJvbWlzZVByb3RvdHlwZSA9IGJ1aWx0SW5Qcm9wKHt9LFwiY29uc3RydWN0b3JcIixQcm9taXNlLFxuXHRcdC8qY29uZmlndXJhYmxlPSovZmFsc2Vcblx0KTtcblxuXHQvLyBOb3RlOiBBbmRyb2lkIDQgY2Fubm90IHVzZSBgT2JqZWN0LmRlZmluZVByb3BlcnR5KC4uKWAgaGVyZVxuXHRQcm9taXNlLnByb3RvdHlwZSA9IFByb21pc2VQcm90b3R5cGU7XG5cblx0Ly8gYnVpbHQtaW4gXCJicmFuZFwiIHRvIHNpZ25hbCBhbiBcInVuaW5pdGlhbGl6ZWRcIiBwcm9taXNlXG5cdGJ1aWx0SW5Qcm9wKFByb21pc2VQcm90b3R5cGUsXCJfX05QT19fXCIsMCxcblx0XHQvKmNvbmZpZ3VyYWJsZT0qL2ZhbHNlXG5cdCk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcInJlc29sdmVcIixmdW5jdGlvbiBQcm9taXNlJHJlc29sdmUobXNnKSB7XG5cdFx0dmFyIENvbnN0cnVjdG9yID0gdGhpcztcblxuXHRcdC8vIHNwZWMgbWFuZGF0ZWQgY2hlY2tzXG5cdFx0Ly8gbm90ZTogYmVzdCBcImlzUHJvbWlzZVwiIGNoZWNrIHRoYXQncyBwcmFjdGljYWwgZm9yIG5vd1xuXHRcdGlmIChtc2cgJiYgdHlwZW9mIG1zZyA9PSBcIm9iamVjdFwiICYmIG1zZy5fX05QT19fID09PSAxKSB7XG5cdFx0XHRyZXR1cm4gbXNnO1xuXHRcdH1cblxuXHRcdHJldHVybiBuZXcgQ29uc3RydWN0b3IoZnVuY3Rpb24gZXhlY3V0b3IocmVzb2x2ZSxyZWplY3Qpe1xuXHRcdFx0aWYgKHR5cGVvZiByZXNvbHZlICE9IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgcmVqZWN0ICE9IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0XHR0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtcblx0XHRcdH1cblxuXHRcdFx0cmVzb2x2ZShtc2cpO1xuXHRcdH0pO1xuXHR9KTtcblxuXHRidWlsdEluUHJvcChQcm9taXNlLFwicmVqZWN0XCIsZnVuY3Rpb24gUHJvbWlzZSRyZWplY3QobXNnKSB7XG5cdFx0cmV0dXJuIG5ldyB0aGlzKGZ1bmN0aW9uIGV4ZWN1dG9yKHJlc29sdmUscmVqZWN0KXtcblx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0XHR9XG5cblx0XHRcdHJlamVjdChtc2cpO1xuXHRcdH0pO1xuXHR9KTtcblxuXHRidWlsdEluUHJvcChQcm9taXNlLFwiYWxsXCIsZnVuY3Rpb24gUHJvbWlzZSRhbGwoYXJyKSB7XG5cdFx0dmFyIENvbnN0cnVjdG9yID0gdGhpcztcblxuXHRcdC8vIHNwZWMgbWFuZGF0ZWQgY2hlY2tzXG5cdFx0aWYgKFRvU3RyaW5nLmNhbGwoYXJyKSAhPSBcIltvYmplY3QgQXJyYXldXCIpIHtcblx0XHRcdHJldHVybiBDb25zdHJ1Y3Rvci5yZWplY3QoVHlwZUVycm9yKFwiTm90IGFuIGFycmF5XCIpKTtcblx0XHR9XG5cdFx0aWYgKGFyci5sZW5ndGggPT09IDApIHtcblx0XHRcdHJldHVybiBDb25zdHJ1Y3Rvci5yZXNvbHZlKFtdKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gbmV3IENvbnN0cnVjdG9yKGZ1bmN0aW9uIGV4ZWN1dG9yKHJlc29sdmUscmVqZWN0KXtcblx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0XHR9XG5cblx0XHRcdHZhciBsZW4gPSBhcnIubGVuZ3RoLCBtc2dzID0gQXJyYXkobGVuKSwgY291bnQgPSAwO1xuXG5cdFx0XHRpdGVyYXRlUHJvbWlzZXMoQ29uc3RydWN0b3IsYXJyLGZ1bmN0aW9uIHJlc29sdmVyKGlkeCxtc2cpIHtcblx0XHRcdFx0bXNnc1tpZHhdID0gbXNnO1xuXHRcdFx0XHRpZiAoKytjb3VudCA9PT0gbGVuKSB7XG5cdFx0XHRcdFx0cmVzb2x2ZShtc2dzKTtcblx0XHRcdFx0fVxuXHRcdFx0fSxyZWplY3QpO1xuXHRcdH0pO1xuXHR9KTtcblxuXHRidWlsdEluUHJvcChQcm9taXNlLFwicmFjZVwiLGZ1bmN0aW9uIFByb21pc2UkcmFjZShhcnIpIHtcblx0XHR2YXIgQ29uc3RydWN0b3IgPSB0aGlzO1xuXG5cdFx0Ly8gc3BlYyBtYW5kYXRlZCBjaGVja3Ncblx0XHRpZiAoVG9TdHJpbmcuY2FsbChhcnIpICE9IFwiW29iamVjdCBBcnJheV1cIikge1xuXHRcdFx0cmV0dXJuIENvbnN0cnVjdG9yLnJlamVjdChUeXBlRXJyb3IoXCJOb3QgYW4gYXJyYXlcIikpO1xuXHRcdH1cblxuXHRcdHJldHVybiBuZXcgQ29uc3RydWN0b3IoZnVuY3Rpb24gZXhlY3V0b3IocmVzb2x2ZSxyZWplY3Qpe1xuXHRcdFx0aWYgKHR5cGVvZiByZXNvbHZlICE9IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgcmVqZWN0ICE9IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0XHR0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtcblx0XHRcdH1cblxuXHRcdFx0aXRlcmF0ZVByb21pc2VzKENvbnN0cnVjdG9yLGFycixmdW5jdGlvbiByZXNvbHZlcihpZHgsbXNnKXtcblx0XHRcdFx0cmVzb2x2ZShtc2cpO1xuXHRcdFx0fSxyZWplY3QpO1xuXHRcdH0pO1xuXHR9KTtcblxuXHRyZXR1cm4gUHJvbWlzZTtcbn0pO1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbi8vIHJlc29sdmVzIC4gYW5kIC4uIGVsZW1lbnRzIGluIGEgcGF0aCBhcnJheSB3aXRoIGRpcmVjdG9yeSBuYW1lcyB0aGVyZVxuLy8gbXVzdCBiZSBubyBzbGFzaGVzLCBlbXB0eSBlbGVtZW50cywgb3IgZGV2aWNlIG5hbWVzIChjOlxcKSBpbiB0aGUgYXJyYXlcbi8vIChzbyBhbHNvIG5vIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHNsYXNoZXMgLSBpdCBkb2VzIG5vdCBkaXN0aW5ndWlzaFxuLy8gcmVsYXRpdmUgYW5kIGFic29sdXRlIHBhdGhzKVxuZnVuY3Rpb24gbm9ybWFsaXplQXJyYXkocGFydHMsIGFsbG93QWJvdmVSb290KSB7XG4gIC8vIGlmIHRoZSBwYXRoIHRyaWVzIHRvIGdvIGFib3ZlIHRoZSByb290LCBgdXBgIGVuZHMgdXAgPiAwXG4gIHZhciB1cCA9IDA7XG4gIGZvciAodmFyIGkgPSBwYXJ0cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIHZhciBsYXN0ID0gcGFydHNbaV07XG4gICAgaWYgKGxhc3QgPT09ICcuJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgIH0gZWxzZSBpZiAobGFzdCA9PT0gJy4uJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXArKztcbiAgICB9IGVsc2UgaWYgKHVwKSB7XG4gICAgICBwYXJ0cy5zcGxpY2UoaSwgMSk7XG4gICAgICB1cC0tO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmIHRoZSBwYXRoIGlzIGFsbG93ZWQgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIHJlc3RvcmUgbGVhZGluZyAuLnNcbiAgaWYgKGFsbG93QWJvdmVSb290KSB7XG4gICAgZm9yICg7IHVwLS07IHVwKSB7XG4gICAgICBwYXJ0cy51bnNoaWZ0KCcuLicpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cblxuLy8gU3BsaXQgYSBmaWxlbmFtZSBpbnRvIFtyb290LCBkaXIsIGJhc2VuYW1lLCBleHRdLCB1bml4IHZlcnNpb25cbi8vICdyb290JyBpcyBqdXN0IGEgc2xhc2gsIG9yIG5vdGhpbmcuXG52YXIgc3BsaXRQYXRoUmUgPVxuICAgIC9eKFxcLz98KShbXFxzXFxTXSo/KSgoPzpcXC57MSwyfXxbXlxcL10rP3wpKFxcLlteLlxcL10qfCkpKD86W1xcL10qKSQvO1xudmFyIHNwbGl0UGF0aCA9IGZ1bmN0aW9uKGZpbGVuYW1lKSB7XG4gIHJldHVybiBzcGxpdFBhdGhSZS5leGVjKGZpbGVuYW1lKS5zbGljZSgxKTtcbn07XG5cbi8vIHBhdGgucmVzb2x2ZShbZnJvbSAuLi5dLCB0bylcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMucmVzb2x2ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmVzb2x2ZWRQYXRoID0gJycsXG4gICAgICByZXNvbHZlZEFic29sdXRlID0gZmFsc2U7XG5cbiAgZm9yICh2YXIgaSA9IGFyZ3VtZW50cy5sZW5ndGggLSAxOyBpID49IC0xICYmICFyZXNvbHZlZEFic29sdXRlOyBpLS0pIHtcbiAgICB2YXIgcGF0aCA9IChpID49IDApID8gYXJndW1lbnRzW2ldIDogcHJvY2Vzcy5jd2QoKTtcblxuICAgIC8vIFNraXAgZW1wdHkgYW5kIGludmFsaWQgZW50cmllc1xuICAgIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyB0byBwYXRoLnJlc29sdmUgbXVzdCBiZSBzdHJpbmdzJyk7XG4gICAgfSBlbHNlIGlmICghcGF0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQYXRoID0gcGF0aCArICcvJyArIHJlc29sdmVkUGF0aDtcbiAgICByZXNvbHZlZEFic29sdXRlID0gcGF0aC5jaGFyQXQoMCkgPT09ICcvJztcbiAgfVxuXG4gIC8vIEF0IHRoaXMgcG9pbnQgdGhlIHBhdGggc2hvdWxkIGJlIHJlc29sdmVkIHRvIGEgZnVsbCBhYnNvbHV0ZSBwYXRoLCBidXRcbiAgLy8gaGFuZGxlIHJlbGF0aXZlIHBhdGhzIHRvIGJlIHNhZmUgKG1pZ2h0IGhhcHBlbiB3aGVuIHByb2Nlc3MuY3dkKCkgZmFpbHMpXG5cbiAgLy8gTm9ybWFsaXplIHRoZSBwYXRoXG4gIHJlc29sdmVkUGF0aCA9IG5vcm1hbGl6ZUFycmF5KGZpbHRlcihyZXNvbHZlZFBhdGguc3BsaXQoJy8nKSwgZnVuY3Rpb24ocCkge1xuICAgIHJldHVybiAhIXA7XG4gIH0pLCAhcmVzb2x2ZWRBYnNvbHV0ZSkuam9pbignLycpO1xuXG4gIHJldHVybiAoKHJlc29sdmVkQWJzb2x1dGUgPyAnLycgOiAnJykgKyByZXNvbHZlZFBhdGgpIHx8ICcuJztcbn07XG5cbi8vIHBhdGgubm9ybWFsaXplKHBhdGgpXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLm5vcm1hbGl6ZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgdmFyIGlzQWJzb2x1dGUgPSBleHBvcnRzLmlzQWJzb2x1dGUocGF0aCksXG4gICAgICB0cmFpbGluZ1NsYXNoID0gc3Vic3RyKHBhdGgsIC0xKSA9PT0gJy8nO1xuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICBwYXRoID0gbm9ybWFsaXplQXJyYXkoZmlsdGVyKHBhdGguc3BsaXQoJy8nKSwgZnVuY3Rpb24ocCkge1xuICAgIHJldHVybiAhIXA7XG4gIH0pLCAhaXNBYnNvbHV0ZSkuam9pbignLycpO1xuXG4gIGlmICghcGF0aCAmJiAhaXNBYnNvbHV0ZSkge1xuICAgIHBhdGggPSAnLic7XG4gIH1cbiAgaWYgKHBhdGggJiYgdHJhaWxpbmdTbGFzaCkge1xuICAgIHBhdGggKz0gJy8nO1xuICB9XG5cbiAgcmV0dXJuIChpc0Fic29sdXRlID8gJy8nIDogJycpICsgcGF0aDtcbn07XG5cbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMuaXNBYnNvbHV0ZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgcmV0dXJuIHBhdGguY2hhckF0KDApID09PSAnLyc7XG59O1xuXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLmpvaW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhdGhzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAwKTtcbiAgcmV0dXJuIGV4cG9ydHMubm9ybWFsaXplKGZpbHRlcihwYXRocywgZnVuY3Rpb24ocCwgaW5kZXgpIHtcbiAgICBpZiAodHlwZW9mIHAgIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgdG8gcGF0aC5qb2luIG11c3QgYmUgc3RyaW5ncycpO1xuICAgIH1cbiAgICByZXR1cm4gcDtcbiAgfSkuam9pbignLycpKTtcbn07XG5cblxuLy8gcGF0aC5yZWxhdGl2ZShmcm9tLCB0bylcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMucmVsYXRpdmUgPSBmdW5jdGlvbihmcm9tLCB0bykge1xuICBmcm9tID0gZXhwb3J0cy5yZXNvbHZlKGZyb20pLnN1YnN0cigxKTtcbiAgdG8gPSBleHBvcnRzLnJlc29sdmUodG8pLnN1YnN0cigxKTtcblxuICBmdW5jdGlvbiB0cmltKGFycikge1xuICAgIHZhciBzdGFydCA9IDA7XG4gICAgZm9yICg7IHN0YXJ0IDwgYXJyLmxlbmd0aDsgc3RhcnQrKykge1xuICAgICAgaWYgKGFycltzdGFydF0gIT09ICcnKSBicmVhaztcbiAgICB9XG5cbiAgICB2YXIgZW5kID0gYXJyLmxlbmd0aCAtIDE7XG4gICAgZm9yICg7IGVuZCA+PSAwOyBlbmQtLSkge1xuICAgICAgaWYgKGFycltlbmRdICE9PSAnJykgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKHN0YXJ0ID4gZW5kKSByZXR1cm4gW107XG4gICAgcmV0dXJuIGFyci5zbGljZShzdGFydCwgZW5kIC0gc3RhcnQgKyAxKTtcbiAgfVxuXG4gIHZhciBmcm9tUGFydHMgPSB0cmltKGZyb20uc3BsaXQoJy8nKSk7XG4gIHZhciB0b1BhcnRzID0gdHJpbSh0by5zcGxpdCgnLycpKTtcblxuICB2YXIgbGVuZ3RoID0gTWF0aC5taW4oZnJvbVBhcnRzLmxlbmd0aCwgdG9QYXJ0cy5sZW5ndGgpO1xuICB2YXIgc2FtZVBhcnRzTGVuZ3RoID0gbGVuZ3RoO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGZyb21QYXJ0c1tpXSAhPT0gdG9QYXJ0c1tpXSkge1xuICAgICAgc2FtZVBhcnRzTGVuZ3RoID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHZhciBvdXRwdXRQYXJ0cyA9IFtdO1xuICBmb3IgKHZhciBpID0gc2FtZVBhcnRzTGVuZ3RoOyBpIDwgZnJvbVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0cHV0UGFydHMucHVzaCgnLi4nKTtcbiAgfVxuXG4gIG91dHB1dFBhcnRzID0gb3V0cHV0UGFydHMuY29uY2F0KHRvUGFydHMuc2xpY2Uoc2FtZVBhcnRzTGVuZ3RoKSk7XG5cbiAgcmV0dXJuIG91dHB1dFBhcnRzLmpvaW4oJy8nKTtcbn07XG5cbmV4cG9ydHMuc2VwID0gJy8nO1xuZXhwb3J0cy5kZWxpbWl0ZXIgPSAnOic7XG5cbmV4cG9ydHMuZGlybmFtZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgdmFyIHJlc3VsdCA9IHNwbGl0UGF0aChwYXRoKSxcbiAgICAgIHJvb3QgPSByZXN1bHRbMF0sXG4gICAgICBkaXIgPSByZXN1bHRbMV07XG5cbiAgaWYgKCFyb290ICYmICFkaXIpIHtcbiAgICAvLyBObyBkaXJuYW1lIHdoYXRzb2V2ZXJcbiAgICByZXR1cm4gJy4nO1xuICB9XG5cbiAgaWYgKGRpcikge1xuICAgIC8vIEl0IGhhcyBhIGRpcm5hbWUsIHN0cmlwIHRyYWlsaW5nIHNsYXNoXG4gICAgZGlyID0gZGlyLnN1YnN0cigwLCBkaXIubGVuZ3RoIC0gMSk7XG4gIH1cblxuICByZXR1cm4gcm9vdCArIGRpcjtcbn07XG5cblxuZXhwb3J0cy5iYXNlbmFtZSA9IGZ1bmN0aW9uKHBhdGgsIGV4dCkge1xuICB2YXIgZiA9IHNwbGl0UGF0aChwYXRoKVsyXTtcbiAgLy8gVE9ETzogbWFrZSB0aGlzIGNvbXBhcmlzb24gY2FzZS1pbnNlbnNpdGl2ZSBvbiB3aW5kb3dzP1xuICBpZiAoZXh0ICYmIGYuc3Vic3RyKC0xICogZXh0Lmxlbmd0aCkgPT09IGV4dCkge1xuICAgIGYgPSBmLnN1YnN0cigwLCBmLmxlbmd0aCAtIGV4dC5sZW5ndGgpO1xuICB9XG4gIHJldHVybiBmO1xufTtcblxuXG5leHBvcnRzLmV4dG5hbWUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHJldHVybiBzcGxpdFBhdGgocGF0aClbM107XG59O1xuXG5mdW5jdGlvbiBmaWx0ZXIgKHhzLCBmKSB7XG4gICAgaWYgKHhzLmZpbHRlcikgcmV0dXJuIHhzLmZpbHRlcihmKTtcbiAgICB2YXIgcmVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoZih4c1tpXSwgaSwgeHMpKSByZXMucHVzaCh4c1tpXSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG59XG5cbi8vIFN0cmluZy5wcm90b3R5cGUuc3Vic3RyIC0gbmVnYXRpdmUgaW5kZXggZG9uJ3Qgd29yayBpbiBJRThcbnZhciBzdWJzdHIgPSAnYWInLnN1YnN0cigtMSkgPT09ICdiJ1xuICAgID8gZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikgeyByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKSB9XG4gICAgOiBmdW5jdGlvbiAoc3RyLCBzdGFydCwgbGVuKSB7XG4gICAgICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gc3RyLmxlbmd0aCArIHN0YXJ0O1xuICAgICAgICByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKTtcbiAgICB9XG47XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxuLy8gY2FjaGVkIGZyb20gd2hhdGV2ZXIgZ2xvYmFsIGlzIHByZXNlbnQgc28gdGhhdCB0ZXN0IHJ1bm5lcnMgdGhhdCBzdHViIGl0XG4vLyBkb24ndCBicmVhayB0aGluZ3MuICBCdXQgd2UgbmVlZCB0byB3cmFwIGl0IGluIGEgdHJ5IGNhdGNoIGluIGNhc2UgaXQgaXNcbi8vIHdyYXBwZWQgaW4gc3RyaWN0IG1vZGUgY29kZSB3aGljaCBkb2Vzbid0IGRlZmluZSBhbnkgZ2xvYmFscy4gIEl0J3MgaW5zaWRlIGFcbi8vIGZ1bmN0aW9uIGJlY2F1c2UgdHJ5L2NhdGNoZXMgZGVvcHRpbWl6ZSBpbiBjZXJ0YWluIGVuZ2luZXMuXG5cbnZhciBjYWNoZWRTZXRUaW1lb3V0O1xudmFyIGNhY2hlZENsZWFyVGltZW91dDtcblxuZnVuY3Rpb24gZGVmYXVsdFNldFRpbW91dCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldFRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbmZ1bmN0aW9uIGRlZmF1bHRDbGVhclRpbWVvdXQgKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY2xlYXJUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG4oZnVuY3Rpb24gKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2V0VGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2YgY2xlYXJUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgIH1cbn0gKCkpXG5mdW5jdGlvbiBydW5UaW1lb3V0KGZ1bikge1xuICAgIGlmIChjYWNoZWRTZXRUaW1lb3V0ID09PSBzZXRUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICAvLyBpZiBzZXRUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkU2V0VGltZW91dCA9PT0gZGVmYXVsdFNldFRpbW91dCB8fCAhY2FjaGVkU2V0VGltZW91dCkgJiYgc2V0VGltZW91dCkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dChmdW4sIDApO1xuICAgIH0gY2F0Y2goZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwobnVsbCwgZnVuLCAwKTtcbiAgICAgICAgfSBjYXRjaChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yXG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKHRoaXMsIGZ1biwgMCk7XG4gICAgICAgIH1cbiAgICB9XG5cblxufVxuZnVuY3Rpb24gcnVuQ2xlYXJUaW1lb3V0KG1hcmtlcikge1xuICAgIGlmIChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGNsZWFyVGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICAvLyBpZiBjbGVhclRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGRlZmF1bHRDbGVhclRpbWVvdXQgfHwgIWNhY2hlZENsZWFyVGltZW91dCkgJiYgY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCAgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbChudWxsLCBtYXJrZXIpO1xuICAgICAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yLlxuICAgICAgICAgICAgLy8gU29tZSB2ZXJzaW9ucyBvZiBJLkUuIGhhdmUgZGlmZmVyZW50IHJ1bGVzIGZvciBjbGVhclRpbWVvdXQgdnMgc2V0VGltZW91dFxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKHRoaXMsIG1hcmtlcik7XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG59XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBpZiAoIWRyYWluaW5nIHx8ICFjdXJyZW50UXVldWUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBydW5UaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50UXVldWUpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBydW5DbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBydW5UaW1lb3V0KGRyYWluUXVldWUpO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRPbmNlTGlzdGVuZXIgPSBub29wO1xuXG5wcm9jZXNzLmxpc3RlbmVycyA9IGZ1bmN0aW9uIChuYW1lKSB7IHJldHVybiBbXSB9XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbid1c2Ugc3RyaWN0JztcblxuLy8gSWYgb2JqLmhhc093blByb3BlcnR5IGhhcyBiZWVuIG92ZXJyaWRkZW4sIHRoZW4gY2FsbGluZ1xuLy8gb2JqLmhhc093blByb3BlcnR5KHByb3ApIHdpbGwgYnJlYWsuXG4vLyBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9qb3llbnQvbm9kZS9pc3N1ZXMvMTcwN1xuZnVuY3Rpb24gaGFzT3duUHJvcGVydHkob2JqLCBwcm9wKSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihxcywgc2VwLCBlcSwgb3B0aW9ucykge1xuICBzZXAgPSBzZXAgfHwgJyYnO1xuICBlcSA9IGVxIHx8ICc9JztcbiAgdmFyIG9iaiA9IHt9O1xuXG4gIGlmICh0eXBlb2YgcXMgIT09ICdzdHJpbmcnIHx8IHFzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBvYmo7XG4gIH1cblxuICB2YXIgcmVnZXhwID0gL1xcKy9nO1xuICBxcyA9IHFzLnNwbGl0KHNlcCk7XG5cbiAgdmFyIG1heEtleXMgPSAxMDAwO1xuICBpZiAob3B0aW9ucyAmJiB0eXBlb2Ygb3B0aW9ucy5tYXhLZXlzID09PSAnbnVtYmVyJykge1xuICAgIG1heEtleXMgPSBvcHRpb25zLm1heEtleXM7XG4gIH1cblxuICB2YXIgbGVuID0gcXMubGVuZ3RoO1xuICAvLyBtYXhLZXlzIDw9IDAgbWVhbnMgdGhhdCB3ZSBzaG91bGQgbm90IGxpbWl0IGtleXMgY291bnRcbiAgaWYgKG1heEtleXMgPiAwICYmIGxlbiA+IG1heEtleXMpIHtcbiAgICBsZW4gPSBtYXhLZXlzO1xuICB9XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgIHZhciB4ID0gcXNbaV0ucmVwbGFjZShyZWdleHAsICclMjAnKSxcbiAgICAgICAgaWR4ID0geC5pbmRleE9mKGVxKSxcbiAgICAgICAga3N0ciwgdnN0ciwgaywgdjtcblxuICAgIGlmIChpZHggPj0gMCkge1xuICAgICAga3N0ciA9IHguc3Vic3RyKDAsIGlkeCk7XG4gICAgICB2c3RyID0geC5zdWJzdHIoaWR4ICsgMSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGtzdHIgPSB4O1xuICAgICAgdnN0ciA9ICcnO1xuICAgIH1cblxuICAgIGsgPSBkZWNvZGVVUklDb21wb25lbnQoa3N0cik7XG4gICAgdiA9IGRlY29kZVVSSUNvbXBvbmVudCh2c3RyKTtcblxuICAgIGlmICghaGFzT3duUHJvcGVydHkob2JqLCBrKSkge1xuICAgICAgb2JqW2tdID0gdjtcbiAgICB9IGVsc2UgaWYgKGlzQXJyYXkob2JqW2tdKSkge1xuICAgICAgb2JqW2tdLnB1c2godik7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ialtrXSA9IFtvYmpba10sIHZdO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvYmo7XG59O1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gKHhzKSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoeHMpID09PSAnW29iamVjdCBBcnJheV0nO1xufTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBzdHJpbmdpZnlQcmltaXRpdmUgPSBmdW5jdGlvbih2KSB7XG4gIHN3aXRjaCAodHlwZW9mIHYpIHtcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgcmV0dXJuIHY7XG5cbiAgICBjYXNlICdib29sZWFuJzpcbiAgICAgIHJldHVybiB2ID8gJ3RydWUnIDogJ2ZhbHNlJztcblxuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4gaXNGaW5pdGUodikgPyB2IDogJyc7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICcnO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKG9iaiwgc2VwLCBlcSwgbmFtZSkge1xuICBzZXAgPSBzZXAgfHwgJyYnO1xuICBlcSA9IGVxIHx8ICc9JztcbiAgaWYgKG9iaiA9PT0gbnVsbCkge1xuICAgIG9iaiA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIGlmICh0eXBlb2Ygb2JqID09PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBtYXAob2JqZWN0S2V5cyhvYmopLCBmdW5jdGlvbihrKSB7XG4gICAgICB2YXIga3MgPSBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKGspKSArIGVxO1xuICAgICAgaWYgKGlzQXJyYXkob2JqW2tdKSkge1xuICAgICAgICByZXR1cm4gbWFwKG9ialtrXSwgZnVuY3Rpb24odikge1xuICAgICAgICAgIHJldHVybiBrcyArIGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUodikpO1xuICAgICAgICB9KS5qb2luKHNlcCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4ga3MgKyBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKG9ialtrXSkpO1xuICAgICAgfVxuICAgIH0pLmpvaW4oc2VwKTtcblxuICB9XG5cbiAgaWYgKCFuYW1lKSByZXR1cm4gJyc7XG4gIHJldHVybiBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKG5hbWUpKSArIGVxICtcbiAgICAgICAgIGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUob2JqKSk7XG59O1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gKHhzKSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoeHMpID09PSAnW29iamVjdCBBcnJheV0nO1xufTtcblxuZnVuY3Rpb24gbWFwICh4cywgZikge1xuICBpZiAoeHMubWFwKSByZXR1cm4geHMubWFwKGYpO1xuICB2YXIgcmVzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgeHMubGVuZ3RoOyBpKyspIHtcbiAgICByZXMucHVzaChmKHhzW2ldLCBpKSk7XG4gIH1cbiAgcmV0dXJuIHJlcztcbn1cblxudmFyIG9iamVjdEtleXMgPSBPYmplY3Qua2V5cyB8fCBmdW5jdGlvbiAob2JqKSB7XG4gIHZhciByZXMgPSBbXTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBrZXkpKSByZXMucHVzaChrZXkpO1xuICB9XG4gIHJldHVybiByZXM7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5leHBvcnRzLmRlY29kZSA9IGV4cG9ydHMucGFyc2UgPSByZXF1aXJlKCcuL2RlY29kZScpO1xuZXhwb3J0cy5lbmNvZGUgPSBleHBvcnRzLnN0cmluZ2lmeSA9IHJlcXVpcmUoJy4vZW5jb2RlJyk7XG4iLCIndXNlIHN0cmljdCc7XG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChzdHIpIHtcblx0dmFyIGlzRXh0ZW5kZWRMZW5ndGhQYXRoID0gL15cXFxcXFxcXFxcP1xcXFwvLnRlc3Qoc3RyKTtcblx0dmFyIGhhc05vbkFzY2lpID0gL1teXFx4MDAtXFx4ODBdKy8udGVzdChzdHIpO1xuXG5cdGlmIChpc0V4dGVuZGVkTGVuZ3RoUGF0aCB8fCBoYXNOb25Bc2NpaSkge1xuXHRcdHJldHVybiBzdHI7XG5cdH1cblxuXHRyZXR1cm4gc3RyLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn07XG4iLCIvKiogQGxpY2Vuc2UgVVJJLmpzIHYzLjAuMSAoYykgMjAxMSBHYXJ5IENvdXJ0LiBMaWNlbnNlOiBodHRwOi8vZ2l0aHViLmNvbS9nYXJ5Y291cnQvdXJpLWpzICovXG4oZnVuY3Rpb24gKGdsb2JhbCwgZmFjdG9yeSkge1xuXHR0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgPyBmYWN0b3J5KGV4cG9ydHMpIDpcblx0dHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kID8gZGVmaW5lKFsnZXhwb3J0cyddLCBmYWN0b3J5KSA6XG5cdChmYWN0b3J5KChnbG9iYWwuVVJJID0gZ2xvYmFsLlVSSSB8fCB7fSkpKTtcbn0odGhpcywgKGZ1bmN0aW9uIChleHBvcnRzKSB7ICd1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gbWVyZ2UoKSB7XG4gICAgZm9yICh2YXIgX2xlbiA9IGFyZ3VtZW50cy5sZW5ndGgsIHNldHMgPSBBcnJheShfbGVuKSwgX2tleSA9IDA7IF9rZXkgPCBfbGVuOyBfa2V5KyspIHtcbiAgICAgICAgc2V0c1tfa2V5XSA9IGFyZ3VtZW50c1tfa2V5XTtcbiAgICB9XG5cbiAgICBpZiAoc2V0cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHNldHNbMF0gPSBzZXRzWzBdLnNsaWNlKDAsIC0xKTtcbiAgICAgICAgdmFyIHhsID0gc2V0cy5sZW5ndGggLSAxO1xuICAgICAgICBmb3IgKHZhciB4ID0gMTsgeCA8IHhsOyArK3gpIHtcbiAgICAgICAgICAgIHNldHNbeF0gPSBzZXRzW3hdLnNsaWNlKDEsIC0xKTtcbiAgICAgICAgfVxuICAgICAgICBzZXRzW3hsXSA9IHNldHNbeGxdLnNsaWNlKDEpO1xuICAgICAgICByZXR1cm4gc2V0cy5qb2luKCcnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gc2V0c1swXTtcbiAgICB9XG59XG5mdW5jdGlvbiBzdWJleHAoc3RyKSB7XG4gICAgcmV0dXJuIFwiKD86XCIgKyBzdHIgKyBcIilcIjtcbn1cbmZ1bmN0aW9uIHR5cGVPZihvKSB7XG4gICAgcmV0dXJuIG8gPT09IHVuZGVmaW5lZCA/IFwidW5kZWZpbmVkXCIgOiBvID09PSBudWxsID8gXCJudWxsXCIgOiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwobykuc3BsaXQoXCIgXCIpLnBvcCgpLnNwbGl0KFwiXVwiKS5zaGlmdCgpLnRvTG93ZXJDYXNlKCk7XG59XG5mdW5jdGlvbiB0b1VwcGVyQ2FzZShzdHIpIHtcbiAgICByZXR1cm4gc3RyLnRvVXBwZXJDYXNlKCk7XG59XG5mdW5jdGlvbiB0b0FycmF5KG9iaikge1xuICAgIHJldHVybiBvYmogIT09IHVuZGVmaW5lZCAmJiBvYmogIT09IG51bGwgPyBvYmogaW5zdGFuY2VvZiBBcnJheSA/IG9iaiA6IHR5cGVvZiBvYmoubGVuZ3RoICE9PSBcIm51bWJlclwiIHx8IG9iai5zcGxpdCB8fCBvYmouc2V0SW50ZXJ2YWwgfHwgb2JqLmNhbGwgPyBbb2JqXSA6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKG9iaikgOiBbXTtcbn1cblxuZnVuY3Rpb24gYnVpbGRFeHBzKGlzSVJJKSB7XG4gICAgdmFyIEFMUEhBJCQgPSBcIltBLVphLXpdXCIsXG4gICAgICAgIENSJCA9IFwiW1xcXFx4MERdXCIsXG4gICAgICAgIERJR0lUJCQgPSBcIlswLTldXCIsXG4gICAgICAgIERRVU9URSQkID0gXCJbXFxcXHgyMl1cIixcbiAgICAgICAgSEVYRElHJCQgPSBtZXJnZShESUdJVCQkLCBcIltBLUZhLWZdXCIpLFxuICAgICAgICAvL2Nhc2UtaW5zZW5zaXRpdmVcbiAgICBMRiQkID0gXCJbXFxcXHgwQV1cIixcbiAgICAgICAgU1AkJCA9IFwiW1xcXFx4MjBdXCIsXG4gICAgICAgIFBDVF9FTkNPREVEJCA9IHN1YmV4cChzdWJleHAoXCIlW0VGZWZdXCIgKyBIRVhESUckJCArIFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCArIFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCkgKyBcInxcIiArIHN1YmV4cChcIiVbODlBLUZhLWZdXCIgKyBIRVhESUckJCArIFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCkgKyBcInxcIiArIHN1YmV4cChcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpKSxcbiAgICAgICAgLy9leHBhbmRlZFxuICAgIEdFTl9ERUxJTVMkJCA9IFwiW1xcXFw6XFxcXC9cXFxcP1xcXFwjXFxcXFtcXFxcXVxcXFxAXVwiLFxuICAgICAgICBTVUJfREVMSU1TJCQgPSBcIltcXFxcIVxcXFwkXFxcXCZcXFxcJ1xcXFwoXFxcXClcXFxcKlxcXFwrXFxcXCxcXFxcO1xcXFw9XVwiLFxuICAgICAgICBSRVNFUlZFRCQkID0gbWVyZ2UoR0VOX0RFTElNUyQkLCBTVUJfREVMSU1TJCQpLFxuICAgICAgICBVQ1NDSEFSJCQgPSBpc0lSSSA/IFwiW1xcXFx4QTAtXFxcXHUyMDBEXFxcXHUyMDEwLVxcXFx1MjAyOVxcXFx1MjAyRi1cXFxcdUQ3RkZcXFxcdUY5MDAtXFxcXHVGRENGXFxcXHVGREYwLVxcXFx1RkZFRl1cIiA6IFwiW11cIixcbiAgICAgICAgLy9zdWJzZXQsIGV4Y2x1ZGVzIGJpZGkgY29udHJvbCBjaGFyYWN0ZXJzXG4gICAgSVBSSVZBVEUkJCA9IGlzSVJJID8gXCJbXFxcXHVFMDAwLVxcXFx1RjhGRl1cIiA6IFwiW11cIixcbiAgICAgICAgLy9zdWJzZXRcbiAgICBVTlJFU0VSVkVEJCQgPSBtZXJnZShBTFBIQSQkLCBESUdJVCQkLCBcIltcXFxcLVxcXFwuXFxcXF9cXFxcfl1cIiwgVUNTQ0hBUiQkKSxcbiAgICAgICAgU0NIRU1FJCA9IHN1YmV4cChBTFBIQSQkICsgbWVyZ2UoQUxQSEEkJCwgRElHSVQkJCwgXCJbXFxcXCtcXFxcLVxcXFwuXVwiKSArIFwiKlwiKSxcbiAgICAgICAgVVNFUklORk8kID0gc3ViZXhwKHN1YmV4cChQQ1RfRU5DT0RFRCQgKyBcInxcIiArIG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcOl1cIikpICsgXCIqXCIpLFxuICAgICAgICBERUNfT0NURVQkID0gc3ViZXhwKHN1YmV4cChcIjI1WzAtNV1cIikgKyBcInxcIiArIHN1YmV4cChcIjJbMC00XVwiICsgRElHSVQkJCkgKyBcInxcIiArIHN1YmV4cChcIjFcIiArIERJR0lUJCQgKyBESUdJVCQkKSArIFwifFwiICsgc3ViZXhwKFwiWzEtOV1cIiArIERJR0lUJCQpICsgXCJ8XCIgKyBESUdJVCQkKSxcbiAgICAgICAgSVBWNEFERFJFU1MkID0gc3ViZXhwKERFQ19PQ1RFVCQgKyBcIlxcXFwuXCIgKyBERUNfT0NURVQkICsgXCJcXFxcLlwiICsgREVDX09DVEVUJCArIFwiXFxcXC5cIiArIERFQ19PQ1RFVCQpLFxuICAgICAgICBIMTYkID0gc3ViZXhwKEhFWERJRyQkICsgXCJ7MSw0fVwiKSxcbiAgICAgICAgTFMzMiQgPSBzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIgKyBIMTYkKSArIFwifFwiICsgSVBWNEFERFJFU1MkKSxcbiAgICAgICAgSVBWNkFERFJFU1MxJCA9IHN1YmV4cChzdWJleHAoSDE2JCArIFwiXFxcXDpcIikgKyBcIns2fVwiICsgTFMzMiQpLFxuICAgICAgICAvLyAgICAgICAgICAgICAgICAgICAgICAgICAgIDYoIGgxNiBcIjpcIiApIGxzMzJcbiAgICBJUFY2QUREUkVTUzIkID0gc3ViZXhwKFwiXFxcXDpcXFxcOlwiICsgc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7NX1cIiArIExTMzIkKSxcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgICAgICAgXCI6OlwiIDUoIGgxNiBcIjpcIiApIGxzMzJcbiAgICBJUFY2QUREUkVTUzMkID0gc3ViZXhwKHN1YmV4cChIMTYkKSArIFwiP1xcXFw6XFxcXDpcIiArIHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezR9XCIgKyBMUzMyJCksXG4gICAgICAgIC8vWyAgICAgICAgICAgICAgIGgxNiBdIFwiOjpcIiA0KCBoMTYgXCI6XCIgKSBsczMyXG4gICAgSVBWNkFERFJFU1M0JCA9IHN1YmV4cChzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7MCwxfVwiICsgSDE2JCkgKyBcIj9cXFxcOlxcXFw6XCIgKyBzdWJleHAoSDE2JCArIFwiXFxcXDpcIikgKyBcInszfVwiICsgTFMzMiQpLFxuICAgICAgICAvL1sgKjEoIGgxNiBcIjpcIiApIGgxNiBdIFwiOjpcIiAzKCBoMTYgXCI6XCIgKSBsczMyXG4gICAgSVBWNkFERFJFU1M1JCA9IHN1YmV4cChzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7MCwyfVwiICsgSDE2JCkgKyBcIj9cXFxcOlxcXFw6XCIgKyBzdWJleHAoSDE2JCArIFwiXFxcXDpcIikgKyBcInsyfVwiICsgTFMzMiQpLFxuICAgICAgICAvL1sgKjIoIGgxNiBcIjpcIiApIGgxNiBdIFwiOjpcIiAyKCBoMTYgXCI6XCIgKSBsczMyXG4gICAgSVBWNkFERFJFU1M2JCA9IHN1YmV4cChzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7MCwzfVwiICsgSDE2JCkgKyBcIj9cXFxcOlxcXFw6XCIgKyBIMTYkICsgXCJcXFxcOlwiICsgTFMzMiQpLFxuICAgICAgICAvL1sgKjMoIGgxNiBcIjpcIiApIGgxNiBdIFwiOjpcIiAgICBoMTYgXCI6XCIgICBsczMyXG4gICAgSVBWNkFERFJFU1M3JCA9IHN1YmV4cChzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7MCw0fVwiICsgSDE2JCkgKyBcIj9cXFxcOlxcXFw6XCIgKyBMUzMyJCksXG4gICAgICAgIC8vWyAqNCggaDE2IFwiOlwiICkgaDE2IF0gXCI6OlwiICAgICAgICAgICAgICBsczMyXG4gICAgSVBWNkFERFJFU1M4JCA9IHN1YmV4cChzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7MCw1fVwiICsgSDE2JCkgKyBcIj9cXFxcOlxcXFw6XCIgKyBIMTYkKSxcbiAgICAgICAgLy9bICo1KCBoMTYgXCI6XCIgKSBoMTYgXSBcIjo6XCIgICAgICAgICAgICAgIGgxNlxuICAgIElQVjZBRERSRVNTOSQgPSBzdWJleHAoc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezAsNn1cIiArIEgxNiQpICsgXCI/XFxcXDpcXFxcOlwiKSxcbiAgICAgICAgLy9bICo2KCBoMTYgXCI6XCIgKSBoMTYgXSBcIjo6XCJcbiAgICBJUFY2QUREUkVTUyQgPSBzdWJleHAoW0lQVjZBRERSRVNTMSQsIElQVjZBRERSRVNTMiQsIElQVjZBRERSRVNTMyQsIElQVjZBRERSRVNTNCQsIElQVjZBRERSRVNTNSQsIElQVjZBRERSRVNTNiQsIElQVjZBRERSRVNTNyQsIElQVjZBRERSRVNTOCQsIElQVjZBRERSRVNTOSRdLmpvaW4oXCJ8XCIpKSxcbiAgICAgICAgSVBWRlVUVVJFJCA9IHN1YmV4cChcIlt2Vl1cIiArIEhFWERJRyQkICsgXCIrXFxcXC5cIiArIG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcOl1cIikgKyBcIitcIiksXG4gICAgICAgIElQX0xJVEVSQUwkID0gc3ViZXhwKFwiXFxcXFtcIiArIHN1YmV4cChJUFY2QUREUkVTUyQgKyBcInxcIiArIElQVkZVVFVSRSQpICsgXCJcXFxcXVwiKSxcbiAgICAgICAgUkVHX05BTUUkID0gc3ViZXhwKHN1YmV4cChQQ1RfRU5DT0RFRCQgKyBcInxcIiArIG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkKSkgKyBcIipcIiksXG4gICAgICAgIEhPU1QkID0gc3ViZXhwKElQX0xJVEVSQUwkICsgXCJ8XCIgKyBJUFY0QUREUkVTUyQgKyBcIig/IVwiICsgUkVHX05BTUUkICsgXCIpXCIgKyBcInxcIiArIFJFR19OQU1FJCksXG4gICAgICAgIFBPUlQkID0gc3ViZXhwKERJR0lUJCQgKyBcIipcIiksXG4gICAgICAgIEFVVEhPUklUWSQgPSBzdWJleHAoc3ViZXhwKFVTRVJJTkZPJCArIFwiQFwiKSArIFwiP1wiICsgSE9TVCQgKyBzdWJleHAoXCJcXFxcOlwiICsgUE9SVCQpICsgXCI/XCIpLFxuICAgICAgICBQQ0hBUiQgPSBzdWJleHAoUENUX0VOQ09ERUQkICsgXCJ8XCIgKyBtZXJnZShVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCwgXCJbXFxcXDpcXFxcQF1cIikpLFxuICAgICAgICBTRUdNRU5UJCA9IHN1YmV4cChQQ0hBUiQgKyBcIipcIiksXG4gICAgICAgIFNFR01FTlRfTlokID0gc3ViZXhwKFBDSEFSJCArIFwiK1wiKSxcbiAgICAgICAgU0VHTUVOVF9OWl9OQyQgPSBzdWJleHAoc3ViZXhwKFBDVF9FTkNPREVEJCArIFwifFwiICsgbWVyZ2UoVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQsIFwiW1xcXFxAXVwiKSkgKyBcIitcIiksXG4gICAgICAgIFBBVEhfQUJFTVBUWSQgPSBzdWJleHAoc3ViZXhwKFwiXFxcXC9cIiArIFNFR01FTlQkKSArIFwiKlwiKSxcbiAgICAgICAgUEFUSF9BQlNPTFVURSQgPSBzdWJleHAoXCJcXFxcL1wiICsgc3ViZXhwKFNFR01FTlRfTlokICsgUEFUSF9BQkVNUFRZJCkgKyBcIj9cIiksXG4gICAgICAgIC8vc2ltcGxpZmllZFxuICAgIFBBVEhfTk9TQ0hFTUUkID0gc3ViZXhwKFNFR01FTlRfTlpfTkMkICsgUEFUSF9BQkVNUFRZJCksXG4gICAgICAgIC8vc2ltcGxpZmllZFxuICAgIFBBVEhfUk9PVExFU1MkID0gc3ViZXhwKFNFR01FTlRfTlokICsgUEFUSF9BQkVNUFRZJCksXG4gICAgICAgIC8vc2ltcGxpZmllZFxuICAgIFBBVEhfRU1QVFkkID0gXCIoPyFcIiArIFBDSEFSJCArIFwiKVwiLFxuICAgICAgICBQQVRIJCA9IHN1YmV4cChQQVRIX0FCRU1QVFkkICsgXCJ8XCIgKyBQQVRIX0FCU09MVVRFJCArIFwifFwiICsgUEFUSF9OT1NDSEVNRSQgKyBcInxcIiArIFBBVEhfUk9PVExFU1MkICsgXCJ8XCIgKyBQQVRIX0VNUFRZJCksXG4gICAgICAgIFFVRVJZJCA9IHN1YmV4cChzdWJleHAoUENIQVIkICsgXCJ8XCIgKyBtZXJnZShcIltcXFxcL1xcXFw/XVwiLCBJUFJJVkFURSQkKSkgKyBcIipcIiksXG4gICAgICAgIEZSQUdNRU5UJCA9IHN1YmV4cChzdWJleHAoUENIQVIkICsgXCJ8W1xcXFwvXFxcXD9dXCIpICsgXCIqXCIpLFxuICAgICAgICBISUVSX1BBUlQkID0gc3ViZXhwKHN1YmV4cChcIlxcXFwvXFxcXC9cIiArIEFVVEhPUklUWSQgKyBQQVRIX0FCRU1QVFkkKSArIFwifFwiICsgUEFUSF9BQlNPTFVURSQgKyBcInxcIiArIFBBVEhfUk9PVExFU1MkICsgXCJ8XCIgKyBQQVRIX0VNUFRZJCksXG4gICAgICAgIFVSSSQgPSBzdWJleHAoU0NIRU1FJCArIFwiXFxcXDpcIiArIEhJRVJfUEFSVCQgKyBzdWJleHAoXCJcXFxcP1wiICsgUVVFUlkkKSArIFwiP1wiICsgc3ViZXhwKFwiXFxcXCNcIiArIEZSQUdNRU5UJCkgKyBcIj9cIiksXG4gICAgICAgIFJFTEFUSVZFX1BBUlQkID0gc3ViZXhwKHN1YmV4cChcIlxcXFwvXFxcXC9cIiArIEFVVEhPUklUWSQgKyBQQVRIX0FCRU1QVFkkKSArIFwifFwiICsgUEFUSF9BQlNPTFVURSQgKyBcInxcIiArIFBBVEhfTk9TQ0hFTUUkICsgXCJ8XCIgKyBQQVRIX0VNUFRZJCksXG4gICAgICAgIFJFTEFUSVZFJCA9IHN1YmV4cChSRUxBVElWRV9QQVJUJCArIHN1YmV4cChcIlxcXFw/XCIgKyBRVUVSWSQpICsgXCI/XCIgKyBzdWJleHAoXCJcXFxcI1wiICsgRlJBR01FTlQkKSArIFwiP1wiKSxcbiAgICAgICAgVVJJX1JFRkVSRU5DRSQgPSBzdWJleHAoVVJJJCArIFwifFwiICsgUkVMQVRJVkUkKSxcbiAgICAgICAgQUJTT0xVVEVfVVJJJCA9IHN1YmV4cChTQ0hFTUUkICsgXCJcXFxcOlwiICsgSElFUl9QQVJUJCArIHN1YmV4cChcIlxcXFw/XCIgKyBRVUVSWSQpICsgXCI/XCIpLFxuICAgICAgICBHRU5FUklDX1JFRiQgPSBcIl4oXCIgKyBTQ0hFTUUkICsgXCIpXFxcXDpcIiArIHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvKFwiICsgc3ViZXhwKFwiKFwiICsgVVNFUklORk8kICsgXCIpQFwiKSArIFwiPyhcIiArIEhPU1QkICsgXCIpXCIgKyBzdWJleHAoXCJcXFxcOihcIiArIFBPUlQkICsgXCIpXCIpICsgXCI/KVwiKSArIFwiPyhcIiArIFBBVEhfQUJFTVBUWSQgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQgKyBcIilcIikgKyBzdWJleHAoXCJcXFxcPyhcIiArIFFVRVJZJCArIFwiKVwiKSArIFwiP1wiICsgc3ViZXhwKFwiXFxcXCMoXCIgKyBGUkFHTUVOVCQgKyBcIilcIikgKyBcIj8kXCIsXG4gICAgICAgIFJFTEFUSVZFX1JFRiQgPSBcIl4oKXswfVwiICsgc3ViZXhwKHN1YmV4cChcIlxcXFwvXFxcXC8oXCIgKyBzdWJleHAoXCIoXCIgKyBVU0VSSU5GTyQgKyBcIilAXCIpICsgXCI/KFwiICsgSE9TVCQgKyBcIilcIiArIHN1YmV4cChcIlxcXFw6KFwiICsgUE9SVCQgKyBcIilcIikgKyBcIj8pXCIpICsgXCI/KFwiICsgUEFUSF9BQkVNUFRZJCArIFwifFwiICsgUEFUSF9BQlNPTFVURSQgKyBcInxcIiArIFBBVEhfTk9TQ0hFTUUkICsgXCJ8XCIgKyBQQVRIX0VNUFRZJCArIFwiKVwiKSArIHN1YmV4cChcIlxcXFw/KFwiICsgUVVFUlkkICsgXCIpXCIpICsgXCI/XCIgKyBzdWJleHAoXCJcXFxcIyhcIiArIEZSQUdNRU5UJCArIFwiKVwiKSArIFwiPyRcIixcbiAgICAgICAgQUJTT0xVVEVfUkVGJCA9IFwiXihcIiArIFNDSEVNRSQgKyBcIilcXFxcOlwiICsgc3ViZXhwKHN1YmV4cChcIlxcXFwvXFxcXC8oXCIgKyBzdWJleHAoXCIoXCIgKyBVU0VSSU5GTyQgKyBcIilAXCIpICsgXCI/KFwiICsgSE9TVCQgKyBcIilcIiArIHN1YmV4cChcIlxcXFw6KFwiICsgUE9SVCQgKyBcIilcIikgKyBcIj8pXCIpICsgXCI/KFwiICsgUEFUSF9BQkVNUFRZJCArIFwifFwiICsgUEFUSF9BQlNPTFVURSQgKyBcInxcIiArIFBBVEhfUk9PVExFU1MkICsgXCJ8XCIgKyBQQVRIX0VNUFRZJCArIFwiKVwiKSArIHN1YmV4cChcIlxcXFw/KFwiICsgUVVFUlkkICsgXCIpXCIpICsgXCI/JFwiLFxuICAgICAgICBTQU1FRE9DX1JFRiQgPSBcIl5cIiArIHN1YmV4cChcIlxcXFwjKFwiICsgRlJBR01FTlQkICsgXCIpXCIpICsgXCI/JFwiLFxuICAgICAgICBBVVRIT1JJVFlfUkVGJCA9IFwiXlwiICsgc3ViZXhwKFwiKFwiICsgVVNFUklORk8kICsgXCIpQFwiKSArIFwiPyhcIiArIEhPU1QkICsgXCIpXCIgKyBzdWJleHAoXCJcXFxcOihcIiArIFBPUlQkICsgXCIpXCIpICsgXCI/JFwiO1xuICAgIHJldHVybiB7XG4gICAgICAgIE5PVF9TQ0hFTUU6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXl1cIiwgQUxQSEEkJCwgRElHSVQkJCwgXCJbXFxcXCtcXFxcLVxcXFwuXVwiKSwgXCJnXCIpLFxuICAgICAgICBOT1RfVVNFUklORk86IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXFxcXDpdXCIsIFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkKSwgXCJnXCIpLFxuICAgICAgICBOT1RfSE9TVDogbmV3IFJlZ0V4cChtZXJnZShcIlteXFxcXCVcXFxcW1xcXFxdXFxcXDpdXCIsIFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkKSwgXCJnXCIpLFxuICAgICAgICBOT1RfUEFUSDogbmV3IFJlZ0V4cChtZXJnZShcIlteXFxcXCVcXFxcL1xcXFw6XFxcXEBdXCIsIFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkKSwgXCJnXCIpLFxuICAgICAgICBOT1RfUEFUSF9OT1NDSEVNRTogbmV3IFJlZ0V4cChtZXJnZShcIlteXFxcXCVcXFxcL1xcXFxAXVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcbiAgICAgICAgTk9UX1FVRVJZOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJV1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQsIFwiW1xcXFw6XFxcXEBcXFxcL1xcXFw/XVwiLCBJUFJJVkFURSQkKSwgXCJnXCIpLFxuICAgICAgICBOT1RfRlJBR01FTlQ6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCwgXCJbXFxcXDpcXFxcQFxcXFwvXFxcXD9dXCIpLCBcImdcIiksXG4gICAgICAgIEVTQ0FQRTogbmV3IFJlZ0V4cChtZXJnZShcIlteXVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcbiAgICAgICAgVU5SRVNFUlZFRDogbmV3IFJlZ0V4cChVTlJFU0VSVkVEJCQsIFwiZ1wiKSxcbiAgICAgICAgT1RIRVJfQ0hBUlM6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXVwiLCBVTlJFU0VSVkVEJCQsIFJFU0VSVkVEJCQpLCBcImdcIiksXG4gICAgICAgIFBDVF9FTkNPREVEOiBuZXcgUmVnRXhwKFBDVF9FTkNPREVEJCwgXCJnXCIpLFxuICAgICAgICBJUFY2QUREUkVTUzogbmV3IFJlZ0V4cChcIlxcXFxbPyhcIiArIElQVjZBRERSRVNTJCArIFwiKVxcXFxdP1wiLCBcImdcIilcbiAgICB9O1xufVxudmFyIFVSSV9QUk9UT0NPTCA9IGJ1aWxkRXhwcyhmYWxzZSk7XG5cbnZhciBJUklfUFJPVE9DT0wgPSBidWlsZEV4cHModHJ1ZSk7XG5cbnZhciB0b0NvbnN1bWFibGVBcnJheSA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkoYXJyKSkge1xuICAgIGZvciAodmFyIGkgPSAwLCBhcnIyID0gQXJyYXkoYXJyLmxlbmd0aCk7IGkgPCBhcnIubGVuZ3RoOyBpKyspIGFycjJbaV0gPSBhcnJbaV07XG5cbiAgICByZXR1cm4gYXJyMjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShhcnIpO1xuICB9XG59O1xuXG4vKiogSGlnaGVzdCBwb3NpdGl2ZSBzaWduZWQgMzItYml0IGZsb2F0IHZhbHVlICovXG5cbnZhciBtYXhJbnQgPSAyMTQ3NDgzNjQ3OyAvLyBha2EuIDB4N0ZGRkZGRkYgb3IgMl4zMS0xXG5cbi8qKiBCb290c3RyaW5nIHBhcmFtZXRlcnMgKi9cbnZhciBiYXNlID0gMzY7XG52YXIgdE1pbiA9IDE7XG52YXIgdE1heCA9IDI2O1xudmFyIHNrZXcgPSAzODtcbnZhciBkYW1wID0gNzAwO1xudmFyIGluaXRpYWxCaWFzID0gNzI7XG52YXIgaW5pdGlhbE4gPSAxMjg7IC8vIDB4ODBcbnZhciBkZWxpbWl0ZXIgPSAnLSc7IC8vICdcXHgyRCdcblxuLyoqIFJlZ3VsYXIgZXhwcmVzc2lvbnMgKi9cbnZhciByZWdleFB1bnljb2RlID0gL154bi0tLztcbnZhciByZWdleE5vbkFTQ0lJID0gL1teXFwwLVxceDdFXS87IC8vIG5vbi1BU0NJSSBjaGFyc1xudmFyIHJlZ2V4U2VwYXJhdG9ycyA9IC9bXFx4MkVcXHUzMDAyXFx1RkYwRVxcdUZGNjFdL2c7IC8vIFJGQyAzNDkwIHNlcGFyYXRvcnNcblxuLyoqIEVycm9yIG1lc3NhZ2VzICovXG52YXIgZXJyb3JzID0ge1xuXHQnb3ZlcmZsb3cnOiAnT3ZlcmZsb3c6IGlucHV0IG5lZWRzIHdpZGVyIGludGVnZXJzIHRvIHByb2Nlc3MnLFxuXHQnbm90LWJhc2ljJzogJ0lsbGVnYWwgaW5wdXQgPj0gMHg4MCAobm90IGEgYmFzaWMgY29kZSBwb2ludCknLFxuXHQnaW52YWxpZC1pbnB1dCc6ICdJbnZhbGlkIGlucHV0J1xufTtcblxuLyoqIENvbnZlbmllbmNlIHNob3J0Y3V0cyAqL1xudmFyIGJhc2VNaW51c1RNaW4gPSBiYXNlIC0gdE1pbjtcbnZhciBmbG9vciA9IE1hdGguZmxvb3I7XG52YXIgc3RyaW5nRnJvbUNoYXJDb2RlID0gU3RyaW5nLmZyb21DaGFyQ29kZTtcblxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXG5cbi8qKlxuICogQSBnZW5lcmljIGVycm9yIHV0aWxpdHkgZnVuY3Rpb24uXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtTdHJpbmd9IHR5cGUgVGhlIGVycm9yIHR5cGUuXG4gKiBAcmV0dXJucyB7RXJyb3J9IFRocm93cyBhIGBSYW5nZUVycm9yYCB3aXRoIHRoZSBhcHBsaWNhYmxlIGVycm9yIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGVycm9yJDEodHlwZSkge1xuXHR0aHJvdyBuZXcgUmFuZ2VFcnJvcihlcnJvcnNbdHlwZV0pO1xufVxuXG4vKipcbiAqIEEgZ2VuZXJpYyBgQXJyYXkjbWFwYCB1dGlsaXR5IGZ1bmN0aW9uLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IGFycmF5IFRoZSBhcnJheSB0byBpdGVyYXRlIG92ZXIuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdGhhdCBnZXRzIGNhbGxlZCBmb3IgZXZlcnkgYXJyYXlcbiAqIGl0ZW0uXG4gKiBAcmV0dXJucyB7QXJyYXl9IEEgbmV3IGFycmF5IG9mIHZhbHVlcyByZXR1cm5lZCBieSB0aGUgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIG1hcChhcnJheSwgZm4pIHtcblx0dmFyIHJlc3VsdCA9IFtdO1xuXHR2YXIgbGVuZ3RoID0gYXJyYXkubGVuZ3RoO1xuXHR3aGlsZSAobGVuZ3RoLS0pIHtcblx0XHRyZXN1bHRbbGVuZ3RoXSA9IGZuKGFycmF5W2xlbmd0aF0pO1xuXHR9XG5cdHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQSBzaW1wbGUgYEFycmF5I21hcGAtbGlrZSB3cmFwcGVyIHRvIHdvcmsgd2l0aCBkb21haW4gbmFtZSBzdHJpbmdzIG9yIGVtYWlsXG4gKiBhZGRyZXNzZXMuXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtTdHJpbmd9IGRvbWFpbiBUaGUgZG9tYWluIG5hbWUgb3IgZW1haWwgYWRkcmVzcy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0aGF0IGdldHMgY2FsbGVkIGZvciBldmVyeVxuICogY2hhcmFjdGVyLlxuICogQHJldHVybnMge0FycmF5fSBBIG5ldyBzdHJpbmcgb2YgY2hhcmFjdGVycyByZXR1cm5lZCBieSB0aGUgY2FsbGJhY2tcbiAqIGZ1bmN0aW9uLlxuICovXG5mdW5jdGlvbiBtYXBEb21haW4oc3RyaW5nLCBmbikge1xuXHR2YXIgcGFydHMgPSBzdHJpbmcuc3BsaXQoJ0AnKTtcblx0dmFyIHJlc3VsdCA9ICcnO1xuXHRpZiAocGFydHMubGVuZ3RoID4gMSkge1xuXHRcdC8vIEluIGVtYWlsIGFkZHJlc3Nlcywgb25seSB0aGUgZG9tYWluIG5hbWUgc2hvdWxkIGJlIHB1bnljb2RlZC4gTGVhdmVcblx0XHQvLyB0aGUgbG9jYWwgcGFydCAoaS5lLiBldmVyeXRoaW5nIHVwIHRvIGBAYCkgaW50YWN0LlxuXHRcdHJlc3VsdCA9IHBhcnRzWzBdICsgJ0AnO1xuXHRcdHN0cmluZyA9IHBhcnRzWzFdO1xuXHR9XG5cdC8vIEF2b2lkIGBzcGxpdChyZWdleClgIGZvciBJRTggY29tcGF0aWJpbGl0eS4gU2VlICMxNy5cblx0c3RyaW5nID0gc3RyaW5nLnJlcGxhY2UocmVnZXhTZXBhcmF0b3JzLCAnXFx4MkUnKTtcblx0dmFyIGxhYmVscyA9IHN0cmluZy5zcGxpdCgnLicpO1xuXHR2YXIgZW5jb2RlZCA9IG1hcChsYWJlbHMsIGZuKS5qb2luKCcuJyk7XG5cdHJldHVybiByZXN1bHQgKyBlbmNvZGVkO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXJyYXkgY29udGFpbmluZyB0aGUgbnVtZXJpYyBjb2RlIHBvaW50cyBvZiBlYWNoIFVuaWNvZGVcbiAqIGNoYXJhY3RlciBpbiB0aGUgc3RyaW5nLiBXaGlsZSBKYXZhU2NyaXB0IHVzZXMgVUNTLTIgaW50ZXJuYWxseSxcbiAqIHRoaXMgZnVuY3Rpb24gd2lsbCBjb252ZXJ0IGEgcGFpciBvZiBzdXJyb2dhdGUgaGFsdmVzIChlYWNoIG9mIHdoaWNoXG4gKiBVQ1MtMiBleHBvc2VzIGFzIHNlcGFyYXRlIGNoYXJhY3RlcnMpIGludG8gYSBzaW5nbGUgY29kZSBwb2ludCxcbiAqIG1hdGNoaW5nIFVURi0xNi5cbiAqIEBzZWUgYHB1bnljb2RlLnVjczIuZW5jb2RlYFxuICogQHNlZSA8aHR0cHM6Ly9tYXRoaWFzYnluZW5zLmJlL25vdGVzL2phdmFzY3JpcHQtZW5jb2Rpbmc+XG4gKiBAbWVtYmVyT2YgcHVueWNvZGUudWNzMlxuICogQG5hbWUgZGVjb2RlXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyaW5nIFRoZSBVbmljb2RlIGlucHV0IHN0cmluZyAoVUNTLTIpLlxuICogQHJldHVybnMge0FycmF5fSBUaGUgbmV3IGFycmF5IG9mIGNvZGUgcG9pbnRzLlxuICovXG5mdW5jdGlvbiB1Y3MyZGVjb2RlKHN0cmluZykge1xuXHR2YXIgb3V0cHV0ID0gW107XG5cdHZhciBjb3VudGVyID0gMDtcblx0dmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGg7XG5cdHdoaWxlIChjb3VudGVyIDwgbGVuZ3RoKSB7XG5cdFx0dmFyIHZhbHVlID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcblx0XHRpZiAodmFsdWUgPj0gMHhEODAwICYmIHZhbHVlIDw9IDB4REJGRiAmJiBjb3VudGVyIDwgbGVuZ3RoKSB7XG5cdFx0XHQvLyBJdCdzIGEgaGlnaCBzdXJyb2dhdGUsIGFuZCB0aGVyZSBpcyBhIG5leHQgY2hhcmFjdGVyLlxuXHRcdFx0dmFyIGV4dHJhID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcblx0XHRcdGlmICgoZXh0cmEgJiAweEZDMDApID09IDB4REMwMCkge1xuXHRcdFx0XHQvLyBMb3cgc3Vycm9nYXRlLlxuXHRcdFx0XHRvdXRwdXQucHVzaCgoKHZhbHVlICYgMHgzRkYpIDw8IDEwKSArIChleHRyYSAmIDB4M0ZGKSArIDB4MTAwMDApO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Ly8gSXQncyBhbiB1bm1hdGNoZWQgc3Vycm9nYXRlOyBvbmx5IGFwcGVuZCB0aGlzIGNvZGUgdW5pdCwgaW4gY2FzZSB0aGVcblx0XHRcdFx0Ly8gbmV4dCBjb2RlIHVuaXQgaXMgdGhlIGhpZ2ggc3Vycm9nYXRlIG9mIGEgc3Vycm9nYXRlIHBhaXIuXG5cdFx0XHRcdG91dHB1dC5wdXNoKHZhbHVlKTtcblx0XHRcdFx0Y291bnRlci0tO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHRvdXRwdXQucHVzaCh2YWx1ZSk7XG5cdFx0fVxuXHR9XG5cdHJldHVybiBvdXRwdXQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHN0cmluZyBiYXNlZCBvbiBhbiBhcnJheSBvZiBudW1lcmljIGNvZGUgcG9pbnRzLlxuICogQHNlZSBgcHVueWNvZGUudWNzMi5kZWNvZGVgXG4gKiBAbWVtYmVyT2YgcHVueWNvZGUudWNzMlxuICogQG5hbWUgZW5jb2RlXG4gKiBAcGFyYW0ge0FycmF5fSBjb2RlUG9pbnRzIFRoZSBhcnJheSBvZiBudW1lcmljIGNvZGUgcG9pbnRzLlxuICogQHJldHVybnMge1N0cmluZ30gVGhlIG5ldyBVbmljb2RlIHN0cmluZyAoVUNTLTIpLlxuICovXG52YXIgdWNzMmVuY29kZSA9IGZ1bmN0aW9uIHVjczJlbmNvZGUoYXJyYXkpIHtcblx0cmV0dXJuIFN0cmluZy5mcm9tQ29kZVBvaW50LmFwcGx5KFN0cmluZywgdG9Db25zdW1hYmxlQXJyYXkoYXJyYXkpKTtcbn07XG5cbi8qKlxuICogQ29udmVydHMgYSBiYXNpYyBjb2RlIHBvaW50IGludG8gYSBkaWdpdC9pbnRlZ2VyLlxuICogQHNlZSBgZGlnaXRUb0Jhc2ljKClgXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtOdW1iZXJ9IGNvZGVQb2ludCBUaGUgYmFzaWMgbnVtZXJpYyBjb2RlIHBvaW50IHZhbHVlLlxuICogQHJldHVybnMge051bWJlcn0gVGhlIG51bWVyaWMgdmFsdWUgb2YgYSBiYXNpYyBjb2RlIHBvaW50IChmb3IgdXNlIGluXG4gKiByZXByZXNlbnRpbmcgaW50ZWdlcnMpIGluIHRoZSByYW5nZSBgMGAgdG8gYGJhc2UgLSAxYCwgb3IgYGJhc2VgIGlmXG4gKiB0aGUgY29kZSBwb2ludCBkb2VzIG5vdCByZXByZXNlbnQgYSB2YWx1ZS5cbiAqL1xudmFyIGJhc2ljVG9EaWdpdCA9IGZ1bmN0aW9uIGJhc2ljVG9EaWdpdChjb2RlUG9pbnQpIHtcblx0aWYgKGNvZGVQb2ludCAtIDB4MzAgPCAweDBBKSB7XG5cdFx0cmV0dXJuIGNvZGVQb2ludCAtIDB4MTY7XG5cdH1cblx0aWYgKGNvZGVQb2ludCAtIDB4NDEgPCAweDFBKSB7XG5cdFx0cmV0dXJuIGNvZGVQb2ludCAtIDB4NDE7XG5cdH1cblx0aWYgKGNvZGVQb2ludCAtIDB4NjEgPCAweDFBKSB7XG5cdFx0cmV0dXJuIGNvZGVQb2ludCAtIDB4NjE7XG5cdH1cblx0cmV0dXJuIGJhc2U7XG59O1xuXG4vKipcbiAqIENvbnZlcnRzIGEgZGlnaXQvaW50ZWdlciBpbnRvIGEgYmFzaWMgY29kZSBwb2ludC5cbiAqIEBzZWUgYGJhc2ljVG9EaWdpdCgpYFxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7TnVtYmVyfSBkaWdpdCBUaGUgbnVtZXJpYyB2YWx1ZSBvZiBhIGJhc2ljIGNvZGUgcG9pbnQuXG4gKiBAcmV0dXJucyB7TnVtYmVyfSBUaGUgYmFzaWMgY29kZSBwb2ludCB3aG9zZSB2YWx1ZSAod2hlbiB1c2VkIGZvclxuICogcmVwcmVzZW50aW5nIGludGVnZXJzKSBpcyBgZGlnaXRgLCB3aGljaCBuZWVkcyB0byBiZSBpbiB0aGUgcmFuZ2VcbiAqIGAwYCB0byBgYmFzZSAtIDFgLiBJZiBgZmxhZ2AgaXMgbm9uLXplcm8sIHRoZSB1cHBlcmNhc2UgZm9ybSBpc1xuICogdXNlZDsgZWxzZSwgdGhlIGxvd2VyY2FzZSBmb3JtIGlzIHVzZWQuIFRoZSBiZWhhdmlvciBpcyB1bmRlZmluZWRcbiAqIGlmIGBmbGFnYCBpcyBub24temVybyBhbmQgYGRpZ2l0YCBoYXMgbm8gdXBwZXJjYXNlIGZvcm0uXG4gKi9cbnZhciBkaWdpdFRvQmFzaWMgPSBmdW5jdGlvbiBkaWdpdFRvQmFzaWMoZGlnaXQsIGZsYWcpIHtcblx0Ly8gIDAuLjI1IG1hcCB0byBBU0NJSSBhLi56IG9yIEEuLlpcblx0Ly8gMjYuLjM1IG1hcCB0byBBU0NJSSAwLi45XG5cdHJldHVybiBkaWdpdCArIDIyICsgNzUgKiAoZGlnaXQgPCAyNikgLSAoKGZsYWcgIT0gMCkgPDwgNSk7XG59O1xuXG4vKipcbiAqIEJpYXMgYWRhcHRhdGlvbiBmdW5jdGlvbiBhcyBwZXIgc2VjdGlvbiAzLjQgb2YgUkZDIDM0OTIuXG4gKiBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzQ5MiNzZWN0aW9uLTMuNFxuICogQHByaXZhdGVcbiAqL1xudmFyIGFkYXB0ID0gZnVuY3Rpb24gYWRhcHQoZGVsdGEsIG51bVBvaW50cywgZmlyc3RUaW1lKSB7XG5cdHZhciBrID0gMDtcblx0ZGVsdGEgPSBmaXJzdFRpbWUgPyBmbG9vcihkZWx0YSAvIGRhbXApIDogZGVsdGEgPj4gMTtcblx0ZGVsdGEgKz0gZmxvb3IoZGVsdGEgLyBudW1Qb2ludHMpO1xuXHRmb3IgKDsgLyogbm8gaW5pdGlhbGl6YXRpb24gKi9kZWx0YSA+IGJhc2VNaW51c1RNaW4gKiB0TWF4ID4+IDE7IGsgKz0gYmFzZSkge1xuXHRcdGRlbHRhID0gZmxvb3IoZGVsdGEgLyBiYXNlTWludXNUTWluKTtcblx0fVxuXHRyZXR1cm4gZmxvb3IoayArIChiYXNlTWludXNUTWluICsgMSkgKiBkZWx0YSAvIChkZWx0YSArIHNrZXcpKTtcbn07XG5cbi8qKlxuICogQ29udmVydHMgYSBQdW55Y29kZSBzdHJpbmcgb2YgQVNDSUktb25seSBzeW1ib2xzIHRvIGEgc3RyaW5nIG9mIFVuaWNvZGVcbiAqIHN5bWJvbHMuXG4gKiBAbWVtYmVyT2YgcHVueWNvZGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scy5cbiAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSByZXN1bHRpbmcgc3RyaW5nIG9mIFVuaWNvZGUgc3ltYm9scy5cbiAqL1xudmFyIGRlY29kZSA9IGZ1bmN0aW9uIGRlY29kZShpbnB1dCkge1xuXHQvLyBEb24ndCB1c2UgVUNTLTIuXG5cdHZhciBvdXRwdXQgPSBbXTtcblx0dmFyIGlucHV0TGVuZ3RoID0gaW5wdXQubGVuZ3RoO1xuXHR2YXIgaSA9IDA7XG5cdHZhciBuID0gaW5pdGlhbE47XG5cdHZhciBiaWFzID0gaW5pdGlhbEJpYXM7XG5cblx0Ly8gSGFuZGxlIHRoZSBiYXNpYyBjb2RlIHBvaW50czogbGV0IGBiYXNpY2AgYmUgdGhlIG51bWJlciBvZiBpbnB1dCBjb2RlXG5cdC8vIHBvaW50cyBiZWZvcmUgdGhlIGxhc3QgZGVsaW1pdGVyLCBvciBgMGAgaWYgdGhlcmUgaXMgbm9uZSwgdGhlbiBjb3B5XG5cdC8vIHRoZSBmaXJzdCBiYXNpYyBjb2RlIHBvaW50cyB0byB0aGUgb3V0cHV0LlxuXG5cdHZhciBiYXNpYyA9IGlucHV0Lmxhc3RJbmRleE9mKGRlbGltaXRlcik7XG5cdGlmIChiYXNpYyA8IDApIHtcblx0XHRiYXNpYyA9IDA7XG5cdH1cblxuXHRmb3IgKHZhciBqID0gMDsgaiA8IGJhc2ljOyArK2opIHtcblx0XHQvLyBpZiBpdCdzIG5vdCBhIGJhc2ljIGNvZGUgcG9pbnRcblx0XHRpZiAoaW5wdXQuY2hhckNvZGVBdChqKSA+PSAweDgwKSB7XG5cdFx0XHRlcnJvciQxKCdub3QtYmFzaWMnKTtcblx0XHR9XG5cdFx0b3V0cHV0LnB1c2goaW5wdXQuY2hhckNvZGVBdChqKSk7XG5cdH1cblxuXHQvLyBNYWluIGRlY29kaW5nIGxvb3A6IHN0YXJ0IGp1c3QgYWZ0ZXIgdGhlIGxhc3QgZGVsaW1pdGVyIGlmIGFueSBiYXNpYyBjb2RlXG5cdC8vIHBvaW50cyB3ZXJlIGNvcGllZDsgc3RhcnQgYXQgdGhlIGJlZ2lubmluZyBvdGhlcndpc2UuXG5cblx0Zm9yICh2YXIgaW5kZXggPSBiYXNpYyA+IDAgPyBiYXNpYyArIDEgOiAwOyBpbmRleCA8IGlucHV0TGVuZ3RoOykgLyogbm8gZmluYWwgZXhwcmVzc2lvbiAqL3tcblxuXHRcdC8vIGBpbmRleGAgaXMgdGhlIGluZGV4IG9mIHRoZSBuZXh0IGNoYXJhY3RlciB0byBiZSBjb25zdW1lZC5cblx0XHQvLyBEZWNvZGUgYSBnZW5lcmFsaXplZCB2YXJpYWJsZS1sZW5ndGggaW50ZWdlciBpbnRvIGBkZWx0YWAsXG5cdFx0Ly8gd2hpY2ggZ2V0cyBhZGRlZCB0byBgaWAuIFRoZSBvdmVyZmxvdyBjaGVja2luZyBpcyBlYXNpZXJcblx0XHQvLyBpZiB3ZSBpbmNyZWFzZSBgaWAgYXMgd2UgZ28sIHRoZW4gc3VidHJhY3Qgb2ZmIGl0cyBzdGFydGluZ1xuXHRcdC8vIHZhbHVlIGF0IHRoZSBlbmQgdG8gb2J0YWluIGBkZWx0YWAuXG5cdFx0dmFyIG9sZGkgPSBpO1xuXHRcdGZvciAodmFyIHcgPSAxLCBrID0gYmFzZTs7IC8qIG5vIGNvbmRpdGlvbiAqL2sgKz0gYmFzZSkge1xuXG5cdFx0XHRpZiAoaW5kZXggPj0gaW5wdXRMZW5ndGgpIHtcblx0XHRcdFx0ZXJyb3IkMSgnaW52YWxpZC1pbnB1dCcpO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgZGlnaXQgPSBiYXNpY1RvRGlnaXQoaW5wdXQuY2hhckNvZGVBdChpbmRleCsrKSk7XG5cblx0XHRcdGlmIChkaWdpdCA+PSBiYXNlIHx8IGRpZ2l0ID4gZmxvb3IoKG1heEludCAtIGkpIC8gdykpIHtcblx0XHRcdFx0ZXJyb3IkMSgnb3ZlcmZsb3cnKTtcblx0XHRcdH1cblxuXHRcdFx0aSArPSBkaWdpdCAqIHc7XG5cdFx0XHR2YXIgdCA9IGsgPD0gYmlhcyA/IHRNaW4gOiBrID49IGJpYXMgKyB0TWF4ID8gdE1heCA6IGsgLSBiaWFzO1xuXG5cdFx0XHRpZiAoZGlnaXQgPCB0KSB7XG5cdFx0XHRcdGJyZWFrO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgYmFzZU1pbnVzVCA9IGJhc2UgLSB0O1xuXHRcdFx0aWYgKHcgPiBmbG9vcihtYXhJbnQgLyBiYXNlTWludXNUKSkge1xuXHRcdFx0XHRlcnJvciQxKCdvdmVyZmxvdycpO1xuXHRcdFx0fVxuXG5cdFx0XHR3ICo9IGJhc2VNaW51c1Q7XG5cdFx0fVxuXG5cdFx0dmFyIG91dCA9IG91dHB1dC5sZW5ndGggKyAxO1xuXHRcdGJpYXMgPSBhZGFwdChpIC0gb2xkaSwgb3V0LCBvbGRpID09IDApO1xuXG5cdFx0Ly8gYGlgIHdhcyBzdXBwb3NlZCB0byB3cmFwIGFyb3VuZCBmcm9tIGBvdXRgIHRvIGAwYCxcblx0XHQvLyBpbmNyZW1lbnRpbmcgYG5gIGVhY2ggdGltZSwgc28gd2UnbGwgZml4IHRoYXQgbm93OlxuXHRcdGlmIChmbG9vcihpIC8gb3V0KSA+IG1heEludCAtIG4pIHtcblx0XHRcdGVycm9yJDEoJ292ZXJmbG93Jyk7XG5cdFx0fVxuXG5cdFx0biArPSBmbG9vcihpIC8gb3V0KTtcblx0XHRpICU9IG91dDtcblxuXHRcdC8vIEluc2VydCBgbmAgYXQgcG9zaXRpb24gYGlgIG9mIHRoZSBvdXRwdXQuXG5cdFx0b3V0cHV0LnNwbGljZShpKyssIDAsIG4pO1xuXHR9XG5cblx0cmV0dXJuIFN0cmluZy5mcm9tQ29kZVBvaW50LmFwcGx5KFN0cmluZywgb3V0cHV0KTtcbn07XG5cbi8qKlxuICogQ29udmVydHMgYSBzdHJpbmcgb2YgVW5pY29kZSBzeW1ib2xzIChlLmcuIGEgZG9tYWluIG5hbWUgbGFiZWwpIHRvIGFcbiAqIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMuXG4gKiBAbWVtYmVyT2YgcHVueWNvZGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgc3RyaW5nIG9mIFVuaWNvZGUgc3ltYm9scy5cbiAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSByZXN1bHRpbmcgUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scy5cbiAqL1xudmFyIGVuY29kZSA9IGZ1bmN0aW9uIGVuY29kZShpbnB1dCkge1xuXHR2YXIgb3V0cHV0ID0gW107XG5cblx0Ly8gQ29udmVydCB0aGUgaW5wdXQgaW4gVUNTLTIgdG8gYW4gYXJyYXkgb2YgVW5pY29kZSBjb2RlIHBvaW50cy5cblx0aW5wdXQgPSB1Y3MyZGVjb2RlKGlucHV0KTtcblxuXHQvLyBDYWNoZSB0aGUgbGVuZ3RoLlxuXHR2YXIgaW5wdXRMZW5ndGggPSBpbnB1dC5sZW5ndGg7XG5cblx0Ly8gSW5pdGlhbGl6ZSB0aGUgc3RhdGUuXG5cdHZhciBuID0gaW5pdGlhbE47XG5cdHZhciBkZWx0YSA9IDA7XG5cdHZhciBiaWFzID0gaW5pdGlhbEJpYXM7XG5cblx0Ly8gSGFuZGxlIHRoZSBiYXNpYyBjb2RlIHBvaW50cy5cblx0dmFyIF9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24gPSB0cnVlO1xuXHR2YXIgX2RpZEl0ZXJhdG9yRXJyb3IgPSBmYWxzZTtcblx0dmFyIF9pdGVyYXRvckVycm9yID0gdW5kZWZpbmVkO1xuXG5cdHRyeSB7XG5cdFx0Zm9yICh2YXIgX2l0ZXJhdG9yID0gaW5wdXRbU3ltYm9sLml0ZXJhdG9yXSgpLCBfc3RlcDsgIShfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uID0gKF9zdGVwID0gX2l0ZXJhdG9yLm5leHQoKSkuZG9uZSk7IF9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24gPSB0cnVlKSB7XG5cdFx0XHR2YXIgX2N1cnJlbnRWYWx1ZTIgPSBfc3RlcC52YWx1ZTtcblxuXHRcdFx0aWYgKF9jdXJyZW50VmFsdWUyIDwgMHg4MCkge1xuXHRcdFx0XHRvdXRwdXQucHVzaChzdHJpbmdGcm9tQ2hhckNvZGUoX2N1cnJlbnRWYWx1ZTIpKTtcblx0XHRcdH1cblx0XHR9XG5cdH0gY2F0Y2ggKGVycikge1xuXHRcdF9kaWRJdGVyYXRvckVycm9yID0gdHJ1ZTtcblx0XHRfaXRlcmF0b3JFcnJvciA9IGVycjtcblx0fSBmaW5hbGx5IHtcblx0XHR0cnkge1xuXHRcdFx0aWYgKCFfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uICYmIF9pdGVyYXRvci5yZXR1cm4pIHtcblx0XHRcdFx0X2l0ZXJhdG9yLnJldHVybigpO1xuXHRcdFx0fVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRpZiAoX2RpZEl0ZXJhdG9yRXJyb3IpIHtcblx0XHRcdFx0dGhyb3cgX2l0ZXJhdG9yRXJyb3I7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0dmFyIGJhc2ljTGVuZ3RoID0gb3V0cHV0Lmxlbmd0aDtcblx0dmFyIGhhbmRsZWRDUENvdW50ID0gYmFzaWNMZW5ndGg7XG5cblx0Ly8gYGhhbmRsZWRDUENvdW50YCBpcyB0aGUgbnVtYmVyIG9mIGNvZGUgcG9pbnRzIHRoYXQgaGF2ZSBiZWVuIGhhbmRsZWQ7XG5cdC8vIGBiYXNpY0xlbmd0aGAgaXMgdGhlIG51bWJlciBvZiBiYXNpYyBjb2RlIHBvaW50cy5cblxuXHQvLyBGaW5pc2ggdGhlIGJhc2ljIHN0cmluZyB3aXRoIGEgZGVsaW1pdGVyIHVubGVzcyBpdCdzIGVtcHR5LlxuXHRpZiAoYmFzaWNMZW5ndGgpIHtcblx0XHRvdXRwdXQucHVzaChkZWxpbWl0ZXIpO1xuXHR9XG5cblx0Ly8gTWFpbiBlbmNvZGluZyBsb29wOlxuXHR3aGlsZSAoaGFuZGxlZENQQ291bnQgPCBpbnB1dExlbmd0aCkge1xuXG5cdFx0Ly8gQWxsIG5vbi1iYXNpYyBjb2RlIHBvaW50cyA8IG4gaGF2ZSBiZWVuIGhhbmRsZWQgYWxyZWFkeS4gRmluZCB0aGUgbmV4dFxuXHRcdC8vIGxhcmdlciBvbmU6XG5cdFx0dmFyIG0gPSBtYXhJbnQ7XG5cdFx0dmFyIF9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24yID0gdHJ1ZTtcblx0XHR2YXIgX2RpZEl0ZXJhdG9yRXJyb3IyID0gZmFsc2U7XG5cdFx0dmFyIF9pdGVyYXRvckVycm9yMiA9IHVuZGVmaW5lZDtcblxuXHRcdHRyeSB7XG5cdFx0XHRmb3IgKHZhciBfaXRlcmF0b3IyID0gaW5wdXRbU3ltYm9sLml0ZXJhdG9yXSgpLCBfc3RlcDI7ICEoX2l0ZXJhdG9yTm9ybWFsQ29tcGxldGlvbjIgPSAoX3N0ZXAyID0gX2l0ZXJhdG9yMi5uZXh0KCkpLmRvbmUpOyBfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uMiA9IHRydWUpIHtcblx0XHRcdFx0dmFyIGN1cnJlbnRWYWx1ZSA9IF9zdGVwMi52YWx1ZTtcblxuXHRcdFx0XHRpZiAoY3VycmVudFZhbHVlID49IG4gJiYgY3VycmVudFZhbHVlIDwgbSkge1xuXHRcdFx0XHRcdG0gPSBjdXJyZW50VmFsdWU7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0Ly8gSW5jcmVhc2UgYGRlbHRhYCBlbm91Z2ggdG8gYWR2YW5jZSB0aGUgZGVjb2RlcidzIDxuLGk+IHN0YXRlIHRvIDxtLDA+LFxuXHRcdFx0Ly8gYnV0IGd1YXJkIGFnYWluc3Qgb3ZlcmZsb3cuXG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHRfZGlkSXRlcmF0b3JFcnJvcjIgPSB0cnVlO1xuXHRcdFx0X2l0ZXJhdG9yRXJyb3IyID0gZXJyO1xuXHRcdH0gZmluYWxseSB7XG5cdFx0XHR0cnkge1xuXHRcdFx0XHRpZiAoIV9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24yICYmIF9pdGVyYXRvcjIucmV0dXJuKSB7XG5cdFx0XHRcdFx0X2l0ZXJhdG9yMi5yZXR1cm4oKTtcblx0XHRcdFx0fVxuXHRcdFx0fSBmaW5hbGx5IHtcblx0XHRcdFx0aWYgKF9kaWRJdGVyYXRvckVycm9yMikge1xuXHRcdFx0XHRcdHRocm93IF9pdGVyYXRvckVycm9yMjtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHZhciBoYW5kbGVkQ1BDb3VudFBsdXNPbmUgPSBoYW5kbGVkQ1BDb3VudCArIDE7XG5cdFx0aWYgKG0gLSBuID4gZmxvb3IoKG1heEludCAtIGRlbHRhKSAvIGhhbmRsZWRDUENvdW50UGx1c09uZSkpIHtcblx0XHRcdGVycm9yJDEoJ292ZXJmbG93Jyk7XG5cdFx0fVxuXG5cdFx0ZGVsdGEgKz0gKG0gLSBuKSAqIGhhbmRsZWRDUENvdW50UGx1c09uZTtcblx0XHRuID0gbTtcblxuXHRcdHZhciBfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uMyA9IHRydWU7XG5cdFx0dmFyIF9kaWRJdGVyYXRvckVycm9yMyA9IGZhbHNlO1xuXHRcdHZhciBfaXRlcmF0b3JFcnJvcjMgPSB1bmRlZmluZWQ7XG5cblx0XHR0cnkge1xuXHRcdFx0Zm9yICh2YXIgX2l0ZXJhdG9yMyA9IGlucHV0W1N5bWJvbC5pdGVyYXRvcl0oKSwgX3N0ZXAzOyAhKF9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24zID0gKF9zdGVwMyA9IF9pdGVyYXRvcjMubmV4dCgpKS5kb25lKTsgX2l0ZXJhdG9yTm9ybWFsQ29tcGxldGlvbjMgPSB0cnVlKSB7XG5cdFx0XHRcdHZhciBfY3VycmVudFZhbHVlID0gX3N0ZXAzLnZhbHVlO1xuXG5cdFx0XHRcdGlmIChfY3VycmVudFZhbHVlIDwgbiAmJiArK2RlbHRhID4gbWF4SW50KSB7XG5cdFx0XHRcdFx0ZXJyb3IkMSgnb3ZlcmZsb3cnKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAoX2N1cnJlbnRWYWx1ZSA9PSBuKSB7XG5cdFx0XHRcdFx0Ly8gUmVwcmVzZW50IGRlbHRhIGFzIGEgZ2VuZXJhbGl6ZWQgdmFyaWFibGUtbGVuZ3RoIGludGVnZXIuXG5cdFx0XHRcdFx0dmFyIHEgPSBkZWx0YTtcblx0XHRcdFx0XHRmb3IgKHZhciBrID0gYmFzZTs7IC8qIG5vIGNvbmRpdGlvbiAqL2sgKz0gYmFzZSkge1xuXHRcdFx0XHRcdFx0dmFyIHQgPSBrIDw9IGJpYXMgPyB0TWluIDogayA+PSBiaWFzICsgdE1heCA/IHRNYXggOiBrIC0gYmlhcztcblx0XHRcdFx0XHRcdGlmIChxIDwgdCkge1xuXHRcdFx0XHRcdFx0XHRicmVhaztcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdHZhciBxTWludXNUID0gcSAtIHQ7XG5cdFx0XHRcdFx0XHR2YXIgYmFzZU1pbnVzVCA9IGJhc2UgLSB0O1xuXHRcdFx0XHRcdFx0b3V0cHV0LnB1c2goc3RyaW5nRnJvbUNoYXJDb2RlKGRpZ2l0VG9CYXNpYyh0ICsgcU1pbnVzVCAlIGJhc2VNaW51c1QsIDApKSk7XG5cdFx0XHRcdFx0XHRxID0gZmxvb3IocU1pbnVzVCAvIGJhc2VNaW51c1QpO1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdG91dHB1dC5wdXNoKHN0cmluZ0Zyb21DaGFyQ29kZShkaWdpdFRvQmFzaWMocSwgMCkpKTtcblx0XHRcdFx0XHRiaWFzID0gYWRhcHQoZGVsdGEsIGhhbmRsZWRDUENvdW50UGx1c09uZSwgaGFuZGxlZENQQ291bnQgPT0gYmFzaWNMZW5ndGgpO1xuXHRcdFx0XHRcdGRlbHRhID0gMDtcblx0XHRcdFx0XHQrK2hhbmRsZWRDUENvdW50O1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHRfZGlkSXRlcmF0b3JFcnJvcjMgPSB0cnVlO1xuXHRcdFx0X2l0ZXJhdG9yRXJyb3IzID0gZXJyO1xuXHRcdH0gZmluYWxseSB7XG5cdFx0XHR0cnkge1xuXHRcdFx0XHRpZiAoIV9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24zICYmIF9pdGVyYXRvcjMucmV0dXJuKSB7XG5cdFx0XHRcdFx0X2l0ZXJhdG9yMy5yZXR1cm4oKTtcblx0XHRcdFx0fVxuXHRcdFx0fSBmaW5hbGx5IHtcblx0XHRcdFx0aWYgKF9kaWRJdGVyYXRvckVycm9yMykge1xuXHRcdFx0XHRcdHRocm93IF9pdGVyYXRvckVycm9yMztcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdCsrZGVsdGE7XG5cdFx0KytuO1xuXHR9XG5cdHJldHVybiBvdXRwdXQuam9pbignJyk7XG59O1xuXG4vKipcbiAqIENvbnZlcnRzIGEgUHVueWNvZGUgc3RyaW5nIHJlcHJlc2VudGluZyBhIGRvbWFpbiBuYW1lIG9yIGFuIGVtYWlsIGFkZHJlc3NcbiAqIHRvIFVuaWNvZGUuIE9ubHkgdGhlIFB1bnljb2RlZCBwYXJ0cyBvZiB0aGUgaW5wdXQgd2lsbCBiZSBjb252ZXJ0ZWQsIGkuZS5cbiAqIGl0IGRvZXNuJ3QgbWF0dGVyIGlmIHlvdSBjYWxsIGl0IG9uIGEgc3RyaW5nIHRoYXQgaGFzIGFscmVhZHkgYmVlblxuICogY29udmVydGVkIHRvIFVuaWNvZGUuXG4gKiBAbWVtYmVyT2YgcHVueWNvZGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgUHVueWNvZGVkIGRvbWFpbiBuYW1lIG9yIGVtYWlsIGFkZHJlc3MgdG9cbiAqIGNvbnZlcnQgdG8gVW5pY29kZS5cbiAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBVbmljb2RlIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBnaXZlbiBQdW55Y29kZVxuICogc3RyaW5nLlxuICovXG52YXIgdG9Vbmljb2RlID0gZnVuY3Rpb24gdG9Vbmljb2RlKGlucHV0KSB7XG5cdHJldHVybiBtYXBEb21haW4oaW5wdXQsIGZ1bmN0aW9uIChzdHJpbmcpIHtcblx0XHRyZXR1cm4gcmVnZXhQdW55Y29kZS50ZXN0KHN0cmluZykgPyBkZWNvZGUoc3RyaW5nLnNsaWNlKDQpLnRvTG93ZXJDYXNlKCkpIDogc3RyaW5nO1xuXHR9KTtcbn07XG5cbi8qKlxuICogQ29udmVydHMgYSBVbmljb2RlIHN0cmluZyByZXByZXNlbnRpbmcgYSBkb21haW4gbmFtZSBvciBhbiBlbWFpbCBhZGRyZXNzIHRvXG4gKiBQdW55Y29kZS4gT25seSB0aGUgbm9uLUFTQ0lJIHBhcnRzIG9mIHRoZSBkb21haW4gbmFtZSB3aWxsIGJlIGNvbnZlcnRlZCxcbiAqIGkuZS4gaXQgZG9lc24ndCBtYXR0ZXIgaWYgeW91IGNhbGwgaXQgd2l0aCBhIGRvbWFpbiB0aGF0J3MgYWxyZWFkeSBpblxuICogQVNDSUkuXG4gKiBAbWVtYmVyT2YgcHVueWNvZGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgZG9tYWluIG5hbWUgb3IgZW1haWwgYWRkcmVzcyB0byBjb252ZXJ0LCBhcyBhXG4gKiBVbmljb2RlIHN0cmluZy5cbiAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBQdW55Y29kZSByZXByZXNlbnRhdGlvbiBvZiB0aGUgZ2l2ZW4gZG9tYWluIG5hbWUgb3JcbiAqIGVtYWlsIGFkZHJlc3MuXG4gKi9cbnZhciB0b0FTQ0lJID0gZnVuY3Rpb24gdG9BU0NJSShpbnB1dCkge1xuXHRyZXR1cm4gbWFwRG9tYWluKGlucHV0LCBmdW5jdGlvbiAoc3RyaW5nKSB7XG5cdFx0cmV0dXJuIHJlZ2V4Tm9uQVNDSUkudGVzdChzdHJpbmcpID8gJ3huLS0nICsgZW5jb2RlKHN0cmluZykgOiBzdHJpbmc7XG5cdH0pO1xufTtcblxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXG5cbi8qKiBEZWZpbmUgdGhlIHB1YmxpYyBBUEkgKi9cbnZhciBwdW55Y29kZSA9IHtcblx0LyoqXG4gICogQSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBjdXJyZW50IFB1bnljb2RlLmpzIHZlcnNpb24gbnVtYmVyLlxuICAqIEBtZW1iZXJPZiBwdW55Y29kZVxuICAqIEB0eXBlIFN0cmluZ1xuICAqL1xuXHQndmVyc2lvbic6ICcyLjEuMCcsXG5cdC8qKlxuICAqIEFuIG9iamVjdCBvZiBtZXRob2RzIHRvIGNvbnZlcnQgZnJvbSBKYXZhU2NyaXB0J3MgaW50ZXJuYWwgY2hhcmFjdGVyXG4gICogcmVwcmVzZW50YXRpb24gKFVDUy0yKSB0byBVbmljb2RlIGNvZGUgcG9pbnRzLCBhbmQgYmFjay5cbiAgKiBAc2VlIDxodHRwczovL21hdGhpYXNieW5lbnMuYmUvbm90ZXMvamF2YXNjcmlwdC1lbmNvZGluZz5cbiAgKiBAbWVtYmVyT2YgcHVueWNvZGVcbiAgKiBAdHlwZSBPYmplY3RcbiAgKi9cblx0J3VjczInOiB7XG5cdFx0J2RlY29kZSc6IHVjczJkZWNvZGUsXG5cdFx0J2VuY29kZSc6IHVjczJlbmNvZGVcblx0fSxcblx0J2RlY29kZSc6IGRlY29kZSxcblx0J2VuY29kZSc6IGVuY29kZSxcblx0J3RvQVNDSUknOiB0b0FTQ0lJLFxuXHQndG9Vbmljb2RlJzogdG9Vbmljb2RlXG59O1xuXG4vKipcclxuICogVVJJLmpzXHJcbiAqXHJcbiAqIEBmaWxlb3ZlcnZpZXcgQW4gUkZDIDM5ODYgY29tcGxpYW50LCBzY2hlbWUgZXh0ZW5kYWJsZSBVUkkgcGFyc2luZy92YWxpZGF0aW5nL3Jlc29sdmluZyBsaWJyYXJ5IGZvciBKYXZhU2NyaXB0LlxyXG4gKiBAYXV0aG9yIDxhIGhyZWY9XCJtYWlsdG86Z2FyeS5jb3VydEBnbWFpbC5jb21cIj5HYXJ5IENvdXJ0PC9hPlxyXG4gKiBAc2VlIGh0dHA6Ly9naXRodWIuY29tL2dhcnljb3VydC91cmktanNcclxuICovXG4vKipcclxuICogQ29weXJpZ2h0IDIwMTEgR2FyeSBDb3VydC4gQWxsIHJpZ2h0cyByZXNlcnZlZC5cclxuICpcclxuICogUmVkaXN0cmlidXRpb24gYW5kIHVzZSBpbiBzb3VyY2UgYW5kIGJpbmFyeSBmb3Jtcywgd2l0aCBvciB3aXRob3V0IG1vZGlmaWNhdGlvbiwgYXJlXHJcbiAqIHBlcm1pdHRlZCBwcm92aWRlZCB0aGF0IHRoZSBmb2xsb3dpbmcgY29uZGl0aW9ucyBhcmUgbWV0OlxyXG4gKlxyXG4gKiAgICAxLiBSZWRpc3RyaWJ1dGlvbnMgb2Ygc291cmNlIGNvZGUgbXVzdCByZXRhaW4gdGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UsIHRoaXMgbGlzdCBvZlxyXG4gKiAgICAgICBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIuXHJcbiAqXHJcbiAqICAgIDIuIFJlZGlzdHJpYnV0aW9ucyBpbiBiaW5hcnkgZm9ybSBtdXN0IHJlcHJvZHVjZSB0aGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSwgdGhpcyBsaXN0XHJcbiAqICAgICAgIG9mIGNvbmRpdGlvbnMgYW5kIHRoZSBmb2xsb3dpbmcgZGlzY2xhaW1lciBpbiB0aGUgZG9jdW1lbnRhdGlvbiBhbmQvb3Igb3RoZXIgbWF0ZXJpYWxzXHJcbiAqICAgICAgIHByb3ZpZGVkIHdpdGggdGhlIGRpc3RyaWJ1dGlvbi5cclxuICpcclxuICogVEhJUyBTT0ZUV0FSRSBJUyBQUk9WSURFRCBCWSBHQVJZIENPVVJUIGBgQVMgSVMnJyBBTkQgQU5ZIEVYUFJFU1MgT1IgSU1QTElFRFxyXG4gKiBXQVJSQU5USUVTLCBJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgVEhFIElNUExJRUQgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFkgQU5EXHJcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFSRSBESVNDTEFJTUVELiBJTiBOTyBFVkVOVCBTSEFMTCBHQVJZIENPVVJUIE9SXHJcbiAqIENPTlRSSUJVVE9SUyBCRSBMSUFCTEUgRk9SIEFOWSBESVJFQ1QsIElORElSRUNULCBJTkNJREVOVEFMLCBTUEVDSUFMLCBFWEVNUExBUlksIE9SXHJcbiAqIENPTlNFUVVFTlRJQUwgREFNQUdFUyAoSU5DTFVESU5HLCBCVVQgTk9UIExJTUlURUQgVE8sIFBST0NVUkVNRU5UIE9GIFNVQlNUSVRVVEUgR09PRFMgT1JcclxuICogU0VSVklDRVM7IExPU1MgT0YgVVNFLCBEQVRBLCBPUiBQUk9GSVRTOyBPUiBCVVNJTkVTUyBJTlRFUlJVUFRJT04pIEhPV0VWRVIgQ0FVU0VEIEFORCBPTlxyXG4gKiBBTlkgVEhFT1JZIE9GIExJQUJJTElUWSwgV0hFVEhFUiBJTiBDT05UUkFDVCwgU1RSSUNUIExJQUJJTElUWSwgT1IgVE9SVCAoSU5DTFVESU5HXHJcbiAqIE5FR0xJR0VOQ0UgT1IgT1RIRVJXSVNFKSBBUklTSU5HIElOIEFOWSBXQVkgT1VUIE9GIFRIRSBVU0UgT0YgVEhJUyBTT0ZUV0FSRSwgRVZFTiBJRlxyXG4gKiBBRFZJU0VEIE9GIFRIRSBQT1NTSUJJTElUWSBPRiBTVUNIIERBTUFHRS5cclxuICpcclxuICogVGhlIHZpZXdzIGFuZCBjb25jbHVzaW9ucyBjb250YWluZWQgaW4gdGhlIHNvZnR3YXJlIGFuZCBkb2N1bWVudGF0aW9uIGFyZSB0aG9zZSBvZiB0aGVcclxuICogYXV0aG9ycyBhbmQgc2hvdWxkIG5vdCBiZSBpbnRlcnByZXRlZCBhcyByZXByZXNlbnRpbmcgb2ZmaWNpYWwgcG9saWNpZXMsIGVpdGhlciBleHByZXNzZWRcclxuICogb3IgaW1wbGllZCwgb2YgR2FyeSBDb3VydC5cclxuICovXG52YXIgU0NIRU1FUyA9IHt9O1xuZnVuY3Rpb24gcGN0RW5jQ2hhcihjaHIpIHtcbiAgICB2YXIgYyA9IGNoci5jaGFyQ29kZUF0KDApO1xuICAgIHZhciBlID0gdm9pZCAwO1xuICAgIGlmIChjIDwgMTYpIGUgPSBcIiUwXCIgKyBjLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpO2Vsc2UgaWYgKGMgPCAxMjgpIGUgPSBcIiVcIiArIGMudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7ZWxzZSBpZiAoYyA8IDIwNDgpIGUgPSBcIiVcIiArIChjID4+IDYgfCAxOTIpLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpICsgXCIlXCIgKyAoYyAmIDYzIHwgMTI4KS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKTtlbHNlIGUgPSBcIiVcIiArIChjID4+IDEyIHwgMjI0KS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKSArIFwiJVwiICsgKGMgPj4gNiAmIDYzIHwgMTI4KS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKSArIFwiJVwiICsgKGMgJiA2MyB8IDEyOCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7XG4gICAgcmV0dXJuIGU7XG59XG5mdW5jdGlvbiBwY3REZWNDaGFycyhzdHIpIHtcbiAgICB2YXIgbmV3U3RyID0gXCJcIjtcbiAgICB2YXIgaSA9IDA7XG4gICAgdmFyIGlsID0gc3RyLmxlbmd0aDtcbiAgICB3aGlsZSAoaSA8IGlsKSB7XG4gICAgICAgIHZhciBjID0gcGFyc2VJbnQoc3RyLnN1YnN0cihpICsgMSwgMiksIDE2KTtcbiAgICAgICAgaWYgKGMgPCAxMjgpIHtcbiAgICAgICAgICAgIG5ld1N0ciArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMpO1xuICAgICAgICAgICAgaSArPSAzO1xuICAgICAgICB9IGVsc2UgaWYgKGMgPj0gMTk0ICYmIGMgPCAyMjQpIHtcbiAgICAgICAgICAgIGlmIChpbCAtIGkgPj0gNikge1xuICAgICAgICAgICAgICAgIHZhciBjMiA9IHBhcnNlSW50KHN0ci5zdWJzdHIoaSArIDQsIDIpLCAxNik7XG4gICAgICAgICAgICAgICAgbmV3U3RyICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoKGMgJiAzMSkgPDwgNiB8IGMyICYgNjMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBuZXdTdHIgKz0gc3RyLnN1YnN0cihpLCA2KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGkgKz0gNjtcbiAgICAgICAgfSBlbHNlIGlmIChjID49IDIyNCkge1xuICAgICAgICAgICAgaWYgKGlsIC0gaSA+PSA5KSB7XG4gICAgICAgICAgICAgICAgdmFyIF9jID0gcGFyc2VJbnQoc3RyLnN1YnN0cihpICsgNCwgMiksIDE2KTtcbiAgICAgICAgICAgICAgICB2YXIgYzMgPSBwYXJzZUludChzdHIuc3Vic3RyKGkgKyA3LCAyKSwgMTYpO1xuICAgICAgICAgICAgICAgIG5ld1N0ciArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKChjICYgMTUpIDw8IDEyIHwgKF9jICYgNjMpIDw8IDYgfCBjMyAmIDYzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbmV3U3RyICs9IHN0ci5zdWJzdHIoaSwgOSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpICs9IDk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXdTdHIgKz0gc3RyLnN1YnN0cihpLCAzKTtcbiAgICAgICAgICAgIGkgKz0gMztcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbmV3U3RyO1xufVxuZnVuY3Rpb24gX25vcm1hbGl6ZUNvbXBvbmVudEVuY29kaW5nKGNvbXBvbmVudHMsIHByb3RvY29sKSB7XG4gICAgZnVuY3Rpb24gZGVjb2RlVW5yZXNlcnZlZChzdHIpIHtcbiAgICAgICAgdmFyIGRlY1N0ciA9IHBjdERlY0NoYXJzKHN0cik7XG4gICAgICAgIHJldHVybiAhZGVjU3RyLm1hdGNoKHByb3RvY29sLlVOUkVTRVJWRUQpID8gc3RyIDogZGVjU3RyO1xuICAgIH1cbiAgICBpZiAoY29tcG9uZW50cy5zY2hlbWUpIGNvbXBvbmVudHMuc2NoZW1lID0gU3RyaW5nKGNvbXBvbmVudHMuc2NoZW1lKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UocHJvdG9jb2wuTk9UX1NDSEVNRSwgXCJcIik7XG4gICAgaWYgKGNvbXBvbmVudHMudXNlcmluZm8gIT09IHVuZGVmaW5lZCkgY29tcG9uZW50cy51c2VyaW5mbyA9IFN0cmluZyhjb21wb25lbnRzLnVzZXJpbmZvKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS5yZXBsYWNlKHByb3RvY29sLk5PVF9VU0VSSU5GTywgcGN0RW5jQ2hhcikucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpO1xuICAgIGlmIChjb21wb25lbnRzLmhvc3QgIT09IHVuZGVmaW5lZCkgY29tcG9uZW50cy5ob3N0ID0gU3RyaW5nKGNvbXBvbmVudHMuaG9zdCkucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKHByb3RvY29sLk5PVF9IT1NULCBwY3RFbmNDaGFyKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSk7XG4gICAgaWYgKGNvbXBvbmVudHMucGF0aCAhPT0gdW5kZWZpbmVkKSBjb21wb25lbnRzLnBhdGggPSBTdHJpbmcoY29tcG9uZW50cy5wYXRoKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS5yZXBsYWNlKGNvbXBvbmVudHMuc2NoZW1lID8gcHJvdG9jb2wuTk9UX1BBVEggOiBwcm90b2NvbC5OT1RfUEFUSF9OT1NDSEVNRSwgcGN0RW5jQ2hhcikucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpO1xuICAgIGlmIChjb21wb25lbnRzLnF1ZXJ5ICE9PSB1bmRlZmluZWQpIGNvbXBvbmVudHMucXVlcnkgPSBTdHJpbmcoY29tcG9uZW50cy5xdWVyeSkucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkucmVwbGFjZShwcm90b2NvbC5OT1RfUVVFUlksIHBjdEVuY0NoYXIpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKTtcbiAgICBpZiAoY29tcG9uZW50cy5mcmFnbWVudCAhPT0gdW5kZWZpbmVkKSBjb21wb25lbnRzLmZyYWdtZW50ID0gU3RyaW5nKGNvbXBvbmVudHMuZnJhZ21lbnQpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UocHJvdG9jb2wuTk9UX0ZSQUdNRU5ULCBwY3RFbmNDaGFyKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSk7XG4gICAgcmV0dXJuIGNvbXBvbmVudHM7XG59XG5cbnZhciBVUklfUEFSU0UgPSAvXig/OihbXjpcXC8/I10rKTopPyg/OlxcL1xcLygoPzooW15cXC8/I0BdKilAKT8oXFxbW1xcZEEtRjouXStcXF18W15cXC8/IzpdKikoPzpcXDooXFxkKikpPykpPyhbXj8jXSopKD86XFw/KFteI10qKSk/KD86IygoPzoufFxcbnxcXHIpKikpPy9pO1xudmFyIE5PX01BVENIX0lTX1VOREVGSU5FRCA9IFwiXCIubWF0Y2goLygpezB9LylbMV0gPT09IHVuZGVmaW5lZDtcbmZ1bmN0aW9uIHBhcnNlKHVyaVN0cmluZykge1xuICAgIHZhciBvcHRpb25zID0gYXJndW1lbnRzLmxlbmd0aCA+IDEgJiYgYXJndW1lbnRzWzFdICE9PSB1bmRlZmluZWQgPyBhcmd1bWVudHNbMV0gOiB7fTtcblxuICAgIHZhciBjb21wb25lbnRzID0ge307XG4gICAgdmFyIHByb3RvY29sID0gb3B0aW9ucy5pcmkgIT09IGZhbHNlID8gSVJJX1BST1RPQ09MIDogVVJJX1BST1RPQ09MO1xuICAgIGlmIChvcHRpb25zLnJlZmVyZW5jZSA9PT0gXCJzdWZmaXhcIikgdXJpU3RyaW5nID0gKG9wdGlvbnMuc2NoZW1lID8gb3B0aW9ucy5zY2hlbWUgKyBcIjpcIiA6IFwiXCIpICsgXCIvL1wiICsgdXJpU3RyaW5nO1xuICAgIHZhciBtYXRjaGVzID0gdXJpU3RyaW5nLm1hdGNoKFVSSV9QQVJTRSk7XG4gICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgaWYgKE5PX01BVENIX0lTX1VOREVGSU5FRCkge1xuICAgICAgICAgICAgLy9zdG9yZSBlYWNoIGNvbXBvbmVudFxuICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBtYXRjaGVzWzFdO1xuICAgICAgICAgICAgY29tcG9uZW50cy51c2VyaW5mbyA9IG1hdGNoZXNbM107XG4gICAgICAgICAgICBjb21wb25lbnRzLmhvc3QgPSBtYXRjaGVzWzRdO1xuICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gcGFyc2VJbnQobWF0Y2hlc1s1XSwgMTApO1xuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gbWF0Y2hlc1s2XSB8fCBcIlwiO1xuICAgICAgICAgICAgY29tcG9uZW50cy5xdWVyeSA9IG1hdGNoZXNbN107XG4gICAgICAgICAgICBjb21wb25lbnRzLmZyYWdtZW50ID0gbWF0Y2hlc1s4XTtcbiAgICAgICAgICAgIC8vZml4IHBvcnQgbnVtYmVyXG4gICAgICAgICAgICBpZiAoaXNOYU4oY29tcG9uZW50cy5wb3J0KSkge1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMucG9ydCA9IG1hdGNoZXNbNV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvL3N0b3JlIGVhY2ggY29tcG9uZW50XG4gICAgICAgICAgICBjb21wb25lbnRzLnNjaGVtZSA9IG1hdGNoZXNbMV0gfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29tcG9uZW50cy51c2VyaW5mbyA9IHVyaVN0cmluZy5pbmRleE9mKFwiQFwiKSAhPT0gLTEgPyBtYXRjaGVzWzNdIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29tcG9uZW50cy5ob3N0ID0gdXJpU3RyaW5nLmluZGV4T2YoXCIvL1wiKSAhPT0gLTEgPyBtYXRjaGVzWzRdIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gcGFyc2VJbnQobWF0Y2hlc1s1XSwgMTApO1xuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gbWF0Y2hlc1s2XSB8fCBcIlwiO1xuICAgICAgICAgICAgY29tcG9uZW50cy5xdWVyeSA9IHVyaVN0cmluZy5pbmRleE9mKFwiP1wiKSAhPT0gLTEgPyBtYXRjaGVzWzddIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29tcG9uZW50cy5mcmFnbWVudCA9IHVyaVN0cmluZy5pbmRleE9mKFwiI1wiKSAhPT0gLTEgPyBtYXRjaGVzWzhdIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgLy9maXggcG9ydCBudW1iZXJcbiAgICAgICAgICAgIGlmIChpc05hTihjb21wb25lbnRzLnBvcnQpKSB7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gdXJpU3RyaW5nLm1hdGNoKC9cXC9cXC8oPzoufFxcbikqXFw6KD86XFwvfFxcP3xcXCN8JCkvKSA/IG1hdGNoZXNbNF0gOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy9zdHJpcCBicmFja2V0cyBmcm9tIElQdjYgaG9zdHNcbiAgICAgICAgaWYgKGNvbXBvbmVudHMuaG9zdCkge1xuICAgICAgICAgICAgY29tcG9uZW50cy5ob3N0ID0gY29tcG9uZW50cy5ob3N0LnJlcGxhY2UocHJvdG9jb2wuSVBWNkFERFJFU1MsIFwiJDFcIik7XG4gICAgICAgIH1cbiAgICAgICAgLy9kZXRlcm1pbmUgcmVmZXJlbmNlIHR5cGVcbiAgICAgICAgaWYgKGNvbXBvbmVudHMuc2NoZW1lID09PSB1bmRlZmluZWQgJiYgY29tcG9uZW50cy51c2VyaW5mbyA9PT0gdW5kZWZpbmVkICYmIGNvbXBvbmVudHMuaG9zdCA9PT0gdW5kZWZpbmVkICYmIGNvbXBvbmVudHMucG9ydCA9PT0gdW5kZWZpbmVkICYmICFjb21wb25lbnRzLnBhdGggJiYgY29tcG9uZW50cy5xdWVyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLnJlZmVyZW5jZSA9IFwic2FtZS1kb2N1bWVudFwiO1xuICAgICAgICB9IGVsc2UgaWYgKGNvbXBvbmVudHMuc2NoZW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucmVmZXJlbmNlID0gXCJyZWxhdGl2ZVwiO1xuICAgICAgICB9IGVsc2UgaWYgKGNvbXBvbmVudHMuZnJhZ21lbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29tcG9uZW50cy5yZWZlcmVuY2UgPSBcImFic29sdXRlXCI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLnJlZmVyZW5jZSA9IFwidXJpXCI7XG4gICAgICAgIH1cbiAgICAgICAgLy9jaGVjayBmb3IgcmVmZXJlbmNlIGVycm9yc1xuICAgICAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgJiYgb3B0aW9ucy5yZWZlcmVuY2UgIT09IFwic3VmZml4XCIgJiYgb3B0aW9ucy5yZWZlcmVuY2UgIT09IGNvbXBvbmVudHMucmVmZXJlbmNlKSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVSSSBpcyBub3QgYSBcIiArIG9wdGlvbnMucmVmZXJlbmNlICsgXCIgcmVmZXJlbmNlLlwiO1xuICAgICAgICB9XG4gICAgICAgIC8vZmluZCBzY2hlbWUgaGFuZGxlclxuICAgICAgICB2YXIgc2NoZW1lSGFuZGxlciA9IFNDSEVNRVNbKG9wdGlvbnMuc2NoZW1lIHx8IGNvbXBvbmVudHMuc2NoZW1lIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCldO1xuICAgICAgICAvL2NoZWNrIGlmIHNjaGVtZSBjYW4ndCBoYW5kbGUgSVJJc1xuICAgICAgICBpZiAoIW9wdGlvbnMudW5pY29kZVN1cHBvcnQgJiYgKCFzY2hlbWVIYW5kbGVyIHx8ICFzY2hlbWVIYW5kbGVyLnVuaWNvZGVTdXBwb3J0KSkge1xuICAgICAgICAgICAgLy9pZiBob3N0IGNvbXBvbmVudCBpcyBhIGRvbWFpbiBuYW1lXG4gICAgICAgICAgICBpZiAoY29tcG9uZW50cy5ob3N0ICYmIChvcHRpb25zLmRvbWFpbkhvc3QgfHwgc2NoZW1lSGFuZGxlciAmJiBzY2hlbWVIYW5kbGVyLmRvbWFpbkhvc3QpKSB7XG4gICAgICAgICAgICAgICAgLy9jb252ZXJ0IFVuaWNvZGUgSUROIC0+IEFTQ0lJIElETlxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuaG9zdCA9IHB1bnljb2RlLnRvQVNDSUkoY29tcG9uZW50cy5ob3N0LnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHBjdERlY0NoYXJzKS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiSG9zdCdzIGRvbWFpbiBuYW1lIGNhbiBub3QgYmUgY29udmVydGVkIHRvIEFTQ0lJIHZpYSBwdW55Y29kZTogXCIgKyBlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vY29udmVydCBJUkkgLT4gVVJJXG4gICAgICAgICAgICBfbm9ybWFsaXplQ29tcG9uZW50RW5jb2RpbmcoY29tcG9uZW50cywgVVJJX1BST1RPQ09MKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vbm9ybWFsaXplIGVuY29kaW5nc1xuICAgICAgICAgICAgX25vcm1hbGl6ZUNvbXBvbmVudEVuY29kaW5nKGNvbXBvbmVudHMsIHByb3RvY29sKTtcbiAgICAgICAgfVxuICAgICAgICAvL3BlcmZvcm0gc2NoZW1lIHNwZWNpZmljIHBhcnNpbmdcbiAgICAgICAgaWYgKHNjaGVtZUhhbmRsZXIgJiYgc2NoZW1lSGFuZGxlci5wYXJzZSkge1xuICAgICAgICAgICAgc2NoZW1lSGFuZGxlci5wYXJzZShjb21wb25lbnRzLCBvcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiVVJJIGNhbiBub3QgYmUgcGFyc2VkLlwiO1xuICAgIH1cbiAgICByZXR1cm4gY29tcG9uZW50cztcbn1cblxuZnVuY3Rpb24gX3JlY29tcG9zZUF1dGhvcml0eShjb21wb25lbnRzLCBvcHRpb25zKSB7XG4gICAgdmFyIHByb3RvY29sID0gb3B0aW9ucy5pcmkgIT09IGZhbHNlID8gSVJJX1BST1RPQ09MIDogVVJJX1BST1RPQ09MO1xuICAgIHZhciB1cmlUb2tlbnMgPSBbXTtcbiAgICBpZiAoY29tcG9uZW50cy51c2VyaW5mbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMudXNlcmluZm8pO1xuICAgICAgICB1cmlUb2tlbnMucHVzaChcIkBcIik7XG4gICAgfVxuICAgIGlmIChjb21wb25lbnRzLmhvc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvL2Vuc3VyZSBJUHY2IGFkZHJlc3NlcyBhcmUgYnJhY2tldGVkXG4gICAgICAgIHVyaVRva2Vucy5wdXNoKFN0cmluZyhjb21wb25lbnRzLmhvc3QpLnJlcGxhY2UocHJvdG9jb2wuSVBWNkFERFJFU1MsIFwiWyQxXVwiKSk7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgY29tcG9uZW50cy5wb3J0ID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKFwiOlwiKTtcbiAgICAgICAgdXJpVG9rZW5zLnB1c2goY29tcG9uZW50cy5wb3J0LnRvU3RyaW5nKDEwKSk7XG4gICAgfVxuICAgIHJldHVybiB1cmlUb2tlbnMubGVuZ3RoID8gdXJpVG9rZW5zLmpvaW4oXCJcIikgOiB1bmRlZmluZWQ7XG59XG5cbnZhciBSRFMxID0gL15cXC5cXC4/XFwvLztcbnZhciBSRFMyID0gL15cXC9cXC4oXFwvfCQpLztcbnZhciBSRFMzID0gL15cXC9cXC5cXC4oXFwvfCQpLztcbnZhciBSRFM1ID0gL15cXC8/KD86LnxcXG4pKj8oPz1cXC98JCkvO1xuZnVuY3Rpb24gcmVtb3ZlRG90U2VnbWVudHMoaW5wdXQpIHtcbiAgICB2YXIgb3V0cHV0ID0gW107XG4gICAgd2hpbGUgKGlucHV0Lmxlbmd0aCkge1xuICAgICAgICBpZiAoaW5wdXQubWF0Y2goUkRTMSkpIHtcbiAgICAgICAgICAgIGlucHV0ID0gaW5wdXQucmVwbGFjZShSRFMxLCBcIlwiKTtcbiAgICAgICAgfSBlbHNlIGlmIChpbnB1dC5tYXRjaChSRFMyKSkge1xuICAgICAgICAgICAgaW5wdXQgPSBpbnB1dC5yZXBsYWNlKFJEUzIsIFwiL1wiKTtcbiAgICAgICAgfSBlbHNlIGlmIChpbnB1dC5tYXRjaChSRFMzKSkge1xuICAgICAgICAgICAgaW5wdXQgPSBpbnB1dC5yZXBsYWNlKFJEUzMsIFwiL1wiKTtcbiAgICAgICAgICAgIG91dHB1dC5wb3AoKTtcbiAgICAgICAgfSBlbHNlIGlmIChpbnB1dCA9PT0gXCIuXCIgfHwgaW5wdXQgPT09IFwiLi5cIikge1xuICAgICAgICAgICAgaW5wdXQgPSBcIlwiO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIGltID0gaW5wdXQubWF0Y2goUkRTNSk7XG4gICAgICAgICAgICBpZiAoaW0pIHtcbiAgICAgICAgICAgICAgICB2YXIgcyA9IGltWzBdO1xuICAgICAgICAgICAgICAgIGlucHV0ID0gaW5wdXQuc2xpY2Uocy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKHMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIGRvdCBzZWdtZW50IGNvbmRpdGlvblwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb3V0cHV0LmpvaW4oXCJcIik7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZShjb21wb25lbnRzKSB7XG4gICAgdmFyIG9wdGlvbnMgPSBhcmd1bWVudHMubGVuZ3RoID4gMSAmJiBhcmd1bWVudHNbMV0gIT09IHVuZGVmaW5lZCA/IGFyZ3VtZW50c1sxXSA6IHt9O1xuXG4gICAgdmFyIHByb3RvY29sID0gb3B0aW9ucy5pcmkgPyBJUklfUFJPVE9DT0wgOiBVUklfUFJPVE9DT0w7XG4gICAgdmFyIHVyaVRva2VucyA9IFtdO1xuICAgIC8vZmluZCBzY2hlbWUgaGFuZGxlclxuICAgIHZhciBzY2hlbWVIYW5kbGVyID0gU0NIRU1FU1sob3B0aW9ucy5zY2hlbWUgfHwgY29tcG9uZW50cy5zY2hlbWUgfHwgXCJcIikudG9Mb3dlckNhc2UoKV07XG4gICAgLy9wZXJmb3JtIHNjaGVtZSBzcGVjaWZpYyBzZXJpYWxpemF0aW9uXG4gICAgaWYgKHNjaGVtZUhhbmRsZXIgJiYgc2NoZW1lSGFuZGxlci5zZXJpYWxpemUpIHNjaGVtZUhhbmRsZXIuc2VyaWFsaXplKGNvbXBvbmVudHMsIG9wdGlvbnMpO1xuICAgIGlmIChjb21wb25lbnRzLmhvc3QpIHtcbiAgICAgICAgLy9pZiBob3N0IGNvbXBvbmVudCBpcyBhbiBJUHY2IGFkZHJlc3NcbiAgICAgICAgaWYgKHByb3RvY29sLklQVjZBRERSRVNTLnRlc3QoY29tcG9uZW50cy5ob3N0KSkge1xuICAgICAgICAgICAgLy9UT0RPOiBub3JtYWxpemUgSVB2NiBhZGRyZXNzIGFzIHBlciBSRkMgNTk1MlxuICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbnMuZG9tYWluSG9zdCB8fCBzY2hlbWVIYW5kbGVyICYmIHNjaGVtZUhhbmRsZXIuZG9tYWluSG9zdCkge1xuICAgICAgICAgICAgLy9jb252ZXJ0IElETiB2aWEgcHVueWNvZGVcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5ob3N0ID0gIW9wdGlvbnMuaXJpID8gcHVueWNvZGUudG9BU0NJSShjb21wb25lbnRzLmhvc3QucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgcGN0RGVjQ2hhcnMpLnRvTG93ZXJDYXNlKCkpIDogcHVueWNvZGUudG9Vbmljb2RlKGNvbXBvbmVudHMuaG9zdCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJIb3N0J3MgZG9tYWluIG5hbWUgY2FuIG5vdCBiZSBjb252ZXJ0ZWQgdG8gXCIgKyAoIW9wdGlvbnMuaXJpID8gXCJBU0NJSVwiIDogXCJVbmljb2RlXCIpICsgXCIgdmlhIHB1bnljb2RlOiBcIiArIGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgLy9ub3JtYWxpemUgZW5jb2RpbmdcbiAgICBfbm9ybWFsaXplQ29tcG9uZW50RW5jb2RpbmcoY29tcG9uZW50cywgcHJvdG9jb2wpO1xuICAgIGlmIChvcHRpb25zLnJlZmVyZW5jZSAhPT0gXCJzdWZmaXhcIiAmJiBjb21wb25lbnRzLnNjaGVtZSkge1xuICAgICAgICB1cmlUb2tlbnMucHVzaChjb21wb25lbnRzLnNjaGVtZSk7XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKFwiOlwiKTtcbiAgICB9XG4gICAgdmFyIGF1dGhvcml0eSA9IF9yZWNvbXBvc2VBdXRob3JpdHkoY29tcG9uZW50cywgb3B0aW9ucyk7XG4gICAgaWYgKGF1dGhvcml0eSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmIChvcHRpb25zLnJlZmVyZW5jZSAhPT0gXCJzdWZmaXhcIikge1xuICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2goXCIvL1wiKTtcbiAgICAgICAgfVxuICAgICAgICB1cmlUb2tlbnMucHVzaChhdXRob3JpdHkpO1xuICAgICAgICBpZiAoY29tcG9uZW50cy5wYXRoICYmIGNvbXBvbmVudHMucGF0aC5jaGFyQXQoMCkgIT09IFwiL1wiKSB7XG4gICAgICAgICAgICB1cmlUb2tlbnMucHVzaChcIi9cIik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudHMucGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHZhciBzID0gY29tcG9uZW50cy5wYXRoO1xuICAgICAgICBpZiAoIW9wdGlvbnMuYWJzb2x1dGVQYXRoICYmICghc2NoZW1lSGFuZGxlciB8fCAhc2NoZW1lSGFuZGxlci5hYnNvbHV0ZVBhdGgpKSB7XG4gICAgICAgICAgICBzID0gcmVtb3ZlRG90U2VnbWVudHMocyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGF1dGhvcml0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBzID0gcy5yZXBsYWNlKC9eXFwvXFwvLywgXCIvJTJGXCIpOyAvL2Rvbid0IGFsbG93IHRoZSBwYXRoIHRvIHN0YXJ0IHdpdGggXCIvL1wiXG4gICAgICAgIH1cbiAgICAgICAgdXJpVG9rZW5zLnB1c2gocyk7XG4gICAgfVxuICAgIGlmIChjb21wb25lbnRzLnF1ZXJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdXJpVG9rZW5zLnB1c2goXCI/XCIpO1xuICAgICAgICB1cmlUb2tlbnMucHVzaChjb21wb25lbnRzLnF1ZXJ5KTtcbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudHMuZnJhZ21lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB1cmlUb2tlbnMucHVzaChcIiNcIik7XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMuZnJhZ21lbnQpO1xuICAgIH1cbiAgICByZXR1cm4gdXJpVG9rZW5zLmpvaW4oXCJcIik7IC8vbWVyZ2UgdG9rZW5zIGludG8gYSBzdHJpbmdcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbXBvbmVudHMoYmFzZSwgcmVsYXRpdmUpIHtcbiAgICB2YXIgb3B0aW9ucyA9IGFyZ3VtZW50cy5sZW5ndGggPiAyICYmIGFyZ3VtZW50c1syXSAhPT0gdW5kZWZpbmVkID8gYXJndW1lbnRzWzJdIDoge307XG4gICAgdmFyIHNraXBOb3JtYWxpemF0aW9uID0gYXJndW1lbnRzWzNdO1xuXG4gICAgdmFyIHRhcmdldCA9IHt9O1xuICAgIGlmICghc2tpcE5vcm1hbGl6YXRpb24pIHtcbiAgICAgICAgYmFzZSA9IHBhcnNlKHNlcmlhbGl6ZShiYXNlLCBvcHRpb25zKSwgb3B0aW9ucyk7IC8vbm9ybWFsaXplIGJhc2UgY29tcG9uZW50c1xuICAgICAgICByZWxhdGl2ZSA9IHBhcnNlKHNlcmlhbGl6ZShyZWxhdGl2ZSwgb3B0aW9ucyksIG9wdGlvbnMpOyAvL25vcm1hbGl6ZSByZWxhdGl2ZSBjb21wb25lbnRzXG4gICAgfVxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgIGlmICghb3B0aW9ucy50b2xlcmFudCAmJiByZWxhdGl2ZS5zY2hlbWUpIHtcbiAgICAgICAgdGFyZ2V0LnNjaGVtZSA9IHJlbGF0aXZlLnNjaGVtZTtcbiAgICAgICAgLy90YXJnZXQuYXV0aG9yaXR5ID0gcmVsYXRpdmUuYXV0aG9yaXR5O1xuICAgICAgICB0YXJnZXQudXNlcmluZm8gPSByZWxhdGl2ZS51c2VyaW5mbztcbiAgICAgICAgdGFyZ2V0Lmhvc3QgPSByZWxhdGl2ZS5ob3N0O1xuICAgICAgICB0YXJnZXQucG9ydCA9IHJlbGF0aXZlLnBvcnQ7XG4gICAgICAgIHRhcmdldC5wYXRoID0gcmVtb3ZlRG90U2VnbWVudHMocmVsYXRpdmUucGF0aCB8fCBcIlwiKTtcbiAgICAgICAgdGFyZ2V0LnF1ZXJ5ID0gcmVsYXRpdmUucXVlcnk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHJlbGF0aXZlLnVzZXJpbmZvICE9PSB1bmRlZmluZWQgfHwgcmVsYXRpdmUuaG9zdCAhPT0gdW5kZWZpbmVkIHx8IHJlbGF0aXZlLnBvcnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy90YXJnZXQuYXV0aG9yaXR5ID0gcmVsYXRpdmUuYXV0aG9yaXR5O1xuICAgICAgICAgICAgdGFyZ2V0LnVzZXJpbmZvID0gcmVsYXRpdmUudXNlcmluZm87XG4gICAgICAgICAgICB0YXJnZXQuaG9zdCA9IHJlbGF0aXZlLmhvc3Q7XG4gICAgICAgICAgICB0YXJnZXQucG9ydCA9IHJlbGF0aXZlLnBvcnQ7XG4gICAgICAgICAgICB0YXJnZXQucGF0aCA9IHJlbW92ZURvdFNlZ21lbnRzKHJlbGF0aXZlLnBhdGggfHwgXCJcIik7XG4gICAgICAgICAgICB0YXJnZXQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICghcmVsYXRpdmUucGF0aCkge1xuICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gYmFzZS5wYXRoO1xuICAgICAgICAgICAgICAgIGlmIChyZWxhdGl2ZS5xdWVyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldC5xdWVyeSA9IHJlbGF0aXZlLnF1ZXJ5O1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldC5xdWVyeSA9IGJhc2UucXVlcnk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAocmVsYXRpdmUucGF0aC5jaGFyQXQoMCkgPT09IFwiL1wiKSB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gcmVtb3ZlRG90U2VnbWVudHMocmVsYXRpdmUucGF0aCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKChiYXNlLnVzZXJpbmZvICE9PSB1bmRlZmluZWQgfHwgYmFzZS5ob3N0ICE9PSB1bmRlZmluZWQgfHwgYmFzZS5wb3J0ICE9PSB1bmRlZmluZWQpICYmICFiYXNlLnBhdGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gXCIvXCIgKyByZWxhdGl2ZS5wYXRoO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFiYXNlLnBhdGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gcmVsYXRpdmUucGF0aDtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gYmFzZS5wYXRoLnNsaWNlKDAsIGJhc2UucGF0aC5sYXN0SW5kZXhPZihcIi9cIikgKyAxKSArIHJlbGF0aXZlLnBhdGg7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LnBhdGggPSByZW1vdmVEb3RTZWdtZW50cyh0YXJnZXQucGF0aCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRhcmdldC5xdWVyeSA9IHJlbGF0aXZlLnF1ZXJ5O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy90YXJnZXQuYXV0aG9yaXR5ID0gYmFzZS5hdXRob3JpdHk7XG4gICAgICAgICAgICB0YXJnZXQudXNlcmluZm8gPSBiYXNlLnVzZXJpbmZvO1xuICAgICAgICAgICAgdGFyZ2V0Lmhvc3QgPSBiYXNlLmhvc3Q7XG4gICAgICAgICAgICB0YXJnZXQucG9ydCA9IGJhc2UucG9ydDtcbiAgICAgICAgfVxuICAgICAgICB0YXJnZXQuc2NoZW1lID0gYmFzZS5zY2hlbWU7XG4gICAgfVxuICAgIHRhcmdldC5mcmFnbWVudCA9IHJlbGF0aXZlLmZyYWdtZW50O1xuICAgIHJldHVybiB0YXJnZXQ7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmUoYmFzZVVSSSwgcmVsYXRpdmVVUkksIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gc2VyaWFsaXplKHJlc29sdmVDb21wb25lbnRzKHBhcnNlKGJhc2VVUkksIG9wdGlvbnMpLCBwYXJzZShyZWxhdGl2ZVVSSSwgb3B0aW9ucyksIG9wdGlvbnMsIHRydWUpLCBvcHRpb25zKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplKHVyaSwgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2YgdXJpID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHVyaSA9IHNlcmlhbGl6ZShwYXJzZSh1cmksIG9wdGlvbnMpLCBvcHRpb25zKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVPZih1cmkpID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHVyaSA9IHBhcnNlKHNlcmlhbGl6ZSh1cmksIG9wdGlvbnMpLCBvcHRpb25zKTtcbiAgICB9XG4gICAgcmV0dXJuIHVyaTtcbn1cblxuZnVuY3Rpb24gZXF1YWwodXJpQSwgdXJpQiwgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2YgdXJpQSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICB1cmlBID0gc2VyaWFsaXplKHBhcnNlKHVyaUEsIG9wdGlvbnMpLCBvcHRpb25zKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVPZih1cmlBKSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB1cmlBID0gc2VyaWFsaXplKHVyaUEsIG9wdGlvbnMpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHVyaUIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdXJpQiA9IHNlcmlhbGl6ZShwYXJzZSh1cmlCLCBvcHRpb25zKSwgb3B0aW9ucyk7XG4gICAgfSBlbHNlIGlmICh0eXBlT2YodXJpQikgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgdXJpQiA9IHNlcmlhbGl6ZSh1cmlCLCBvcHRpb25zKTtcbiAgICB9XG4gICAgcmV0dXJuIHVyaUEgPT09IHVyaUI7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUNvbXBvbmVudChzdHIsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gc3RyICYmIHN0ci50b1N0cmluZygpLnJlcGxhY2UoIW9wdGlvbnMgfHwgIW9wdGlvbnMuaXJpID8gVVJJX1BST1RPQ09MLkVTQ0FQRSA6IElSSV9QUk9UT0NPTC5FU0NBUEUsIHBjdEVuY0NoYXIpO1xufVxuXG5mdW5jdGlvbiB1bmVzY2FwZUNvbXBvbmVudChzdHIsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gc3RyICYmIHN0ci50b1N0cmluZygpLnJlcGxhY2UoIW9wdGlvbnMgfHwgIW9wdGlvbnMuaXJpID8gVVJJX1BST1RPQ09MLlBDVF9FTkNPREVEIDogSVJJX1BST1RPQ09MLlBDVF9FTkNPREVELCBwY3REZWNDaGFycyk7XG59XG5cbnZhciBodHRwID0ge1xuICAgIHNjaGVtZTogXCJodHRwXCIsXG4gICAgZG9tYWluSG9zdDogdHJ1ZSxcbiAgICBwYXJzZTogZnVuY3Rpb24gcGFyc2UoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICAvL3JlcG9ydCBtaXNzaW5nIGhvc3RcbiAgICAgICAgaWYgKCFjb21wb25lbnRzLmhvc3QpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiSFRUUCBVUklzIG11c3QgaGF2ZSBhIGhvc3QuXCI7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudHM7XG4gICAgfSxcbiAgICBzZXJpYWxpemU6IGZ1bmN0aW9uIHNlcmlhbGl6ZShjb21wb25lbnRzLCBvcHRpb25zKSB7XG4gICAgICAgIC8vbm9ybWFsaXplIHRoZSBkZWZhdWx0IHBvcnRcbiAgICAgICAgaWYgKGNvbXBvbmVudHMucG9ydCA9PT0gKFN0cmluZyhjb21wb25lbnRzLnNjaGVtZSkudG9Mb3dlckNhc2UoKSAhPT0gXCJodHRwc1wiID8gODAgOiA0NDMpIHx8IGNvbXBvbmVudHMucG9ydCA9PT0gXCJcIikge1xuICAgICAgICAgICAgY29tcG9uZW50cy5wb3J0ID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIC8vbm9ybWFsaXplIHRoZSBlbXB0eSBwYXRoXG4gICAgICAgIGlmICghY29tcG9uZW50cy5wYXRoKSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSBcIi9cIjtcbiAgICAgICAgfVxuICAgICAgICAvL05PVEU6IFdlIGRvIG5vdCBwYXJzZSBxdWVyeSBzdHJpbmdzIGZvciBIVFRQIFVSSXNcbiAgICAgICAgLy9hcyBXV1cgRm9ybSBVcmwgRW5jb2RlZCBxdWVyeSBzdHJpbmdzIGFyZSBwYXJ0IG9mIHRoZSBIVE1MNCsgc3BlYyxcbiAgICAgICAgLy9hbmQgbm90IHRoZSBIVFRQIHNwZWMuXG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH1cbn07XG5cbnZhciBodHRwcyA9IHtcbiAgICBzY2hlbWU6IFwiaHR0cHNcIixcbiAgICBkb21haW5Ib3N0OiBodHRwLmRvbWFpbkhvc3QsXG4gICAgcGFyc2U6IGh0dHAucGFyc2UsXG4gICAgc2VyaWFsaXplOiBodHRwLnNlcmlhbGl6ZVxufTtcblxudmFyIE8gPSB7fTtcbnZhciBpc0lSSSA9IHRydWU7XG4vL1JGQyAzOTg2XG52YXIgVU5SRVNFUlZFRCQkID0gXCJbQS1aYS16MC05XFxcXC1cXFxcLlxcXFxfXFxcXH5cIiArIChpc0lSSSA/IFwiXFxcXHhBMC1cXFxcdTIwMERcXFxcdTIwMTAtXFxcXHUyMDI5XFxcXHUyMDJGLVxcXFx1RDdGRlxcXFx1RjkwMC1cXFxcdUZEQ0ZcXFxcdUZERjAtXFxcXHVGRkVGXCIgOiBcIlwiKSArIFwiXVwiO1xudmFyIEhFWERJRyQkID0gXCJbMC05QS1GYS1mXVwiOyAvL2Nhc2UtaW5zZW5zaXRpdmVcbnZhciBQQ1RfRU5DT0RFRCQgPSBzdWJleHAoc3ViZXhwKFwiJVtFRmVmXVwiICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIlWzg5QS1GYS1mXVwiICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIlXCIgKyBIRVhESUckJCArIEhFWERJRyQkKSk7IC8vZXhwYW5kZWRcbi8vUkZDIDUzMjIsIGV4Y2VwdCB0aGVzZSBzeW1ib2xzIGFzIHBlciBSRkMgNjA2ODogQCA6IC8gPyAjIFsgXSAmIDsgPVxuLy9jb25zdCBBVEVYVCQkID0gXCJbQS1aYS16MC05XFxcXCFcXFxcI1xcXFwkXFxcXCVcXFxcJlxcXFwnXFxcXCpcXFxcK1xcXFwtXFxcXC9cXFxcPVxcXFw/XFxcXF5cXFxcX1xcXFxgXFxcXHtcXFxcfFxcXFx9XFxcXH5dXCI7XG4vL2NvbnN0IFdTUCQkID0gXCJbXFxcXHgyMFxcXFx4MDldXCI7XG4vL2NvbnN0IE9CU19RVEVYVCQkID0gXCJbXFxcXHgwMS1cXFxceDA4XFxcXHgwQlxcXFx4MENcXFxceDBFLVxcXFx4MUZcXFxceDdGXVwiOyAgLy8oJWQxLTggLyAlZDExLTEyIC8gJWQxNC0zMSAvICVkMTI3KVxuLy9jb25zdCBRVEVYVCQkID0gbWVyZ2UoXCJbXFxcXHgyMVxcXFx4MjMtXFxcXHg1QlxcXFx4NUQtXFxcXHg3RV1cIiwgT0JTX1FURVhUJCQpOyAgLy8lZDMzIC8gJWQzNS05MSAvICVkOTMtMTI2IC8gb2JzLXF0ZXh0XG4vL2NvbnN0IFZDSEFSJCQgPSBcIltcXFxceDIxLVxcXFx4N0VdXCI7XG4vL2NvbnN0IFdTUCQkID0gXCJbXFxcXHgyMFxcXFx4MDldXCI7XG4vL2NvbnN0IE9CU19RUCQgPSBzdWJleHAoXCJcXFxcXFxcXFwiICsgbWVyZ2UoXCJbXFxcXHgwMFxcXFx4MERcXFxceDBBXVwiLCBPQlNfUVRFWFQkJCkpOyAgLy8lZDAgLyBDUiAvIExGIC8gb2JzLXF0ZXh0XG4vL2NvbnN0IEZXUyQgPSBzdWJleHAoc3ViZXhwKFdTUCQkICsgXCIqXCIgKyBcIlxcXFx4MERcXFxceDBBXCIpICsgXCI/XCIgKyBXU1AkJCArIFwiK1wiKTtcbi8vY29uc3QgUVVPVEVEX1BBSVIkID0gc3ViZXhwKHN1YmV4cChcIlxcXFxcXFxcXCIgKyBzdWJleHAoVkNIQVIkJCArIFwifFwiICsgV1NQJCQpKSArIFwifFwiICsgT0JTX1FQJCk7XG4vL2NvbnN0IFFVT1RFRF9TVFJJTkckID0gc3ViZXhwKCdcXFxcXCInICsgc3ViZXhwKEZXUyQgKyBcIj9cIiArIFFDT05URU5UJCkgKyBcIipcIiArIEZXUyQgKyBcIj9cIiArICdcXFxcXCInKTtcbnZhciBBVEVYVCQkID0gXCJbQS1aYS16MC05XFxcXCFcXFxcJFxcXFwlXFxcXCdcXFxcKlxcXFwrXFxcXC1cXFxcXlxcXFxfXFxcXGBcXFxce1xcXFx8XFxcXH1cXFxcfl1cIjtcbnZhciBRVEVYVCQkID0gXCJbXFxcXCFcXFxcJFxcXFwlXFxcXCdcXFxcKFxcXFwpXFxcXCpcXFxcK1xcXFwsXFxcXC1cXFxcLjAtOVxcXFw8XFxcXD5BLVpcXFxceDVFLVxcXFx4N0VdXCI7XG52YXIgVkNIQVIkJCA9IG1lcmdlKFFURVhUJCQsIFwiW1xcXFxcXFwiXFxcXFxcXFxdXCIpO1xudmFyIFNPTUVfREVMSU1TJCQgPSBcIltcXFxcIVxcXFwkXFxcXCdcXFxcKFxcXFwpXFxcXCpcXFxcK1xcXFwsXFxcXDtcXFxcOlxcXFxAXVwiO1xudmFyIFVOUkVTRVJWRUQgPSBuZXcgUmVnRXhwKFVOUkVTRVJWRUQkJCwgXCJnXCIpO1xudmFyIFBDVF9FTkNPREVEID0gbmV3IFJlZ0V4cChQQ1RfRU5DT0RFRCQsIFwiZ1wiKTtcbnZhciBOT1RfTE9DQUxfUEFSVCA9IG5ldyBSZWdFeHAobWVyZ2UoXCJbXl1cIiwgQVRFWFQkJCwgXCJbXFxcXC5dXCIsICdbXFxcXFwiXScsIFZDSEFSJCQpLCBcImdcIik7XG52YXIgTk9UX0hGTkFNRSA9IG5ldyBSZWdFeHAobWVyZ2UoXCJbXl1cIiwgVU5SRVNFUlZFRCQkLCBTT01FX0RFTElNUyQkKSwgXCJnXCIpO1xudmFyIE5PVF9IRlZBTFVFID0gTk9UX0hGTkFNRTtcbmZ1bmN0aW9uIGRlY29kZVVucmVzZXJ2ZWQoc3RyKSB7XG4gICAgdmFyIGRlY1N0ciA9IHBjdERlY0NoYXJzKHN0cik7XG4gICAgcmV0dXJuICFkZWNTdHIubWF0Y2goVU5SRVNFUlZFRCkgPyBzdHIgOiBkZWNTdHI7XG59XG52YXIgbWFpbHRvID0ge1xuICAgIHNjaGVtZTogXCJtYWlsdG9cIixcbiAgICBwYXJzZTogZnVuY3Rpb24gcGFyc2UkJDEoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICB2YXIgdG8gPSBjb21wb25lbnRzLnRvID0gY29tcG9uZW50cy5wYXRoID8gY29tcG9uZW50cy5wYXRoLnNwbGl0KFwiLFwiKSA6IFtdO1xuICAgICAgICBjb21wb25lbnRzLnBhdGggPSB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChjb21wb25lbnRzLnF1ZXJ5KSB7XG4gICAgICAgICAgICB2YXIgdW5rbm93bkhlYWRlcnMgPSBmYWxzZTtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0ge307XG4gICAgICAgICAgICB2YXIgaGZpZWxkcyA9IGNvbXBvbmVudHMucXVlcnkuc3BsaXQoXCImXCIpO1xuICAgICAgICAgICAgZm9yICh2YXIgeCA9IDAsIHhsID0gaGZpZWxkcy5sZW5ndGg7IHggPCB4bDsgKyt4KSB7XG4gICAgICAgICAgICAgICAgdmFyIGhmaWVsZCA9IGhmaWVsZHNbeF0uc3BsaXQoXCI9XCIpO1xuICAgICAgICAgICAgICAgIHN3aXRjaCAoaGZpZWxkWzBdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJ0b1wiOlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHRvQWRkcnMgPSBoZmllbGRbMV0uc3BsaXQoXCIsXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgX3ggPSAwLCBfeGwgPSB0b0FkZHJzLmxlbmd0aDsgX3ggPCBfeGw7ICsrX3gpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0by5wdXNoKHRvQWRkcnNbX3hdKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwic3ViamVjdFwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5zdWJqZWN0ID0gdW5lc2NhcGVDb21wb25lbnQoaGZpZWxkWzFdLCBvcHRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiYm9keVwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5ib2R5ID0gdW5lc2NhcGVDb21wb25lbnQoaGZpZWxkWzFdLCBvcHRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgdW5rbm93bkhlYWRlcnMgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGVyc1t1bmVzY2FwZUNvbXBvbmVudChoZmllbGRbMF0sIG9wdGlvbnMpXSA9IHVuZXNjYXBlQ29tcG9uZW50KGhmaWVsZFsxXSwgb3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodW5rbm93bkhlYWRlcnMpIGNvbXBvbmVudHMuaGVhZGVycyA9IGhlYWRlcnM7XG4gICAgICAgIH1cbiAgICAgICAgY29tcG9uZW50cy5xdWVyeSA9IHVuZGVmaW5lZDtcbiAgICAgICAgZm9yICh2YXIgX3gyID0gMCwgX3hsMiA9IHRvLmxlbmd0aDsgX3gyIDwgX3hsMjsgKytfeDIpIHtcbiAgICAgICAgICAgIHZhciBhZGRyID0gdG9bX3gyXS5zcGxpdChcIkBcIik7XG4gICAgICAgICAgICBhZGRyWzBdID0gdW5lc2NhcGVDb21wb25lbnQoYWRkclswXSk7XG4gICAgICAgICAgICBpZiAoIW9wdGlvbnMudW5pY29kZVN1cHBvcnQpIHtcbiAgICAgICAgICAgICAgICAvL2NvbnZlcnQgVW5pY29kZSBJRE4gLT4gQVNDSUkgSUROXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYWRkclsxXSA9IHB1bnljb2RlLnRvQVNDSUkodW5lc2NhcGVDb21wb25lbnQoYWRkclsxXSwgb3B0aW9ucykudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIkVtYWlsIGFkZHJlc3MncyBkb21haW4gbmFtZSBjYW4gbm90IGJlIGNvbnZlcnRlZCB0byBBU0NJSSB2aWEgcHVueWNvZGU6IFwiICsgZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGFkZHJbMV0gPSB1bmVzY2FwZUNvbXBvbmVudChhZGRyWzFdLCBvcHRpb25zKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdG9bX3gyXSA9IGFkZHIuam9pbihcIkBcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudHM7XG4gICAgfSxcbiAgICBzZXJpYWxpemU6IGZ1bmN0aW9uIHNlcmlhbGl6ZSQkMShjb21wb25lbnRzLCBvcHRpb25zKSB7XG4gICAgICAgIHZhciB0byA9IHRvQXJyYXkoY29tcG9uZW50cy50byk7XG4gICAgICAgIGlmICh0bykge1xuICAgICAgICAgICAgZm9yICh2YXIgeCA9IDAsIHhsID0gdG8ubGVuZ3RoOyB4IDwgeGw7ICsreCkge1xuICAgICAgICAgICAgICAgIHZhciB0b0FkZHIgPSBTdHJpbmcodG9beF0pO1xuICAgICAgICAgICAgICAgIHZhciBhdElkeCA9IHRvQWRkci5sYXN0SW5kZXhPZihcIkBcIik7XG4gICAgICAgICAgICAgICAgdmFyIGxvY2FsUGFydCA9IHRvQWRkci5zbGljZSgwLCBhdElkeCkucmVwbGFjZShQQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkucmVwbGFjZShQQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpLnJlcGxhY2UoTk9UX0xPQ0FMX1BBUlQsIHBjdEVuY0NoYXIpO1xuICAgICAgICAgICAgICAgIHZhciBkb21haW4gPSB0b0FkZHIuc2xpY2UoYXRJZHggKyAxKTtcbiAgICAgICAgICAgICAgICAvL2NvbnZlcnQgSUROIHZpYSBwdW55Y29kZVxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGRvbWFpbiA9ICFvcHRpb25zLmlyaSA/IHB1bnljb2RlLnRvQVNDSUkodW5lc2NhcGVDb21wb25lbnQoZG9tYWluLCBvcHRpb25zKS50b0xvd2VyQ2FzZSgpKSA6IHB1bnljb2RlLnRvVW5pY29kZShkb21haW4pO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJFbWFpbCBhZGRyZXNzJ3MgZG9tYWluIG5hbWUgY2FuIG5vdCBiZSBjb252ZXJ0ZWQgdG8gXCIgKyAoIW9wdGlvbnMuaXJpID8gXCJBU0NJSVwiIDogXCJVbmljb2RlXCIpICsgXCIgdmlhIHB1bnljb2RlOiBcIiArIGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRvW3hdID0gbG9jYWxQYXJ0ICsgXCJAXCIgKyBkb21haW47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSB0by5qb2luKFwiLFwiKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaGVhZGVycyA9IGNvbXBvbmVudHMuaGVhZGVycyA9IGNvbXBvbmVudHMuaGVhZGVycyB8fCB7fTtcbiAgICAgICAgaWYgKGNvbXBvbmVudHMuc3ViamVjdCkgaGVhZGVyc1tcInN1YmplY3RcIl0gPSBjb21wb25lbnRzLnN1YmplY3Q7XG4gICAgICAgIGlmIChjb21wb25lbnRzLmJvZHkpIGhlYWRlcnNbXCJib2R5XCJdID0gY29tcG9uZW50cy5ib2R5O1xuICAgICAgICB2YXIgZmllbGRzID0gW107XG4gICAgICAgIGZvciAodmFyIG5hbWUgaW4gaGVhZGVycykge1xuICAgICAgICAgICAgaWYgKGhlYWRlcnNbbmFtZV0gIT09IE9bbmFtZV0pIHtcbiAgICAgICAgICAgICAgICBmaWVsZHMucHVzaChuYW1lLnJlcGxhY2UoUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UoUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKS5yZXBsYWNlKE5PVF9IRk5BTUUsIHBjdEVuY0NoYXIpICsgXCI9XCIgKyBoZWFkZXJzW25hbWVdLnJlcGxhY2UoUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UoUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKS5yZXBsYWNlKE5PVF9IRlZBTFVFLCBwY3RFbmNDaGFyKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucXVlcnkgPSBmaWVsZHMuam9pbihcIiZcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudHM7XG4gICAgfVxufTtcblxudmFyIE5JRCQgPSBcIig/OlswLTlBLVphLXpdWzAtOUEtWmEtelxcXFwtXXsxLDMxfSlcIjtcbnZhciBVUk5fU0NIRU1FID0gbmV3IFJlZ0V4cChcIl51cm5cXFxcOihcIiArIE5JRCQgKyBcIikkXCIpO1xudmFyIFVSTl9QQVJTRSA9IC9eKFteXFw6XSspXFw6KC4qKS87XG52YXIgVVJOX0VYQ0xVREVEID0gL1tcXHgwMC1cXHgyMFxcXFxcXFwiXFwmXFw8XFw+XFxbXFxdXFxeXFxgXFx7XFx8XFx9XFx+XFx4N0YtXFx4RkZdL2c7XG4vL1JGQyAyMTQxXG52YXIgdXJuID0ge1xuICAgIHNjaGVtZTogXCJ1cm5cIixcbiAgICBwYXJzZTogZnVuY3Rpb24gcGFyc2UkJDEoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICB2YXIgbWF0Y2hlcyA9IGNvbXBvbmVudHMucGF0aCAmJiBjb21wb25lbnRzLnBhdGgubWF0Y2goVVJOX1BBUlNFKTtcbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICAgIHZhciBzY2hlbWUgPSBcInVybjpcIiArIG1hdGNoZXNbMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIHZhciBzY2hlbWVIYW5kbGVyID0gU0NIRU1FU1tzY2hlbWVdO1xuICAgICAgICAgICAgLy9pbiBvcmRlciB0byBzZXJpYWxpemUgcHJvcGVybHksXG4gICAgICAgICAgICAvL2V2ZXJ5IFVSTiBtdXN0IGhhdmUgYSBzZXJpYWxpemVyIHRoYXQgY2FsbHMgdGhlIFVSTiBzZXJpYWxpemVyXG4gICAgICAgICAgICBpZiAoIXNjaGVtZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAvL2NyZWF0ZSBmYWtlIHNjaGVtZSBoYW5kbGVyXG4gICAgICAgICAgICAgICAgc2NoZW1lSGFuZGxlciA9IFNDSEVNRVNbc2NoZW1lXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1lOiBzY2hlbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhcnNlOiBmdW5jdGlvbiBwYXJzZSQkMShjb21wb25lbnRzLCBvcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gY29tcG9uZW50cztcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgc2VyaWFsaXplOiBTQ0hFTUVTW1widXJuXCJdLnNlcmlhbGl6ZVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb21wb25lbnRzLnNjaGVtZSA9IHNjaGVtZTtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucGF0aCA9IG1hdGNoZXNbMl07XG4gICAgICAgICAgICBjb21wb25lbnRzID0gc2NoZW1lSGFuZGxlci5wYXJzZShjb21wb25lbnRzLCBvcHRpb25zKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiVVJOIGNhbiBub3QgYmUgcGFyc2VkLlwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH0sXG4gICAgc2VyaWFsaXplOiBmdW5jdGlvbiBzZXJpYWxpemUkJDEoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICB2YXIgc2NoZW1lID0gY29tcG9uZW50cy5zY2hlbWUgfHwgb3B0aW9ucy5zY2hlbWU7XG4gICAgICAgIGlmIChzY2hlbWUgJiYgc2NoZW1lICE9PSBcInVyblwiKSB7XG4gICAgICAgICAgICB2YXIgbWF0Y2hlcyA9IHNjaGVtZS5tYXRjaChVUk5fU0NIRU1FKSB8fCBbXCJ1cm46XCIgKyBzY2hlbWUsIHNjaGVtZV07XG4gICAgICAgICAgICBjb21wb25lbnRzLnNjaGVtZSA9IFwidXJuXCI7XG4gICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSBtYXRjaGVzWzFdICsgXCI6XCIgKyAoY29tcG9uZW50cy5wYXRoID8gY29tcG9uZW50cy5wYXRoLnJlcGxhY2UoVVJOX0VYQ0xVREVELCBwY3RFbmNDaGFyKSA6IFwiXCIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH1cbn07XG5cbnZhciBVVUlEID0gL15bMC05QS1GYS1mXXs4fSg/OlxcLVswLTlBLUZhLWZdezR9KXszfVxcLVswLTlBLUZhLWZdezEyfSQvO1xuLy9SRkMgNDEyMlxudmFyIHV1aWQgPSB7XG4gICAgc2NoZW1lOiBcInVybjp1dWlkXCIsXG4gICAgcGFyc2U6IGZ1bmN0aW9uIHBhcnNlJCQxKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFvcHRpb25zLnRvbGVyYW50ICYmICghY29tcG9uZW50cy5wYXRoIHx8ICFjb21wb25lbnRzLnBhdGgubWF0Y2goVVVJRCkpKSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVVSUQgaXMgbm90IHZhbGlkLlwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH0sXG4gICAgc2VyaWFsaXplOiBmdW5jdGlvbiBzZXJpYWxpemUkJDEoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICAvL2Vuc3VyZSBVVUlEIGlzIHZhbGlkXG4gICAgICAgIGlmICghb3B0aW9ucy50b2xlcmFudCAmJiAoIWNvbXBvbmVudHMucGF0aCB8fCAhY29tcG9uZW50cy5wYXRoLm1hdGNoKFVVSUQpKSkge1xuICAgICAgICAgICAgLy9pbnZhbGlkIFVVSURzIGNhbiBub3QgaGF2ZSB0aGlzIHNjaGVtZVxuICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSB1bmRlZmluZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvL25vcm1hbGl6ZSBVVUlEXG4gICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSAoY29tcG9uZW50cy5wYXRoIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFNDSEVNRVNbXCJ1cm5cIl0uc2VyaWFsaXplKGNvbXBvbmVudHMsIG9wdGlvbnMpO1xuICAgIH1cbn07XG5cblNDSEVNRVNbXCJodHRwXCJdID0gaHR0cDtcblNDSEVNRVNbXCJodHRwc1wiXSA9IGh0dHBzO1xuU0NIRU1FU1tcIm1haWx0b1wiXSA9IG1haWx0bztcblNDSEVNRVNbXCJ1cm5cIl0gPSB1cm47XG5TQ0hFTUVTW1widXJuOnV1aWRcIl0gPSB1dWlkO1xuXG5leHBvcnRzLlNDSEVNRVMgPSBTQ0hFTUVTO1xuZXhwb3J0cy5wY3RFbmNDaGFyID0gcGN0RW5jQ2hhcjtcbmV4cG9ydHMucGN0RGVjQ2hhcnMgPSBwY3REZWNDaGFycztcbmV4cG9ydHMucGFyc2UgPSBwYXJzZTtcbmV4cG9ydHMucmVtb3ZlRG90U2VnbWVudHMgPSByZW1vdmVEb3RTZWdtZW50cztcbmV4cG9ydHMuc2VyaWFsaXplID0gc2VyaWFsaXplO1xuZXhwb3J0cy5yZXNvbHZlQ29tcG9uZW50cyA9IHJlc29sdmVDb21wb25lbnRzO1xuZXhwb3J0cy5yZXNvbHZlID0gcmVzb2x2ZTtcbmV4cG9ydHMubm9ybWFsaXplID0gbm9ybWFsaXplO1xuZXhwb3J0cy5lcXVhbCA9IGVxdWFsO1xuZXhwb3J0cy5lc2NhcGVDb21wb25lbnQgPSBlc2NhcGVDb21wb25lbnQ7XG5leHBvcnRzLnVuZXNjYXBlQ29tcG9uZW50ID0gdW5lc2NhcGVDb21wb25lbnQ7XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCAnX19lc01vZHVsZScsIHsgdmFsdWU6IHRydWUgfSk7XG5cbn0pKSk7XG4vLyMgc291cmNlTWFwcGluZ1VSTD11cmkuYWxsLmpzLm1hcFxuIl19
