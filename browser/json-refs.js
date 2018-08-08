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
    _.forOwn(obj, function (val, key) {
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
  return URI.parse(uri);
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
    _.forOwn(refs, function (refDetails, refPtr) {
      var refKey = makeAbsolute(options.location) + refPtr;
      var refdKey = refDetails.refdId = decodeURI(makeAbsolute(isRemote(refDetails) ?
                                                       combineURIs(relativeBase, refDetails.uri) :
                                                       options.location) + '#' +
                                          (refDetails.uri.indexOf('#') > -1 ?
                                             refDetails.uri.split('#')[1] :
                                             ''));

      // Record reference metadata
      metadata.refs[refKey] = refDetails;

      // Do not process invalid references
      if (!isValid(refDetails)) {
        return;
      }

      // Record the fully-qualified URI
      refDetails.fqURI = refdKey;

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
        _.forOwn(node, function (cNode, key) {
          walkItem(cNode, key);
        });
      }
    }

    ancestors.pop();
  }
}

function validateOptions (options, obj) {
  var locationParts;
  var shouldDecode;

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

  shouldDecode = decodeURI(options.location) === options.location;

  // Just to be safe, remove any accidental fragment as it would break things
  options.location = combineURIs(options.location, undefined);

  // If the location was not encoded, meke sure it's not when we get it back (Issue #138)
  if (shouldDecode) {
    options.location = decodeURI(options.location);
  }

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

function decodePath (path) {
  if (!_.isArray(path)) {
    throw new TypeError('path must be an array');
  }

  return path.map(function (seg) {
    if (!_.isString(seg)) {
      seg = JSON.stringify(seg);
    }

    return seg.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

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

        // Validate the JSON Pointer
        try {
          if (['#', '/'].indexOf(cacheKey[0]) > -1) {
            isPtr(cacheKey, true);
          } else if (cacheKey.indexOf('#') > -1) {
            isPtr(uriDetails.fragment, true);
          }
        } catch (err) {
          details.error = err.message;
          details.type = 'invalid';
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
  } catch (err) {
    details.error = err.message;
    details.type = 'invalid';
  }

  return details;
}

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

function isRef (obj, throwWithDetails) {
  return isRefLike(obj, throwWithDetails) && getRefDetails(obj, throwWithDetails).type !== 'invalid';
}

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

function pathToPtr (path, hashPrefix) {
  if (!_.isArray(path)) {
    throw new Error('path must be an Array');
  }

  // Encode each segment and return
  return (hashPrefix !== false ? '#' : '') + (path.length > 0 ? '/' : '') + encodePath(path).join('/');
}

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
      var relativeBase = path.dirname(fullLocation);

      // Identify circulars

      // Add nodes first
      Object.keys(results.deps).forEach(function (node) {
        depGraph.setNode(node);
      });

      // Add edges
      _.forOwn(results.deps, function (props, node) {
        _.forOwn(props, function (dep) {
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

      // Identify circulars
      _.forOwn(results.deps, function (props, node) {
        _.forOwn(props, function (dep, prop) {
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
                    // circular if the matching path is the last path segment or its match is not to a document root
                    if (!remote || pathIndex === path.length - 1 || dep[dep.length - 1] !== '#') {
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

      // Resolve the references in reverse order since the current order is top-down
      _.forOwn(Object.keys(results.deps).reverse(), function (parentPtr) {
        var deps = results.deps[parentPtr];
        var pPtrParts = parentPtr.split('#');
        var pDocument = results.docs[pPtrParts[0]];
        var pPtrPath = pathFromPtr(pPtrParts[1]);

        _.forOwn(deps, function (dep, prop) {
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
        var refDetails = results.refs[refPtr];
        var fqURISegments;
        var uriSegments;

        // Make all fully-qualified reference URIs relative to the document root (if necessary).  This step is done here
        // for performance reasons instead of below when the official sanitization process runs.
        if (refDetails.type !== 'invalid') {
          // Remove the trailing hash from document root references if they weren't in the original URI
          if (refDetails.fqURI[refDetails.fqURI.length - 1] === '#' &&
                refDetails.uri[refDetails.uri.length - 1] !== '#') {
            refDetails.fqURI = refDetails.fqURI.substr(0, refDetails.fqURI.length - 1);
          }

          fqURISegments = refDetails.fqURI.split('/');
          uriSegments = refDetails.uri.split('/');

          // The fully-qualified URI is unencoded so to keep the original formatting of the URI (encoded vs. unencoded),
          // we need to replace each URI segment in reverse order.
          _.times(uriSegments.length - 1, function (time) {
            var nSeg = uriSegments[uriSegments.length - time - 1];
            var fqSegIndex = fqURISegments.length - time - 1;
            var fqSeg = fqURISegments[fqSegIndex];

            if (nSeg === '.' || nSeg === '..') {
              nSeg = fqSeg;
            }

            fqURISegments[fqSegIndex] = nSeg;
          });

          refDetails.fqURI = fqURISegments.join('/');

          // Make the fully-qualified URIs relative to the document root
          if (refDetails.fqURI.indexOf(fullLocation) === 0) {
            refDetails.fqURI = refDetails.fqURI.replace(fullLocation, '');
          } else if (refDetails.fqURI.indexOf(relativeBase) === 0) {
            refDetails.fqURI = refDetails.fqURI.replace(relativeBase, '');
          }

          if (refDetails.fqURI[0] === '/') {
            refDetails.fqURI = '.' + refDetails.fqURI;
          }
        }

        // We only want to process references found at or beneath the provided document and sub-document path
        if (refPtr.indexOf(refsRoot) !== 0) {
          return;
        }

        walkRefs(refsRoot, refPtr, pathFromPtr(refPtr.substr(refsRoot.length)));
      });

      // Sanitize the reference details
      _.forOwn(results.refs, function (refDetails) {
        // Delete the reference id used for dependency tracking and circular identification
        delete refDetails.refdId;

        // To avoid the error message being URI encoded/decoded by mistake, replace the current JSON Pointer with the
        // value in the JSON Reference definition.
        if (refDetails.missing) {
          refDetails.error = refDetails.error.split(': ')[0] + ': ' + refDetails.def.$ref;
        }
      });

      return {
        refs: allRefs,
        resolved: results.docs[fullLocation]
      };
    });

  return allTasks;
}

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

/**
 * Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
 * JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.
 *
 * @module json-refs
 */

/**
 * A number of functions exported below are used within the exported functions.  Typically, I would use a function
 * declaration _(with documenation)_ above and then just export a reference to the function but due to a bug in JSDoc
 * (https://github.com/jsdoc3/jsdoc/issues/679), this breaks the generated API documentation and TypeScript
 * declarations.  So that's why each `module.exports` below basically just wraps a call to the function declaration.
 */

 /**
 * Clears the internal cache of remote documents, reference details, etc.
 */
module.exports.clearCache = function () {
  remoteCache = {};
};

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
 */
module.exports.decodePath = function (path) {
  return decodePath(path);
};

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
 */
module.exports.encodePath = function (path) {
  return encodePath(path);
};

/**
 * Finds JSON References defined within the provided array/object.
 *
 * @param {array|object} obj - The structure to find JSON References within
 * @param {module:json-refs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {object} an object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined
 * and whose values are {@link UnresolvedRefDetails}.
 *
 * @throws {Error} when the input arguments fail validation or if `options.subDocPath` points to an invalid location
 *
 * @example
 * // Finding all valid references
 * var allRefs = JsonRefs.findRefs(obj);
 * // Finding all remote references
 * var remoteRefs = JsonRefs.findRefs(obj, {filter: ['relative', 'remote']});
 * // Finding all invalid references
 * var invalidRefs = JsonRefs.findRefs(obj, {filter: 'invalid', includeInvalid: true});
 */
module.exports.findRefs = function (obj, options) {
  return findRefs(obj, options);
};

/**
 * Finds JSON References defined within the document at the provided location.
 *
 * This API is identical to {@link findRefs} except this API will retrieve a remote document and then
 * return the result of {@link findRefs} on the retrieved document.
 *
 * @param {string} location - The location to retrieve *(Can be relative or absolute, just make sure you look at the
 * {@link module:json-refs~JsonRefsOptions|options documentation} to see how relative references are handled.)*
 * @param {module:json-refs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {Promise<module:json-refs~RetrievedRefsResults>} a promise that resolves a
 * {@link module:json-refs~RetrievedRefsResults} and rejects with an `Error` when the input arguments fail validation,
 * when `options.subDocPath` points to an invalid location or when the location argument points to an unloadable
 * resource
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
module.exports.findRefsAt = function (location, options) {
  return findRefsAt(location, options);
};

/**
 * Returns detailed information about the JSON Reference.
 *
 * @param {object} obj - The JSON Reference definition
 *
 * @returns {module:json-refs~UnresolvedRefDetails} the detailed information
 */
module.exports.getRefDetails = function (obj) {
  return getRefDetails(obj);
};

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
module.exports.isPtr = function (ptr, throwWithDetails) {
  return isPtr(ptr, throwWithDetails);
};

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
module.exports.isRef = function (obj, throwWithDetails) {
  return isRef(obj, throwWithDetails);
};

/**
 * Returns an array of path segments for the provided JSON Pointer.
 *
 * @param {string} ptr - The JSON Pointer
 *
 * @returns {string[]} the path segments
 *
 * @throws {Error} if the provided `ptr` argument is not a JSON Pointer
 */
module.exports.pathFromPtr = function (ptr) {
  return pathFromPtr(ptr);
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
 * @throws {Error} if the `path` argument is not an array
 */
module.exports.pathToPtr = function (path, hashPrefix) {
  return pathToPtr(path, hashPrefix);
};

/**
 * Finds JSON References defined within the provided array/object and resolves them.
 *
 * @param {array|object} obj - The structure to find JSON References within
 * @param {module:json-refs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {Promise<module:json-refs~ResolvedRefsResults>} a promise that resolves a
 * {@link module:json-refs~ResolvedRefsResults} and rejects with an `Error` when the input arguments fail validation,
 * when `options.subDocPath` points to an invalid location or when the location argument points to an unloadable
 * resource
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
module.exports.resolveRefs = function (obj, options) {
  return resolveRefs(obj, options);
};

/**
 * Resolves JSON References defined within the document at the provided location.
 *
 * This API is identical to {@link module:json-refs.resolveRefs} except this API will retrieve a remote document and
 * then return the result of {@link module:json-refs.resolveRefs} on the retrieved document.
 *
 * @param {string} location - The location to retrieve *(Can be relative or absolute, just make sure you look at the
 * {@link module:json-refs~JsonRefsOptions|options documentation} to see how relative references are handled.)*
 * @param {module:json-refs~JsonRefsOptions} [options] - The JsonRefs options
 *
 * @returns {Promise<module:json-refs~RetrievedResolvedRefsResults>} a promise that resolves a
 * {@link module:json-refs~RetrievedResolvedRefsResults} and rejects with an `Error` when the input arguments fail
 * validation, when `options.subDocPath` points to an invalid location or when the location argument points to an
 * unloadable resource
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
module.exports.resolveRefsAt = function (location, options) {
  return resolveRefsAt(location, options);
};

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L2xpYi9ucG8uc3JjLmpzIiwibm9kZV9tb2R1bGVzL3BhdGgtYnJvd3NlcmlmeS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcXVlcnlzdHJpbmctZXMzL2RlY29kZS5qcyIsIm5vZGVfbW9kdWxlcy9xdWVyeXN0cmluZy1lczMvZW5jb2RlLmpzIiwibm9kZV9tb2R1bGVzL3F1ZXJ5c3RyaW5nLWVzMy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9zbGFzaC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy91cmktanMvZGlzdC9lczUvdXJpLmFsbC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUM3MkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDclhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2hPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNCBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIF8gPSAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvd1snXyddIDogdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbFsnXyddIDogbnVsbCk7XG52YXIgZ2wgPSAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvd1snZ3JhcGhsaWInXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ2dyYXBobGliJ10gOiBudWxsKTtcbnZhciBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xudmFyIFBhdGhMb2FkZXIgPSAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvd1snUGF0aExvYWRlciddIDogdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbFsnUGF0aExvYWRlciddIDogbnVsbCk7XG52YXIgcXMgPSByZXF1aXJlKCdxdWVyeXN0cmluZycpO1xudmFyIHNsYXNoID0gcmVxdWlyZSgnc2xhc2gnKTtcbnZhciBVUkkgPSByZXF1aXJlKCd1cmktanMnKTtcblxudmFyIGJhZFB0clRva2VuUmVnZXggPSAvfig/OlteMDFdfCQpL2c7XG52YXIgcmVtb3RlQ2FjaGUgPSB7fTtcbnZhciByZW1vdGVUeXBlcyA9IFsncmVsYXRpdmUnLCAncmVtb3RlJ107XG52YXIgcmVtb3RlVXJpVHlwZXMgPSBbJ2Fic29sdXRlJywgJ3VyaSddO1xudmFyIHVyaURldGFpbHNDYWNoZSA9IHt9O1xuXG4vLyBMb2FkIHByb21pc2VzIHBvbHlmaWxsIGlmIG5lY2Vzc2FyeVxuLyogaXN0YW5idWwgaWdub3JlIGlmICovXG5pZiAodHlwZW9mIFByb21pc2UgPT09ICd1bmRlZmluZWQnKSB7XG4gIHJlcXVpcmUoJ25hdGl2ZS1wcm9taXNlLW9ubHknKTtcbn1cblxuLyogSW50ZXJuYWwgRnVuY3Rpb25zICovXG5cbmZ1bmN0aW9uIGNvbWJpbmVRdWVyeVBhcmFtcyAocXMxLCBxczIpIHtcbiAgdmFyIGNvbWJpbmVkID0ge307XG5cbiAgZnVuY3Rpb24gbWVyZ2VRdWVyeVBhcmFtcyAob2JqKSB7XG4gICAgXy5mb3JPd24ob2JqLCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICAgIGNvbWJpbmVkW2tleV0gPSB2YWw7XG4gICAgfSk7XG4gIH1cblxuICBtZXJnZVF1ZXJ5UGFyYW1zKHFzLnBhcnNlKHFzMSB8fCAnJykpO1xuICBtZXJnZVF1ZXJ5UGFyYW1zKHFzLnBhcnNlKHFzMiB8fCAnJykpO1xuXG4gIHJldHVybiBPYmplY3Qua2V5cyhjb21iaW5lZCkubGVuZ3RoID09PSAwID8gdW5kZWZpbmVkIDogcXMuc3RyaW5naWZ5KGNvbWJpbmVkKTtcbn1cblxuZnVuY3Rpb24gY29tYmluZVVSSXMgKHUxLCB1Mikge1xuICAvLyBDb252ZXJ0IFdpbmRvd3MgcGF0aHNcbiAgaWYgKF8uaXNTdHJpbmcodTEpKSB7XG4gICAgdTEgPSBzbGFzaCh1MSk7XG4gIH1cblxuICBpZiAoXy5pc1N0cmluZyh1MikpIHtcbiAgICB1MiA9IHNsYXNoKHUyKTtcbiAgfVxuXG4gIHZhciB1MkRldGFpbHMgPSBwYXJzZVVSSShfLmlzVW5kZWZpbmVkKHUyKSA/ICcnIDogdTIpO1xuICB2YXIgdTFEZXRhaWxzO1xuICB2YXIgY29tYmluZWREZXRhaWxzO1xuXG4gIGlmIChyZW1vdGVVcmlUeXBlcy5pbmRleE9mKHUyRGV0YWlscy5yZWZlcmVuY2UpID4gLTEpIHtcbiAgICBjb21iaW5lZERldGFpbHMgPSB1MkRldGFpbHM7XG4gIH0gZWxzZSB7XG4gICAgdTFEZXRhaWxzID0gXy5pc1VuZGVmaW5lZCh1MSkgPyB1bmRlZmluZWQgOiBwYXJzZVVSSSh1MSk7XG5cbiAgICBpZiAoIV8uaXNVbmRlZmluZWQodTFEZXRhaWxzKSkge1xuICAgICAgY29tYmluZWREZXRhaWxzID0gdTFEZXRhaWxzO1xuXG4gICAgICAvLyBKb2luIHRoZSBwYXRoc1xuICAgICAgY29tYmluZWREZXRhaWxzLnBhdGggPSBzbGFzaChwYXRoLmpvaW4odTFEZXRhaWxzLnBhdGgsIHUyRGV0YWlscy5wYXRoKSk7XG5cbiAgICAgIC8vIEpvaW4gcXVlcnkgcGFyYW1ldGVyc1xuICAgICAgY29tYmluZWREZXRhaWxzLnF1ZXJ5ID0gY29tYmluZVF1ZXJ5UGFyYW1zKHUxRGV0YWlscy5xdWVyeSwgdTJEZXRhaWxzLnF1ZXJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29tYmluZWREZXRhaWxzID0gdTJEZXRhaWxzO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSB0aGUgZnJhZ21lbnRcbiAgY29tYmluZWREZXRhaWxzLmZyYWdtZW50ID0gdW5kZWZpbmVkO1xuXG4gIC8vIEZvciByZWxhdGl2ZSBVUklzLCBhZGQgYmFjayB0aGUgJy4uJyBzaW5jZSBpdCB3YXMgcmVtb3ZlZCBhYm92ZVxuICByZXR1cm4gKHJlbW90ZVVyaVR5cGVzLmluZGV4T2YoY29tYmluZWREZXRhaWxzLnJlZmVyZW5jZSkgPT09IC0xICYmXG4gICAgICAgICAgY29tYmluZWREZXRhaWxzLnBhdGguaW5kZXhPZignLi4vJykgPT09IDAgPyAnLi4vJyA6ICcnKSArIFVSSS5zZXJpYWxpemUoY29tYmluZWREZXRhaWxzKTtcbn1cblxuZnVuY3Rpb24gZmluZEFuY2VzdG9ycyAob2JqLCBwYXRoKSB7XG4gIHZhciBhbmNlc3RvcnMgPSBbXTtcbiAgdmFyIG5vZGU7XG5cbiAgaWYgKHBhdGgubGVuZ3RoID4gMCkge1xuICAgIG5vZGUgPSBvYmo7XG5cbiAgICBwYXRoLnNsaWNlKDAsIHBhdGgubGVuZ3RoIC0gMSkuZm9yRWFjaChmdW5jdGlvbiAoc2VnKSB7XG4gICAgICBpZiAoc2VnIGluIG5vZGUpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVbc2VnXTtcblxuICAgICAgICBhbmNlc3RvcnMucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBhbmNlc3RvcnM7XG59XG5cbmZ1bmN0aW9uIGlzUmVtb3RlIChyZWZEZXRhaWxzKSB7XG4gIHJldHVybiByZW1vdGVUeXBlcy5pbmRleE9mKGdldFJlZlR5cGUocmVmRGV0YWlscykpID4gLTE7XG59XG5cbmZ1bmN0aW9uIGlzVmFsaWQgKHJlZkRldGFpbHMpIHtcbiAgcmV0dXJuIF8uaXNVbmRlZmluZWQocmVmRGV0YWlscy5lcnJvcikgJiYgcmVmRGV0YWlscy50eXBlICE9PSAnaW52YWxpZCc7XG59XG5cbmZ1bmN0aW9uIGZpbmRWYWx1ZSAob2JqLCBwYXRoKSB7XG4gIHZhciB2YWx1ZSA9IG9iajtcblxuICAvLyBVc2luZyB0aGlzIG1hbnVhbCBhcHByb2FjaCBpbnN0ZWFkIG9mIF8uZ2V0IHNpbmNlIHdlIGhhdmUgdG8gZGVjb2RlVVJJIHRoZSBzZWdtZW50c1xuICBwYXRoLmZvckVhY2goZnVuY3Rpb24gKHNlZykge1xuICAgIGlmIChzZWcgaW4gdmFsdWUpIHtcbiAgICAgIHZhbHVlID0gdmFsdWVbc2VnXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgRXJyb3IoJ0pTT04gUG9pbnRlciBwb2ludHMgdG8gbWlzc2luZyBsb2NhdGlvbjogJyArIHBhdGhUb1B0cihwYXRoKSk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGdldEV4dHJhUmVmS2V5cyAocmVmKSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhyZWYpLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG4gICAgcmV0dXJuIGtleSAhPT0gJyRyZWYnO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0UmVmVHlwZSAocmVmRGV0YWlscykge1xuICB2YXIgdHlwZTtcblxuICAvLyBDb252ZXJ0IHRoZSBVUkkgcmVmZXJlbmNlIHRvIG9uZSBvZiBvdXIgdHlwZXNcbiAgc3dpdGNoIChyZWZEZXRhaWxzLnVyaURldGFpbHMucmVmZXJlbmNlKSB7XG4gIGNhc2UgJ2Fic29sdXRlJzpcbiAgY2FzZSAndXJpJzpcbiAgICB0eXBlID0gJ3JlbW90ZSc7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ3NhbWUtZG9jdW1lbnQnOlxuICAgIHR5cGUgPSAnbG9jYWwnO1xuICAgIGJyZWFrO1xuICBkZWZhdWx0OlxuICAgIHR5cGUgPSByZWZEZXRhaWxzLnVyaURldGFpbHMucmVmZXJlbmNlO1xuICB9XG5cbiAgcmV0dXJuIHR5cGU7XG59XG5cbmZ1bmN0aW9uIGdldFJlbW90ZURvY3VtZW50ICh1cmwsIG9wdGlvbnMpIHtcbiAgdmFyIGNhY2hlRW50cnkgPSByZW1vdGVDYWNoZVt1cmxdO1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgdmFyIGxvYWRlck9wdGlvbnMgPSBfLmNsb25lRGVlcChvcHRpb25zLmxvYWRlck9wdGlvbnMgfHwge30pO1xuXG4gIGlmIChfLmlzVW5kZWZpbmVkKGNhY2hlRW50cnkpKSB7XG4gICAgLy8gSWYgdGhlcmUgaXMgbm8gY29udGVudCBwcm9jZXNzb3IsIGRlZmF1bHQgdG8gcHJvY2Vzc2luZyB0aGUgcmF3IHJlc3BvbnNlIGFzIEpTT05cbiAgICBpZiAoXy5pc1VuZGVmaW5lZChsb2FkZXJPcHRpb25zLnByb2Nlc3NDb250ZW50KSkge1xuICAgICAgbG9hZGVyT3B0aW9ucy5wcm9jZXNzQ29udGVudCA9IGZ1bmN0aW9uIChyZXMsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrKHVuZGVmaW5lZCwgSlNPTi5wYXJzZShyZXMudGV4dCkpO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBdHRlbXB0IHRvIGxvYWQgdGhlIHJlc291cmNlIHVzaW5nIHBhdGgtbG9hZGVyXG4gICAgYWxsVGFza3MgPSBQYXRoTG9hZGVyLmxvYWQoZGVjb2RlVVJJKHVybCksIGxvYWRlck9wdGlvbnMpO1xuXG4gICAgLy8gVXBkYXRlIHRoZSBjYWNoZVxuICAgIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgcmVtb3RlQ2FjaGVbdXJsXSA9IHtcbiAgICAgICAgICB2YWx1ZTogcmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZnVuY3Rpb24gKGVycikge1xuICAgICAgICByZW1vdGVDYWNoZVt1cmxdID0ge1xuICAgICAgICAgIGVycm9yOiBlcnJcbiAgICAgICAgfTtcblxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBSZXR1cm4gdGhlIGNhY2hlZCB2ZXJzaW9uXG4gICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChfLmlzRXJyb3IoY2FjaGVFbnRyeS5lcnJvcikpIHtcbiAgICAgICAgdGhyb3cgY2FjaGVFbnRyeS5lcnJvcjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBjYWNoZUVudHJ5LnZhbHVlO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgY2xvbmVkIHZlcnNpb24gdG8gYXZvaWQgdXBkYXRpbmcgdGhlIGNhY2hlXG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgcmV0dXJuIF8uY2xvbmVEZWVwKHJlcyk7XG4gIH0pO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuZnVuY3Rpb24gaXNSZWZMaWtlIChvYmosIHRocm93V2l0aERldGFpbHMpIHtcbiAgdmFyIHJlZkxpa2UgPSB0cnVlO1xuXG4gIHRyeSB7XG4gICAgaWYgKCFfLmlzUGxhaW5PYmplY3Qob2JqKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvYmogaXMgbm90IGFuIE9iamVjdCcpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNTdHJpbmcob2JqLiRyZWYpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29iai4kcmVmIGlzIG5vdCBhIFN0cmluZycpO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKHRocm93V2l0aERldGFpbHMpIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICByZWZMaWtlID0gZmFsc2U7XG4gIH1cblxuICByZXR1cm4gcmVmTGlrZTtcbn1cblxuZnVuY3Rpb24gbWFrZUFic29sdXRlIChsb2NhdGlvbikge1xuICBpZiAobG9jYXRpb24uaW5kZXhPZignOi8vJykgPT09IC0xICYmICFwYXRoLmlzQWJzb2x1dGUobG9jYXRpb24pKSB7XG4gICAgcmV0dXJuIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBsb2NhdGlvbik7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGxvY2F0aW9uO1xuICB9XG59XG5cbmZ1bmN0aW9uIG1ha2VSZWZGaWx0ZXIgKG9wdGlvbnMpIHtcbiAgdmFyIHJlZkZpbHRlcjtcbiAgdmFyIHZhbGlkVHlwZXM7XG5cbiAgaWYgKF8uaXNBcnJheShvcHRpb25zLmZpbHRlcikgfHwgXy5pc1N0cmluZyhvcHRpb25zLmZpbHRlcikpIHtcbiAgICB2YWxpZFR5cGVzID0gXy5pc1N0cmluZyhvcHRpb25zLmZpbHRlcikgPyBbb3B0aW9ucy5maWx0ZXJdIDogb3B0aW9ucy5maWx0ZXI7XG4gICAgcmVmRmlsdGVyID0gZnVuY3Rpb24gKHJlZkRldGFpbHMpIHtcbiAgICAgIC8vIENoZWNrIHRoZSBleGFjdCB0eXBlIG9yIGZvciBpbnZhbGlkIFVSSXMsIGNoZWNrIGl0cyBvcmlnaW5hbCB0eXBlXG4gICAgICByZXR1cm4gdmFsaWRUeXBlcy5pbmRleE9mKHJlZkRldGFpbHMudHlwZSkgPiAtMSB8fCB2YWxpZFR5cGVzLmluZGV4T2YoZ2V0UmVmVHlwZShyZWZEZXRhaWxzKSkgPiAtMTtcbiAgICB9O1xuICB9IGVsc2UgaWYgKF8uaXNGdW5jdGlvbihvcHRpb25zLmZpbHRlcikpIHtcbiAgICByZWZGaWx0ZXIgPSBvcHRpb25zLmZpbHRlcjtcbiAgfSBlbHNlIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZmlsdGVyKSkge1xuICAgIHJlZkZpbHRlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH07XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gKHJlZkRldGFpbHMsIHBhdGgpIHtcbiAgICByZXR1cm4gKHJlZkRldGFpbHMudHlwZSAhPT0gJ2ludmFsaWQnIHx8IG9wdGlvbnMuaW5jbHVkZUludmFsaWQgPT09IHRydWUpICYmIHJlZkZpbHRlcihyZWZEZXRhaWxzLCBwYXRoKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFrZVN1YkRvY1BhdGggKG9wdGlvbnMpIHtcbiAgdmFyIHN1YkRvY1BhdGg7XG5cbiAgaWYgKF8uaXNBcnJheShvcHRpb25zLnN1YkRvY1BhdGgpKSB7XG4gICAgc3ViRG9jUGF0aCA9IG9wdGlvbnMuc3ViRG9jUGF0aDtcbiAgfSBlbHNlIGlmIChfLmlzU3RyaW5nKG9wdGlvbnMuc3ViRG9jUGF0aCkpIHtcbiAgICBzdWJEb2NQYXRoID0gcGF0aEZyb21QdHIob3B0aW9ucy5zdWJEb2NQYXRoKTtcbiAgfSBlbHNlIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMuc3ViRG9jUGF0aCkpIHtcbiAgICBzdWJEb2NQYXRoID0gW107XG4gIH1cblxuICByZXR1cm4gc3ViRG9jUGF0aDtcbn1cblxuZnVuY3Rpb24gbWFya01pc3NpbmcgKHJlZkRldGFpbHMsIGVycikge1xuICByZWZEZXRhaWxzLmVycm9yID0gZXJyLm1lc3NhZ2U7XG4gIHJlZkRldGFpbHMubWlzc2luZyA9IHRydWU7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVVJJICh1cmkpIHtcbiAgLy8gV2UgZGVjb2RlIGZpcnN0IHRvIGF2b2lkIGRvdWJseSBlbmNvZGluZ1xuICByZXR1cm4gVVJJLnBhcnNlKHVyaSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkUmVmTW9kZWwgKGRvY3VtZW50LCBvcHRpb25zLCBtZXRhZGF0YSkge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgdmFyIHN1YkRvY1B0ciA9IHBhdGhUb1B0cihvcHRpb25zLnN1YkRvY1BhdGgpO1xuICB2YXIgYWJzTG9jYXRpb24gPSBtYWtlQWJzb2x1dGUob3B0aW9ucy5sb2NhdGlvbik7XG4gIHZhciByZWxhdGl2ZUJhc2UgPSBwYXRoLmRpcm5hbWUob3B0aW9ucy5sb2NhdGlvbik7XG4gIHZhciBkb2NEZXBLZXkgPSBhYnNMb2NhdGlvbiArIHN1YkRvY1B0cjtcbiAgdmFyIHJlZnM7XG4gIHZhciByT3B0aW9ucztcblxuICAvLyBTdG9yZSB0aGUgZG9jdW1lbnQgaW4gdGhlIG1ldGFkYXRhIGlmIG5lY2Vzc2FyeVxuICBpZiAoXy5pc1VuZGVmaW5lZChtZXRhZGF0YS5kb2NzW2Fic0xvY2F0aW9uXSkpIHtcbiAgICBtZXRhZGF0YS5kb2NzW2Fic0xvY2F0aW9uXSA9IGRvY3VtZW50O1xuICB9XG5cbiAgLy8gSWYgdGhlcmUgYXJlIG5vIGRlcGVuZGVuY2llcyBzdG9yZWQgZm9yIHRoZSBsb2NhdGlvbitzdWJEb2NQYXRoLCB3ZSd2ZSBuZXZlciBzZWVuIGl0IGJlZm9yZSBhbmQgd2lsbCBwcm9jZXNzIGl0XG4gIGlmIChfLmlzVW5kZWZpbmVkKG1ldGFkYXRhLmRlcHNbZG9jRGVwS2V5XSkpIHtcbiAgICBtZXRhZGF0YS5kZXBzW2RvY0RlcEtleV0gPSB7fTtcblxuICAgIC8vIEZpbmQgdGhlIHJlZmVyZW5jZXMgYmFzZWQgb24gdGhlIG9wdGlvbnNcbiAgICByZWZzID0gZmluZFJlZnMoZG9jdW1lbnQsIG9wdGlvbnMpO1xuXG4gICAgLy8gSXRlcmF0ZSBvdmVyIHRoZSByZWZlcmVuY2VzIGFuZCBwcm9jZXNzXG4gICAgXy5mb3JPd24ocmVmcywgZnVuY3Rpb24gKHJlZkRldGFpbHMsIHJlZlB0cikge1xuICAgICAgdmFyIHJlZktleSA9IG1ha2VBYnNvbHV0ZShvcHRpb25zLmxvY2F0aW9uKSArIHJlZlB0cjtcbiAgICAgIHZhciByZWZkS2V5ID0gcmVmRGV0YWlscy5yZWZkSWQgPSBkZWNvZGVVUkkobWFrZUFic29sdXRlKGlzUmVtb3RlKHJlZkRldGFpbHMpID9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21iaW5lVVJJcyhyZWxhdGl2ZUJhc2UsIHJlZkRldGFpbHMudXJpKSA6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5sb2NhdGlvbikgKyAnIycgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHJlZkRldGFpbHMudXJpLmluZGV4T2YoJyMnKSA+IC0xID9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZkRldGFpbHMudXJpLnNwbGl0KCcjJylbMV0gOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJycpKTtcblxuICAgICAgLy8gUmVjb3JkIHJlZmVyZW5jZSBtZXRhZGF0YVxuICAgICAgbWV0YWRhdGEucmVmc1tyZWZLZXldID0gcmVmRGV0YWlscztcblxuICAgICAgLy8gRG8gbm90IHByb2Nlc3MgaW52YWxpZCByZWZlcmVuY2VzXG4gICAgICBpZiAoIWlzVmFsaWQocmVmRGV0YWlscykpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBSZWNvcmQgdGhlIGZ1bGx5LXF1YWxpZmllZCBVUklcbiAgICAgIHJlZkRldGFpbHMuZnFVUkkgPSByZWZkS2V5O1xuXG4gICAgICAvLyBSZWNvcmQgZGVwZW5kZW5jeSAocmVsYXRpdmUgdG8gdGhlIGRvY3VtZW50J3Mgc3ViLWRvY3VtZW50IHBhdGgpXG4gICAgICBtZXRhZGF0YS5kZXBzW2RvY0RlcEtleV1bcmVmUHRyID09PSBzdWJEb2NQdHIgPyAnIycgOiByZWZQdHIucmVwbGFjZShzdWJEb2NQdHIgKyAnLycsICcjLycpXSA9IHJlZmRLZXk7XG5cbiAgICAgIC8vIERvIG5vdCBwcm9jZXNzIGRpcmVjdGx5LWNpcmN1bGFyIHJlZmVyZW5jZXMgKHRvIGFuIGFuY2VzdG9yIG9yIHNlbGYpXG4gICAgICBpZiAocmVmS2V5LmluZGV4T2YocmVmZEtleSArICcvJykgPT09IDApIHtcbiAgICAgICAgcmVmRGV0YWlscy5jaXJjdWxhciA9IHRydWU7XG5cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBQcmVwYXJlIHRoZSBvcHRpb25zIGZvciBzdWJzZXF1ZW50IHByb2Nlc3NEb2N1bWVudCBjYWxsc1xuICAgICAgck9wdGlvbnMgPSBfLmNsb25lRGVlcChvcHRpb25zKTtcblxuICAgICAgck9wdGlvbnMuc3ViRG9jUGF0aCA9IF8uaXNVbmRlZmluZWQocmVmRGV0YWlscy51cmlEZXRhaWxzLmZyYWdtZW50KSA/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW10gOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGhGcm9tUHRyKGRlY29kZVVSSShyZWZEZXRhaWxzLnVyaURldGFpbHMuZnJhZ21lbnQpKTtcblxuICAgICAgLy8gUmVzb2x2ZSB0aGUgcmVmZXJlbmNlXG4gICAgICBpZiAoaXNSZW1vdGUocmVmRGV0YWlscykpIHtcbiAgICAgICAgLy8gRGVsZXRlIGZpbHRlci5vcHRpb25zIGJlY2F1c2UgYWxsIHJlbW90ZSByZWZlcmVuY2VzIHNob3VsZCBiZSBmdWxseSByZXNvbHZlZFxuICAgICAgICBkZWxldGUgck9wdGlvbnMuZmlsdGVyO1xuICAgICAgICAvLyBUaGUgbmV3IGxvY2F0aW9uIGJlaW5nIHJlZmVyZW5jZWRcbiAgICAgICAgck9wdGlvbnMubG9jYXRpb24gPSByZWZkS2V5LnNwbGl0KCcjJylbMF07XG5cbiAgICAgICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChuTWV0YWRhdGEsIG5PcHRpb25zKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICB2YXIgckFic0xvY2F0aW9uID0gbWFrZUFic29sdXRlKG5PcHRpb25zLmxvY2F0aW9uKTtcbiAgICAgICAgICAgICAgdmFyIHJEb2MgPSBuTWV0YWRhdGEuZG9jc1tyQWJzTG9jYXRpb25dO1xuXG4gICAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKHJEb2MpKSB7XG4gICAgICAgICAgICAgICAgLy8gV2UgaGF2ZSBubyBjYWNoZSBzbyB3ZSBtdXN0IHJldHJpZXZlIHRoZSBkb2N1bWVudFxuICAgICAgICAgICAgICAgIHJldHVybiBnZXRSZW1vdGVEb2N1bWVudChyQWJzTG9jYXRpb24sIG5PcHRpb25zKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gU3RvcmUgdGhlIHJlc3BvbnNlIGluIHRoZSBkb2N1bWVudCBjYWNoZVxuICAgICAgICAgICAgICAgICAgICAgICAgICBuTWV0YWRhdGEuZG9jc1tyQWJzTG9jYXRpb25dID0gZXJyO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJldHVybiB0aGUgZXJyb3IgdG8gYWxsb3cgdGhlIHN1YnNlcXVlbnQgYHRoZW5gIHRvIGhhbmRsZSBib3RoIGVycm9ycyBhbmQgc3VjY2Vzc2VzXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBlcnI7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBXZSBoYXZlIGFscmVhZHkgcmV0cmlldmVkIChvciBhdHRlbXB0ZWQgdG8pIHRoZSBkb2N1bWVudCBhbmQgc2hvdWxkIHVzZSB0aGUgY2FjaGVkIHZlcnNpb24gaW4gdGhlXG4gICAgICAgICAgICAgICAgLy8gbWV0YWRhdGEgc2luY2UgaXQgY291bGQgYWxyZWFkeSBiZSBwcm9jZXNzZWQgc29tZS5cbiAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJEb2M7XG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9KG1ldGFkYXRhLCByT3B0aW9ucykpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBkb2N1bWVudDtcbiAgICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gUHJvY2VzcyB0aGUgcmVtb3RlIGRvY3VtZW50IG9yIHRoZSByZWZlcmVuY2VkIHBvcnRpb24gb2YgdGhlIGxvY2FsIGRvY3VtZW50XG4gICAgICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uIChuTWV0YWRhdGEsIG5PcHRpb25zLCBuUmVmRGV0YWlscykge1xuICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoZG9jKSB7XG4gICAgICAgICAgICBpZiAoXy5pc0Vycm9yKGRvYykpIHtcbiAgICAgICAgICAgICAgbWFya01pc3NpbmcoblJlZkRldGFpbHMsIGRvYyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBXcmFwcGVkIGluIGEgdHJ5L2NhdGNoIHNpbmNlIGZpbmRSZWZzIHRocm93c1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJldHVybiBidWlsZFJlZk1vZGVsKGRvYywgbk9wdGlvbnMsIG5NZXRhZGF0YSlcbiAgICAgICAgICAgICAgICAgIC5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcmtNaXNzaW5nKG5SZWZEZXRhaWxzLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIG1hcmtNaXNzaW5nKG5SZWZEZXRhaWxzLCBlcnIpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfTtcbiAgICAgICAgfShtZXRhZGF0YSwgck9wdGlvbnMsIHJlZkRldGFpbHMpKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuZnVuY3Rpb24gc2V0VmFsdWUgKG9iaiwgcmVmUGF0aCwgdmFsdWUpIHtcbiAgZmluZFZhbHVlKG9iaiwgcmVmUGF0aC5zbGljZSgwLCByZWZQYXRoLmxlbmd0aCAtIDEpKVtyZWZQYXRoW3JlZlBhdGgubGVuZ3RoIC0gMV1dID0gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHdhbGsgKGFuY2VzdG9ycywgbm9kZSwgcGF0aCwgZm4pIHtcbiAgdmFyIHByb2Nlc3NDaGlsZHJlbiA9IHRydWU7XG5cbiAgZnVuY3Rpb24gd2Fsa0l0ZW0gKGl0ZW0sIHNlZ21lbnQpIHtcbiAgICBwYXRoLnB1c2goc2VnbWVudCk7XG4gICAgd2FsayhhbmNlc3RvcnMsIGl0ZW0sIHBhdGgsIGZuKTtcbiAgICBwYXRoLnBvcCgpO1xuICB9XG5cbiAgLy8gQ2FsbCB0aGUgaXRlcmF0ZWVcbiAgaWYgKF8uaXNGdW5jdGlvbihmbikpIHtcbiAgICBwcm9jZXNzQ2hpbGRyZW4gPSBmbihhbmNlc3RvcnMsIG5vZGUsIHBhdGgpO1xuICB9XG5cbiAgLy8gV2UgZG8gbm90IHByb2Nlc3MgY2lyY3VsYXIgb2JqZWN0cyBhZ2FpblxuICBpZiAoYW5jZXN0b3JzLmluZGV4T2Yobm9kZSkgPT09IC0xKSB7XG4gICAgYW5jZXN0b3JzLnB1c2gobm9kZSk7XG5cbiAgICBpZiAocHJvY2Vzc0NoaWxkcmVuICE9PSBmYWxzZSkge1xuICAgICAgaWYgKF8uaXNBcnJheShub2RlKSkge1xuICAgICAgICBub2RlLmZvckVhY2goZnVuY3Rpb24gKG1lbWJlciwgaW5kZXgpIHtcbiAgICAgICAgICB3YWxrSXRlbShtZW1iZXIsIGluZGV4LnRvU3RyaW5nKCkpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAoXy5pc09iamVjdChub2RlKSkge1xuICAgICAgICBfLmZvck93bihub2RlLCBmdW5jdGlvbiAoY05vZGUsIGtleSkge1xuICAgICAgICAgIHdhbGtJdGVtKGNOb2RlLCBrZXkpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhbmNlc3RvcnMucG9wKCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVPcHRpb25zIChvcHRpb25zLCBvYmopIHtcbiAgdmFyIGxvY2F0aW9uUGFydHM7XG4gIHZhciBzaG91bGREZWNvZGU7XG5cbiAgaWYgKF8uaXNVbmRlZmluZWQob3B0aW9ucykpIHtcbiAgICAvLyBEZWZhdWx0IHRvIGFuIGVtcHR5IG9wdGlvbnMgb2JqZWN0XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9IGVsc2Uge1xuICAgIC8vIENsb25lIHRoZSBvcHRpb25zIHNvIHdlIGRvIG5vdCBhbHRlciB0aGUgb25lcyBwYXNzZWQgaW5cbiAgICBvcHRpb25zID0gXy5jbG9uZURlZXAob3B0aW9ucyk7XG4gIH1cblxuICBpZiAoIV8uaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zIG11c3QgYmUgYW4gT2JqZWN0Jyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5yZXNvbHZlQ2lyY3VsYXJzKSAmJlxuICAgICAgICAgICAgICFfLmlzQm9vbGVhbihvcHRpb25zLnJlc29sdmVDaXJjdWxhcnMpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5yZXNvbHZlQ2lyY3VsYXJzIG11c3QgYmUgYSBCb29sZWFuJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5maWx0ZXIpICYmXG4gICAgICAgICAgICAgIV8uaXNBcnJheShvcHRpb25zLmZpbHRlcikgJiZcbiAgICAgICAgICAgICAhXy5pc0Z1bmN0aW9uKG9wdGlvbnMuZmlsdGVyKSAmJlxuICAgICAgICAgICAgICFfLmlzU3RyaW5nKG9wdGlvbnMuZmlsdGVyKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMuZmlsdGVyIG11c3QgYmUgYW4gQXJyYXksIGEgRnVuY3Rpb24gb2YgYSBTdHJpbmcnKTtcbiAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmluY2x1ZGVJbnZhbGlkKSAmJlxuICAgICAgICAgICAgICFfLmlzQm9vbGVhbihvcHRpb25zLmluY2x1ZGVJbnZhbGlkKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMuaW5jbHVkZUludmFsaWQgbXVzdCBiZSBhIEJvb2xlYW4nKTtcbiAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmxvY2F0aW9uKSAmJlxuICAgICAgICAgICAgICFfLmlzU3RyaW5nKG9wdGlvbnMubG9jYXRpb24pKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5sb2NhdGlvbiBtdXN0IGJlIGEgU3RyaW5nJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5yZWZQcmVQcm9jZXNzb3IpICYmXG4gICAgICAgICAgICAgIV8uaXNGdW5jdGlvbihvcHRpb25zLnJlZlByZVByb2Nlc3NvcikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zLnJlZlByZVByb2Nlc3NvciBtdXN0IGJlIGEgRnVuY3Rpb24nKTtcbiAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLnJlZlBvc3RQcm9jZXNzb3IpICYmXG4gICAgICAgICAgICAgIV8uaXNGdW5jdGlvbihvcHRpb25zLnJlZlBvc3RQcm9jZXNzb3IpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yIG11c3QgYmUgYSBGdW5jdGlvbicpO1xuICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMuc3ViRG9jUGF0aCkgJiZcbiAgICAgICAgICAgICAhXy5pc0FycmF5KG9wdGlvbnMuc3ViRG9jUGF0aCkgJiZcbiAgICAgICAgICAgICAhaXNQdHIob3B0aW9ucy5zdWJEb2NQYXRoKSkge1xuICAgIC8vIElmIGEgcG9pbnRlciBpcyBwcm92aWRlZCwgdGhyb3cgYW4gZXJyb3IgaWYgaXQncyBub3QgdGhlIHByb3BlciB0eXBlXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucy5zdWJEb2NQYXRoIG11c3QgYmUgYW4gQXJyYXkgb2YgcGF0aCBzZWdtZW50cyBvciBhIHZhbGlkIEpTT04gUG9pbnRlcicpO1xuICB9XG5cbiAgLy8gRGVmYXVsdCB0byBmYWxzZSBmb3IgYWxsb3dpbmcgY2lyY3VsYXJzXG4gIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMucmVzb2x2ZUNpcmN1bGFycykpIHtcbiAgICBvcHRpb25zLnJlc29sdmVDaXJjdWxhcnMgPSBmYWxzZTtcbiAgfVxuXG4gIG9wdGlvbnMuZmlsdGVyID0gbWFrZVJlZkZpbHRlcihvcHRpb25zKTtcblxuICAvLyBvcHRpb25zLmxvY2F0aW9uIGlzIG5vdCBvZmZpY2lhbGx5IHN1cHBvcnRlZCB5ZXQgYnV0IHdpbGwgYmUgd2hlbiBJc3N1ZSA4OCBpcyBjb21wbGV0ZVxuICBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zLmxvY2F0aW9uKSkge1xuICAgIG9wdGlvbnMubG9jYXRpb24gPSBtYWtlQWJzb2x1dGUoJy4vcm9vdC5qc29uJyk7XG4gIH1cblxuICBsb2NhdGlvblBhcnRzID0gb3B0aW9ucy5sb2NhdGlvbi5zcGxpdCgnIycpO1xuXG4gIC8vIElmIG9wdGlvbnMubG9jYXRpb24gY29udGFpbnMgYSBmcmFnbWVudCwgdHVybiBpdCBpbnRvIGFuIG9wdGlvbnMuc3ViRG9jUGF0aFxuICBpZiAobG9jYXRpb25QYXJ0cy5sZW5ndGggPiAxKSB7XG4gICAgb3B0aW9ucy5zdWJEb2NQYXRoID0gJyMnICsgbG9jYXRpb25QYXJ0c1sxXTtcbiAgfVxuXG4gIHNob3VsZERlY29kZSA9IGRlY29kZVVSSShvcHRpb25zLmxvY2F0aW9uKSA9PT0gb3B0aW9ucy5sb2NhdGlvbjtcblxuICAvLyBKdXN0IHRvIGJlIHNhZmUsIHJlbW92ZSBhbnkgYWNjaWRlbnRhbCBmcmFnbWVudCBhcyBpdCB3b3VsZCBicmVhayB0aGluZ3NcbiAgb3B0aW9ucy5sb2NhdGlvbiA9IGNvbWJpbmVVUklzKG9wdGlvbnMubG9jYXRpb24sIHVuZGVmaW5lZCk7XG5cbiAgLy8gSWYgdGhlIGxvY2F0aW9uIHdhcyBub3QgZW5jb2RlZCwgbWVrZSBzdXJlIGl0J3Mgbm90IHdoZW4gd2UgZ2V0IGl0IGJhY2sgKElzc3VlICMxMzgpXG4gIGlmIChzaG91bGREZWNvZGUpIHtcbiAgICBvcHRpb25zLmxvY2F0aW9uID0gZGVjb2RlVVJJKG9wdGlvbnMubG9jYXRpb24pO1xuICB9XG5cbiAgLy8gU2V0IHRoZSBzdWJEb2NQYXRoIHRvIGF2b2lkIGV2ZXJ5b25lIGVsc2UgaGF2aW5nIHRvIGNvbXB1dGUgaXRcbiAgb3B0aW9ucy5zdWJEb2NQYXRoID0gbWFrZVN1YkRvY1BhdGgob3B0aW9ucyk7XG5cbiAgaWYgKCFfLmlzVW5kZWZpbmVkKG9iaikpIHtcbiAgICB0cnkge1xuICAgICAgZmluZFZhbHVlKG9iaiwgb3B0aW9ucy5zdWJEb2NQYXRoKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGVyci5tZXNzYWdlID0gZXJyLm1lc3NhZ2UucmVwbGFjZSgnSlNPTiBQb2ludGVyJywgJ29wdGlvbnMuc3ViRG9jUGF0aCcpO1xuXG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG9wdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGRlY29kZVBhdGggKHBhdGgpIHtcbiAgaWYgKCFfLmlzQXJyYXkocGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwYXRoIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgfVxuXG4gIHJldHVybiBwYXRoLm1hcChmdW5jdGlvbiAoc2VnKSB7XG4gICAgaWYgKCFfLmlzU3RyaW5nKHNlZykpIHtcbiAgICAgIHNlZyA9IEpTT04uc3RyaW5naWZ5KHNlZyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlZy5yZXBsYWNlKC9+MS9nLCAnLycpLnJlcGxhY2UoL34wL2csICd+Jyk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBlbmNvZGVQYXRoIChwYXRoKSB7XG4gIGlmICghXy5pc0FycmF5KHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF0aCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gIH1cblxuICByZXR1cm4gcGF0aC5tYXAoZnVuY3Rpb24gKHNlZykge1xuICAgIGlmICghXy5pc1N0cmluZyhzZWcpKSB7XG4gICAgICBzZWcgPSBKU09OLnN0cmluZ2lmeShzZWcpO1xuICAgIH1cblxuICAgIHJldHVybiBzZWcucmVwbGFjZSgvfi9nLCAnfjAnKS5yZXBsYWNlKC9cXC8vZywgJ34xJyk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBmaW5kUmVmcyAob2JqLCBvcHRpb25zKSB7XG4gIHZhciByZWZzID0ge307XG5cbiAgLy8gVmFsaWRhdGUgdGhlIHByb3ZpZGVkIGRvY3VtZW50XG4gIGlmICghXy5pc0FycmF5KG9iaikgJiYgIV8uaXNPYmplY3Qob2JqKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29iaiBtdXN0IGJlIGFuIEFycmF5IG9yIGFuIE9iamVjdCcpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgb3B0aW9uc1xuICBvcHRpb25zID0gdmFsaWRhdGVPcHRpb25zKG9wdGlvbnMsIG9iaik7XG5cbiAgLy8gV2FsayB0aGUgZG9jdW1lbnQgKG9yIHN1YiBkb2N1bWVudCkgYW5kIGZpbmQgYWxsIEpTT04gUmVmZXJlbmNlc1xuICB3YWxrKGZpbmRBbmNlc3RvcnMob2JqLCBvcHRpb25zLnN1YkRvY1BhdGgpLFxuICAgICAgIGZpbmRWYWx1ZShvYmosIG9wdGlvbnMuc3ViRG9jUGF0aCksXG4gICAgICAgXy5jbG9uZURlZXAob3B0aW9ucy5zdWJEb2NQYXRoKSxcbiAgICAgICBmdW5jdGlvbiAoYW5jZXN0b3JzLCBub2RlLCBwYXRoKSB7XG4gICAgICAgICB2YXIgcHJvY2Vzc0NoaWxkcmVuID0gdHJ1ZTtcbiAgICAgICAgIHZhciByZWZEZXRhaWxzO1xuICAgICAgICAgdmFyIHJlZlB0cjtcblxuICAgICAgICAgaWYgKGlzUmVmTGlrZShub2RlKSkge1xuICAgICAgICAgICAvLyBQcmUtcHJvY2VzcyB0aGUgbm9kZSB3aGVuIG5lY2Vzc2FyeVxuICAgICAgICAgICBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5yZWZQcmVQcm9jZXNzb3IpKSB7XG4gICAgICAgICAgICAgbm9kZSA9IG9wdGlvbnMucmVmUHJlUHJvY2Vzc29yKF8uY2xvbmVEZWVwKG5vZGUpLCBwYXRoKTtcbiAgICAgICAgICAgfVxuXG4gICAgICAgICAgIHJlZkRldGFpbHMgPSBnZXRSZWZEZXRhaWxzKG5vZGUpO1xuXG4gICAgICAgICAgIC8vIFBvc3QtcHJvY2VzcyB0aGUgcmVmZXJlbmNlIGRldGFpbHNcbiAgICAgICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucmVmUG9zdFByb2Nlc3NvcikpIHtcbiAgICAgICAgICAgICByZWZEZXRhaWxzID0gb3B0aW9ucy5yZWZQb3N0UHJvY2Vzc29yKHJlZkRldGFpbHMsIHBhdGgpO1xuICAgICAgICAgICB9XG5cbiAgICAgICAgICAgaWYgKG9wdGlvbnMuZmlsdGVyKHJlZkRldGFpbHMsIHBhdGgpKSB7XG4gICAgICAgICAgICAgcmVmUHRyID0gcGF0aFRvUHRyKHBhdGgpO1xuXG4gICAgICAgICAgICAgcmVmc1tyZWZQdHJdID0gcmVmRGV0YWlscztcbiAgICAgICAgICAgfVxuXG4gICAgICAgICAgIC8vIFdoZW5ldmVyIGEgSlNPTiBSZWZlcmVuY2UgaGFzIGV4dHJhIGNoaWxkcmVuLCBpdHMgY2hpbGRyZW4gc2hvdWxkIG5vdCBiZSBwcm9jZXNzZWQuXG4gICAgICAgICAgIC8vICAgU2VlOiBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzI3NlY3Rpb24tM1xuICAgICAgICAgICBpZiAoZ2V0RXh0cmFSZWZLZXlzKG5vZGUpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICBwcm9jZXNzQ2hpbGRyZW4gPSBmYWxzZTtcbiAgICAgICAgICAgfVxuICAgICAgICAgfVxuXG4gICAgICAgICByZXR1cm4gcHJvY2Vzc0NoaWxkcmVuO1xuICAgICAgIH0pO1xuXG4gIHJldHVybiByZWZzO1xufVxuXG5mdW5jdGlvbiBmaW5kUmVmc0F0IChsb2NhdGlvbiwgb3B0aW9ucykge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgLy8gVmFsaWRhdGUgdGhlIHByb3ZpZGVkIGxvY2F0aW9uXG4gICAgICBpZiAoIV8uaXNTdHJpbmcobG9jYXRpb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xvY2F0aW9uIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICAgIH1cblxuICAgICAgaWYgKF8uaXNVbmRlZmluZWQob3B0aW9ucykpIHtcbiAgICAgICAgb3B0aW9ucyA9IHt9O1xuICAgICAgfVxuXG4gICAgICBpZiAoXy5pc09iamVjdChvcHRpb25zKSkge1xuICAgICAgICAvLyBBZGQgdGhlIGxvY2F0aW9uIHRvIHRoZSBvcHRpb25zIGZvciBwcm9jZXNzaW5nL3ZhbGlkYXRpb25cbiAgICAgICAgb3B0aW9ucy5sb2NhdGlvbiA9IGxvY2F0aW9uO1xuICAgICAgfVxuXG4gICAgICAvLyBWYWxpZGF0ZSBvcHRpb25zXG4gICAgICBvcHRpb25zID0gdmFsaWRhdGVPcHRpb25zKG9wdGlvbnMpO1xuXG4gICAgICByZXR1cm4gZ2V0UmVtb3RlRG9jdW1lbnQob3B0aW9ucy5sb2NhdGlvbiwgb3B0aW9ucyk7XG4gICAgfSlcbiAgICAudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICB2YXIgY2FjaGVFbnRyeSA9IF8uY2xvbmVEZWVwKHJlbW90ZUNhY2hlW29wdGlvbnMubG9jYXRpb25dKTtcbiAgICAgIHZhciBjT3B0aW9ucyA9IF8uY2xvbmVEZWVwKG9wdGlvbnMpO1xuICAgICAgdmFyIHVyaURldGFpbHMgPSBwYXJzZVVSSShvcHRpb25zLmxvY2F0aW9uKTtcblxuICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2FjaGVFbnRyeS5yZWZzKSkge1xuICAgICAgICAvLyBEbyBub3QgZmlsdGVyIGFueSByZWZlcmVuY2VzIHNvIHRoZSBjYWNoZSBpcyBjb21wbGV0ZVxuICAgICAgICBkZWxldGUgY09wdGlvbnMuZmlsdGVyO1xuICAgICAgICBkZWxldGUgY09wdGlvbnMuc3ViRG9jUGF0aDtcblxuICAgICAgICBjT3B0aW9ucy5pbmNsdWRlSW52YWxpZCA9IHRydWU7XG5cbiAgICAgICAgcmVtb3RlQ2FjaGVbb3B0aW9ucy5sb2NhdGlvbl0ucmVmcyA9IGZpbmRSZWZzKHJlcywgY09wdGlvbnMpO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgdGhlIGZpbHRlciBvcHRpb25zIGJhY2tcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmZpbHRlcikpIHtcbiAgICAgICAgY09wdGlvbnMuZmlsdGVyID0gb3B0aW9ucy5maWx0ZXI7XG4gICAgICB9XG5cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZCh1cmlEZXRhaWxzLmZyYWdtZW50KSkge1xuICAgICAgICBjT3B0aW9ucy5zdWJEb2NQYXRoID0gcGF0aEZyb21QdHIoZGVjb2RlVVJJKHVyaURldGFpbHMuZnJhZ21lbnQpKTtcbiAgICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQodXJpRGV0YWlscy5zdWJEb2NQYXRoKSkge1xuICAgICAgICBjT3B0aW9ucy5zdWJEb2NQYXRoID0gb3B0aW9ucy5zdWJEb2NQYXRoO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGlzIHdpbGwgdXNlIHRoZSBjYWNoZSBzbyBkb24ndCB3b3JyeSBhYm91dCBjYWxsaW5nIGl0IHR3aWNlXG4gICAgICByZXR1cm4ge1xuICAgICAgICByZWZzOiBmaW5kUmVmcyhyZXMsIGNPcHRpb25zKSxcbiAgICAgICAgdmFsdWU6IHJlc1xuICAgICAgfTtcbiAgICB9KTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbmZ1bmN0aW9uIGdldFJlZkRldGFpbHMgKG9iaikge1xuICB2YXIgZGV0YWlscyA9IHtcbiAgICBkZWY6IG9ialxuICB9O1xuICB2YXIgY2FjaGVLZXk7XG4gIHZhciBleHRyYUtleXM7XG4gIHZhciB1cmlEZXRhaWxzO1xuXG4gIHRyeSB7XG4gICAgaWYgKGlzUmVmTGlrZShvYmosIHRydWUpKSB7XG4gICAgICBjYWNoZUtleSA9IG9iai4kcmVmO1xuICAgICAgdXJpRGV0YWlscyA9IHVyaURldGFpbHNDYWNoZVtjYWNoZUtleV07XG5cbiAgICAgIGlmIChfLmlzVW5kZWZpbmVkKHVyaURldGFpbHMpKSB7XG4gICAgICAgIHVyaURldGFpbHMgPSB1cmlEZXRhaWxzQ2FjaGVbY2FjaGVLZXldID0gcGFyc2VVUkkoY2FjaGVLZXkpO1xuICAgICAgfVxuXG4gICAgICBkZXRhaWxzLnVyaSA9IGNhY2hlS2V5O1xuICAgICAgZGV0YWlscy51cmlEZXRhaWxzID0gdXJpRGV0YWlscztcblxuICAgICAgaWYgKF8uaXNVbmRlZmluZWQodXJpRGV0YWlscy5lcnJvcikpIHtcbiAgICAgICAgZGV0YWlscy50eXBlID0gZ2V0UmVmVHlwZShkZXRhaWxzKTtcblxuICAgICAgICAvLyBWYWxpZGF0ZSB0aGUgSlNPTiBQb2ludGVyXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKFsnIycsICcvJ10uaW5kZXhPZihjYWNoZUtleVswXSkgPiAtMSkge1xuICAgICAgICAgICAgaXNQdHIoY2FjaGVLZXksIHRydWUpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY2FjaGVLZXkuaW5kZXhPZignIycpID4gLTEpIHtcbiAgICAgICAgICAgIGlzUHRyKHVyaURldGFpbHMuZnJhZ21lbnQsIHRydWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgZGV0YWlscy5lcnJvciA9IGVyci5tZXNzYWdlO1xuICAgICAgICAgIGRldGFpbHMudHlwZSA9ICdpbnZhbGlkJztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGV0YWlscy5lcnJvciA9IGRldGFpbHMudXJpRGV0YWlscy5lcnJvcjtcbiAgICAgICAgZGV0YWlscy50eXBlID0gJ2ludmFsaWQnO1xuICAgICAgfVxuXG4gICAgICAvLyBJZGVudGlmeSB3YXJuaW5nXG4gICAgICBleHRyYUtleXMgPSBnZXRFeHRyYVJlZktleXMob2JqKTtcblxuICAgICAgaWYgKGV4dHJhS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGRldGFpbHMud2FybmluZyA9ICdFeHRyYSBKU09OIFJlZmVyZW5jZSBwcm9wZXJ0aWVzIHdpbGwgYmUgaWdub3JlZDogJyArIGV4dHJhS2V5cy5qb2luKCcsICcpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBkZXRhaWxzLnR5cGUgPSAnaW52YWxpZCc7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBkZXRhaWxzLmVycm9yID0gZXJyLm1lc3NhZ2U7XG4gICAgZGV0YWlscy50eXBlID0gJ2ludmFsaWQnO1xuICB9XG5cbiAgcmV0dXJuIGRldGFpbHM7XG59XG5cbmZ1bmN0aW9uIGlzUHRyIChwdHIsIHRocm93V2l0aERldGFpbHMpIHtcbiAgdmFyIHZhbGlkID0gdHJ1ZTtcbiAgdmFyIGZpcnN0Q2hhcjtcblxuICB0cnkge1xuICAgIGlmIChfLmlzU3RyaW5nKHB0cikpIHtcbiAgICAgIGlmIChwdHIgIT09ICcnKSB7XG4gICAgICAgIGZpcnN0Q2hhciA9IHB0ci5jaGFyQXQoMCk7XG5cbiAgICAgICAgaWYgKFsnIycsICcvJ10uaW5kZXhPZihmaXJzdENoYXIpID09PSAtMSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcigncHRyIG11c3Qgc3RhcnQgd2l0aCBhIC8gb3IgIy8nKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaXJzdENoYXIgPT09ICcjJyAmJiBwdHIgIT09ICcjJyAmJiBwdHIuY2hhckF0KDEpICE9PSAnLycpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IHN0YXJ0IHdpdGggYSAvIG9yICMvJyk7XG4gICAgICAgIH0gZWxzZSBpZiAocHRyLm1hdGNoKGJhZFB0clRva2VuUmVnZXgpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgaGFzIGludmFsaWQgdG9rZW4ocyknKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyBub3QgYSBTdHJpbmcnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmICh0aHJvd1dpdGhEZXRhaWxzID09PSB0cnVlKSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgdmFsaWQgPSBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiB2YWxpZDtcbn1cblxuZnVuY3Rpb24gaXNSZWYgKG9iaiwgdGhyb3dXaXRoRGV0YWlscykge1xuICByZXR1cm4gaXNSZWZMaWtlKG9iaiwgdGhyb3dXaXRoRGV0YWlscykgJiYgZ2V0UmVmRGV0YWlscyhvYmosIHRocm93V2l0aERldGFpbHMpLnR5cGUgIT09ICdpbnZhbGlkJztcbn1cblxuZnVuY3Rpb24gcGF0aEZyb21QdHIgKHB0cikge1xuICB0cnkge1xuICAgIGlzUHRyKHB0ciwgdHJ1ZSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHRyIG11c3QgYmUgYSBKU09OIFBvaW50ZXI6ICcgKyBlcnIubWVzc2FnZSk7XG4gIH1cblxuICB2YXIgc2VnbWVudHMgPSBwdHIuc3BsaXQoJy8nKTtcblxuICAvLyBSZW1vdmUgdGhlIGZpcnN0IHNlZ21lbnRcbiAgc2VnbWVudHMuc2hpZnQoKTtcblxuICByZXR1cm4gZGVjb2RlUGF0aChzZWdtZW50cyk7XG59XG5cbmZ1bmN0aW9uIHBhdGhUb1B0ciAocGF0aCwgaGFzaFByZWZpeCkge1xuICBpZiAoIV8uaXNBcnJheShwYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncGF0aCBtdXN0IGJlIGFuIEFycmF5Jyk7XG4gIH1cblxuICAvLyBFbmNvZGUgZWFjaCBzZWdtZW50IGFuZCByZXR1cm5cbiAgcmV0dXJuIChoYXNoUHJlZml4ICE9PSBmYWxzZSA/ICcjJyA6ICcnKSArIChwYXRoLmxlbmd0aCA+IDAgPyAnLycgOiAnJykgKyBlbmNvZGVQYXRoKHBhdGgpLmpvaW4oJy8nKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZnMgKG9iaiwgb3B0aW9ucykge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgLy8gVmFsaWRhdGUgdGhlIHByb3ZpZGVkIGRvY3VtZW50XG4gICAgICBpZiAoIV8uaXNBcnJheShvYmopICYmICFfLmlzT2JqZWN0KG9iaikpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb2JqIG11c3QgYmUgYW4gQXJyYXkgb3IgYW4gT2JqZWN0Jyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFZhbGlkYXRlIG9wdGlvbnNcbiAgICAgIG9wdGlvbnMgPSB2YWxpZGF0ZU9wdGlvbnMob3B0aW9ucywgb2JqKTtcblxuICAgICAgLy8gQ2xvbmUgdGhlIGlucHV0IHNvIHdlIGRvIG5vdCBhbHRlciBpdFxuICAgICAgb2JqID0gXy5jbG9uZURlZXAob2JqKTtcbiAgICB9KVxuICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBtZXRhZGF0YSA9IHtcbiAgICAgICAgZGVwczoge30sIC8vIFRvIGF2b2lkIHByb2Nlc3NpbmcgdGhlIHNhbWUgcmVmZXJuZWNlIHR3aWNlLCBhbmQgZm9yIGNpcmN1bGFyIHJlZmVyZW5jZSBpZGVudGlmaWNhdGlvblxuICAgICAgICBkb2NzOiB7fSwgLy8gQ2FjaGUgdG8gYXZvaWQgcHJvY2Vzc2luZyB0aGUgc2FtZSBkb2N1bWVudCBtb3JlIHRoYW4gb25jZVxuICAgICAgICByZWZzOiB7fSAvLyBSZWZlcmVuY2UgbG9jYXRpb25zIGFuZCB0aGVpciBtZXRhZGF0YVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIGJ1aWxkUmVmTW9kZWwob2JqLCBvcHRpb25zLCBtZXRhZGF0YSlcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHJldHVybiBtZXRhZGF0YTtcbiAgICAgICAgfSk7XG4gICAgfSlcbiAgICAudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICAgICAgdmFyIGFsbFJlZnMgPSB7fTtcbiAgICAgIHZhciBjaXJjdWxhclBhdGhzID0gW107XG4gICAgICB2YXIgY2lyY3VsYXJzID0gW107XG4gICAgICB2YXIgZGVwR3JhcGggPSBuZXcgZ2wuR3JhcGgoKTtcbiAgICAgIHZhciBmdWxsTG9jYXRpb24gPSBtYWtlQWJzb2x1dGUob3B0aW9ucy5sb2NhdGlvbik7XG4gICAgICB2YXIgcmVmc1Jvb3QgPSBmdWxsTG9jYXRpb24gKyBwYXRoVG9QdHIob3B0aW9ucy5zdWJEb2NQYXRoKTtcbiAgICAgIHZhciByZWxhdGl2ZUJhc2UgPSBwYXRoLmRpcm5hbWUoZnVsbExvY2F0aW9uKTtcblxuICAgICAgLy8gSWRlbnRpZnkgY2lyY3VsYXJzXG5cbiAgICAgIC8vIEFkZCBub2RlcyBmaXJzdFxuICAgICAgT2JqZWN0LmtleXMocmVzdWx0cy5kZXBzKS5mb3JFYWNoKGZ1bmN0aW9uIChub2RlKSB7XG4gICAgICAgIGRlcEdyYXBoLnNldE5vZGUobm9kZSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVkZ2VzXG4gICAgICBfLmZvck93bihyZXN1bHRzLmRlcHMsIGZ1bmN0aW9uIChwcm9wcywgbm9kZSkge1xuICAgICAgICBfLmZvck93bihwcm9wcywgZnVuY3Rpb24gKGRlcCkge1xuICAgICAgICAgIGRlcEdyYXBoLnNldEVkZ2Uobm9kZSwgZGVwKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgY2lyY3VsYXJQYXRocyA9IGdsLmFsZy5maW5kQ3ljbGVzKGRlcEdyYXBoKTtcblxuICAgICAgLy8gQ3JlYXRlIGEgdW5pcXVlIGxpc3Qgb2YgY2lyY3VsYXJzXG4gICAgICBjaXJjdWxhclBhdGhzLmZvckVhY2goZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgICAgcGF0aC5mb3JFYWNoKGZ1bmN0aW9uIChzZWcpIHtcbiAgICAgICAgICBpZiAoY2lyY3VsYXJzLmluZGV4T2Yoc2VnKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGNpcmN1bGFycy5wdXNoKHNlZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBJZGVudGlmeSBjaXJjdWxhcnNcbiAgICAgIF8uZm9yT3duKHJlc3VsdHMuZGVwcywgZnVuY3Rpb24gKHByb3BzLCBub2RlKSB7XG4gICAgICAgIF8uZm9yT3duKHByb3BzLCBmdW5jdGlvbiAoZGVwLCBwcm9wKSB7XG4gICAgICAgICAgdmFyIGlzQ2lyY3VsYXIgPSBmYWxzZTtcbiAgICAgICAgICB2YXIgcmVmUHRyID0gbm9kZSArIHByb3Auc2xpY2UoMSk7XG4gICAgICAgICAgdmFyIHJlZkRldGFpbHMgPSByZXN1bHRzLnJlZnNbbm9kZSArIHByb3Auc2xpY2UoMSldO1xuICAgICAgICAgIHZhciByZW1vdGUgPSBpc1JlbW90ZShyZWZEZXRhaWxzKTtcbiAgICAgICAgICB2YXIgcGF0aEluZGV4O1xuXG4gICAgICAgICAgaWYgKGNpcmN1bGFycy5pbmRleE9mKGRlcCkgPiAtMSkge1xuICAgICAgICAgICAgLy8gRmlndXJlIG91dCBpZiB0aGUgY2lyY3VsYXIgaXMgcGFydCBvZiBhIGNpcmN1bGFyIGNoYWluIG9yIGp1c3QgYSByZWZlcmVuY2UgdG8gYSBjaXJjdWxhclxuICAgICAgICAgICAgY2lyY3VsYXJQYXRocy5mb3JFYWNoKGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgICAgICAgICAgIC8vIFNob3J0IGNpcmN1aXRcbiAgICAgICAgICAgICAgaWYgKGlzQ2lyY3VsYXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBwYXRoSW5kZXggPSBwYXRoLmluZGV4T2YoZGVwKTtcblxuICAgICAgICAgICAgICBpZiAocGF0aEluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBlYWNoIHBhdGggc2VnbWVudCB0byBzZWUgaWYgdGhlIHJlZmVyZW5jZSBsb2NhdGlvbiBpcyBiZW5lYXRoIG9uZSBvZiBpdHMgc2VnbWVudHNcbiAgICAgICAgICAgICAgICBwYXRoLmZvckVhY2goZnVuY3Rpb24gKHNlZykge1xuICAgICAgICAgICAgICAgICAgLy8gU2hvcnQgY2lyY3VpdFxuICAgICAgICAgICAgICAgICAgaWYgKGlzQ2lyY3VsYXIpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICBpZiAocmVmUHRyLmluZGV4T2Yoc2VnICsgJy8nKSA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGUgcmVmZXJlbmNlIGlzIGxvY2FsLCBtYXJrIGl0IGFzIGNpcmN1bGFyIGJ1dCBpZiBpdCdzIGEgcmVtb3RlIHJlZmVyZW5jZSwgb25seSBtYXJrIGl0XG4gICAgICAgICAgICAgICAgICAgIC8vIGNpcmN1bGFyIGlmIHRoZSBtYXRjaGluZyBwYXRoIGlzIHRoZSBsYXN0IHBhdGggc2VnbWVudCBvciBpdHMgbWF0Y2ggaXMgbm90IHRvIGEgZG9jdW1lbnQgcm9vdFxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbW90ZSB8fCBwYXRoSW5kZXggPT09IHBhdGgubGVuZ3RoIC0gMSB8fCBkZXBbZGVwLmxlbmd0aCAtIDFdICE9PSAnIycpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpc0NpcmN1bGFyID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaXNDaXJjdWxhcikge1xuICAgICAgICAgICAgLy8gVXBkYXRlIGFsbCByZWZlcmVuY2VzIGFuZCByZWZlcmVuY2UgZGV0YWlsc1xuICAgICAgICAgICAgcmVmRGV0YWlscy5jaXJjdWxhciA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZXNvbHZlIHRoZSByZWZlcmVuY2VzIGluIHJldmVyc2Ugb3JkZXIgc2luY2UgdGhlIGN1cnJlbnQgb3JkZXIgaXMgdG9wLWRvd25cbiAgICAgIF8uZm9yT3duKE9iamVjdC5rZXlzKHJlc3VsdHMuZGVwcykucmV2ZXJzZSgpLCBmdW5jdGlvbiAocGFyZW50UHRyKSB7XG4gICAgICAgIHZhciBkZXBzID0gcmVzdWx0cy5kZXBzW3BhcmVudFB0cl07XG4gICAgICAgIHZhciBwUHRyUGFydHMgPSBwYXJlbnRQdHIuc3BsaXQoJyMnKTtcbiAgICAgICAgdmFyIHBEb2N1bWVudCA9IHJlc3VsdHMuZG9jc1twUHRyUGFydHNbMF1dO1xuICAgICAgICB2YXIgcFB0clBhdGggPSBwYXRoRnJvbVB0cihwUHRyUGFydHNbMV0pO1xuXG4gICAgICAgIF8uZm9yT3duKGRlcHMsIGZ1bmN0aW9uIChkZXAsIHByb3ApIHtcbiAgICAgICAgICB2YXIgZGVwUGFydHMgPSBkZXAuc3BsaXQoJyMnKTtcbiAgICAgICAgICB2YXIgZERvY3VtZW50ID0gcmVzdWx0cy5kb2NzW2RlcFBhcnRzWzBdXTtcbiAgICAgICAgICB2YXIgZFB0clBhdGggPSBwUHRyUGF0aC5jb25jYXQocGF0aEZyb21QdHIocHJvcCkpO1xuICAgICAgICAgIHZhciByZWZEZXRhaWxzID0gcmVzdWx0cy5yZWZzW3BQdHJQYXJ0c1swXSArIHBhdGhUb1B0cihkUHRyUGF0aCldO1xuXG4gICAgICAgICAgLy8gUmVzb2x2ZSByZWZlcmVuY2UgaWYgdmFsaWRcbiAgICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChyZWZEZXRhaWxzLmVycm9yKSAmJiBfLmlzVW5kZWZpbmVkKHJlZkRldGFpbHMubWlzc2luZykpIHtcbiAgICAgICAgICAgIGlmICghb3B0aW9ucy5yZXNvbHZlQ2lyY3VsYXJzICYmIHJlZkRldGFpbHMuY2lyY3VsYXIpIHtcbiAgICAgICAgICAgICAgcmVmRGV0YWlscy52YWx1ZSA9IHJlZkRldGFpbHMuZGVmO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZWZEZXRhaWxzLnZhbHVlID0gZmluZFZhbHVlKGREb2N1bWVudCwgcGF0aEZyb21QdHIoZGVwUGFydHNbMV0pKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgbWFya01pc3NpbmcocmVmRGV0YWlscywgZXJyKTtcblxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIElmIHRoZSByZWZlcmVuY2UgaXMgYXQgdGhlIHJvb3Qgb2YgdGhlIGRvY3VtZW50LCByZXBsYWNlIHRoZSBkb2N1bWVudCBpbiB0aGUgY2FjaGUuICBPdGhlcndpc2UsIHJlcGxhY2VcbiAgICAgICAgICAgICAgLy8gdGhlIHZhbHVlIGluIHRoZSBhcHByb3ByaWF0ZSBsb2NhdGlvbiBpbiB0aGUgZG9jdW1lbnQgY2FjaGUuXG4gICAgICAgICAgICAgIGlmIChwUHRyUGFydHNbMV0gPT09ICcnICYmIHByb3AgPT09ICcjJykge1xuICAgICAgICAgICAgICAgIHJlc3VsdHMuZG9jc1twUHRyUGFydHNbMF1dID0gcmVmRGV0YWlscy52YWx1ZTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZXRWYWx1ZShwRG9jdW1lbnQsIGRQdHJQYXRoLCByZWZEZXRhaWxzLnZhbHVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgZnVuY3Rpb24gd2Fsa1JlZnMgKHJvb3QsIHJlZlB0ciwgcmVmUGF0aCkge1xuICAgICAgICB2YXIgcmVmUHRyUGFydHMgPSByZWZQdHIuc3BsaXQoJyMnKTtcbiAgICAgICAgdmFyIHJlZkRldGFpbHMgPSByZXN1bHRzLnJlZnNbcmVmUHRyXTtcbiAgICAgICAgdmFyIHJlZkRlcHM7XG5cbiAgICAgICAgLy8gUmVjb3JkIHRoZSByZWZlcmVuY2UgKHJlbGF0aXZlIHRvIHRoZSByb290IGRvY3VtZW50IHVubGVzcyB0aGUgcmVmZXJlbmNlIGlzIGluIHRoZSByb290IGRvY3VtZW50KVxuICAgICAgICBhbGxSZWZzW3JlZlB0clBhcnRzWzBdID09PSBvcHRpb25zLmxvY2F0aW9uID9cbiAgICAgICAgICAgICAgICAgICcjJyArIHJlZlB0clBhcnRzWzFdIDpcbiAgICAgICAgICAgICAgICAgIHBhdGhUb1B0cihvcHRpb25zLnN1YkRvY1BhdGguY29uY2F0KHJlZlBhdGgpKV0gPSByZWZEZXRhaWxzO1xuXG4gICAgICAgIC8vIERvIG5vdCB3YWxrIGludmFsaWQgcmVmZXJlbmNlc1xuICAgICAgICBpZiAocmVmRGV0YWlscy5jaXJjdWxhciB8fCAhaXNWYWxpZChyZWZEZXRhaWxzKSkge1xuICAgICAgICAgIC8vIFNhbml0aXplIGVycm9yc1xuICAgICAgICAgIGlmICghcmVmRGV0YWlscy5jaXJjdWxhciAmJiByZWZEZXRhaWxzLmVycm9yKSB7XG4gICAgICAgICAgICAvLyBUaGUgd2F5IHdlIHVzZSBmaW5kUmVmcyBub3cgcmVzdWx0cyBpbiBhbiBlcnJvciB0aGF0IGRvZXNuJ3QgbWF0Y2ggdGhlIGV4cGVjdGF0aW9uXG4gICAgICAgICAgICByZWZEZXRhaWxzLmVycm9yID0gcmVmRGV0YWlscy5lcnJvci5yZXBsYWNlKCdvcHRpb25zLnN1YkRvY1BhdGgnLCAnSlNPTiBQb2ludGVyJyk7XG5cbiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgZXJyb3IgdG8gdXNlIHRoZSBhcHByb3ByaWF0ZSBKU09OIFBvaW50ZXJcbiAgICAgICAgICAgIGlmIChyZWZEZXRhaWxzLmVycm9yLmluZGV4T2YoJyMnKSA+IC0xKSB7XG4gICAgICAgICAgICAgIHJlZkRldGFpbHMuZXJyb3IgPSByZWZEZXRhaWxzLmVycm9yLnJlcGxhY2UocmVmRGV0YWlscy51cmkuc3Vic3RyKHJlZkRldGFpbHMudXJpLmluZGV4T2YoJyMnKSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmRGV0YWlscy51cmkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSZXBvcnQgZXJyb3JzIG9wZW5pbmcgZmlsZXMgYXMgSlNPTiBQb2ludGVyIGVycm9yc1xuICAgICAgICAgICAgaWYgKHJlZkRldGFpbHMuZXJyb3IuaW5kZXhPZignRU5PRU5UOicpID09PSAwIHx8IHJlZkRldGFpbHMuZXJyb3IuaW5kZXhPZignTm90IEZvdW5kJykgPT09IDApIHtcbiAgICAgICAgICAgICAgcmVmRGV0YWlscy5lcnJvciA9ICdKU09OIFBvaW50ZXIgcG9pbnRzIHRvIG1pc3NpbmcgbG9jYXRpb246ICcgKyByZWZEZXRhaWxzLnVyaTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICByZWZEZXBzID0gcmVzdWx0cy5kZXBzW3JlZkRldGFpbHMucmVmZElkXTtcblxuICAgICAgICBpZiAocmVmRGV0YWlscy5yZWZkSWQuaW5kZXhPZihyb290KSAhPT0gMCkge1xuICAgICAgICAgIE9iamVjdC5rZXlzKHJlZkRlcHMpLmZvckVhY2goZnVuY3Rpb24gKHByb3ApIHtcbiAgICAgICAgICAgIHdhbGtSZWZzKHJlZkRldGFpbHMucmVmZElkLCByZWZEZXRhaWxzLnJlZmRJZCArIHByb3Auc3Vic3RyKDEpLCByZWZQYXRoLmNvbmNhdChwYXRoRnJvbVB0cihwcm9wKSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEZvciBwZXJmb3JtYW5jZSByZWFzb25zLCB3ZSBvbmx5IHByb2Nlc3MgYSBkb2N1bWVudCAob3Igc3ViIGRvY3VtZW50KSBhbmQgZWFjaCByZWZlcmVuY2Ugb25jZSBldmVyLiAgVGhpcyBtZWFuc1xuICAgICAgLy8gdGhhdCBpZiB3ZSB3YW50IHRvIHByb3ZpZGUgdGhlIGZ1bGwgcGljdHVyZSBhcyB0byB3aGF0IHBhdGhzIGluIHRoZSByZXNvbHZlZCBkb2N1bWVudCB3ZXJlIGNyZWF0ZWQgYXMgYSByZXN1bHRcbiAgICAgIC8vIG9mIGEgcmVmZXJlbmNlLCB3ZSBoYXZlIHRvIHRha2Ugb3VyIGZ1bGx5LXF1YWxpZmllZCByZWZlcmVuY2UgbG9jYXRpb25zIGFuZCBleHBhbmQgdGhlbSB0byBiZSBhbGwgbG9jYWwgYmFzZWRcbiAgICAgIC8vIG9uIHRoZSBvcmlnaW5hbCBkb2N1bWVudC5cbiAgICAgIE9iamVjdC5rZXlzKHJlc3VsdHMucmVmcykuZm9yRWFjaChmdW5jdGlvbiAocmVmUHRyKSB7XG4gICAgICAgIHZhciByZWZEZXRhaWxzID0gcmVzdWx0cy5yZWZzW3JlZlB0cl07XG4gICAgICAgIHZhciBmcVVSSVNlZ21lbnRzO1xuICAgICAgICB2YXIgdXJpU2VnbWVudHM7XG5cbiAgICAgICAgLy8gTWFrZSBhbGwgZnVsbHktcXVhbGlmaWVkIHJlZmVyZW5jZSBVUklzIHJlbGF0aXZlIHRvIHRoZSBkb2N1bWVudCByb290IChpZiBuZWNlc3NhcnkpLiAgVGhpcyBzdGVwIGlzIGRvbmUgaGVyZVxuICAgICAgICAvLyBmb3IgcGVyZm9ybWFuY2UgcmVhc29ucyBpbnN0ZWFkIG9mIGJlbG93IHdoZW4gdGhlIG9mZmljaWFsIHNhbml0aXphdGlvbiBwcm9jZXNzIHJ1bnMuXG4gICAgICAgIGlmIChyZWZEZXRhaWxzLnR5cGUgIT09ICdpbnZhbGlkJykge1xuICAgICAgICAgIC8vIFJlbW92ZSB0aGUgdHJhaWxpbmcgaGFzaCBmcm9tIGRvY3VtZW50IHJvb3QgcmVmZXJlbmNlcyBpZiB0aGV5IHdlcmVuJ3QgaW4gdGhlIG9yaWdpbmFsIFVSSVxuICAgICAgICAgIGlmIChyZWZEZXRhaWxzLmZxVVJJW3JlZkRldGFpbHMuZnFVUkkubGVuZ3RoIC0gMV0gPT09ICcjJyAmJlxuICAgICAgICAgICAgICAgIHJlZkRldGFpbHMudXJpW3JlZkRldGFpbHMudXJpLmxlbmd0aCAtIDFdICE9PSAnIycpIHtcbiAgICAgICAgICAgIHJlZkRldGFpbHMuZnFVUkkgPSByZWZEZXRhaWxzLmZxVVJJLnN1YnN0cigwLCByZWZEZXRhaWxzLmZxVVJJLmxlbmd0aCAtIDEpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGZxVVJJU2VnbWVudHMgPSByZWZEZXRhaWxzLmZxVVJJLnNwbGl0KCcvJyk7XG4gICAgICAgICAgdXJpU2VnbWVudHMgPSByZWZEZXRhaWxzLnVyaS5zcGxpdCgnLycpO1xuXG4gICAgICAgICAgLy8gVGhlIGZ1bGx5LXF1YWxpZmllZCBVUkkgaXMgdW5lbmNvZGVkIHNvIHRvIGtlZXAgdGhlIG9yaWdpbmFsIGZvcm1hdHRpbmcgb2YgdGhlIFVSSSAoZW5jb2RlZCB2cy4gdW5lbmNvZGVkKSxcbiAgICAgICAgICAvLyB3ZSBuZWVkIHRvIHJlcGxhY2UgZWFjaCBVUkkgc2VnbWVudCBpbiByZXZlcnNlIG9yZGVyLlxuICAgICAgICAgIF8udGltZXModXJpU2VnbWVudHMubGVuZ3RoIC0gMSwgZnVuY3Rpb24gKHRpbWUpIHtcbiAgICAgICAgICAgIHZhciBuU2VnID0gdXJpU2VnbWVudHNbdXJpU2VnbWVudHMubGVuZ3RoIC0gdGltZSAtIDFdO1xuICAgICAgICAgICAgdmFyIGZxU2VnSW5kZXggPSBmcVVSSVNlZ21lbnRzLmxlbmd0aCAtIHRpbWUgLSAxO1xuICAgICAgICAgICAgdmFyIGZxU2VnID0gZnFVUklTZWdtZW50c1tmcVNlZ0luZGV4XTtcblxuICAgICAgICAgICAgaWYgKG5TZWcgPT09ICcuJyB8fCBuU2VnID09PSAnLi4nKSB7XG4gICAgICAgICAgICAgIG5TZWcgPSBmcVNlZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZnFVUklTZWdtZW50c1tmcVNlZ0luZGV4XSA9IG5TZWc7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICByZWZEZXRhaWxzLmZxVVJJID0gZnFVUklTZWdtZW50cy5qb2luKCcvJyk7XG5cbiAgICAgICAgICAvLyBNYWtlIHRoZSBmdWxseS1xdWFsaWZpZWQgVVJJcyByZWxhdGl2ZSB0byB0aGUgZG9jdW1lbnQgcm9vdFxuICAgICAgICAgIGlmIChyZWZEZXRhaWxzLmZxVVJJLmluZGV4T2YoZnVsbExvY2F0aW9uKSA9PT0gMCkge1xuICAgICAgICAgICAgcmVmRGV0YWlscy5mcVVSSSA9IHJlZkRldGFpbHMuZnFVUkkucmVwbGFjZShmdWxsTG9jYXRpb24sICcnKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHJlZkRldGFpbHMuZnFVUkkuaW5kZXhPZihyZWxhdGl2ZUJhc2UpID09PSAwKSB7XG4gICAgICAgICAgICByZWZEZXRhaWxzLmZxVVJJID0gcmVmRGV0YWlscy5mcVVSSS5yZXBsYWNlKHJlbGF0aXZlQmFzZSwgJycpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChyZWZEZXRhaWxzLmZxVVJJWzBdID09PSAnLycpIHtcbiAgICAgICAgICAgIHJlZkRldGFpbHMuZnFVUkkgPSAnLicgKyByZWZEZXRhaWxzLmZxVVJJO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdlIG9ubHkgd2FudCB0byBwcm9jZXNzIHJlZmVyZW5jZXMgZm91bmQgYXQgb3IgYmVuZWF0aCB0aGUgcHJvdmlkZWQgZG9jdW1lbnQgYW5kIHN1Yi1kb2N1bWVudCBwYXRoXG4gICAgICAgIGlmIChyZWZQdHIuaW5kZXhPZihyZWZzUm9vdCkgIT09IDApIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB3YWxrUmVmcyhyZWZzUm9vdCwgcmVmUHRyLCBwYXRoRnJvbVB0cihyZWZQdHIuc3Vic3RyKHJlZnNSb290Lmxlbmd0aCkpKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTYW5pdGl6ZSB0aGUgcmVmZXJlbmNlIGRldGFpbHNcbiAgICAgIF8uZm9yT3duKHJlc3VsdHMucmVmcywgZnVuY3Rpb24gKHJlZkRldGFpbHMpIHtcbiAgICAgICAgLy8gRGVsZXRlIHRoZSByZWZlcmVuY2UgaWQgdXNlZCBmb3IgZGVwZW5kZW5jeSB0cmFja2luZyBhbmQgY2lyY3VsYXIgaWRlbnRpZmljYXRpb25cbiAgICAgICAgZGVsZXRlIHJlZkRldGFpbHMucmVmZElkO1xuXG4gICAgICAgIC8vIFRvIGF2b2lkIHRoZSBlcnJvciBtZXNzYWdlIGJlaW5nIFVSSSBlbmNvZGVkL2RlY29kZWQgYnkgbWlzdGFrZSwgcmVwbGFjZSB0aGUgY3VycmVudCBKU09OIFBvaW50ZXIgd2l0aCB0aGVcbiAgICAgICAgLy8gdmFsdWUgaW4gdGhlIEpTT04gUmVmZXJlbmNlIGRlZmluaXRpb24uXG4gICAgICAgIGlmIChyZWZEZXRhaWxzLm1pc3NpbmcpIHtcbiAgICAgICAgICByZWZEZXRhaWxzLmVycm9yID0gcmVmRGV0YWlscy5lcnJvci5zcGxpdCgnOiAnKVswXSArICc6ICcgKyByZWZEZXRhaWxzLmRlZi4kcmVmO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVmczogYWxsUmVmcyxcbiAgICAgICAgcmVzb2x2ZWQ6IHJlc3VsdHMuZG9jc1tmdWxsTG9jYXRpb25dXG4gICAgICB9O1xuICAgIH0pO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZnNBdCAobG9jYXRpb24sIG9wdGlvbnMpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIFZhbGlkYXRlIHRoZSBwcm92aWRlZCBsb2NhdGlvblxuICAgICAgaWYgKCFfLmlzU3RyaW5nKGxvY2F0aW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsb2NhdGlvbiBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMpKSB7XG4gICAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICAgIH1cblxuICAgICAgaWYgKF8uaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgICAgLy8gQWRkIHRoZSBsb2NhdGlvbiB0byB0aGUgb3B0aW9ucyBmb3IgcHJvY2Vzc2luZy92YWxpZGF0aW9uXG4gICAgICAgIG9wdGlvbnMubG9jYXRpb24gPSBsb2NhdGlvbjtcbiAgICAgIH1cblxuICAgICAgLy8gVmFsaWRhdGUgb3B0aW9uc1xuICAgICAgb3B0aW9ucyA9IHZhbGlkYXRlT3B0aW9ucyhvcHRpb25zKTtcblxuICAgICAgcmV0dXJuIGdldFJlbW90ZURvY3VtZW50KG9wdGlvbnMubG9jYXRpb24sIG9wdGlvbnMpO1xuICAgIH0pXG4gICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgdmFyIGNPcHRpb25zID0gXy5jbG9uZURlZXAob3B0aW9ucyk7XG4gICAgICB2YXIgdXJpRGV0YWlscyA9IHBhcnNlVVJJKG9wdGlvbnMubG9jYXRpb24pO1xuXG4gICAgICAvLyBTZXQgdGhlIHN1YiBkb2N1bWVudCBwYXRoIGlmIG5lY2Vzc2FyeVxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHVyaURldGFpbHMuZnJhZ21lbnQpKSB7XG4gICAgICAgIGNPcHRpb25zLnN1YkRvY1BhdGggPSBwYXRoRnJvbVB0cihkZWNvZGVVUkkodXJpRGV0YWlscy5mcmFnbWVudCkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzb2x2ZVJlZnMocmVzLCBjT3B0aW9ucylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJlczIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcmVmczogcmVzMi5yZWZzLFxuICAgICAgICAgICAgcmVzb2x2ZWQ6IHJlczIucmVzb2x2ZWQsXG4gICAgICAgICAgICB2YWx1ZTogcmVzXG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgcmV0dXJuIGFsbFRhc2tzO1xufVxuXG4vKipcbiAqIFZhcmlvdXMgdXRpbGl0aWVzIGZvciBKU09OIFJlZmVyZW5jZXMgKihodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzKSogYW5kXG4gKiBKU09OIFBvaW50ZXJzICooaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEpKi5cbiAqXG4gKiBAbW9kdWxlIGpzb24tcmVmc1xuICovXG5cbi8qKlxuICogQSBudW1iZXIgb2YgZnVuY3Rpb25zIGV4cG9ydGVkIGJlbG93IGFyZSB1c2VkIHdpdGhpbiB0aGUgZXhwb3J0ZWQgZnVuY3Rpb25zLiAgVHlwaWNhbGx5LCBJIHdvdWxkIHVzZSBhIGZ1bmN0aW9uXG4gKiBkZWNsYXJhdGlvbiBfKHdpdGggZG9jdW1lbmF0aW9uKV8gYWJvdmUgYW5kIHRoZW4ganVzdCBleHBvcnQgYSByZWZlcmVuY2UgdG8gdGhlIGZ1bmN0aW9uIGJ1dCBkdWUgdG8gYSBidWcgaW4gSlNEb2NcbiAqIChodHRwczovL2dpdGh1Yi5jb20vanNkb2MzL2pzZG9jL2lzc3Vlcy82NzkpLCB0aGlzIGJyZWFrcyB0aGUgZ2VuZXJhdGVkIEFQSSBkb2N1bWVudGF0aW9uIGFuZCBUeXBlU2NyaXB0XG4gKiBkZWNsYXJhdGlvbnMuICBTbyB0aGF0J3Mgd2h5IGVhY2ggYG1vZHVsZS5leHBvcnRzYCBiZWxvdyBiYXNpY2FsbHkganVzdCB3cmFwcyBhIGNhbGwgdG8gdGhlIGZ1bmN0aW9uIGRlY2xhcmF0aW9uLlxuICovXG5cbiAvKipcbiAqIENsZWFycyB0aGUgaW50ZXJuYWwgY2FjaGUgb2YgcmVtb3RlIGRvY3VtZW50cywgcmVmZXJlbmNlIGRldGFpbHMsIGV0Yy5cbiAqL1xubW9kdWxlLmV4cG9ydHMuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uICgpIHtcbiAgcmVtb3RlQ2FjaGUgPSB7fTtcbn07XG5cbi8qKlxuICogVGFrZXMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cyBhbmQgZGVjb2RlcyB0aGUgSlNPTiBQb2ludGVyIHRva2VucyBpbiB0aGVtLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50c1xuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIHdpdGggdGhlaXIgSlNPTiBQb2ludGVyIHRva2VucyBkZWNvZGVkXG4gKlxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZSBwYXRoIGlzIG5vdCBhbiBgQXJyYXlgXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEjc2VjdGlvbi0zfVxuICovXG5tb2R1bGUuZXhwb3J0cy5kZWNvZGVQYXRoID0gZnVuY3Rpb24gKHBhdGgpIHtcbiAgcmV0dXJuIGRlY29kZVBhdGgocGF0aCk7XG59O1xuXG4vKipcbiAqIFRha2VzIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgYW5kIGVuY29kZXMgdGhlIHNwZWNpYWwgSlNPTiBQb2ludGVyIGNoYXJhY3RlcnMgaW4gdGhlbS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIGFycmF5IG9mIHBhdGggc2VnbWVudHNcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSB0aGUgYXJyYXkgb2YgcGF0aCBzZWdtZW50cyB3aXRoIHRoZWlyIEpTT04gUG9pbnRlciB0b2tlbnMgZW5jb2RlZFxuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGUgcGF0aCBpcyBub3QgYW4gYEFycmF5YFxuICpcbiAqIEBzZWUge0BsaW5rIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxI3NlY3Rpb24tM31cbiAqL1xubW9kdWxlLmV4cG9ydHMuZW5jb2RlUGF0aCA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gIHJldHVybiBlbmNvZGVQYXRoKHBhdGgpO1xufTtcblxuLyoqXG4gKiBGaW5kcyBKU09OIFJlZmVyZW5jZXMgZGVmaW5lZCB3aXRoaW4gdGhlIHByb3ZpZGVkIGFycmF5L29iamVjdC5cbiAqXG4gKiBAcGFyYW0ge2FycmF5fG9iamVjdH0gb2JqIC0gVGhlIHN0cnVjdHVyZSB0byBmaW5kIEpTT04gUmVmZXJlbmNlcyB3aXRoaW5cbiAqIEBwYXJhbSB7bW9kdWxlOmpzb24tcmVmc35Kc29uUmVmc09wdGlvbnN9IFtvcHRpb25zXSAtIFRoZSBKc29uUmVmcyBvcHRpb25zXG4gKlxuICogQHJldHVybnMge29iamVjdH0gYW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgKihmcmFnbWVudCB2ZXJzaW9uKSogdG8gd2hlcmUgdGhlIEpTT04gUmVmZXJlbmNlIGlzIGRlZmluZWRcbiAqIGFuZCB3aG9zZSB2YWx1ZXMgYXJlIHtAbGluayBVbnJlc29sdmVkUmVmRGV0YWlsc30uXG4gKlxuICogQHRocm93cyB7RXJyb3J9IHdoZW4gdGhlIGlucHV0IGFyZ3VtZW50cyBmYWlsIHZhbGlkYXRpb24gb3IgaWYgYG9wdGlvbnMuc3ViRG9jUGF0aGAgcG9pbnRzIHRvIGFuIGludmFsaWQgbG9jYXRpb25cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRmluZGluZyBhbGwgdmFsaWQgcmVmZXJlbmNlc1xuICogdmFyIGFsbFJlZnMgPSBKc29uUmVmcy5maW5kUmVmcyhvYmopO1xuICogLy8gRmluZGluZyBhbGwgcmVtb3RlIHJlZmVyZW5jZXNcbiAqIHZhciByZW1vdGVSZWZzID0gSnNvblJlZnMuZmluZFJlZnMob2JqLCB7ZmlsdGVyOiBbJ3JlbGF0aXZlJywgJ3JlbW90ZSddfSk7XG4gKiAvLyBGaW5kaW5nIGFsbCBpbnZhbGlkIHJlZmVyZW5jZXNcbiAqIHZhciBpbnZhbGlkUmVmcyA9IEpzb25SZWZzLmZpbmRSZWZzKG9iaiwge2ZpbHRlcjogJ2ludmFsaWQnLCBpbmNsdWRlSW52YWxpZDogdHJ1ZX0pO1xuICovXG5tb2R1bGUuZXhwb3J0cy5maW5kUmVmcyA9IGZ1bmN0aW9uIChvYmosIG9wdGlvbnMpIHtcbiAgcmV0dXJuIGZpbmRSZWZzKG9iaiwgb3B0aW9ucyk7XG59O1xuXG4vKipcbiAqIEZpbmRzIEpTT04gUmVmZXJlbmNlcyBkZWZpbmVkIHdpdGhpbiB0aGUgZG9jdW1lbnQgYXQgdGhlIHByb3ZpZGVkIGxvY2F0aW9uLlxuICpcbiAqIFRoaXMgQVBJIGlzIGlkZW50aWNhbCB0byB7QGxpbmsgZmluZFJlZnN9IGV4Y2VwdCB0aGlzIEFQSSB3aWxsIHJldHJpZXZlIGEgcmVtb3RlIGRvY3VtZW50IGFuZCB0aGVuXG4gKiByZXR1cm4gdGhlIHJlc3VsdCBvZiB7QGxpbmsgZmluZFJlZnN9IG9uIHRoZSByZXRyaWV2ZWQgZG9jdW1lbnQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2F0aW9uIC0gVGhlIGxvY2F0aW9uIHRvIHJldHJpZXZlICooQ2FuIGJlIHJlbGF0aXZlIG9yIGFic29sdXRlLCBqdXN0IG1ha2Ugc3VyZSB5b3UgbG9vayBhdCB0aGVcbiAqIHtAbGluayBtb2R1bGU6anNvbi1yZWZzfkpzb25SZWZzT3B0aW9uc3xvcHRpb25zIGRvY3VtZW50YXRpb259IHRvIHNlZSBob3cgcmVsYXRpdmUgcmVmZXJlbmNlcyBhcmUgaGFuZGxlZC4pKlxuICogQHBhcmFtIHttb2R1bGU6anNvbi1yZWZzfkpzb25SZWZzT3B0aW9uc30gW29wdGlvbnNdIC0gVGhlIEpzb25SZWZzIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxtb2R1bGU6anNvbi1yZWZzflJldHJpZXZlZFJlZnNSZXN1bHRzPn0gYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgYVxuICoge0BsaW5rIG1vZHVsZTpqc29uLXJlZnN+UmV0cmlldmVkUmVmc1Jlc3VsdHN9IGFuZCByZWplY3RzIHdpdGggYW4gYEVycm9yYCB3aGVuIHRoZSBpbnB1dCBhcmd1bWVudHMgZmFpbCB2YWxpZGF0aW9uLFxuICogd2hlbiBgb3B0aW9ucy5zdWJEb2NQYXRoYCBwb2ludHMgdG8gYW4gaW52YWxpZCBsb2NhdGlvbiBvciB3aGVuIHRoZSBsb2NhdGlvbiBhcmd1bWVudCBwb2ludHMgdG8gYW4gdW5sb2FkYWJsZVxuICogcmVzb3VyY2VcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB0aGF0IG9ubHkgcmVzb2x2ZXMgcmVmZXJlbmNlcyB3aXRoaW4gYSBzdWIgZG9jdW1lbnRcbiAqIEpzb25SZWZzLmZpbmRSZWZzQXQoJ2h0dHA6Ly9wZXRzdG9yZS5zd2FnZ2VyLmlvL3YyL3N3YWdnZXIuanNvbicsIHtcbiAqICAgICBzdWJEb2NQYXRoOiAnIy9kZWZpbml0aW9ucydcbiAqICAgfSlcbiAqICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICogICAgICAvLyBEbyBzb21ldGhpbmcgd2l0aCB0aGUgcmVzcG9uc2VcbiAqICAgICAgLy9cbiAqICAgICAgLy8gcmVzLnJlZnM6IEpTT04gUmVmZXJlbmNlIGxvY2F0aW9ucyBhbmQgZGV0YWlsc1xuICogICAgICAvLyByZXMudmFsdWU6IFRoZSByZXRyaWV2ZWQgZG9jdW1lbnRcbiAqICAgfSwgZnVuY3Rpb24gKGVycikge1xuICogICAgIGNvbnNvbGUubG9nKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICovXG5tb2R1bGUuZXhwb3J0cy5maW5kUmVmc0F0ID0gZnVuY3Rpb24gKGxvY2F0aW9uLCBvcHRpb25zKSB7XG4gIHJldHVybiBmaW5kUmVmc0F0KGxvY2F0aW9uLCBvcHRpb25zKTtcbn07XG5cbi8qKlxuICogUmV0dXJucyBkZXRhaWxlZCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgSlNPTiBSZWZlcmVuY2UuXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IG9iaiAtIFRoZSBKU09OIFJlZmVyZW5jZSBkZWZpbml0aW9uXG4gKlxuICogQHJldHVybnMge21vZHVsZTpqc29uLXJlZnN+VW5yZXNvbHZlZFJlZkRldGFpbHN9IHRoZSBkZXRhaWxlZCBpbmZvcm1hdGlvblxuICovXG5tb2R1bGUuZXhwb3J0cy5nZXRSZWZEZXRhaWxzID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gZ2V0UmVmRGV0YWlscyhvYmopO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgdGhlIGFyZ3VtZW50IHJlcHJlc2VudHMgYSBKU09OIFBvaW50ZXIuXG4gKlxuICogQSBzdHJpbmcgaXMgYSBKU09OIFBvaW50ZXIgaWYgdGhlIGZvbGxvd2luZyBhcmUgYWxsIHRydWU6XG4gKlxuICogICAqIFRoZSBzdHJpbmcgaXMgb2YgdHlwZSBgU3RyaW5nYFxuICogICAqIFRoZSBzdHJpbmcgbXVzdCBiZSBlbXB0eSwgYCNgIG9yIHN0YXJ0IHdpdGggYSBgL2Agb3IgYCMvYFxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgc3RyaW5nIHRvIGNoZWNrXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFt0aHJvd1dpdGhEZXRhaWxzPWZhbHNlXSAtIFdoZXRoZXIgb3Igbm90IHRvIHRocm93IGFuIGBFcnJvcmAgd2l0aCB0aGUgZGV0YWlscyBhcyB0byB3aHkgdGhlIHZhbHVlXG4gKiBwcm92aWRlZCBpcyBpbnZhbGlkXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRoZSByZXN1bHQgb2YgdGhlIGNoZWNrXG4gKlxuICogQHRocm93cyB7ZXJyb3J9IHdoZW4gdGhlIHByb3ZpZGVkIHZhbHVlIGlzIGludmFsaWQgYW5kIHRoZSBgdGhyb3dXaXRoRGV0YWlsc2AgYXJndW1lbnQgaXMgYHRydWVgXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDEjc2VjdGlvbi0zfVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBTZXBhcmF0aW5nIHRoZSBkaWZmZXJlbnQgd2F5cyB0byBpbnZva2UgaXNQdHIgZm9yIGRlbW9uc3RyYXRpb24gcHVycG9zZXNcbiAqIGlmIChpc1B0cihzdHIpKSB7XG4gKiAgIC8vIEhhbmRsZSBhIHZhbGlkIEpTT04gUG9pbnRlclxuICogfSBlbHNlIHtcbiAqICAgLy8gR2V0IHRoZSByZWFzb24gYXMgdG8gd2h5IHRoZSB2YWx1ZSBpcyBub3QgYSBKU09OIFBvaW50ZXIgc28geW91IGNhbiBmaXgvcmVwb3J0IGl0XG4gKiAgIHRyeSB7XG4gKiAgICAgaXNQdHIoc3RyLCB0cnVlKTtcbiAqICAgfSBjYXRjaCAoZXJyKSB7XG4gKiAgICAgLy8gVGhlIGVycm9yIG1lc3NhZ2UgY29udGFpbnMgdGhlIGRldGFpbHMgYXMgdG8gd2h5IHRoZSBwcm92aWRlZCB2YWx1ZSBpcyBub3QgYSBKU09OIFBvaW50ZXJcbiAqICAgfVxuICogfVxuICovXG5tb2R1bGUuZXhwb3J0cy5pc1B0ciA9IGZ1bmN0aW9uIChwdHIsIHRocm93V2l0aERldGFpbHMpIHtcbiAgcmV0dXJuIGlzUHRyKHB0ciwgdGhyb3dXaXRoRGV0YWlscyk7XG59O1xuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciB0aGUgYXJndW1lbnQgcmVwcmVzZW50cyBhIEpTT04gUmVmZXJlbmNlLlxuICpcbiAqIEFuIG9iamVjdCBpcyBhIEpTT04gUmVmZXJlbmNlIG9ubHkgaWYgdGhlIGZvbGxvd2luZyBhcmUgYWxsIHRydWU6XG4gKlxuICogICAqIFRoZSBvYmplY3QgaXMgb2YgdHlwZSBgT2JqZWN0YFxuICogICAqIFRoZSBvYmplY3QgaGFzIGEgYCRyZWZgIHByb3BlcnR5XG4gKiAgICogVGhlIGAkcmVmYCBwcm9wZXJ0eSBpcyBhIHZhbGlkIFVSSSAqKFdlIGRvIG5vdCByZXF1aXJlIDEwMCUgc3RyaWN0IFVSSXMgYW5kIHdpbGwgaGFuZGxlIHVuZXNjYXBlZCBzcGVjaWFsXG4gKiAgICAgY2hhcmFjdGVycy4pKlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmogLSBUaGUgb2JqZWN0IHRvIGNoZWNrXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFt0aHJvd1dpdGhEZXRhaWxzPWZhbHNlXSAtIFdoZXRoZXIgb3Igbm90IHRvIHRocm93IGFuIGBFcnJvcmAgd2l0aCB0aGUgZGV0YWlscyBhcyB0byB3aHkgdGhlIHZhbHVlXG4gKiBwcm92aWRlZCBpcyBpbnZhbGlkXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRoZSByZXN1bHQgb2YgdGhlIGNoZWNrXG4gKlxuICogQHRocm93cyB7ZXJyb3J9IHdoZW4gdGhlIHByb3ZpZGVkIHZhbHVlIGlzIGludmFsaWQgYW5kIHRoZSBgdGhyb3dXaXRoRGV0YWlsc2AgYXJndW1lbnQgaXMgYHRydWVgXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtcGJyeWFuLXp5cC1qc29uLXJlZi0wMyNzZWN0aW9uLTN9XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFNlcGFyYXRpbmcgdGhlIGRpZmZlcmVudCB3YXlzIHRvIGludm9rZSBpc1JlZiBmb3IgZGVtb25zdHJhdGlvbiBwdXJwb3Nlc1xuICogaWYgKGlzUmVmKG9iaikpIHtcbiAqICAgLy8gSGFuZGxlIGEgdmFsaWQgSlNPTiBSZWZlcmVuY2VcbiAqIH0gZWxzZSB7XG4gKiAgIC8vIEdldCB0aGUgcmVhc29uIGFzIHRvIHdoeSB0aGUgdmFsdWUgaXMgbm90IGEgSlNPTiBSZWZlcmVuY2Ugc28geW91IGNhbiBmaXgvcmVwb3J0IGl0XG4gKiAgIHRyeSB7XG4gKiAgICAgaXNSZWYoc3RyLCB0cnVlKTtcbiAqICAgfSBjYXRjaCAoZXJyKSB7XG4gKiAgICAgLy8gVGhlIGVycm9yIG1lc3NhZ2UgY29udGFpbnMgdGhlIGRldGFpbHMgYXMgdG8gd2h5IHRoZSBwcm92aWRlZCB2YWx1ZSBpcyBub3QgYSBKU09OIFJlZmVyZW5jZVxuICogICB9XG4gKiB9XG4gKi9cbm1vZHVsZS5leHBvcnRzLmlzUmVmID0gZnVuY3Rpb24gKG9iaiwgdGhyb3dXaXRoRGV0YWlscykge1xuICByZXR1cm4gaXNSZWYob2JqLCB0aHJvd1dpdGhEZXRhaWxzKTtcbn07XG5cbi8qKlxuICogUmV0dXJucyBhbiBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIGZvciB0aGUgcHJvdmlkZWQgSlNPTiBQb2ludGVyLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge3N0cmluZ1tdfSB0aGUgcGF0aCBzZWdtZW50c1xuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGUgcHJvdmlkZWQgYHB0cmAgYXJndW1lbnQgaXMgbm90IGEgSlNPTiBQb2ludGVyXG4gKi9cbm1vZHVsZS5leHBvcnRzLnBhdGhGcm9tUHRyID0gZnVuY3Rpb24gKHB0cikge1xuICByZXR1cm4gcGF0aEZyb21QdHIocHRyKTtcbn07XG5cbi8qKlxuICogUmV0dXJucyBhIEpTT04gUG9pbnRlciBmb3IgdGhlIHByb3ZpZGVkIGFycmF5IG9mIHBhdGggc2VnbWVudHMuXG4gKlxuICogKipOb3RlOioqIElmIGEgcGF0aCBzZWdtZW50IGluIGBwYXRoYCBpcyBub3QgYSBgU3RyaW5nYCwgaXQgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gb25lIHVzaW5nIGBKU09OLnN0cmluZ2lmeWAuXG4gKlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFRoZSBhcnJheSBvZiBwYXRoIHNlZ21lbnRzXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtoYXNoUHJlZml4PXRydWVdIC0gV2hldGhlciBvciBub3QgY3JlYXRlIGEgaGFzaC1wcmVmaXhlZCBKU09OIFBvaW50ZXJcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSB0aGUgY29ycmVzcG9uZGluZyBKU09OIFBvaW50ZXJcbiAqXG4gKiBAdGhyb3dzIHtFcnJvcn0gaWYgdGhlIGBwYXRoYCBhcmd1bWVudCBpcyBub3QgYW4gYXJyYXlcbiAqL1xubW9kdWxlLmV4cG9ydHMucGF0aFRvUHRyID0gZnVuY3Rpb24gKHBhdGgsIGhhc2hQcmVmaXgpIHtcbiAgcmV0dXJuIHBhdGhUb1B0cihwYXRoLCBoYXNoUHJlZml4KTtcbn07XG5cbi8qKlxuICogRmluZHMgSlNPTiBSZWZlcmVuY2VzIGRlZmluZWQgd2l0aGluIHRoZSBwcm92aWRlZCBhcnJheS9vYmplY3QgYW5kIHJlc29sdmVzIHRoZW0uXG4gKlxuICogQHBhcmFtIHthcnJheXxvYmplY3R9IG9iaiAtIFRoZSBzdHJ1Y3R1cmUgdG8gZmluZCBKU09OIFJlZmVyZW5jZXMgd2l0aGluXG4gKiBAcGFyYW0ge21vZHVsZTpqc29uLXJlZnN+SnNvblJlZnNPcHRpb25zfSBbb3B0aW9uc10gLSBUaGUgSnNvblJlZnMgb3B0aW9uc1xuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlPG1vZHVsZTpqc29uLXJlZnN+UmVzb2x2ZWRSZWZzUmVzdWx0cz59IGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIGFcbiAqIHtAbGluayBtb2R1bGU6anNvbi1yZWZzflJlc29sdmVkUmVmc1Jlc3VsdHN9IGFuZCByZWplY3RzIHdpdGggYW4gYEVycm9yYCB3aGVuIHRoZSBpbnB1dCBhcmd1bWVudHMgZmFpbCB2YWxpZGF0aW9uLFxuICogd2hlbiBgb3B0aW9ucy5zdWJEb2NQYXRoYCBwb2ludHMgdG8gYW4gaW52YWxpZCBsb2NhdGlvbiBvciB3aGVuIHRoZSBsb2NhdGlvbiBhcmd1bWVudCBwb2ludHMgdG8gYW4gdW5sb2FkYWJsZVxuICogcmVzb3VyY2VcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB0aGF0IG9ubHkgcmVzb2x2ZXMgcmVsYXRpdmUgYW5kIHJlbW90ZSByZWZlcmVuY2VzXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyhzd2FnZ2VyT2JqLCB7XG4gKiAgICAgZmlsdGVyOiBbJ3JlbGF0aXZlJywgJ3JlbW90ZSddXG4gKiAgIH0pXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAqICAgICAgLy8gRG8gc29tZXRoaW5nIHdpdGggdGhlIHJlc3BvbnNlXG4gKiAgICAgIC8vXG4gKiAgICAgIC8vIHJlcy5yZWZzOiBKU09OIFJlZmVyZW5jZSBsb2NhdGlvbnMgYW5kIGRldGFpbHNcbiAqICAgICAgLy8gcmVzLnJlc29sdmVkOiBUaGUgZG9jdW1lbnQgd2l0aCB0aGUgYXBwcm9wcmlhdGUgSlNPTiBSZWZlcmVuY2VzIHJlc29sdmVkXG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmxvZyhlcnIuc3RhY2spO1xuICogICB9KTtcbiAqL1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnMgPSBmdW5jdGlvbiAob2JqLCBvcHRpb25zKSB7XG4gIHJldHVybiByZXNvbHZlUmVmcyhvYmosIG9wdGlvbnMpO1xufTtcblxuLyoqXG4gKiBSZXNvbHZlcyBKU09OIFJlZmVyZW5jZXMgZGVmaW5lZCB3aXRoaW4gdGhlIGRvY3VtZW50IGF0IHRoZSBwcm92aWRlZCBsb2NhdGlvbi5cbiAqXG4gKiBUaGlzIEFQSSBpcyBpZGVudGljYWwgdG8ge0BsaW5rIG1vZHVsZTpqc29uLXJlZnMucmVzb2x2ZVJlZnN9IGV4Y2VwdCB0aGlzIEFQSSB3aWxsIHJldHJpZXZlIGEgcmVtb3RlIGRvY3VtZW50IGFuZFxuICogdGhlbiByZXR1cm4gdGhlIHJlc3VsdCBvZiB7QGxpbmsgbW9kdWxlOmpzb24tcmVmcy5yZXNvbHZlUmVmc30gb24gdGhlIHJldHJpZXZlZCBkb2N1bWVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gdG8gcmV0cmlldmUgKihDYW4gYmUgcmVsYXRpdmUgb3IgYWJzb2x1dGUsIGp1c3QgbWFrZSBzdXJlIHlvdSBsb29rIGF0IHRoZVxuICoge0BsaW5rIG1vZHVsZTpqc29uLXJlZnN+SnNvblJlZnNPcHRpb25zfG9wdGlvbnMgZG9jdW1lbnRhdGlvbn0gdG8gc2VlIGhvdyByZWxhdGl2ZSByZWZlcmVuY2VzIGFyZSBoYW5kbGVkLikqXG4gKiBAcGFyYW0ge21vZHVsZTpqc29uLXJlZnN+SnNvblJlZnNPcHRpb25zfSBbb3B0aW9uc10gLSBUaGUgSnNvblJlZnMgb3B0aW9uc1xuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlPG1vZHVsZTpqc29uLXJlZnN+UmV0cmlldmVkUmVzb2x2ZWRSZWZzUmVzdWx0cz59IGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIGFcbiAqIHtAbGluayBtb2R1bGU6anNvbi1yZWZzflJldHJpZXZlZFJlc29sdmVkUmVmc1Jlc3VsdHN9IGFuZCByZWplY3RzIHdpdGggYW4gYEVycm9yYCB3aGVuIHRoZSBpbnB1dCBhcmd1bWVudHMgZmFpbFxuICogdmFsaWRhdGlvbiwgd2hlbiBgb3B0aW9ucy5zdWJEb2NQYXRoYCBwb2ludHMgdG8gYW4gaW52YWxpZCBsb2NhdGlvbiBvciB3aGVuIHRoZSBsb2NhdGlvbiBhcmd1bWVudCBwb2ludHMgdG8gYW5cbiAqIHVubG9hZGFibGUgcmVzb3VyY2VcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB0aGF0IGxvYWRzIGEgSlNPTiBkb2N1bWVudCAoTm8gb3B0aW9ucy5sb2FkZXJPcHRpb25zLnByb2Nlc3NDb250ZW50IHJlcXVpcmVkKSBhbmQgcmVzb2x2ZXMgYWxsIHJlZmVyZW5jZXNcbiAqIEpzb25SZWZzLnJlc29sdmVSZWZzQXQoJy4vc3dhZ2dlci5qc29uJylcbiAqICAgLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICogICAgICAvLyBEbyBzb21ldGhpbmcgd2l0aCB0aGUgcmVzcG9uc2VcbiAqICAgICAgLy9cbiAqICAgICAgLy8gcmVzLnJlZnM6IEpTT04gUmVmZXJlbmNlIGxvY2F0aW9ucyBhbmQgZGV0YWlsc1xuICogICAgICAvLyByZXMucmVzb2x2ZWQ6IFRoZSBkb2N1bWVudCB3aXRoIHRoZSBhcHByb3ByaWF0ZSBKU09OIFJlZmVyZW5jZXMgcmVzb2x2ZWRcbiAqICAgICAgLy8gcmVzLnZhbHVlOiBUaGUgcmV0cmlldmVkIGRvY3VtZW50XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmxvZyhlcnIuc3RhY2spO1xuICogICB9KTtcbiAqL1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnNBdCA9IGZ1bmN0aW9uIChsb2NhdGlvbiwgb3B0aW9ucykge1xuICByZXR1cm4gcmVzb2x2ZVJlZnNBdChsb2NhdGlvbiwgb3B0aW9ucyk7XG59O1xuIiwiLyohIE5hdGl2ZSBQcm9taXNlIE9ubHlcbiAgICB2MC44LjEgKGMpIEt5bGUgU2ltcHNvblxuICAgIE1JVCBMaWNlbnNlOiBodHRwOi8vZ2V0aWZ5Lm1pdC1saWNlbnNlLm9yZ1xuKi9cblxuKGZ1bmN0aW9uIFVNRChuYW1lLGNvbnRleHQsZGVmaW5pdGlvbil7XG5cdC8vIHNwZWNpYWwgZm9ybSBvZiBVTUQgZm9yIHBvbHlmaWxsaW5nIGFjcm9zcyBldmlyb25tZW50c1xuXHRjb250ZXh0W25hbWVdID0gY29udGV4dFtuYW1lXSB8fCBkZWZpbml0aW9uKCk7XG5cdGlmICh0eXBlb2YgbW9kdWxlICE9IFwidW5kZWZpbmVkXCIgJiYgbW9kdWxlLmV4cG9ydHMpIHsgbW9kdWxlLmV4cG9ydHMgPSBjb250ZXh0W25hbWVdOyB9XG5cdGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT0gXCJmdW5jdGlvblwiICYmIGRlZmluZS5hbWQpIHsgZGVmaW5lKGZ1bmN0aW9uICRBTUQkKCl7IHJldHVybiBjb250ZXh0W25hbWVdOyB9KTsgfVxufSkoXCJQcm9taXNlXCIsdHlwZW9mIGdsb2JhbCAhPSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDogdGhpcyxmdW5jdGlvbiBERUYoKXtcblx0Lypqc2hpbnQgdmFsaWR0aGlzOnRydWUgKi9cblx0XCJ1c2Ugc3RyaWN0XCI7XG5cblx0dmFyIGJ1aWx0SW5Qcm9wLCBjeWNsZSwgc2NoZWR1bGluZ19xdWV1ZSxcblx0XHRUb1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcsXG5cdFx0dGltZXIgPSAodHlwZW9mIHNldEltbWVkaWF0ZSAhPSBcInVuZGVmaW5lZFwiKSA/XG5cdFx0XHRmdW5jdGlvbiB0aW1lcihmbikgeyByZXR1cm4gc2V0SW1tZWRpYXRlKGZuKTsgfSA6XG5cdFx0XHRzZXRUaW1lb3V0XG5cdDtcblxuXHQvLyBkYW1taXQsIElFOC5cblx0dHJ5IHtcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoe30sXCJ4XCIse30pO1xuXHRcdGJ1aWx0SW5Qcm9wID0gZnVuY3Rpb24gYnVpbHRJblByb3Aob2JqLG5hbWUsdmFsLGNvbmZpZykge1xuXHRcdFx0cmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosbmFtZSx7XG5cdFx0XHRcdHZhbHVlOiB2YWwsXG5cdFx0XHRcdHdyaXRhYmxlOiB0cnVlLFxuXHRcdFx0XHRjb25maWd1cmFibGU6IGNvbmZpZyAhPT0gZmFsc2Vcblx0XHRcdH0pO1xuXHRcdH07XG5cdH1cblx0Y2F0Y2ggKGVycikge1xuXHRcdGJ1aWx0SW5Qcm9wID0gZnVuY3Rpb24gYnVpbHRJblByb3Aob2JqLG5hbWUsdmFsKSB7XG5cdFx0XHRvYmpbbmFtZV0gPSB2YWw7XG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH07XG5cdH1cblxuXHQvLyBOb3RlOiB1c2luZyBhIHF1ZXVlIGluc3RlYWQgb2YgYXJyYXkgZm9yIGVmZmljaWVuY3lcblx0c2NoZWR1bGluZ19xdWV1ZSA9IChmdW5jdGlvbiBRdWV1ZSgpIHtcblx0XHR2YXIgZmlyc3QsIGxhc3QsIGl0ZW07XG5cblx0XHRmdW5jdGlvbiBJdGVtKGZuLHNlbGYpIHtcblx0XHRcdHRoaXMuZm4gPSBmbjtcblx0XHRcdHRoaXMuc2VsZiA9IHNlbGY7XG5cdFx0XHR0aGlzLm5leHQgPSB2b2lkIDA7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGFkZDogZnVuY3Rpb24gYWRkKGZuLHNlbGYpIHtcblx0XHRcdFx0aXRlbSA9IG5ldyBJdGVtKGZuLHNlbGYpO1xuXHRcdFx0XHRpZiAobGFzdCkge1xuXHRcdFx0XHRcdGxhc3QubmV4dCA9IGl0ZW07XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0Zmlyc3QgPSBpdGVtO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGxhc3QgPSBpdGVtO1xuXHRcdFx0XHRpdGVtID0gdm9pZCAwO1xuXHRcdFx0fSxcblx0XHRcdGRyYWluOiBmdW5jdGlvbiBkcmFpbigpIHtcblx0XHRcdFx0dmFyIGYgPSBmaXJzdDtcblx0XHRcdFx0Zmlyc3QgPSBsYXN0ID0gY3ljbGUgPSB2b2lkIDA7XG5cblx0XHRcdFx0d2hpbGUgKGYpIHtcblx0XHRcdFx0XHRmLmZuLmNhbGwoZi5zZWxmKTtcblx0XHRcdFx0XHRmID0gZi5uZXh0O1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fTtcblx0fSkoKTtcblxuXHRmdW5jdGlvbiBzY2hlZHVsZShmbixzZWxmKSB7XG5cdFx0c2NoZWR1bGluZ19xdWV1ZS5hZGQoZm4sc2VsZik7XG5cdFx0aWYgKCFjeWNsZSkge1xuXHRcdFx0Y3ljbGUgPSB0aW1lcihzY2hlZHVsaW5nX3F1ZXVlLmRyYWluKTtcblx0XHR9XG5cdH1cblxuXHQvLyBwcm9taXNlIGR1Y2sgdHlwaW5nXG5cdGZ1bmN0aW9uIGlzVGhlbmFibGUobykge1xuXHRcdHZhciBfdGhlbiwgb190eXBlID0gdHlwZW9mIG87XG5cblx0XHRpZiAobyAhPSBudWxsICYmXG5cdFx0XHQoXG5cdFx0XHRcdG9fdHlwZSA9PSBcIm9iamVjdFwiIHx8IG9fdHlwZSA9PSBcImZ1bmN0aW9uXCJcblx0XHRcdClcblx0XHQpIHtcblx0XHRcdF90aGVuID0gby50aGVuO1xuXHRcdH1cblx0XHRyZXR1cm4gdHlwZW9mIF90aGVuID09IFwiZnVuY3Rpb25cIiA/IF90aGVuIDogZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBub3RpZnkoKSB7XG5cdFx0Zm9yICh2YXIgaT0wOyBpPHRoaXMuY2hhaW4ubGVuZ3RoOyBpKyspIHtcblx0XHRcdG5vdGlmeUlzb2xhdGVkKFxuXHRcdFx0XHR0aGlzLFxuXHRcdFx0XHQodGhpcy5zdGF0ZSA9PT0gMSkgPyB0aGlzLmNoYWluW2ldLnN1Y2Nlc3MgOiB0aGlzLmNoYWluW2ldLmZhaWx1cmUsXG5cdFx0XHRcdHRoaXMuY2hhaW5baV1cblx0XHRcdCk7XG5cdFx0fVxuXHRcdHRoaXMuY2hhaW4ubGVuZ3RoID0gMDtcblx0fVxuXG5cdC8vIE5PVEU6IFRoaXMgaXMgYSBzZXBhcmF0ZSBmdW5jdGlvbiB0byBpc29sYXRlXG5cdC8vIHRoZSBgdHJ5Li5jYXRjaGAgc28gdGhhdCBvdGhlciBjb2RlIGNhbiBiZVxuXHQvLyBvcHRpbWl6ZWQgYmV0dGVyXG5cdGZ1bmN0aW9uIG5vdGlmeUlzb2xhdGVkKHNlbGYsY2IsY2hhaW4pIHtcblx0XHR2YXIgcmV0LCBfdGhlbjtcblx0XHR0cnkge1xuXHRcdFx0aWYgKGNiID09PSBmYWxzZSkge1xuXHRcdFx0XHRjaGFpbi5yZWplY3Qoc2VsZi5tc2cpO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZSB7XG5cdFx0XHRcdGlmIChjYiA9PT0gdHJ1ZSkge1xuXHRcdFx0XHRcdHJldCA9IHNlbGYubXNnO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2Uge1xuXHRcdFx0XHRcdHJldCA9IGNiLmNhbGwodm9pZCAwLHNlbGYubXNnKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChyZXQgPT09IGNoYWluLnByb21pc2UpIHtcblx0XHRcdFx0XHRjaGFpbi5yZWplY3QoVHlwZUVycm9yKFwiUHJvbWlzZS1jaGFpbiBjeWNsZVwiKSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSBpZiAoX3RoZW4gPSBpc1RoZW5hYmxlKHJldCkpIHtcblx0XHRcdFx0XHRfdGhlbi5jYWxsKHJldCxjaGFpbi5yZXNvbHZlLGNoYWluLnJlamVjdCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0ZWxzZSB7XG5cdFx0XHRcdFx0Y2hhaW4ucmVzb2x2ZShyZXQpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGNhdGNoIChlcnIpIHtcblx0XHRcdGNoYWluLnJlamVjdChlcnIpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHJlc29sdmUobXNnKSB7XG5cdFx0dmFyIF90aGVuLCBzZWxmID0gdGhpcztcblxuXHRcdC8vIGFscmVhZHkgdHJpZ2dlcmVkP1xuXHRcdGlmIChzZWxmLnRyaWdnZXJlZCkgeyByZXR1cm47IH1cblxuXHRcdHNlbGYudHJpZ2dlcmVkID0gdHJ1ZTtcblxuXHRcdC8vIHVud3JhcFxuXHRcdGlmIChzZWxmLmRlZikge1xuXHRcdFx0c2VsZiA9IHNlbGYuZGVmO1xuXHRcdH1cblxuXHRcdHRyeSB7XG5cdFx0XHRpZiAoX3RoZW4gPSBpc1RoZW5hYmxlKG1zZykpIHtcblx0XHRcdFx0c2NoZWR1bGUoZnVuY3Rpb24oKXtcblx0XHRcdFx0XHR2YXIgZGVmX3dyYXBwZXIgPSBuZXcgTWFrZURlZldyYXBwZXIoc2VsZik7XG5cdFx0XHRcdFx0dHJ5IHtcblx0XHRcdFx0XHRcdF90aGVuLmNhbGwobXNnLFxuXHRcdFx0XHRcdFx0XHRmdW5jdGlvbiAkcmVzb2x2ZSQoKXsgcmVzb2x2ZS5hcHBseShkZWZfd3JhcHBlcixhcmd1bWVudHMpOyB9LFxuXHRcdFx0XHRcdFx0XHRmdW5jdGlvbiAkcmVqZWN0JCgpeyByZWplY3QuYXBwbHkoZGVmX3dyYXBwZXIsYXJndW1lbnRzKTsgfVxuXHRcdFx0XHRcdFx0KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0Y2F0Y2ggKGVycikge1xuXHRcdFx0XHRcdFx0cmVqZWN0LmNhbGwoZGVmX3dyYXBwZXIsZXJyKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pXG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0c2VsZi5tc2cgPSBtc2c7XG5cdFx0XHRcdHNlbGYuc3RhdGUgPSAxO1xuXHRcdFx0XHRpZiAoc2VsZi5jaGFpbi5sZW5ndGggPiAwKSB7XG5cdFx0XHRcdFx0c2NoZWR1bGUobm90aWZ5LHNlbGYpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGNhdGNoIChlcnIpIHtcblx0XHRcdHJlamVjdC5jYWxsKG5ldyBNYWtlRGVmV3JhcHBlcihzZWxmKSxlcnIpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHJlamVjdChtc2cpIHtcblx0XHR2YXIgc2VsZiA9IHRoaXM7XG5cblx0XHQvLyBhbHJlYWR5IHRyaWdnZXJlZD9cblx0XHRpZiAoc2VsZi50cmlnZ2VyZWQpIHsgcmV0dXJuOyB9XG5cblx0XHRzZWxmLnRyaWdnZXJlZCA9IHRydWU7XG5cblx0XHQvLyB1bndyYXBcblx0XHRpZiAoc2VsZi5kZWYpIHtcblx0XHRcdHNlbGYgPSBzZWxmLmRlZjtcblx0XHR9XG5cblx0XHRzZWxmLm1zZyA9IG1zZztcblx0XHRzZWxmLnN0YXRlID0gMjtcblx0XHRpZiAoc2VsZi5jaGFpbi5sZW5ndGggPiAwKSB7XG5cdFx0XHRzY2hlZHVsZShub3RpZnksc2VsZik7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gaXRlcmF0ZVByb21pc2VzKENvbnN0cnVjdG9yLGFycixyZXNvbHZlcixyZWplY3Rlcikge1xuXHRcdGZvciAodmFyIGlkeD0wOyBpZHg8YXJyLmxlbmd0aDsgaWR4KyspIHtcblx0XHRcdChmdW5jdGlvbiBJSUZFKGlkeCl7XG5cdFx0XHRcdENvbnN0cnVjdG9yLnJlc29sdmUoYXJyW2lkeF0pXG5cdFx0XHRcdC50aGVuKFxuXHRcdFx0XHRcdGZ1bmN0aW9uICRyZXNvbHZlciQobXNnKXtcblx0XHRcdFx0XHRcdHJlc29sdmVyKGlkeCxtc2cpO1xuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0cmVqZWN0ZXJcblx0XHRcdFx0KTtcblx0XHRcdH0pKGlkeCk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gTWFrZURlZldyYXBwZXIoc2VsZikge1xuXHRcdHRoaXMuZGVmID0gc2VsZjtcblx0XHR0aGlzLnRyaWdnZXJlZCA9IGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gTWFrZURlZihzZWxmKSB7XG5cdFx0dGhpcy5wcm9taXNlID0gc2VsZjtcblx0XHR0aGlzLnN0YXRlID0gMDtcblx0XHR0aGlzLnRyaWdnZXJlZCA9IGZhbHNlO1xuXHRcdHRoaXMuY2hhaW4gPSBbXTtcblx0XHR0aGlzLm1zZyA9IHZvaWQgMDtcblx0fVxuXG5cdGZ1bmN0aW9uIFByb21pc2UoZXhlY3V0b3IpIHtcblx0XHRpZiAodHlwZW9mIGV4ZWN1dG9yICE9IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0fVxuXG5cdFx0aWYgKHRoaXMuX19OUE9fXyAhPT0gMCkge1xuXHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgcHJvbWlzZVwiKTtcblx0XHR9XG5cblx0XHQvLyBpbnN0YW5jZSBzaGFkb3dpbmcgdGhlIGluaGVyaXRlZCBcImJyYW5kXCJcblx0XHQvLyB0byBzaWduYWwgYW4gYWxyZWFkeSBcImluaXRpYWxpemVkXCIgcHJvbWlzZVxuXHRcdHRoaXMuX19OUE9fXyA9IDE7XG5cblx0XHR2YXIgZGVmID0gbmV3IE1ha2VEZWYodGhpcyk7XG5cblx0XHR0aGlzW1widGhlblwiXSA9IGZ1bmN0aW9uIHRoZW4oc3VjY2VzcyxmYWlsdXJlKSB7XG5cdFx0XHR2YXIgbyA9IHtcblx0XHRcdFx0c3VjY2VzczogdHlwZW9mIHN1Y2Nlc3MgPT0gXCJmdW5jdGlvblwiID8gc3VjY2VzcyA6IHRydWUsXG5cdFx0XHRcdGZhaWx1cmU6IHR5cGVvZiBmYWlsdXJlID09IFwiZnVuY3Rpb25cIiA/IGZhaWx1cmUgOiBmYWxzZVxuXHRcdFx0fTtcblx0XHRcdC8vIE5vdGU6IGB0aGVuKC4uKWAgaXRzZWxmIGNhbiBiZSBib3Jyb3dlZCB0byBiZSB1c2VkIGFnYWluc3Rcblx0XHRcdC8vIGEgZGlmZmVyZW50IHByb21pc2UgY29uc3RydWN0b3IgZm9yIG1ha2luZyB0aGUgY2hhaW5lZCBwcm9taXNlLFxuXHRcdFx0Ly8gYnkgc3Vic3RpdHV0aW5nIGEgZGlmZmVyZW50IGB0aGlzYCBiaW5kaW5nLlxuXHRcdFx0by5wcm9taXNlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoZnVuY3Rpb24gZXh0cmFjdENoYWluKHJlc29sdmUscmVqZWN0KSB7XG5cdFx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0XHR0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdG8ucmVzb2x2ZSA9IHJlc29sdmU7XG5cdFx0XHRcdG8ucmVqZWN0ID0gcmVqZWN0O1xuXHRcdFx0fSk7XG5cdFx0XHRkZWYuY2hhaW4ucHVzaChvKTtcblxuXHRcdFx0aWYgKGRlZi5zdGF0ZSAhPT0gMCkge1xuXHRcdFx0XHRzY2hlZHVsZShub3RpZnksZGVmKTtcblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIG8ucHJvbWlzZTtcblx0XHR9O1xuXHRcdHRoaXNbXCJjYXRjaFwiXSA9IGZ1bmN0aW9uICRjYXRjaCQoZmFpbHVyZSkge1xuXHRcdFx0cmV0dXJuIHRoaXMudGhlbih2b2lkIDAsZmFpbHVyZSk7XG5cdFx0fTtcblxuXHRcdHRyeSB7XG5cdFx0XHRleGVjdXRvci5jYWxsKFxuXHRcdFx0XHR2b2lkIDAsXG5cdFx0XHRcdGZ1bmN0aW9uIHB1YmxpY1Jlc29sdmUobXNnKXtcblx0XHRcdFx0XHRyZXNvbHZlLmNhbGwoZGVmLG1zZyk7XG5cdFx0XHRcdH0sXG5cdFx0XHRcdGZ1bmN0aW9uIHB1YmxpY1JlamVjdChtc2cpIHtcblx0XHRcdFx0XHRyZWplY3QuY2FsbChkZWYsbXNnKTtcblx0XHRcdFx0fVxuXHRcdFx0KTtcblx0XHR9XG5cdFx0Y2F0Y2ggKGVycikge1xuXHRcdFx0cmVqZWN0LmNhbGwoZGVmLGVycik7XG5cdFx0fVxuXHR9XG5cblx0dmFyIFByb21pc2VQcm90b3R5cGUgPSBidWlsdEluUHJvcCh7fSxcImNvbnN0cnVjdG9yXCIsUHJvbWlzZSxcblx0XHQvKmNvbmZpZ3VyYWJsZT0qL2ZhbHNlXG5cdCk7XG5cblx0Ly8gTm90ZTogQW5kcm9pZCA0IGNhbm5vdCB1c2UgYE9iamVjdC5kZWZpbmVQcm9wZXJ0eSguLilgIGhlcmVcblx0UHJvbWlzZS5wcm90b3R5cGUgPSBQcm9taXNlUHJvdG90eXBlO1xuXG5cdC8vIGJ1aWx0LWluIFwiYnJhbmRcIiB0byBzaWduYWwgYW4gXCJ1bmluaXRpYWxpemVkXCIgcHJvbWlzZVxuXHRidWlsdEluUHJvcChQcm9taXNlUHJvdG90eXBlLFwiX19OUE9fX1wiLDAsXG5cdFx0Lypjb25maWd1cmFibGU9Ki9mYWxzZVxuXHQpO1xuXG5cdGJ1aWx0SW5Qcm9wKFByb21pc2UsXCJyZXNvbHZlXCIsZnVuY3Rpb24gUHJvbWlzZSRyZXNvbHZlKG1zZykge1xuXHRcdHZhciBDb25zdHJ1Y3RvciA9IHRoaXM7XG5cblx0XHQvLyBzcGVjIG1hbmRhdGVkIGNoZWNrc1xuXHRcdC8vIG5vdGU6IGJlc3QgXCJpc1Byb21pc2VcIiBjaGVjayB0aGF0J3MgcHJhY3RpY2FsIGZvciBub3dcblx0XHRpZiAobXNnICYmIHR5cGVvZiBtc2cgPT0gXCJvYmplY3RcIiAmJiBtc2cuX19OUE9fXyA9PT0gMSkge1xuXHRcdFx0cmV0dXJuIG1zZztcblx0XHR9XG5cblx0XHRyZXR1cm4gbmV3IENvbnN0cnVjdG9yKGZ1bmN0aW9uIGV4ZWN1dG9yKHJlc29sdmUscmVqZWN0KXtcblx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0XHR9XG5cblx0XHRcdHJlc29sdmUobXNnKTtcblx0XHR9KTtcblx0fSk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcInJlamVjdFwiLGZ1bmN0aW9uIFByb21pc2UkcmVqZWN0KG1zZykge1xuXHRcdHJldHVybiBuZXcgdGhpcyhmdW5jdGlvbiBleGVjdXRvcihyZXNvbHZlLHJlamVjdCl7XG5cdFx0XHRpZiAodHlwZW9mIHJlc29sdmUgIT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiByZWplY3QgIT0gXCJmdW5jdGlvblwiKSB7XG5cdFx0XHRcdHRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRcdFx0fVxuXG5cdFx0XHRyZWplY3QobXNnKTtcblx0XHR9KTtcblx0fSk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcImFsbFwiLGZ1bmN0aW9uIFByb21pc2UkYWxsKGFycikge1xuXHRcdHZhciBDb25zdHJ1Y3RvciA9IHRoaXM7XG5cblx0XHQvLyBzcGVjIG1hbmRhdGVkIGNoZWNrc1xuXHRcdGlmIChUb1N0cmluZy5jYWxsKGFycikgIT0gXCJbb2JqZWN0IEFycmF5XVwiKSB7XG5cdFx0XHRyZXR1cm4gQ29uc3RydWN0b3IucmVqZWN0KFR5cGVFcnJvcihcIk5vdCBhbiBhcnJheVwiKSk7XG5cdFx0fVxuXHRcdGlmIChhcnIubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRyZXR1cm4gQ29uc3RydWN0b3IucmVzb2x2ZShbXSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIG5ldyBDb25zdHJ1Y3RvcihmdW5jdGlvbiBleGVjdXRvcihyZXNvbHZlLHJlamVjdCl7XG5cdFx0XHRpZiAodHlwZW9mIHJlc29sdmUgIT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiByZWplY3QgIT0gXCJmdW5jdGlvblwiKSB7XG5cdFx0XHRcdHRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgbGVuID0gYXJyLmxlbmd0aCwgbXNncyA9IEFycmF5KGxlbiksIGNvdW50ID0gMDtcblxuXHRcdFx0aXRlcmF0ZVByb21pc2VzKENvbnN0cnVjdG9yLGFycixmdW5jdGlvbiByZXNvbHZlcihpZHgsbXNnKSB7XG5cdFx0XHRcdG1zZ3NbaWR4XSA9IG1zZztcblx0XHRcdFx0aWYgKCsrY291bnQgPT09IGxlbikge1xuXHRcdFx0XHRcdHJlc29sdmUobXNncyk7XG5cdFx0XHRcdH1cblx0XHRcdH0scmVqZWN0KTtcblx0XHR9KTtcblx0fSk7XG5cblx0YnVpbHRJblByb3AoUHJvbWlzZSxcInJhY2VcIixmdW5jdGlvbiBQcm9taXNlJHJhY2UoYXJyKSB7XG5cdFx0dmFyIENvbnN0cnVjdG9yID0gdGhpcztcblxuXHRcdC8vIHNwZWMgbWFuZGF0ZWQgY2hlY2tzXG5cdFx0aWYgKFRvU3RyaW5nLmNhbGwoYXJyKSAhPSBcIltvYmplY3QgQXJyYXldXCIpIHtcblx0XHRcdHJldHVybiBDb25zdHJ1Y3Rvci5yZWplY3QoVHlwZUVycm9yKFwiTm90IGFuIGFycmF5XCIpKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gbmV3IENvbnN0cnVjdG9yKGZ1bmN0aW9uIGV4ZWN1dG9yKHJlc29sdmUscmVqZWN0KXtcblx0XHRcdGlmICh0eXBlb2YgcmVzb2x2ZSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHJlamVjdCAhPSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdFx0dGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7XG5cdFx0XHR9XG5cblx0XHRcdGl0ZXJhdGVQcm9taXNlcyhDb25zdHJ1Y3RvcixhcnIsZnVuY3Rpb24gcmVzb2x2ZXIoaWR4LG1zZyl7XG5cdFx0XHRcdHJlc29sdmUobXNnKTtcblx0XHRcdH0scmVqZWN0KTtcblx0XHR9KTtcblx0fSk7XG5cblx0cmV0dXJuIFByb21pc2U7XG59KTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4vLyByZXNvbHZlcyAuIGFuZCAuLiBlbGVtZW50cyBpbiBhIHBhdGggYXJyYXkgd2l0aCBkaXJlY3RvcnkgbmFtZXMgdGhlcmVcbi8vIG11c3QgYmUgbm8gc2xhc2hlcywgZW1wdHkgZWxlbWVudHMsIG9yIGRldmljZSBuYW1lcyAoYzpcXCkgaW4gdGhlIGFycmF5XG4vLyAoc28gYWxzbyBubyBsZWFkaW5nIGFuZCB0cmFpbGluZyBzbGFzaGVzIC0gaXQgZG9lcyBub3QgZGlzdGluZ3Vpc2hcbi8vIHJlbGF0aXZlIGFuZCBhYnNvbHV0ZSBwYXRocylcbmZ1bmN0aW9uIG5vcm1hbGl6ZUFycmF5KHBhcnRzLCBhbGxvd0Fib3ZlUm9vdCkge1xuICAvLyBpZiB0aGUgcGF0aCB0cmllcyB0byBnbyBhYm92ZSB0aGUgcm9vdCwgYHVwYCBlbmRzIHVwID4gMFxuICB2YXIgdXAgPSAwO1xuICBmb3IgKHZhciBpID0gcGFydHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICB2YXIgbGFzdCA9IHBhcnRzW2ldO1xuICAgIGlmIChsYXN0ID09PSAnLicpIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICB9IGVsc2UgaWYgKGxhc3QgPT09ICcuLicpIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICAgIHVwKys7XG4gICAgfSBlbHNlIGlmICh1cCkge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXAtLTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiB0aGUgcGF0aCBpcyBhbGxvd2VkIHRvIGdvIGFib3ZlIHRoZSByb290LCByZXN0b3JlIGxlYWRpbmcgLi5zXG4gIGlmIChhbGxvd0Fib3ZlUm9vdCkge1xuICAgIGZvciAoOyB1cC0tOyB1cCkge1xuICAgICAgcGFydHMudW5zaGlmdCgnLi4nKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG5cbi8vIFNwbGl0IGEgZmlsZW5hbWUgaW50byBbcm9vdCwgZGlyLCBiYXNlbmFtZSwgZXh0XSwgdW5peCB2ZXJzaW9uXG4vLyAncm9vdCcgaXMganVzdCBhIHNsYXNoLCBvciBub3RoaW5nLlxudmFyIHNwbGl0UGF0aFJlID1cbiAgICAvXihcXC8/fCkoW1xcc1xcU10qPykoKD86XFwuezEsMn18W15cXC9dKz98KShcXC5bXi5cXC9dKnwpKSg/OltcXC9dKikkLztcbnZhciBzcGxpdFBhdGggPSBmdW5jdGlvbihmaWxlbmFtZSkge1xuICByZXR1cm4gc3BsaXRQYXRoUmUuZXhlYyhmaWxlbmFtZSkuc2xpY2UoMSk7XG59O1xuXG4vLyBwYXRoLnJlc29sdmUoW2Zyb20gLi4uXSwgdG8pXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLnJlc29sdmUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJlc29sdmVkUGF0aCA9ICcnLFxuICAgICAgcmVzb2x2ZWRBYnNvbHV0ZSA9IGZhbHNlO1xuXG4gIGZvciAodmFyIGkgPSBhcmd1bWVudHMubGVuZ3RoIC0gMTsgaSA+PSAtMSAmJiAhcmVzb2x2ZWRBYnNvbHV0ZTsgaS0tKSB7XG4gICAgdmFyIHBhdGggPSAoaSA+PSAwKSA/IGFyZ3VtZW50c1tpXSA6IHByb2Nlc3MuY3dkKCk7XG5cbiAgICAvLyBTa2lwIGVtcHR5IGFuZCBpbnZhbGlkIGVudHJpZXNcbiAgICBpZiAodHlwZW9mIHBhdGggIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgdG8gcGF0aC5yZXNvbHZlIG11c3QgYmUgc3RyaW5ncycpO1xuICAgIH0gZWxzZSBpZiAoIXBhdGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHJlc29sdmVkUGF0aCA9IHBhdGggKyAnLycgKyByZXNvbHZlZFBhdGg7XG4gICAgcmVzb2x2ZWRBYnNvbHV0ZSA9IHBhdGguY2hhckF0KDApID09PSAnLyc7XG4gIH1cblxuICAvLyBBdCB0aGlzIHBvaW50IHRoZSBwYXRoIHNob3VsZCBiZSByZXNvbHZlZCB0byBhIGZ1bGwgYWJzb2x1dGUgcGF0aCwgYnV0XG4gIC8vIGhhbmRsZSByZWxhdGl2ZSBwYXRocyB0byBiZSBzYWZlIChtaWdodCBoYXBwZW4gd2hlbiBwcm9jZXNzLmN3ZCgpIGZhaWxzKVxuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICByZXNvbHZlZFBhdGggPSBub3JtYWxpemVBcnJheShmaWx0ZXIocmVzb2x2ZWRQYXRoLnNwbGl0KCcvJyksIGZ1bmN0aW9uKHApIHtcbiAgICByZXR1cm4gISFwO1xuICB9KSwgIXJlc29sdmVkQWJzb2x1dGUpLmpvaW4oJy8nKTtcblxuICByZXR1cm4gKChyZXNvbHZlZEFic29sdXRlID8gJy8nIDogJycpICsgcmVzb2x2ZWRQYXRoKSB8fCAnLic7XG59O1xuXG4vLyBwYXRoLm5vcm1hbGl6ZShwYXRoKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5ub3JtYWxpemUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHZhciBpc0Fic29sdXRlID0gZXhwb3J0cy5pc0Fic29sdXRlKHBhdGgpLFxuICAgICAgdHJhaWxpbmdTbGFzaCA9IHN1YnN0cihwYXRoLCAtMSkgPT09ICcvJztcblxuICAvLyBOb3JtYWxpemUgdGhlIHBhdGhcbiAgcGF0aCA9IG5vcm1hbGl6ZUFycmF5KGZpbHRlcihwYXRoLnNwbGl0KCcvJyksIGZ1bmN0aW9uKHApIHtcbiAgICByZXR1cm4gISFwO1xuICB9KSwgIWlzQWJzb2x1dGUpLmpvaW4oJy8nKTtcblxuICBpZiAoIXBhdGggJiYgIWlzQWJzb2x1dGUpIHtcbiAgICBwYXRoID0gJy4nO1xuICB9XG4gIGlmIChwYXRoICYmIHRyYWlsaW5nU2xhc2gpIHtcbiAgICBwYXRoICs9ICcvJztcbiAgfVxuXG4gIHJldHVybiAoaXNBYnNvbHV0ZSA/ICcvJyA6ICcnKSArIHBhdGg7XG59O1xuXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLmlzQWJzb2x1dGUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHJldHVybiBwYXRoLmNoYXJBdCgwKSA9PT0gJy8nO1xufTtcblxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5qb2luID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwYXRocyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMCk7XG4gIHJldHVybiBleHBvcnRzLm5vcm1hbGl6ZShmaWx0ZXIocGF0aHMsIGZ1bmN0aW9uKHAsIGluZGV4KSB7XG4gICAgaWYgKHR5cGVvZiBwICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIHRvIHBhdGguam9pbiBtdXN0IGJlIHN0cmluZ3MnKTtcbiAgICB9XG4gICAgcmV0dXJuIHA7XG4gIH0pLmpvaW4oJy8nKSk7XG59O1xuXG5cbi8vIHBhdGgucmVsYXRpdmUoZnJvbSwgdG8pXG4vLyBwb3NpeCB2ZXJzaW9uXG5leHBvcnRzLnJlbGF0aXZlID0gZnVuY3Rpb24oZnJvbSwgdG8pIHtcbiAgZnJvbSA9IGV4cG9ydHMucmVzb2x2ZShmcm9tKS5zdWJzdHIoMSk7XG4gIHRvID0gZXhwb3J0cy5yZXNvbHZlKHRvKS5zdWJzdHIoMSk7XG5cbiAgZnVuY3Rpb24gdHJpbShhcnIpIHtcbiAgICB2YXIgc3RhcnQgPSAwO1xuICAgIGZvciAoOyBzdGFydCA8IGFyci5sZW5ndGg7IHN0YXJ0KyspIHtcbiAgICAgIGlmIChhcnJbc3RhcnRdICE9PSAnJykgYnJlYWs7XG4gICAgfVxuXG4gICAgdmFyIGVuZCA9IGFyci5sZW5ndGggLSAxO1xuICAgIGZvciAoOyBlbmQgPj0gMDsgZW5kLS0pIHtcbiAgICAgIGlmIChhcnJbZW5kXSAhPT0gJycpIGJyZWFrO1xuICAgIH1cblxuICAgIGlmIChzdGFydCA+IGVuZCkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBhcnIuc2xpY2Uoc3RhcnQsIGVuZCAtIHN0YXJ0ICsgMSk7XG4gIH1cblxuICB2YXIgZnJvbVBhcnRzID0gdHJpbShmcm9tLnNwbGl0KCcvJykpO1xuICB2YXIgdG9QYXJ0cyA9IHRyaW0odG8uc3BsaXQoJy8nKSk7XG5cbiAgdmFyIGxlbmd0aCA9IE1hdGgubWluKGZyb21QYXJ0cy5sZW5ndGgsIHRvUGFydHMubGVuZ3RoKTtcbiAgdmFyIHNhbWVQYXJ0c0xlbmd0aCA9IGxlbmd0aDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmIChmcm9tUGFydHNbaV0gIT09IHRvUGFydHNbaV0pIHtcbiAgICAgIHNhbWVQYXJ0c0xlbmd0aCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB2YXIgb3V0cHV0UGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IHNhbWVQYXJ0c0xlbmd0aDsgaSA8IGZyb21QYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dHB1dFBhcnRzLnB1c2goJy4uJyk7XG4gIH1cblxuICBvdXRwdXRQYXJ0cyA9IG91dHB1dFBhcnRzLmNvbmNhdCh0b1BhcnRzLnNsaWNlKHNhbWVQYXJ0c0xlbmd0aCkpO1xuXG4gIHJldHVybiBvdXRwdXRQYXJ0cy5qb2luKCcvJyk7XG59O1xuXG5leHBvcnRzLnNlcCA9ICcvJztcbmV4cG9ydHMuZGVsaW1pdGVyID0gJzonO1xuXG5leHBvcnRzLmRpcm5hbWUgPSBmdW5jdGlvbihwYXRoKSB7XG4gIHZhciByZXN1bHQgPSBzcGxpdFBhdGgocGF0aCksXG4gICAgICByb290ID0gcmVzdWx0WzBdLFxuICAgICAgZGlyID0gcmVzdWx0WzFdO1xuXG4gIGlmICghcm9vdCAmJiAhZGlyKSB7XG4gICAgLy8gTm8gZGlybmFtZSB3aGF0c29ldmVyXG4gICAgcmV0dXJuICcuJztcbiAgfVxuXG4gIGlmIChkaXIpIHtcbiAgICAvLyBJdCBoYXMgYSBkaXJuYW1lLCBzdHJpcCB0cmFpbGluZyBzbGFzaFxuICAgIGRpciA9IGRpci5zdWJzdHIoMCwgZGlyLmxlbmd0aCAtIDEpO1xuICB9XG5cbiAgcmV0dXJuIHJvb3QgKyBkaXI7XG59O1xuXG5cbmV4cG9ydHMuYmFzZW5hbWUgPSBmdW5jdGlvbihwYXRoLCBleHQpIHtcbiAgdmFyIGYgPSBzcGxpdFBhdGgocGF0aClbMl07XG4gIC8vIFRPRE86IG1ha2UgdGhpcyBjb21wYXJpc29uIGNhc2UtaW5zZW5zaXRpdmUgb24gd2luZG93cz9cbiAgaWYgKGV4dCAmJiBmLnN1YnN0cigtMSAqIGV4dC5sZW5ndGgpID09PSBleHQpIHtcbiAgICBmID0gZi5zdWJzdHIoMCwgZi5sZW5ndGggLSBleHQubGVuZ3RoKTtcbiAgfVxuICByZXR1cm4gZjtcbn07XG5cblxuZXhwb3J0cy5leHRuYW1lID0gZnVuY3Rpb24ocGF0aCkge1xuICByZXR1cm4gc3BsaXRQYXRoKHBhdGgpWzNdO1xufTtcblxuZnVuY3Rpb24gZmlsdGVyICh4cywgZikge1xuICAgIGlmICh4cy5maWx0ZXIpIHJldHVybiB4cy5maWx0ZXIoZik7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgeHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGYoeHNbaV0sIGksIHhzKSkgcmVzLnB1c2goeHNbaV0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xufVxuXG4vLyBTdHJpbmcucHJvdG90eXBlLnN1YnN0ciAtIG5lZ2F0aXZlIGluZGV4IGRvbid0IHdvcmsgaW4gSUU4XG52YXIgc3Vic3RyID0gJ2FiJy5zdWJzdHIoLTEpID09PSAnYidcbiAgICA/IGZ1bmN0aW9uIChzdHIsIHN0YXJ0LCBsZW4pIHsgcmV0dXJuIHN0ci5zdWJzdHIoc3RhcnQsIGxlbikgfVxuICAgIDogZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikge1xuICAgICAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IHN0ci5sZW5ndGggKyBzdGFydDtcbiAgICAgICAgcmV0dXJuIHN0ci5zdWJzdHIoc3RhcnQsIGxlbik7XG4gICAgfVxuO1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbi8vIGNhY2hlZCBmcm9tIHdoYXRldmVyIGdsb2JhbCBpcyBwcmVzZW50IHNvIHRoYXQgdGVzdCBydW5uZXJzIHRoYXQgc3R1YiBpdFxuLy8gZG9uJ3QgYnJlYWsgdGhpbmdzLiAgQnV0IHdlIG5lZWQgdG8gd3JhcCBpdCBpbiBhIHRyeSBjYXRjaCBpbiBjYXNlIGl0IGlzXG4vLyB3cmFwcGVkIGluIHN0cmljdCBtb2RlIGNvZGUgd2hpY2ggZG9lc24ndCBkZWZpbmUgYW55IGdsb2JhbHMuICBJdCdzIGluc2lkZSBhXG4vLyBmdW5jdGlvbiBiZWNhdXNlIHRyeS9jYXRjaGVzIGRlb3B0aW1pemUgaW4gY2VydGFpbiBlbmdpbmVzLlxuXG52YXIgY2FjaGVkU2V0VGltZW91dDtcbnZhciBjYWNoZWRDbGVhclRpbWVvdXQ7XG5cbmZ1bmN0aW9uIGRlZmF1bHRTZXRUaW1vdXQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXRUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG5mdW5jdGlvbiBkZWZhdWx0Q2xlYXJUaW1lb3V0ICgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyVGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxuKGZ1bmN0aW9uICgpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIHNldFRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIGNsZWFyVGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gZGVmYXVsdENsZWFyVGltZW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gZGVmYXVsdENsZWFyVGltZW91dDtcbiAgICB9XG59ICgpKVxuZnVuY3Rpb24gcnVuVGltZW91dChmdW4pIHtcbiAgICBpZiAoY2FjaGVkU2V0VGltZW91dCA9PT0gc2V0VGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgLy8gaWYgc2V0VGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZFNldFRpbWVvdXQgPT09IGRlZmF1bHRTZXRUaW1vdXQgfHwgIWNhY2hlZFNldFRpbWVvdXQpICYmIHNldFRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9IGNhdGNoKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0IHRydXN0IHRoZSBnbG9iYWwgb2JqZWN0IHdoZW4gY2FsbGVkIG5vcm1hbGx5XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKG51bGwsIGZ1biwgMCk7XG4gICAgICAgIH0gY2F0Y2goZSl7XG4gICAgICAgICAgICAvLyBzYW1lIGFzIGFib3ZlIGJ1dCB3aGVuIGl0J3MgYSB2ZXJzaW9uIG9mIEkuRS4gdGhhdCBtdXN0IGhhdmUgdGhlIGdsb2JhbCBvYmplY3QgZm9yICd0aGlzJywgaG9wZnVsbHkgb3VyIGNvbnRleHQgY29ycmVjdCBvdGhlcndpc2UgaXQgd2lsbCB0aHJvdyBhIGdsb2JhbCBlcnJvclxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbCh0aGlzLCBmdW4sIDApO1xuICAgICAgICB9XG4gICAgfVxuXG5cbn1cbmZ1bmN0aW9uIHJ1bkNsZWFyVGltZW91dChtYXJrZXIpIHtcbiAgICBpZiAoY2FjaGVkQ2xlYXJUaW1lb3V0ID09PSBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBjbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9XG4gICAgLy8gaWYgY2xlYXJUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkQ2xlYXJUaW1lb3V0ID09PSBkZWZhdWx0Q2xlYXJUaW1lb3V0IHx8ICFjYWNoZWRDbGVhclRpbWVvdXQpICYmIGNsZWFyVGltZW91dCkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIHJldHVybiBjbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfSBjYXRjaCAoZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgIHRydXN0IHRoZSBnbG9iYWwgb2JqZWN0IHdoZW4gY2FsbGVkIG5vcm1hbGx5XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwobnVsbCwgbWFya2VyKTtcbiAgICAgICAgfSBjYXRjaCAoZSl7XG4gICAgICAgICAgICAvLyBzYW1lIGFzIGFib3ZlIGJ1dCB3aGVuIGl0J3MgYSB2ZXJzaW9uIG9mIEkuRS4gdGhhdCBtdXN0IGhhdmUgdGhlIGdsb2JhbCBvYmplY3QgZm9yICd0aGlzJywgaG9wZnVsbHkgb3VyIGNvbnRleHQgY29ycmVjdCBvdGhlcndpc2UgaXQgd2lsbCB0aHJvdyBhIGdsb2JhbCBlcnJvci5cbiAgICAgICAgICAgIC8vIFNvbWUgdmVyc2lvbnMgb2YgSS5FLiBoYXZlIGRpZmZlcmVudCBydWxlcyBmb3IgY2xlYXJUaW1lb3V0IHZzIHNldFRpbWVvdXRcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbCh0aGlzLCBtYXJrZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG5cblxufVxudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcbnZhciBjdXJyZW50UXVldWU7XG52YXIgcXVldWVJbmRleCA9IC0xO1xuXG5mdW5jdGlvbiBjbGVhblVwTmV4dFRpY2soKSB7XG4gICAgaWYgKCFkcmFpbmluZyB8fCAhY3VycmVudFF1ZXVlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBpZiAoY3VycmVudFF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBxdWV1ZSA9IGN1cnJlbnRRdWV1ZS5jb25jYXQocXVldWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICB9XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBkcmFpblF1ZXVlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkcmFpblF1ZXVlKCkge1xuICAgIGlmIChkcmFpbmluZykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciB0aW1lb3V0ID0gcnVuVGltZW91dChjbGVhblVwTmV4dFRpY2spO1xuICAgIGRyYWluaW5nID0gdHJ1ZTtcblxuICAgIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUobGVuKSB7XG4gICAgICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgICAgICBxdWV1ZSA9IFtdO1xuICAgICAgICB3aGlsZSAoKytxdWV1ZUluZGV4IDwgbGVuKSB7XG4gICAgICAgICAgICBpZiAoY3VycmVudFF1ZXVlKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgcnVuQ2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgcnVuVGltZW91dChkcmFpblF1ZXVlKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xucHJvY2Vzcy5wcmVwZW5kTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5wcmVwZW5kT25jZUxpc3RlbmVyID0gbm9vcDtcblxucHJvY2Vzcy5saXN0ZW5lcnMgPSBmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gW10gfVxuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xucHJvY2Vzcy51bWFzayA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gMDsgfTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4ndXNlIHN0cmljdCc7XG5cbi8vIElmIG9iai5oYXNPd25Qcm9wZXJ0eSBoYXMgYmVlbiBvdmVycmlkZGVuLCB0aGVuIGNhbGxpbmdcbi8vIG9iai5oYXNPd25Qcm9wZXJ0eShwcm9wKSB3aWxsIGJyZWFrLlxuLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vam95ZW50L25vZGUvaXNzdWVzLzE3MDdcbmZ1bmN0aW9uIGhhc093blByb3BlcnR5KG9iaiwgcHJvcCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwgcHJvcCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ocXMsIHNlcCwgZXEsIG9wdGlvbnMpIHtcbiAgc2VwID0gc2VwIHx8ICcmJztcbiAgZXEgPSBlcSB8fCAnPSc7XG4gIHZhciBvYmogPSB7fTtcblxuICBpZiAodHlwZW9mIHFzICE9PSAnc3RyaW5nJyB8fCBxcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gb2JqO1xuICB9XG5cbiAgdmFyIHJlZ2V4cCA9IC9cXCsvZztcbiAgcXMgPSBxcy5zcGxpdChzZXApO1xuXG4gIHZhciBtYXhLZXlzID0gMTAwMDtcbiAgaWYgKG9wdGlvbnMgJiYgdHlwZW9mIG9wdGlvbnMubWF4S2V5cyA9PT0gJ251bWJlcicpIHtcbiAgICBtYXhLZXlzID0gb3B0aW9ucy5tYXhLZXlzO1xuICB9XG5cbiAgdmFyIGxlbiA9IHFzLmxlbmd0aDtcbiAgLy8gbWF4S2V5cyA8PSAwIG1lYW5zIHRoYXQgd2Ugc2hvdWxkIG5vdCBsaW1pdCBrZXlzIGNvdW50XG4gIGlmIChtYXhLZXlzID4gMCAmJiBsZW4gPiBtYXhLZXlzKSB7XG4gICAgbGVuID0gbWF4S2V5cztcbiAgfVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpIHtcbiAgICB2YXIgeCA9IHFzW2ldLnJlcGxhY2UocmVnZXhwLCAnJTIwJyksXG4gICAgICAgIGlkeCA9IHguaW5kZXhPZihlcSksXG4gICAgICAgIGtzdHIsIHZzdHIsIGssIHY7XG5cbiAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgIGtzdHIgPSB4LnN1YnN0cigwLCBpZHgpO1xuICAgICAgdnN0ciA9IHguc3Vic3RyKGlkeCArIDEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBrc3RyID0geDtcbiAgICAgIHZzdHIgPSAnJztcbiAgICB9XG5cbiAgICBrID0gZGVjb2RlVVJJQ29tcG9uZW50KGtzdHIpO1xuICAgIHYgPSBkZWNvZGVVUklDb21wb25lbnQodnN0cik7XG5cbiAgICBpZiAoIWhhc093blByb3BlcnR5KG9iaiwgaykpIHtcbiAgICAgIG9ialtrXSA9IHY7XG4gICAgfSBlbHNlIGlmIChpc0FycmF5KG9ialtrXSkpIHtcbiAgICAgIG9ialtrXS5wdXNoKHYpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvYmpba10gPSBbb2JqW2tdLCB2XTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb2JqO1xufTtcblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uICh4cykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHhzKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgc3RyaW5naWZ5UHJpbWl0aXZlID0gZnVuY3Rpb24odikge1xuICBzd2l0Y2ggKHR5cGVvZiB2KSB7XG4gICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgIHJldHVybiB2O1xuXG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gdiA/ICd0cnVlJyA6ICdmYWxzZSc7XG5cbiAgICBjYXNlICdudW1iZXInOlxuICAgICAgcmV0dXJuIGlzRmluaXRlKHYpID8gdiA6ICcnO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAnJztcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvYmosIHNlcCwgZXEsIG5hbWUpIHtcbiAgc2VwID0gc2VwIHx8ICcmJztcbiAgZXEgPSBlcSB8fCAnPSc7XG4gIGlmIChvYmogPT09IG51bGwpIHtcbiAgICBvYmogPSB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAodHlwZW9mIG9iaiA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gbWFwKG9iamVjdEtleXMob2JqKSwgZnVuY3Rpb24oaykge1xuICAgICAgdmFyIGtzID0gZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShrKSkgKyBlcTtcbiAgICAgIGlmIChpc0FycmF5KG9ialtrXSkpIHtcbiAgICAgICAgcmV0dXJuIG1hcChvYmpba10sIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgICByZXR1cm4ga3MgKyBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKHYpKTtcbiAgICAgICAgfSkuam9pbihzZXApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGtzICsgZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShvYmpba10pKTtcbiAgICAgIH1cbiAgICB9KS5qb2luKHNlcCk7XG5cbiAgfVxuXG4gIGlmICghbmFtZSkgcmV0dXJuICcnO1xuICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShuYW1lKSkgKyBlcSArXG4gICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKG9iaikpO1xufTtcblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uICh4cykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHhzKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5cbmZ1bmN0aW9uIG1hcCAoeHMsIGYpIHtcbiAgaWYgKHhzLm1hcCkgcmV0dXJuIHhzLm1hcChmKTtcbiAgdmFyIHJlcyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgcmVzLnB1c2goZih4c1tpXSwgaSkpO1xuICB9XG4gIHJldHVybiByZXM7XG59XG5cbnZhciBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICB2YXIgcmVzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwga2V5KSkgcmVzLnB1c2goa2V5KTtcbiAgfVxuICByZXR1cm4gcmVzO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuZXhwb3J0cy5kZWNvZGUgPSBleHBvcnRzLnBhcnNlID0gcmVxdWlyZSgnLi9kZWNvZGUnKTtcbmV4cG9ydHMuZW5jb2RlID0gZXhwb3J0cy5zdHJpbmdpZnkgPSByZXF1aXJlKCcuL2VuY29kZScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoc3RyKSB7XG5cdHZhciBpc0V4dGVuZGVkTGVuZ3RoUGF0aCA9IC9eXFxcXFxcXFxcXD9cXFxcLy50ZXN0KHN0cik7XG5cdHZhciBoYXNOb25Bc2NpaSA9IC9bXlxceDAwLVxceDgwXSsvLnRlc3Qoc3RyKTtcblxuXHRpZiAoaXNFeHRlbmRlZExlbmd0aFBhdGggfHwgaGFzTm9uQXNjaWkpIHtcblx0XHRyZXR1cm4gc3RyO1xuXHR9XG5cblx0cmV0dXJuIHN0ci5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59O1xuIiwiLyoqIEBsaWNlbnNlIFVSSS5qcyB2My4wLjEgKGMpIDIwMTEgR2FyeSBDb3VydC4gTGljZW5zZTogaHR0cDovL2dpdGh1Yi5jb20vZ2FyeWNvdXJ0L3VyaS1qcyAqL1xuKGZ1bmN0aW9uIChnbG9iYWwsIGZhY3RvcnkpIHtcblx0dHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnID8gZmFjdG9yeShleHBvcnRzKSA6XG5cdHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCA/IGRlZmluZShbJ2V4cG9ydHMnXSwgZmFjdG9yeSkgOlxuXHQoZmFjdG9yeSgoZ2xvYmFsLlVSSSA9IGdsb2JhbC5VUkkgfHwge30pKSk7XG59KHRoaXMsIChmdW5jdGlvbiAoZXhwb3J0cykgeyAndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIG1lcmdlKCkge1xuICAgIGZvciAodmFyIF9sZW4gPSBhcmd1bWVudHMubGVuZ3RoLCBzZXRzID0gQXJyYXkoX2xlbiksIF9rZXkgPSAwOyBfa2V5IDwgX2xlbjsgX2tleSsrKSB7XG4gICAgICAgIHNldHNbX2tleV0gPSBhcmd1bWVudHNbX2tleV07XG4gICAgfVxuXG4gICAgaWYgKHNldHMubGVuZ3RoID4gMSkge1xuICAgICAgICBzZXRzWzBdID0gc2V0c1swXS5zbGljZSgwLCAtMSk7XG4gICAgICAgIHZhciB4bCA9IHNldHMubGVuZ3RoIC0gMTtcbiAgICAgICAgZm9yICh2YXIgeCA9IDE7IHggPCB4bDsgKyt4KSB7XG4gICAgICAgICAgICBzZXRzW3hdID0gc2V0c1t4XS5zbGljZSgxLCAtMSk7XG4gICAgICAgIH1cbiAgICAgICAgc2V0c1t4bF0gPSBzZXRzW3hsXS5zbGljZSgxKTtcbiAgICAgICAgcmV0dXJuIHNldHMuam9pbignJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHNldHNbMF07XG4gICAgfVxufVxuZnVuY3Rpb24gc3ViZXhwKHN0cikge1xuICAgIHJldHVybiBcIig/OlwiICsgc3RyICsgXCIpXCI7XG59XG5mdW5jdGlvbiB0eXBlT2Yobykge1xuICAgIHJldHVybiBvID09PSB1bmRlZmluZWQgPyBcInVuZGVmaW5lZFwiIDogbyA9PT0gbnVsbCA/IFwibnVsbFwiIDogT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pLnNwbGl0KFwiIFwiKS5wb3AoKS5zcGxpdChcIl1cIikuc2hpZnQoKS50b0xvd2VyQ2FzZSgpO1xufVxuZnVuY3Rpb24gdG9VcHBlckNhc2Uoc3RyKSB7XG4gICAgcmV0dXJuIHN0ci50b1VwcGVyQ2FzZSgpO1xufVxuZnVuY3Rpb24gdG9BcnJheShvYmopIHtcbiAgICByZXR1cm4gb2JqICE9PSB1bmRlZmluZWQgJiYgb2JqICE9PSBudWxsID8gb2JqIGluc3RhbmNlb2YgQXJyYXkgPyBvYmogOiB0eXBlb2Ygb2JqLmxlbmd0aCAhPT0gXCJudW1iZXJcIiB8fCBvYmouc3BsaXQgfHwgb2JqLnNldEludGVydmFsIHx8IG9iai5jYWxsID8gW29ial0gOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChvYmopIDogW107XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRXhwcyhpc0lSSSkge1xuICAgIHZhciBBTFBIQSQkID0gXCJbQS1aYS16XVwiLFxuICAgICAgICBDUiQgPSBcIltcXFxceDBEXVwiLFxuICAgICAgICBESUdJVCQkID0gXCJbMC05XVwiLFxuICAgICAgICBEUVVPVEUkJCA9IFwiW1xcXFx4MjJdXCIsXG4gICAgICAgIEhFWERJRyQkID0gbWVyZ2UoRElHSVQkJCwgXCJbQS1GYS1mXVwiKSxcbiAgICAgICAgLy9jYXNlLWluc2Vuc2l0aXZlXG4gICAgTEYkJCA9IFwiW1xcXFx4MEFdXCIsXG4gICAgICAgIFNQJCQgPSBcIltcXFxceDIwXVwiLFxuICAgICAgICBQQ1RfRU5DT0RFRCQgPSBzdWJleHAoc3ViZXhwKFwiJVtFRmVmXVwiICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIlWzg5QS1GYS1mXVwiICsgSEVYRElHJCQgKyBcIiVcIiArIEhFWERJRyQkICsgSEVYRElHJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIlXCIgKyBIRVhESUckJCArIEhFWERJRyQkKSksXG4gICAgICAgIC8vZXhwYW5kZWRcbiAgICBHRU5fREVMSU1TJCQgPSBcIltcXFxcOlxcXFwvXFxcXD9cXFxcI1xcXFxbXFxcXF1cXFxcQF1cIixcbiAgICAgICAgU1VCX0RFTElNUyQkID0gXCJbXFxcXCFcXFxcJFxcXFwmXFxcXCdcXFxcKFxcXFwpXFxcXCpcXFxcK1xcXFwsXFxcXDtcXFxcPV1cIixcbiAgICAgICAgUkVTRVJWRUQkJCA9IG1lcmdlKEdFTl9ERUxJTVMkJCwgU1VCX0RFTElNUyQkKSxcbiAgICAgICAgVUNTQ0hBUiQkID0gaXNJUkkgPyBcIltcXFxceEEwLVxcXFx1MjAwRFxcXFx1MjAxMC1cXFxcdTIwMjlcXFxcdTIwMkYtXFxcXHVEN0ZGXFxcXHVGOTAwLVxcXFx1RkRDRlxcXFx1RkRGMC1cXFxcdUZGRUZdXCIgOiBcIltdXCIsXG4gICAgICAgIC8vc3Vic2V0LCBleGNsdWRlcyBiaWRpIGNvbnRyb2wgY2hhcmFjdGVyc1xuICAgIElQUklWQVRFJCQgPSBpc0lSSSA/IFwiW1xcXFx1RTAwMC1cXFxcdUY4RkZdXCIgOiBcIltdXCIsXG4gICAgICAgIC8vc3Vic2V0XG4gICAgVU5SRVNFUlZFRCQkID0gbWVyZ2UoQUxQSEEkJCwgRElHSVQkJCwgXCJbXFxcXC1cXFxcLlxcXFxfXFxcXH5dXCIsIFVDU0NIQVIkJCksXG4gICAgICAgIFNDSEVNRSQgPSBzdWJleHAoQUxQSEEkJCArIG1lcmdlKEFMUEhBJCQsIERJR0lUJCQsIFwiW1xcXFwrXFxcXC1cXFxcLl1cIikgKyBcIipcIiksXG4gICAgICAgIFVTRVJJTkZPJCA9IHN1YmV4cChzdWJleHAoUENUX0VOQ09ERUQkICsgXCJ8XCIgKyBtZXJnZShVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCwgXCJbXFxcXDpdXCIpKSArIFwiKlwiKSxcbiAgICAgICAgREVDX09DVEVUJCA9IHN1YmV4cChzdWJleHAoXCIyNVswLTVdXCIpICsgXCJ8XCIgKyBzdWJleHAoXCIyWzAtNF1cIiArIERJR0lUJCQpICsgXCJ8XCIgKyBzdWJleHAoXCIxXCIgKyBESUdJVCQkICsgRElHSVQkJCkgKyBcInxcIiArIHN1YmV4cChcIlsxLTldXCIgKyBESUdJVCQkKSArIFwifFwiICsgRElHSVQkJCksXG4gICAgICAgIElQVjRBRERSRVNTJCA9IHN1YmV4cChERUNfT0NURVQkICsgXCJcXFxcLlwiICsgREVDX09DVEVUJCArIFwiXFxcXC5cIiArIERFQ19PQ1RFVCQgKyBcIlxcXFwuXCIgKyBERUNfT0NURVQkKSxcbiAgICAgICAgSDE2JCA9IHN1YmV4cChIRVhESUckJCArIFwiezEsNH1cIiksXG4gICAgICAgIExTMzIkID0gc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiICsgSDE2JCkgKyBcInxcIiArIElQVjRBRERSRVNTJCksXG4gICAgICAgIElQVjZBRERSRVNTMSQgPSBzdWJleHAoc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7Nn1cIiArIExTMzIkKSxcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgICAgICAgICAgICA2KCBoMTYgXCI6XCIgKSBsczMyXG4gICAgSVBWNkFERFJFU1MyJCA9IHN1YmV4cChcIlxcXFw6XFxcXDpcIiArIHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezV9XCIgKyBMUzMyJCksXG4gICAgICAgIC8vICAgICAgICAgICAgICAgICAgICAgIFwiOjpcIiA1KCBoMTYgXCI6XCIgKSBsczMyXG4gICAgSVBWNkFERFJFU1MzJCA9IHN1YmV4cChzdWJleHAoSDE2JCkgKyBcIj9cXFxcOlxcXFw6XCIgKyBzdWJleHAoSDE2JCArIFwiXFxcXDpcIikgKyBcIns0fVwiICsgTFMzMiQpLFxuICAgICAgICAvL1sgICAgICAgICAgICAgICBoMTYgXSBcIjo6XCIgNCggaDE2IFwiOlwiICkgbHMzMlxuICAgIElQVjZBRERSRVNTNCQgPSBzdWJleHAoc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezAsMX1cIiArIEgxNiQpICsgXCI/XFxcXDpcXFxcOlwiICsgc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7M31cIiArIExTMzIkKSxcbiAgICAgICAgLy9bICoxKCBoMTYgXCI6XCIgKSBoMTYgXSBcIjo6XCIgMyggaDE2IFwiOlwiICkgbHMzMlxuICAgIElQVjZBRERSRVNTNSQgPSBzdWJleHAoc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezAsMn1cIiArIEgxNiQpICsgXCI/XFxcXDpcXFxcOlwiICsgc3ViZXhwKEgxNiQgKyBcIlxcXFw6XCIpICsgXCJ7Mn1cIiArIExTMzIkKSxcbiAgICAgICAgLy9bICoyKCBoMTYgXCI6XCIgKSBoMTYgXSBcIjo6XCIgMiggaDE2IFwiOlwiICkgbHMzMlxuICAgIElQVjZBRERSRVNTNiQgPSBzdWJleHAoc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezAsM31cIiArIEgxNiQpICsgXCI/XFxcXDpcXFxcOlwiICsgSDE2JCArIFwiXFxcXDpcIiArIExTMzIkKSxcbiAgICAgICAgLy9bICozKCBoMTYgXCI6XCIgKSBoMTYgXSBcIjo6XCIgICAgaDE2IFwiOlwiICAgbHMzMlxuICAgIElQVjZBRERSRVNTNyQgPSBzdWJleHAoc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezAsNH1cIiArIEgxNiQpICsgXCI/XFxcXDpcXFxcOlwiICsgTFMzMiQpLFxuICAgICAgICAvL1sgKjQoIGgxNiBcIjpcIiApIGgxNiBdIFwiOjpcIiAgICAgICAgICAgICAgbHMzMlxuICAgIElQVjZBRERSRVNTOCQgPSBzdWJleHAoc3ViZXhwKHN1YmV4cChIMTYkICsgXCJcXFxcOlwiKSArIFwiezAsNX1cIiArIEgxNiQpICsgXCI/XFxcXDpcXFxcOlwiICsgSDE2JCksXG4gICAgICAgIC8vWyAqNSggaDE2IFwiOlwiICkgaDE2IF0gXCI6OlwiICAgICAgICAgICAgICBoMTZcbiAgICBJUFY2QUREUkVTUzkkID0gc3ViZXhwKHN1YmV4cChzdWJleHAoSDE2JCArIFwiXFxcXDpcIikgKyBcInswLDZ9XCIgKyBIMTYkKSArIFwiP1xcXFw6XFxcXDpcIiksXG4gICAgICAgIC8vWyAqNiggaDE2IFwiOlwiICkgaDE2IF0gXCI6OlwiXG4gICAgSVBWNkFERFJFU1MkID0gc3ViZXhwKFtJUFY2QUREUkVTUzEkLCBJUFY2QUREUkVTUzIkLCBJUFY2QUREUkVTUzMkLCBJUFY2QUREUkVTUzQkLCBJUFY2QUREUkVTUzUkLCBJUFY2QUREUkVTUzYkLCBJUFY2QUREUkVTUzckLCBJUFY2QUREUkVTUzgkLCBJUFY2QUREUkVTUzkkXS5qb2luKFwifFwiKSksXG4gICAgICAgIElQVkZVVFVSRSQgPSBzdWJleHAoXCJbdlZdXCIgKyBIRVhESUckJCArIFwiK1xcXFwuXCIgKyBtZXJnZShVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCwgXCJbXFxcXDpdXCIpICsgXCIrXCIpLFxuICAgICAgICBJUF9MSVRFUkFMJCA9IHN1YmV4cChcIlxcXFxbXCIgKyBzdWJleHAoSVBWNkFERFJFU1MkICsgXCJ8XCIgKyBJUFZGVVRVUkUkKSArIFwiXFxcXF1cIiksXG4gICAgICAgIFJFR19OQU1FJCA9IHN1YmV4cChzdWJleHAoUENUX0VOQ09ERUQkICsgXCJ8XCIgKyBtZXJnZShVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCkpICsgXCIqXCIpLFxuICAgICAgICBIT1NUJCA9IHN1YmV4cChJUF9MSVRFUkFMJCArIFwifFwiICsgSVBWNEFERFJFU1MkICsgXCIoPyFcIiArIFJFR19OQU1FJCArIFwiKVwiICsgXCJ8XCIgKyBSRUdfTkFNRSQpLFxuICAgICAgICBQT1JUJCA9IHN1YmV4cChESUdJVCQkICsgXCIqXCIpLFxuICAgICAgICBBVVRIT1JJVFkkID0gc3ViZXhwKHN1YmV4cChVU0VSSU5GTyQgKyBcIkBcIikgKyBcIj9cIiArIEhPU1QkICsgc3ViZXhwKFwiXFxcXDpcIiArIFBPUlQkKSArIFwiP1wiKSxcbiAgICAgICAgUENIQVIkID0gc3ViZXhwKFBDVF9FTkNPREVEJCArIFwifFwiICsgbWVyZ2UoVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQsIFwiW1xcXFw6XFxcXEBdXCIpKSxcbiAgICAgICAgU0VHTUVOVCQgPSBzdWJleHAoUENIQVIkICsgXCIqXCIpLFxuICAgICAgICBTRUdNRU5UX05aJCA9IHN1YmV4cChQQ0hBUiQgKyBcIitcIiksXG4gICAgICAgIFNFR01FTlRfTlpfTkMkID0gc3ViZXhwKHN1YmV4cChQQ1RfRU5DT0RFRCQgKyBcInxcIiArIG1lcmdlKFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcQF1cIikpICsgXCIrXCIpLFxuICAgICAgICBQQVRIX0FCRU1QVFkkID0gc3ViZXhwKHN1YmV4cChcIlxcXFwvXCIgKyBTRUdNRU5UJCkgKyBcIipcIiksXG4gICAgICAgIFBBVEhfQUJTT0xVVEUkID0gc3ViZXhwKFwiXFxcXC9cIiArIHN1YmV4cChTRUdNRU5UX05aJCArIFBBVEhfQUJFTVBUWSQpICsgXCI/XCIpLFxuICAgICAgICAvL3NpbXBsaWZpZWRcbiAgICBQQVRIX05PU0NIRU1FJCA9IHN1YmV4cChTRUdNRU5UX05aX05DJCArIFBBVEhfQUJFTVBUWSQpLFxuICAgICAgICAvL3NpbXBsaWZpZWRcbiAgICBQQVRIX1JPT1RMRVNTJCA9IHN1YmV4cChTRUdNRU5UX05aJCArIFBBVEhfQUJFTVBUWSQpLFxuICAgICAgICAvL3NpbXBsaWZpZWRcbiAgICBQQVRIX0VNUFRZJCA9IFwiKD8hXCIgKyBQQ0hBUiQgKyBcIilcIixcbiAgICAgICAgUEFUSCQgPSBzdWJleHAoUEFUSF9BQkVNUFRZJCArIFwifFwiICsgUEFUSF9BQlNPTFVURSQgKyBcInxcIiArIFBBVEhfTk9TQ0hFTUUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQpLFxuICAgICAgICBRVUVSWSQgPSBzdWJleHAoc3ViZXhwKFBDSEFSJCArIFwifFwiICsgbWVyZ2UoXCJbXFxcXC9cXFxcP11cIiwgSVBSSVZBVEUkJCkpICsgXCIqXCIpLFxuICAgICAgICBGUkFHTUVOVCQgPSBzdWJleHAoc3ViZXhwKFBDSEFSJCArIFwifFtcXFxcL1xcXFw/XVwiKSArIFwiKlwiKSxcbiAgICAgICAgSElFUl9QQVJUJCA9IHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvXCIgKyBBVVRIT1JJVFkkICsgUEFUSF9BQkVNUFRZJCkgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQpLFxuICAgICAgICBVUkkkID0gc3ViZXhwKFNDSEVNRSQgKyBcIlxcXFw6XCIgKyBISUVSX1BBUlQkICsgc3ViZXhwKFwiXFxcXD9cIiArIFFVRVJZJCkgKyBcIj9cIiArIHN1YmV4cChcIlxcXFwjXCIgKyBGUkFHTUVOVCQpICsgXCI/XCIpLFxuICAgICAgICBSRUxBVElWRV9QQVJUJCA9IHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvXCIgKyBBVVRIT1JJVFkkICsgUEFUSF9BQkVNUFRZJCkgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX05PU0NIRU1FJCArIFwifFwiICsgUEFUSF9FTVBUWSQpLFxuICAgICAgICBSRUxBVElWRSQgPSBzdWJleHAoUkVMQVRJVkVfUEFSVCQgKyBzdWJleHAoXCJcXFxcP1wiICsgUVVFUlkkKSArIFwiP1wiICsgc3ViZXhwKFwiXFxcXCNcIiArIEZSQUdNRU5UJCkgKyBcIj9cIiksXG4gICAgICAgIFVSSV9SRUZFUkVOQ0UkID0gc3ViZXhwKFVSSSQgKyBcInxcIiArIFJFTEFUSVZFJCksXG4gICAgICAgIEFCU09MVVRFX1VSSSQgPSBzdWJleHAoU0NIRU1FJCArIFwiXFxcXDpcIiArIEhJRVJfUEFSVCQgKyBzdWJleHAoXCJcXFxcP1wiICsgUVVFUlkkKSArIFwiP1wiKSxcbiAgICAgICAgR0VORVJJQ19SRUYkID0gXCJeKFwiICsgU0NIRU1FJCArIFwiKVxcXFw6XCIgKyBzdWJleHAoc3ViZXhwKFwiXFxcXC9cXFxcLyhcIiArIHN1YmV4cChcIihcIiArIFVTRVJJTkZPJCArIFwiKUBcIikgKyBcIj8oXCIgKyBIT1NUJCArIFwiKVwiICsgc3ViZXhwKFwiXFxcXDooXCIgKyBQT1JUJCArIFwiKVwiKSArIFwiPylcIikgKyBcIj8oXCIgKyBQQVRIX0FCRU1QVFkkICsgXCJ8XCIgKyBQQVRIX0FCU09MVVRFJCArIFwifFwiICsgUEFUSF9ST09UTEVTUyQgKyBcInxcIiArIFBBVEhfRU1QVFkkICsgXCIpXCIpICsgc3ViZXhwKFwiXFxcXD8oXCIgKyBRVUVSWSQgKyBcIilcIikgKyBcIj9cIiArIHN1YmV4cChcIlxcXFwjKFwiICsgRlJBR01FTlQkICsgXCIpXCIpICsgXCI/JFwiLFxuICAgICAgICBSRUxBVElWRV9SRUYkID0gXCJeKCl7MH1cIiArIHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvKFwiICsgc3ViZXhwKFwiKFwiICsgVVNFUklORk8kICsgXCIpQFwiKSArIFwiPyhcIiArIEhPU1QkICsgXCIpXCIgKyBzdWJleHAoXCJcXFxcOihcIiArIFBPUlQkICsgXCIpXCIpICsgXCI/KVwiKSArIFwiPyhcIiArIFBBVEhfQUJFTVBUWSQgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX05PU0NIRU1FJCArIFwifFwiICsgUEFUSF9FTVBUWSQgKyBcIilcIikgKyBzdWJleHAoXCJcXFxcPyhcIiArIFFVRVJZJCArIFwiKVwiKSArIFwiP1wiICsgc3ViZXhwKFwiXFxcXCMoXCIgKyBGUkFHTUVOVCQgKyBcIilcIikgKyBcIj8kXCIsXG4gICAgICAgIEFCU09MVVRFX1JFRiQgPSBcIl4oXCIgKyBTQ0hFTUUkICsgXCIpXFxcXDpcIiArIHN1YmV4cChzdWJleHAoXCJcXFxcL1xcXFwvKFwiICsgc3ViZXhwKFwiKFwiICsgVVNFUklORk8kICsgXCIpQFwiKSArIFwiPyhcIiArIEhPU1QkICsgXCIpXCIgKyBzdWJleHAoXCJcXFxcOihcIiArIFBPUlQkICsgXCIpXCIpICsgXCI/KVwiKSArIFwiPyhcIiArIFBBVEhfQUJFTVBUWSQgKyBcInxcIiArIFBBVEhfQUJTT0xVVEUkICsgXCJ8XCIgKyBQQVRIX1JPT1RMRVNTJCArIFwifFwiICsgUEFUSF9FTVBUWSQgKyBcIilcIikgKyBzdWJleHAoXCJcXFxcPyhcIiArIFFVRVJZJCArIFwiKVwiKSArIFwiPyRcIixcbiAgICAgICAgU0FNRURPQ19SRUYkID0gXCJeXCIgKyBzdWJleHAoXCJcXFxcIyhcIiArIEZSQUdNRU5UJCArIFwiKVwiKSArIFwiPyRcIixcbiAgICAgICAgQVVUSE9SSVRZX1JFRiQgPSBcIl5cIiArIHN1YmV4cChcIihcIiArIFVTRVJJTkZPJCArIFwiKUBcIikgKyBcIj8oXCIgKyBIT1NUJCArIFwiKVwiICsgc3ViZXhwKFwiXFxcXDooXCIgKyBQT1JUJCArIFwiKVwiKSArIFwiPyRcIjtcbiAgICByZXR1cm4ge1xuICAgICAgICBOT1RfU0NIRU1FOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15dXCIsIEFMUEhBJCQsIERJR0lUJCQsIFwiW1xcXFwrXFxcXC1cXFxcLl1cIiksIFwiZ1wiKSxcbiAgICAgICAgTk9UX1VTRVJJTkZPOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJVxcXFw6XVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcbiAgICAgICAgTk9UX0hPU1Q6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXFxcXFtcXFxcXVxcXFw6XVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcbiAgICAgICAgTk9UX1BBVEg6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXFxcXC9cXFxcOlxcXFxAXVwiLCBVTlJFU0VSVkVEJCQsIFNVQl9ERUxJTVMkJCksIFwiZ1wiKSxcbiAgICAgICAgTk9UX1BBVEhfTk9TQ0hFTUU6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXlxcXFwlXFxcXC9cXFxcQF1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQpLCBcImdcIiksXG4gICAgICAgIE5PVF9RVUVSWTogbmV3IFJlZ0V4cChtZXJnZShcIlteXFxcXCVdXCIsIFVOUkVTRVJWRUQkJCwgU1VCX0RFTElNUyQkLCBcIltcXFxcOlxcXFxAXFxcXC9cXFxcP11cIiwgSVBSSVZBVEUkJCksIFwiZ1wiKSxcbiAgICAgICAgTk9UX0ZSQUdNRU5UOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJV1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQsIFwiW1xcXFw6XFxcXEBcXFxcL1xcXFw/XVwiKSwgXCJnXCIpLFxuICAgICAgICBFU0NBUEU6IG5ldyBSZWdFeHAobWVyZ2UoXCJbXl1cIiwgVU5SRVNFUlZFRCQkLCBTVUJfREVMSU1TJCQpLCBcImdcIiksXG4gICAgICAgIFVOUkVTRVJWRUQ6IG5ldyBSZWdFeHAoVU5SRVNFUlZFRCQkLCBcImdcIiksXG4gICAgICAgIE9USEVSX0NIQVJTOiBuZXcgUmVnRXhwKG1lcmdlKFwiW15cXFxcJV1cIiwgVU5SRVNFUlZFRCQkLCBSRVNFUlZFRCQkKSwgXCJnXCIpLFxuICAgICAgICBQQ1RfRU5DT0RFRDogbmV3IFJlZ0V4cChQQ1RfRU5DT0RFRCQsIFwiZ1wiKSxcbiAgICAgICAgSVBWNkFERFJFU1M6IG5ldyBSZWdFeHAoXCJcXFxcWz8oXCIgKyBJUFY2QUREUkVTUyQgKyBcIilcXFxcXT9cIiwgXCJnXCIpXG4gICAgfTtcbn1cbnZhciBVUklfUFJPVE9DT0wgPSBidWlsZEV4cHMoZmFsc2UpO1xuXG52YXIgSVJJX1BST1RPQ09MID0gYnVpbGRFeHBzKHRydWUpO1xuXG52YXIgdG9Db25zdW1hYmxlQXJyYXkgPSBmdW5jdGlvbiAoYXJyKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KGFycikpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgYXJyMiA9IEFycmF5KGFyci5sZW5ndGgpOyBpIDwgYXJyLmxlbmd0aDsgaSsrKSBhcnIyW2ldID0gYXJyW2ldO1xuXG4gICAgcmV0dXJuIGFycjI7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIEFycmF5LmZyb20oYXJyKTtcbiAgfVxufTtcblxuLyoqIEhpZ2hlc3QgcG9zaXRpdmUgc2lnbmVkIDMyLWJpdCBmbG9hdCB2YWx1ZSAqL1xuXG52YXIgbWF4SW50ID0gMjE0NzQ4MzY0NzsgLy8gYWthLiAweDdGRkZGRkZGIG9yIDJeMzEtMVxuXG4vKiogQm9vdHN0cmluZyBwYXJhbWV0ZXJzICovXG52YXIgYmFzZSA9IDM2O1xudmFyIHRNaW4gPSAxO1xudmFyIHRNYXggPSAyNjtcbnZhciBza2V3ID0gMzg7XG52YXIgZGFtcCA9IDcwMDtcbnZhciBpbml0aWFsQmlhcyA9IDcyO1xudmFyIGluaXRpYWxOID0gMTI4OyAvLyAweDgwXG52YXIgZGVsaW1pdGVyID0gJy0nOyAvLyAnXFx4MkQnXG5cbi8qKiBSZWd1bGFyIGV4cHJlc3Npb25zICovXG52YXIgcmVnZXhQdW55Y29kZSA9IC9eeG4tLS87XG52YXIgcmVnZXhOb25BU0NJSSA9IC9bXlxcMC1cXHg3RV0vOyAvLyBub24tQVNDSUkgY2hhcnNcbnZhciByZWdleFNlcGFyYXRvcnMgPSAvW1xceDJFXFx1MzAwMlxcdUZGMEVcXHVGRjYxXS9nOyAvLyBSRkMgMzQ5MCBzZXBhcmF0b3JzXG5cbi8qKiBFcnJvciBtZXNzYWdlcyAqL1xudmFyIGVycm9ycyA9IHtcblx0J292ZXJmbG93JzogJ092ZXJmbG93OiBpbnB1dCBuZWVkcyB3aWRlciBpbnRlZ2VycyB0byBwcm9jZXNzJyxcblx0J25vdC1iYXNpYyc6ICdJbGxlZ2FsIGlucHV0ID49IDB4ODAgKG5vdCBhIGJhc2ljIGNvZGUgcG9pbnQpJyxcblx0J2ludmFsaWQtaW5wdXQnOiAnSW52YWxpZCBpbnB1dCdcbn07XG5cbi8qKiBDb252ZW5pZW5jZSBzaG9ydGN1dHMgKi9cbnZhciBiYXNlTWludXNUTWluID0gYmFzZSAtIHRNaW47XG52YXIgZmxvb3IgPSBNYXRoLmZsb29yO1xudmFyIHN0cmluZ0Zyb21DaGFyQ29kZSA9IFN0cmluZy5mcm9tQ2hhckNvZGU7XG5cbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuXG4vKipcbiAqIEEgZ2VuZXJpYyBlcnJvciB1dGlsaXR5IGZ1bmN0aW9uLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlIFRoZSBlcnJvciB0eXBlLlxuICogQHJldHVybnMge0Vycm9yfSBUaHJvd3MgYSBgUmFuZ2VFcnJvcmAgd2l0aCB0aGUgYXBwbGljYWJsZSBlcnJvciBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBlcnJvciQxKHR5cGUpIHtcblx0dGhyb3cgbmV3IFJhbmdlRXJyb3IoZXJyb3JzW3R5cGVdKTtcbn1cblxuLyoqXG4gKiBBIGdlbmVyaWMgYEFycmF5I21hcGAgdXRpbGl0eSBmdW5jdGlvbi5cbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5fSBhcnJheSBUaGUgYXJyYXkgdG8gaXRlcmF0ZSBvdmVyLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRoYXQgZ2V0cyBjYWxsZWQgZm9yIGV2ZXJ5IGFycmF5XG4gKiBpdGVtLlxuICogQHJldHVybnMge0FycmF5fSBBIG5ldyBhcnJheSBvZiB2YWx1ZXMgcmV0dXJuZWQgYnkgdGhlIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICovXG5mdW5jdGlvbiBtYXAoYXJyYXksIGZuKSB7XG5cdHZhciByZXN1bHQgPSBbXTtcblx0dmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcblx0d2hpbGUgKGxlbmd0aC0tKSB7XG5cdFx0cmVzdWx0W2xlbmd0aF0gPSBmbihhcnJheVtsZW5ndGhdKTtcblx0fVxuXHRyZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIEEgc2ltcGxlIGBBcnJheSNtYXBgLWxpa2Ugd3JhcHBlciB0byB3b3JrIHdpdGggZG9tYWluIG5hbWUgc3RyaW5ncyBvciBlbWFpbFxuICogYWRkcmVzc2VzLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBkb21haW4gVGhlIGRvbWFpbiBuYW1lIG9yIGVtYWlsIGFkZHJlc3MuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdGhhdCBnZXRzIGNhbGxlZCBmb3IgZXZlcnlcbiAqIGNoYXJhY3Rlci5cbiAqIEByZXR1cm5zIHtBcnJheX0gQSBuZXcgc3RyaW5nIG9mIGNoYXJhY3RlcnMgcmV0dXJuZWQgYnkgdGhlIGNhbGxiYWNrXG4gKiBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gbWFwRG9tYWluKHN0cmluZywgZm4pIHtcblx0dmFyIHBhcnRzID0gc3RyaW5nLnNwbGl0KCdAJyk7XG5cdHZhciByZXN1bHQgPSAnJztcblx0aWYgKHBhcnRzLmxlbmd0aCA+IDEpIHtcblx0XHQvLyBJbiBlbWFpbCBhZGRyZXNzZXMsIG9ubHkgdGhlIGRvbWFpbiBuYW1lIHNob3VsZCBiZSBwdW55Y29kZWQuIExlYXZlXG5cdFx0Ly8gdGhlIGxvY2FsIHBhcnQgKGkuZS4gZXZlcnl0aGluZyB1cCB0byBgQGApIGludGFjdC5cblx0XHRyZXN1bHQgPSBwYXJ0c1swXSArICdAJztcblx0XHRzdHJpbmcgPSBwYXJ0c1sxXTtcblx0fVxuXHQvLyBBdm9pZCBgc3BsaXQocmVnZXgpYCBmb3IgSUU4IGNvbXBhdGliaWxpdHkuIFNlZSAjMTcuXG5cdHN0cmluZyA9IHN0cmluZy5yZXBsYWNlKHJlZ2V4U2VwYXJhdG9ycywgJ1xceDJFJyk7XG5cdHZhciBsYWJlbHMgPSBzdHJpbmcuc3BsaXQoJy4nKTtcblx0dmFyIGVuY29kZWQgPSBtYXAobGFiZWxzLCBmbikuam9pbignLicpO1xuXHRyZXR1cm4gcmVzdWx0ICsgZW5jb2RlZDtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGFycmF5IGNvbnRhaW5pbmcgdGhlIG51bWVyaWMgY29kZSBwb2ludHMgb2YgZWFjaCBVbmljb2RlXG4gKiBjaGFyYWN0ZXIgaW4gdGhlIHN0cmluZy4gV2hpbGUgSmF2YVNjcmlwdCB1c2VzIFVDUy0yIGludGVybmFsbHksXG4gKiB0aGlzIGZ1bmN0aW9uIHdpbGwgY29udmVydCBhIHBhaXIgb2Ygc3Vycm9nYXRlIGhhbHZlcyAoZWFjaCBvZiB3aGljaFxuICogVUNTLTIgZXhwb3NlcyBhcyBzZXBhcmF0ZSBjaGFyYWN0ZXJzKSBpbnRvIGEgc2luZ2xlIGNvZGUgcG9pbnQsXG4gKiBtYXRjaGluZyBVVEYtMTYuXG4gKiBAc2VlIGBwdW55Y29kZS51Y3MyLmVuY29kZWBcbiAqIEBzZWUgPGh0dHBzOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LWVuY29kaW5nPlxuICogQG1lbWJlck9mIHB1bnljb2RlLnVjczJcbiAqIEBuYW1lIGRlY29kZVxuICogQHBhcmFtIHtTdHJpbmd9IHN0cmluZyBUaGUgVW5pY29kZSBpbnB1dCBzdHJpbmcgKFVDUy0yKS5cbiAqIEByZXR1cm5zIHtBcnJheX0gVGhlIG5ldyBhcnJheSBvZiBjb2RlIHBvaW50cy5cbiAqL1xuZnVuY3Rpb24gdWNzMmRlY29kZShzdHJpbmcpIHtcblx0dmFyIG91dHB1dCA9IFtdO1xuXHR2YXIgY291bnRlciA9IDA7XG5cdHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoO1xuXHR3aGlsZSAoY291bnRlciA8IGxlbmd0aCkge1xuXHRcdHZhciB2YWx1ZSA9IHN0cmluZy5jaGFyQ29kZUF0KGNvdW50ZXIrKyk7XG5cdFx0aWYgKHZhbHVlID49IDB4RDgwMCAmJiB2YWx1ZSA8PSAweERCRkYgJiYgY291bnRlciA8IGxlbmd0aCkge1xuXHRcdFx0Ly8gSXQncyBhIGhpZ2ggc3Vycm9nYXRlLCBhbmQgdGhlcmUgaXMgYSBuZXh0IGNoYXJhY3Rlci5cblx0XHRcdHZhciBleHRyYSA9IHN0cmluZy5jaGFyQ29kZUF0KGNvdW50ZXIrKyk7XG5cdFx0XHRpZiAoKGV4dHJhICYgMHhGQzAwKSA9PSAweERDMDApIHtcblx0XHRcdFx0Ly8gTG93IHN1cnJvZ2F0ZS5cblx0XHRcdFx0b3V0cHV0LnB1c2goKCh2YWx1ZSAmIDB4M0ZGKSA8PCAxMCkgKyAoZXh0cmEgJiAweDNGRikgKyAweDEwMDAwKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdC8vIEl0J3MgYW4gdW5tYXRjaGVkIHN1cnJvZ2F0ZTsgb25seSBhcHBlbmQgdGhpcyBjb2RlIHVuaXQsIGluIGNhc2UgdGhlXG5cdFx0XHRcdC8vIG5leHQgY29kZSB1bml0IGlzIHRoZSBoaWdoIHN1cnJvZ2F0ZSBvZiBhIHN1cnJvZ2F0ZSBwYWlyLlxuXHRcdFx0XHRvdXRwdXQucHVzaCh2YWx1ZSk7XG5cdFx0XHRcdGNvdW50ZXItLTtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0b3V0cHV0LnB1c2godmFsdWUpO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0cHV0O1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBzdHJpbmcgYmFzZWQgb24gYW4gYXJyYXkgb2YgbnVtZXJpYyBjb2RlIHBvaW50cy5cbiAqIEBzZWUgYHB1bnljb2RlLnVjczIuZGVjb2RlYFxuICogQG1lbWJlck9mIHB1bnljb2RlLnVjczJcbiAqIEBuYW1lIGVuY29kZVxuICogQHBhcmFtIHtBcnJheX0gY29kZVBvaW50cyBUaGUgYXJyYXkgb2YgbnVtZXJpYyBjb2RlIHBvaW50cy5cbiAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBuZXcgVW5pY29kZSBzdHJpbmcgKFVDUy0yKS5cbiAqL1xudmFyIHVjczJlbmNvZGUgPSBmdW5jdGlvbiB1Y3MyZW5jb2RlKGFycmF5KSB7XG5cdHJldHVybiBTdHJpbmcuZnJvbUNvZGVQb2ludC5hcHBseShTdHJpbmcsIHRvQ29uc3VtYWJsZUFycmF5KGFycmF5KSk7XG59O1xuXG4vKipcbiAqIENvbnZlcnRzIGEgYmFzaWMgY29kZSBwb2ludCBpbnRvIGEgZGlnaXQvaW50ZWdlci5cbiAqIEBzZWUgYGRpZ2l0VG9CYXNpYygpYFxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7TnVtYmVyfSBjb2RlUG9pbnQgVGhlIGJhc2ljIG51bWVyaWMgY29kZSBwb2ludCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtOdW1iZXJ9IFRoZSBudW1lcmljIHZhbHVlIG9mIGEgYmFzaWMgY29kZSBwb2ludCAoZm9yIHVzZSBpblxuICogcmVwcmVzZW50aW5nIGludGVnZXJzKSBpbiB0aGUgcmFuZ2UgYDBgIHRvIGBiYXNlIC0gMWAsIG9yIGBiYXNlYCBpZlxuICogdGhlIGNvZGUgcG9pbnQgZG9lcyBub3QgcmVwcmVzZW50IGEgdmFsdWUuXG4gKi9cbnZhciBiYXNpY1RvRGlnaXQgPSBmdW5jdGlvbiBiYXNpY1RvRGlnaXQoY29kZVBvaW50KSB7XG5cdGlmIChjb2RlUG9pbnQgLSAweDMwIDwgMHgwQSkge1xuXHRcdHJldHVybiBjb2RlUG9pbnQgLSAweDE2O1xuXHR9XG5cdGlmIChjb2RlUG9pbnQgLSAweDQxIDwgMHgxQSkge1xuXHRcdHJldHVybiBjb2RlUG9pbnQgLSAweDQxO1xuXHR9XG5cdGlmIChjb2RlUG9pbnQgLSAweDYxIDwgMHgxQSkge1xuXHRcdHJldHVybiBjb2RlUG9pbnQgLSAweDYxO1xuXHR9XG5cdHJldHVybiBiYXNlO1xufTtcblxuLyoqXG4gKiBDb252ZXJ0cyBhIGRpZ2l0L2ludGVnZXIgaW50byBhIGJhc2ljIGNvZGUgcG9pbnQuXG4gKiBAc2VlIGBiYXNpY1RvRGlnaXQoKWBcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge051bWJlcn0gZGlnaXQgVGhlIG51bWVyaWMgdmFsdWUgb2YgYSBiYXNpYyBjb2RlIHBvaW50LlxuICogQHJldHVybnMge051bWJlcn0gVGhlIGJhc2ljIGNvZGUgcG9pbnQgd2hvc2UgdmFsdWUgKHdoZW4gdXNlZCBmb3JcbiAqIHJlcHJlc2VudGluZyBpbnRlZ2VycykgaXMgYGRpZ2l0YCwgd2hpY2ggbmVlZHMgdG8gYmUgaW4gdGhlIHJhbmdlXG4gKiBgMGAgdG8gYGJhc2UgLSAxYC4gSWYgYGZsYWdgIGlzIG5vbi16ZXJvLCB0aGUgdXBwZXJjYXNlIGZvcm0gaXNcbiAqIHVzZWQ7IGVsc2UsIHRoZSBsb3dlcmNhc2UgZm9ybSBpcyB1c2VkLiBUaGUgYmVoYXZpb3IgaXMgdW5kZWZpbmVkXG4gKiBpZiBgZmxhZ2AgaXMgbm9uLXplcm8gYW5kIGBkaWdpdGAgaGFzIG5vIHVwcGVyY2FzZSBmb3JtLlxuICovXG52YXIgZGlnaXRUb0Jhc2ljID0gZnVuY3Rpb24gZGlnaXRUb0Jhc2ljKGRpZ2l0LCBmbGFnKSB7XG5cdC8vICAwLi4yNSBtYXAgdG8gQVNDSUkgYS4ueiBvciBBLi5aXG5cdC8vIDI2Li4zNSBtYXAgdG8gQVNDSUkgMC4uOVxuXHRyZXR1cm4gZGlnaXQgKyAyMiArIDc1ICogKGRpZ2l0IDwgMjYpIC0gKChmbGFnICE9IDApIDw8IDUpO1xufTtcblxuLyoqXG4gKiBCaWFzIGFkYXB0YXRpb24gZnVuY3Rpb24gYXMgcGVyIHNlY3Rpb24gMy40IG9mIFJGQyAzNDkyLlxuICogaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM0OTIjc2VjdGlvbi0zLjRcbiAqIEBwcml2YXRlXG4gKi9cbnZhciBhZGFwdCA9IGZ1bmN0aW9uIGFkYXB0KGRlbHRhLCBudW1Qb2ludHMsIGZpcnN0VGltZSkge1xuXHR2YXIgayA9IDA7XG5cdGRlbHRhID0gZmlyc3RUaW1lID8gZmxvb3IoZGVsdGEgLyBkYW1wKSA6IGRlbHRhID4+IDE7XG5cdGRlbHRhICs9IGZsb29yKGRlbHRhIC8gbnVtUG9pbnRzKTtcblx0Zm9yICg7IC8qIG5vIGluaXRpYWxpemF0aW9uICovZGVsdGEgPiBiYXNlTWludXNUTWluICogdE1heCA+PiAxOyBrICs9IGJhc2UpIHtcblx0XHRkZWx0YSA9IGZsb29yKGRlbHRhIC8gYmFzZU1pbnVzVE1pbik7XG5cdH1cblx0cmV0dXJuIGZsb29yKGsgKyAoYmFzZU1pbnVzVE1pbiArIDEpICogZGVsdGEgLyAoZGVsdGEgKyBza2V3KSk7XG59O1xuXG4vKipcbiAqIENvbnZlcnRzIGEgUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scyB0byBhIHN0cmluZyBvZiBVbmljb2RlXG4gKiBzeW1ib2xzLlxuICogQG1lbWJlck9mIHB1bnljb2RlXG4gKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMuXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgcmVzdWx0aW5nIHN0cmluZyBvZiBVbmljb2RlIHN5bWJvbHMuXG4gKi9cbnZhciBkZWNvZGUgPSBmdW5jdGlvbiBkZWNvZGUoaW5wdXQpIHtcblx0Ly8gRG9uJ3QgdXNlIFVDUy0yLlxuXHR2YXIgb3V0cHV0ID0gW107XG5cdHZhciBpbnB1dExlbmd0aCA9IGlucHV0Lmxlbmd0aDtcblx0dmFyIGkgPSAwO1xuXHR2YXIgbiA9IGluaXRpYWxOO1xuXHR2YXIgYmlhcyA9IGluaXRpYWxCaWFzO1xuXG5cdC8vIEhhbmRsZSB0aGUgYmFzaWMgY29kZSBwb2ludHM6IGxldCBgYmFzaWNgIGJlIHRoZSBudW1iZXIgb2YgaW5wdXQgY29kZVxuXHQvLyBwb2ludHMgYmVmb3JlIHRoZSBsYXN0IGRlbGltaXRlciwgb3IgYDBgIGlmIHRoZXJlIGlzIG5vbmUsIHRoZW4gY29weVxuXHQvLyB0aGUgZmlyc3QgYmFzaWMgY29kZSBwb2ludHMgdG8gdGhlIG91dHB1dC5cblxuXHR2YXIgYmFzaWMgPSBpbnB1dC5sYXN0SW5kZXhPZihkZWxpbWl0ZXIpO1xuXHRpZiAoYmFzaWMgPCAwKSB7XG5cdFx0YmFzaWMgPSAwO1xuXHR9XG5cblx0Zm9yICh2YXIgaiA9IDA7IGogPCBiYXNpYzsgKytqKSB7XG5cdFx0Ly8gaWYgaXQncyBub3QgYSBiYXNpYyBjb2RlIHBvaW50XG5cdFx0aWYgKGlucHV0LmNoYXJDb2RlQXQoaikgPj0gMHg4MCkge1xuXHRcdFx0ZXJyb3IkMSgnbm90LWJhc2ljJyk7XG5cdFx0fVxuXHRcdG91dHB1dC5wdXNoKGlucHV0LmNoYXJDb2RlQXQoaikpO1xuXHR9XG5cblx0Ly8gTWFpbiBkZWNvZGluZyBsb29wOiBzdGFydCBqdXN0IGFmdGVyIHRoZSBsYXN0IGRlbGltaXRlciBpZiBhbnkgYmFzaWMgY29kZVxuXHQvLyBwb2ludHMgd2VyZSBjb3BpZWQ7IHN0YXJ0IGF0IHRoZSBiZWdpbm5pbmcgb3RoZXJ3aXNlLlxuXG5cdGZvciAodmFyIGluZGV4ID0gYmFzaWMgPiAwID8gYmFzaWMgKyAxIDogMDsgaW5kZXggPCBpbnB1dExlbmd0aDspIC8qIG5vIGZpbmFsIGV4cHJlc3Npb24gKi97XG5cblx0XHQvLyBgaW5kZXhgIGlzIHRoZSBpbmRleCBvZiB0aGUgbmV4dCBjaGFyYWN0ZXIgdG8gYmUgY29uc3VtZWQuXG5cdFx0Ly8gRGVjb2RlIGEgZ2VuZXJhbGl6ZWQgdmFyaWFibGUtbGVuZ3RoIGludGVnZXIgaW50byBgZGVsdGFgLFxuXHRcdC8vIHdoaWNoIGdldHMgYWRkZWQgdG8gYGlgLiBUaGUgb3ZlcmZsb3cgY2hlY2tpbmcgaXMgZWFzaWVyXG5cdFx0Ly8gaWYgd2UgaW5jcmVhc2UgYGlgIGFzIHdlIGdvLCB0aGVuIHN1YnRyYWN0IG9mZiBpdHMgc3RhcnRpbmdcblx0XHQvLyB2YWx1ZSBhdCB0aGUgZW5kIHRvIG9idGFpbiBgZGVsdGFgLlxuXHRcdHZhciBvbGRpID0gaTtcblx0XHRmb3IgKHZhciB3ID0gMSwgayA9IGJhc2U7OyAvKiBubyBjb25kaXRpb24gKi9rICs9IGJhc2UpIHtcblxuXHRcdFx0aWYgKGluZGV4ID49IGlucHV0TGVuZ3RoKSB7XG5cdFx0XHRcdGVycm9yJDEoJ2ludmFsaWQtaW5wdXQnKTtcblx0XHRcdH1cblxuXHRcdFx0dmFyIGRpZ2l0ID0gYmFzaWNUb0RpZ2l0KGlucHV0LmNoYXJDb2RlQXQoaW5kZXgrKykpO1xuXG5cdFx0XHRpZiAoZGlnaXQgPj0gYmFzZSB8fCBkaWdpdCA+IGZsb29yKChtYXhJbnQgLSBpKSAvIHcpKSB7XG5cdFx0XHRcdGVycm9yJDEoJ292ZXJmbG93Jyk7XG5cdFx0XHR9XG5cblx0XHRcdGkgKz0gZGlnaXQgKiB3O1xuXHRcdFx0dmFyIHQgPSBrIDw9IGJpYXMgPyB0TWluIDogayA+PSBiaWFzICsgdE1heCA/IHRNYXggOiBrIC0gYmlhcztcblxuXHRcdFx0aWYgKGRpZ2l0IDwgdCkge1xuXHRcdFx0XHRicmVhaztcblx0XHRcdH1cblxuXHRcdFx0dmFyIGJhc2VNaW51c1QgPSBiYXNlIC0gdDtcblx0XHRcdGlmICh3ID4gZmxvb3IobWF4SW50IC8gYmFzZU1pbnVzVCkpIHtcblx0XHRcdFx0ZXJyb3IkMSgnb3ZlcmZsb3cnKTtcblx0XHRcdH1cblxuXHRcdFx0dyAqPSBiYXNlTWludXNUO1xuXHRcdH1cblxuXHRcdHZhciBvdXQgPSBvdXRwdXQubGVuZ3RoICsgMTtcblx0XHRiaWFzID0gYWRhcHQoaSAtIG9sZGksIG91dCwgb2xkaSA9PSAwKTtcblxuXHRcdC8vIGBpYCB3YXMgc3VwcG9zZWQgdG8gd3JhcCBhcm91bmQgZnJvbSBgb3V0YCB0byBgMGAsXG5cdFx0Ly8gaW5jcmVtZW50aW5nIGBuYCBlYWNoIHRpbWUsIHNvIHdlJ2xsIGZpeCB0aGF0IG5vdzpcblx0XHRpZiAoZmxvb3IoaSAvIG91dCkgPiBtYXhJbnQgLSBuKSB7XG5cdFx0XHRlcnJvciQxKCdvdmVyZmxvdycpO1xuXHRcdH1cblxuXHRcdG4gKz0gZmxvb3IoaSAvIG91dCk7XG5cdFx0aSAlPSBvdXQ7XG5cblx0XHQvLyBJbnNlcnQgYG5gIGF0IHBvc2l0aW9uIGBpYCBvZiB0aGUgb3V0cHV0LlxuXHRcdG91dHB1dC5zcGxpY2UoaSsrLCAwLCBuKTtcblx0fVxuXG5cdHJldHVybiBTdHJpbmcuZnJvbUNvZGVQb2ludC5hcHBseShTdHJpbmcsIG91dHB1dCk7XG59O1xuXG4vKipcbiAqIENvbnZlcnRzIGEgc3RyaW5nIG9mIFVuaWNvZGUgc3ltYm9scyAoZS5nLiBhIGRvbWFpbiBuYW1lIGxhYmVsKSB0byBhXG4gKiBQdW55Y29kZSBzdHJpbmcgb2YgQVNDSUktb25seSBzeW1ib2xzLlxuICogQG1lbWJlck9mIHB1bnljb2RlXG4gKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIHN0cmluZyBvZiBVbmljb2RlIHN5bWJvbHMuXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgcmVzdWx0aW5nIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMuXG4gKi9cbnZhciBlbmNvZGUgPSBmdW5jdGlvbiBlbmNvZGUoaW5wdXQpIHtcblx0dmFyIG91dHB1dCA9IFtdO1xuXG5cdC8vIENvbnZlcnQgdGhlIGlucHV0IGluIFVDUy0yIHRvIGFuIGFycmF5IG9mIFVuaWNvZGUgY29kZSBwb2ludHMuXG5cdGlucHV0ID0gdWNzMmRlY29kZShpbnB1dCk7XG5cblx0Ly8gQ2FjaGUgdGhlIGxlbmd0aC5cblx0dmFyIGlucHV0TGVuZ3RoID0gaW5wdXQubGVuZ3RoO1xuXG5cdC8vIEluaXRpYWxpemUgdGhlIHN0YXRlLlxuXHR2YXIgbiA9IGluaXRpYWxOO1xuXHR2YXIgZGVsdGEgPSAwO1xuXHR2YXIgYmlhcyA9IGluaXRpYWxCaWFzO1xuXG5cdC8vIEhhbmRsZSB0aGUgYmFzaWMgY29kZSBwb2ludHMuXG5cdHZhciBfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uID0gdHJ1ZTtcblx0dmFyIF9kaWRJdGVyYXRvckVycm9yID0gZmFsc2U7XG5cdHZhciBfaXRlcmF0b3JFcnJvciA9IHVuZGVmaW5lZDtcblxuXHR0cnkge1xuXHRcdGZvciAodmFyIF9pdGVyYXRvciA9IGlucHV0W1N5bWJvbC5pdGVyYXRvcl0oKSwgX3N0ZXA7ICEoX2l0ZXJhdG9yTm9ybWFsQ29tcGxldGlvbiA9IChfc3RlcCA9IF9pdGVyYXRvci5uZXh0KCkpLmRvbmUpOyBfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uID0gdHJ1ZSkge1xuXHRcdFx0dmFyIF9jdXJyZW50VmFsdWUyID0gX3N0ZXAudmFsdWU7XG5cblx0XHRcdGlmIChfY3VycmVudFZhbHVlMiA8IDB4ODApIHtcblx0XHRcdFx0b3V0cHV0LnB1c2goc3RyaW5nRnJvbUNoYXJDb2RlKF9jdXJyZW50VmFsdWUyKSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9IGNhdGNoIChlcnIpIHtcblx0XHRfZGlkSXRlcmF0b3JFcnJvciA9IHRydWU7XG5cdFx0X2l0ZXJhdG9yRXJyb3IgPSBlcnI7XG5cdH0gZmluYWxseSB7XG5cdFx0dHJ5IHtcblx0XHRcdGlmICghX2l0ZXJhdG9yTm9ybWFsQ29tcGxldGlvbiAmJiBfaXRlcmF0b3IucmV0dXJuKSB7XG5cdFx0XHRcdF9pdGVyYXRvci5yZXR1cm4oKTtcblx0XHRcdH1cblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0aWYgKF9kaWRJdGVyYXRvckVycm9yKSB7XG5cdFx0XHRcdHRocm93IF9pdGVyYXRvckVycm9yO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdHZhciBiYXNpY0xlbmd0aCA9IG91dHB1dC5sZW5ndGg7XG5cdHZhciBoYW5kbGVkQ1BDb3VudCA9IGJhc2ljTGVuZ3RoO1xuXG5cdC8vIGBoYW5kbGVkQ1BDb3VudGAgaXMgdGhlIG51bWJlciBvZiBjb2RlIHBvaW50cyB0aGF0IGhhdmUgYmVlbiBoYW5kbGVkO1xuXHQvLyBgYmFzaWNMZW5ndGhgIGlzIHRoZSBudW1iZXIgb2YgYmFzaWMgY29kZSBwb2ludHMuXG5cblx0Ly8gRmluaXNoIHRoZSBiYXNpYyBzdHJpbmcgd2l0aCBhIGRlbGltaXRlciB1bmxlc3MgaXQncyBlbXB0eS5cblx0aWYgKGJhc2ljTGVuZ3RoKSB7XG5cdFx0b3V0cHV0LnB1c2goZGVsaW1pdGVyKTtcblx0fVxuXG5cdC8vIE1haW4gZW5jb2RpbmcgbG9vcDpcblx0d2hpbGUgKGhhbmRsZWRDUENvdW50IDwgaW5wdXRMZW5ndGgpIHtcblxuXHRcdC8vIEFsbCBub24tYmFzaWMgY29kZSBwb2ludHMgPCBuIGhhdmUgYmVlbiBoYW5kbGVkIGFscmVhZHkuIEZpbmQgdGhlIG5leHRcblx0XHQvLyBsYXJnZXIgb25lOlxuXHRcdHZhciBtID0gbWF4SW50O1xuXHRcdHZhciBfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uMiA9IHRydWU7XG5cdFx0dmFyIF9kaWRJdGVyYXRvckVycm9yMiA9IGZhbHNlO1xuXHRcdHZhciBfaXRlcmF0b3JFcnJvcjIgPSB1bmRlZmluZWQ7XG5cblx0XHR0cnkge1xuXHRcdFx0Zm9yICh2YXIgX2l0ZXJhdG9yMiA9IGlucHV0W1N5bWJvbC5pdGVyYXRvcl0oKSwgX3N0ZXAyOyAhKF9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24yID0gKF9zdGVwMiA9IF9pdGVyYXRvcjIubmV4dCgpKS5kb25lKTsgX2l0ZXJhdG9yTm9ybWFsQ29tcGxldGlvbjIgPSB0cnVlKSB7XG5cdFx0XHRcdHZhciBjdXJyZW50VmFsdWUgPSBfc3RlcDIudmFsdWU7XG5cblx0XHRcdFx0aWYgKGN1cnJlbnRWYWx1ZSA+PSBuICYmIGN1cnJlbnRWYWx1ZSA8IG0pIHtcblx0XHRcdFx0XHRtID0gY3VycmVudFZhbHVlO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdC8vIEluY3JlYXNlIGBkZWx0YWAgZW5vdWdoIHRvIGFkdmFuY2UgdGhlIGRlY29kZXIncyA8bixpPiBzdGF0ZSB0byA8bSwwPixcblx0XHRcdC8vIGJ1dCBndWFyZCBhZ2FpbnN0IG92ZXJmbG93LlxuXHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0X2RpZEl0ZXJhdG9yRXJyb3IyID0gdHJ1ZTtcblx0XHRcdF9pdGVyYXRvckVycm9yMiA9IGVycjtcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0aWYgKCFfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uMiAmJiBfaXRlcmF0b3IyLnJldHVybikge1xuXHRcdFx0XHRcdF9pdGVyYXRvcjIucmV0dXJuKCk7XG5cdFx0XHRcdH1cblx0XHRcdH0gZmluYWxseSB7XG5cdFx0XHRcdGlmIChfZGlkSXRlcmF0b3JFcnJvcjIpIHtcblx0XHRcdFx0XHR0aHJvdyBfaXRlcmF0b3JFcnJvcjI7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHR2YXIgaGFuZGxlZENQQ291bnRQbHVzT25lID0gaGFuZGxlZENQQ291bnQgKyAxO1xuXHRcdGlmIChtIC0gbiA+IGZsb29yKChtYXhJbnQgLSBkZWx0YSkgLyBoYW5kbGVkQ1BDb3VudFBsdXNPbmUpKSB7XG5cdFx0XHRlcnJvciQxKCdvdmVyZmxvdycpO1xuXHRcdH1cblxuXHRcdGRlbHRhICs9IChtIC0gbikgKiBoYW5kbGVkQ1BDb3VudFBsdXNPbmU7XG5cdFx0biA9IG07XG5cblx0XHR2YXIgX2l0ZXJhdG9yTm9ybWFsQ29tcGxldGlvbjMgPSB0cnVlO1xuXHRcdHZhciBfZGlkSXRlcmF0b3JFcnJvcjMgPSBmYWxzZTtcblx0XHR2YXIgX2l0ZXJhdG9yRXJyb3IzID0gdW5kZWZpbmVkO1xuXG5cdFx0dHJ5IHtcblx0XHRcdGZvciAodmFyIF9pdGVyYXRvcjMgPSBpbnB1dFtTeW1ib2wuaXRlcmF0b3JdKCksIF9zdGVwMzsgIShfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uMyA9IChfc3RlcDMgPSBfaXRlcmF0b3IzLm5leHQoKSkuZG9uZSk7IF9pdGVyYXRvck5vcm1hbENvbXBsZXRpb24zID0gdHJ1ZSkge1xuXHRcdFx0XHR2YXIgX2N1cnJlbnRWYWx1ZSA9IF9zdGVwMy52YWx1ZTtcblxuXHRcdFx0XHRpZiAoX2N1cnJlbnRWYWx1ZSA8IG4gJiYgKytkZWx0YSA+IG1heEludCkge1xuXHRcdFx0XHRcdGVycm9yJDEoJ292ZXJmbG93Jyk7XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKF9jdXJyZW50VmFsdWUgPT0gbikge1xuXHRcdFx0XHRcdC8vIFJlcHJlc2VudCBkZWx0YSBhcyBhIGdlbmVyYWxpemVkIHZhcmlhYmxlLWxlbmd0aCBpbnRlZ2VyLlxuXHRcdFx0XHRcdHZhciBxID0gZGVsdGE7XG5cdFx0XHRcdFx0Zm9yICh2YXIgayA9IGJhc2U7OyAvKiBubyBjb25kaXRpb24gKi9rICs9IGJhc2UpIHtcblx0XHRcdFx0XHRcdHZhciB0ID0gayA8PSBiaWFzID8gdE1pbiA6IGsgPj0gYmlhcyArIHRNYXggPyB0TWF4IDogayAtIGJpYXM7XG5cdFx0XHRcdFx0XHRpZiAocSA8IHQpIHtcblx0XHRcdFx0XHRcdFx0YnJlYWs7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR2YXIgcU1pbnVzVCA9IHEgLSB0O1xuXHRcdFx0XHRcdFx0dmFyIGJhc2VNaW51c1QgPSBiYXNlIC0gdDtcblx0XHRcdFx0XHRcdG91dHB1dC5wdXNoKHN0cmluZ0Zyb21DaGFyQ29kZShkaWdpdFRvQmFzaWModCArIHFNaW51c1QgJSBiYXNlTWludXNULCAwKSkpO1xuXHRcdFx0XHRcdFx0cSA9IGZsb29yKHFNaW51c1QgLyBiYXNlTWludXNUKTtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRvdXRwdXQucHVzaChzdHJpbmdGcm9tQ2hhckNvZGUoZGlnaXRUb0Jhc2ljKHEsIDApKSk7XG5cdFx0XHRcdFx0YmlhcyA9IGFkYXB0KGRlbHRhLCBoYW5kbGVkQ1BDb3VudFBsdXNPbmUsIGhhbmRsZWRDUENvdW50ID09IGJhc2ljTGVuZ3RoKTtcblx0XHRcdFx0XHRkZWx0YSA9IDA7XG5cdFx0XHRcdFx0KytoYW5kbGVkQ1BDb3VudDtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0X2RpZEl0ZXJhdG9yRXJyb3IzID0gdHJ1ZTtcblx0XHRcdF9pdGVyYXRvckVycm9yMyA9IGVycjtcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0aWYgKCFfaXRlcmF0b3JOb3JtYWxDb21wbGV0aW9uMyAmJiBfaXRlcmF0b3IzLnJldHVybikge1xuXHRcdFx0XHRcdF9pdGVyYXRvcjMucmV0dXJuKCk7XG5cdFx0XHRcdH1cblx0XHRcdH0gZmluYWxseSB7XG5cdFx0XHRcdGlmIChfZGlkSXRlcmF0b3JFcnJvcjMpIHtcblx0XHRcdFx0XHR0aHJvdyBfaXRlcmF0b3JFcnJvcjM7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHQrK2RlbHRhO1xuXHRcdCsrbjtcblx0fVxuXHRyZXR1cm4gb3V0cHV0LmpvaW4oJycpO1xufTtcblxuLyoqXG4gKiBDb252ZXJ0cyBhIFB1bnljb2RlIHN0cmluZyByZXByZXNlbnRpbmcgYSBkb21haW4gbmFtZSBvciBhbiBlbWFpbCBhZGRyZXNzXG4gKiB0byBVbmljb2RlLiBPbmx5IHRoZSBQdW55Y29kZWQgcGFydHMgb2YgdGhlIGlucHV0IHdpbGwgYmUgY29udmVydGVkLCBpLmUuXG4gKiBpdCBkb2Vzbid0IG1hdHRlciBpZiB5b3UgY2FsbCBpdCBvbiBhIHN0cmluZyB0aGF0IGhhcyBhbHJlYWR5IGJlZW5cbiAqIGNvbnZlcnRlZCB0byBVbmljb2RlLlxuICogQG1lbWJlck9mIHB1bnljb2RlXG4gKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIFB1bnljb2RlZCBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzIHRvXG4gKiBjb252ZXJ0IHRvIFVuaWNvZGUuXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgVW5pY29kZSByZXByZXNlbnRhdGlvbiBvZiB0aGUgZ2l2ZW4gUHVueWNvZGVcbiAqIHN0cmluZy5cbiAqL1xudmFyIHRvVW5pY29kZSA9IGZ1bmN0aW9uIHRvVW5pY29kZShpbnB1dCkge1xuXHRyZXR1cm4gbWFwRG9tYWluKGlucHV0LCBmdW5jdGlvbiAoc3RyaW5nKSB7XG5cdFx0cmV0dXJuIHJlZ2V4UHVueWNvZGUudGVzdChzdHJpbmcpID8gZGVjb2RlKHN0cmluZy5zbGljZSg0KS50b0xvd2VyQ2FzZSgpKSA6IHN0cmluZztcblx0fSk7XG59O1xuXG4vKipcbiAqIENvbnZlcnRzIGEgVW5pY29kZSBzdHJpbmcgcmVwcmVzZW50aW5nIGEgZG9tYWluIG5hbWUgb3IgYW4gZW1haWwgYWRkcmVzcyB0b1xuICogUHVueWNvZGUuIE9ubHkgdGhlIG5vbi1BU0NJSSBwYXJ0cyBvZiB0aGUgZG9tYWluIG5hbWUgd2lsbCBiZSBjb252ZXJ0ZWQsXG4gKiBpLmUuIGl0IGRvZXNuJ3QgbWF0dGVyIGlmIHlvdSBjYWxsIGl0IHdpdGggYSBkb21haW4gdGhhdCdzIGFscmVhZHkgaW5cbiAqIEFTQ0lJLlxuICogQG1lbWJlck9mIHB1bnljb2RlXG4gKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIGRvbWFpbiBuYW1lIG9yIGVtYWlsIGFkZHJlc3MgdG8gY29udmVydCwgYXMgYVxuICogVW5pY29kZSBzdHJpbmcuXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgUHVueWNvZGUgcmVwcmVzZW50YXRpb24gb2YgdGhlIGdpdmVuIGRvbWFpbiBuYW1lIG9yXG4gKiBlbWFpbCBhZGRyZXNzLlxuICovXG52YXIgdG9BU0NJSSA9IGZ1bmN0aW9uIHRvQVNDSUkoaW5wdXQpIHtcblx0cmV0dXJuIG1hcERvbWFpbihpbnB1dCwgZnVuY3Rpb24gKHN0cmluZykge1xuXHRcdHJldHVybiByZWdleE5vbkFTQ0lJLnRlc3Qoc3RyaW5nKSA/ICd4bi0tJyArIGVuY29kZShzdHJpbmcpIDogc3RyaW5nO1xuXHR9KTtcbn07XG5cbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuXG4vKiogRGVmaW5lIHRoZSBwdWJsaWMgQVBJICovXG52YXIgcHVueWNvZGUgPSB7XG5cdC8qKlxuICAqIEEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgY3VycmVudCBQdW55Y29kZS5qcyB2ZXJzaW9uIG51bWJlci5cbiAgKiBAbWVtYmVyT2YgcHVueWNvZGVcbiAgKiBAdHlwZSBTdHJpbmdcbiAgKi9cblx0J3ZlcnNpb24nOiAnMi4xLjAnLFxuXHQvKipcbiAgKiBBbiBvYmplY3Qgb2YgbWV0aG9kcyB0byBjb252ZXJ0IGZyb20gSmF2YVNjcmlwdCdzIGludGVybmFsIGNoYXJhY3RlclxuICAqIHJlcHJlc2VudGF0aW9uIChVQ1MtMikgdG8gVW5pY29kZSBjb2RlIHBvaW50cywgYW5kIGJhY2suXG4gICogQHNlZSA8aHR0cHM6Ly9tYXRoaWFzYnluZW5zLmJlL25vdGVzL2phdmFzY3JpcHQtZW5jb2Rpbmc+XG4gICogQG1lbWJlck9mIHB1bnljb2RlXG4gICogQHR5cGUgT2JqZWN0XG4gICovXG5cdCd1Y3MyJzoge1xuXHRcdCdkZWNvZGUnOiB1Y3MyZGVjb2RlLFxuXHRcdCdlbmNvZGUnOiB1Y3MyZW5jb2RlXG5cdH0sXG5cdCdkZWNvZGUnOiBkZWNvZGUsXG5cdCdlbmNvZGUnOiBlbmNvZGUsXG5cdCd0b0FTQ0lJJzogdG9BU0NJSSxcblx0J3RvVW5pY29kZSc6IHRvVW5pY29kZVxufTtcblxuLyoqXHJcbiAqIFVSSS5qc1xyXG4gKlxyXG4gKiBAZmlsZW92ZXJ2aWV3IEFuIFJGQyAzOTg2IGNvbXBsaWFudCwgc2NoZW1lIGV4dGVuZGFibGUgVVJJIHBhcnNpbmcvdmFsaWRhdGluZy9yZXNvbHZpbmcgbGlicmFyeSBmb3IgSmF2YVNjcmlwdC5cclxuICogQGF1dGhvciA8YSBocmVmPVwibWFpbHRvOmdhcnkuY291cnRAZ21haWwuY29tXCI+R2FyeSBDb3VydDwvYT5cclxuICogQHNlZSBodHRwOi8vZ2l0aHViLmNvbS9nYXJ5Y291cnQvdXJpLWpzXHJcbiAqL1xuLyoqXHJcbiAqIENvcHlyaWdodCAyMDExIEdhcnkgQ291cnQuIEFsbCByaWdodHMgcmVzZXJ2ZWQuXHJcbiAqXHJcbiAqIFJlZGlzdHJpYnV0aW9uIGFuZCB1c2UgaW4gc291cmNlIGFuZCBiaW5hcnkgZm9ybXMsIHdpdGggb3Igd2l0aG91dCBtb2RpZmljYXRpb24sIGFyZVxyXG4gKiBwZXJtaXR0ZWQgcHJvdmlkZWQgdGhhdCB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnMgYXJlIG1ldDpcclxuICpcclxuICogICAgMS4gUmVkaXN0cmlidXRpb25zIG9mIHNvdXJjZSBjb2RlIG11c3QgcmV0YWluIHRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlLCB0aGlzIGxpc3Qgb2ZcclxuICogICAgICAgY29uZGl0aW9ucyBhbmQgdGhlIGZvbGxvd2luZyBkaXNjbGFpbWVyLlxyXG4gKlxyXG4gKiAgICAyLiBSZWRpc3RyaWJ1dGlvbnMgaW4gYmluYXJ5IGZvcm0gbXVzdCByZXByb2R1Y2UgdGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UsIHRoaXMgbGlzdFxyXG4gKiAgICAgICBvZiBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIgaW4gdGhlIGRvY3VtZW50YXRpb24gYW5kL29yIG90aGVyIG1hdGVyaWFsc1xyXG4gKiAgICAgICBwcm92aWRlZCB3aXRoIHRoZSBkaXN0cmlidXRpb24uXHJcbiAqXHJcbiAqIFRISVMgU09GVFdBUkUgSVMgUFJPVklERUQgQlkgR0FSWSBDT1VSVCBgYEFTIElTJycgQU5EIEFOWSBFWFBSRVNTIE9SIElNUExJRURcclxuICogV0FSUkFOVElFUywgSU5DTFVESU5HLCBCVVQgTk9UIExJTUlURUQgVE8sIFRIRSBJTVBMSUVEIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORFxyXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBUkUgRElTQ0xBSU1FRC4gSU4gTk8gRVZFTlQgU0hBTEwgR0FSWSBDT1VSVCBPUlxyXG4gKiBDT05UUklCVVRPUlMgQkUgTElBQkxFIEZPUiBBTlkgRElSRUNULCBJTkRJUkVDVCwgSU5DSURFTlRBTCwgU1BFQ0lBTCwgRVhFTVBMQVJZLCBPUlxyXG4gKiBDT05TRVFVRU5USUFMIERBTUFHRVMgKElOQ0xVRElORywgQlVUIE5PVCBMSU1JVEVEIFRPLCBQUk9DVVJFTUVOVCBPRiBTVUJTVElUVVRFIEdPT0RTIE9SXHJcbiAqIFNFUlZJQ0VTOyBMT1NTIE9GIFVTRSwgREFUQSwgT1IgUFJPRklUUzsgT1IgQlVTSU5FU1MgSU5URVJSVVBUSU9OKSBIT1dFVkVSIENBVVNFRCBBTkQgT05cclxuICogQU5ZIFRIRU9SWSBPRiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlQgKElOQ0xVRElOR1xyXG4gKiBORUdMSUdFTkNFIE9SIE9USEVSV0lTRSkgQVJJU0lORyBJTiBBTlkgV0FZIE9VVCBPRiBUSEUgVVNFIE9GIFRISVMgU09GVFdBUkUsIEVWRU4gSUZcclxuICogQURWSVNFRCBPRiBUSEUgUE9TU0lCSUxJVFkgT0YgU1VDSCBEQU1BR0UuXHJcbiAqXHJcbiAqIFRoZSB2aWV3cyBhbmQgY29uY2x1c2lvbnMgY29udGFpbmVkIGluIHRoZSBzb2Z0d2FyZSBhbmQgZG9jdW1lbnRhdGlvbiBhcmUgdGhvc2Ugb2YgdGhlXHJcbiAqIGF1dGhvcnMgYW5kIHNob3VsZCBub3QgYmUgaW50ZXJwcmV0ZWQgYXMgcmVwcmVzZW50aW5nIG9mZmljaWFsIHBvbGljaWVzLCBlaXRoZXIgZXhwcmVzc2VkXHJcbiAqIG9yIGltcGxpZWQsIG9mIEdhcnkgQ291cnQuXHJcbiAqL1xudmFyIFNDSEVNRVMgPSB7fTtcbmZ1bmN0aW9uIHBjdEVuY0NoYXIoY2hyKSB7XG4gICAgdmFyIGMgPSBjaHIuY2hhckNvZGVBdCgwKTtcbiAgICB2YXIgZSA9IHZvaWQgMDtcbiAgICBpZiAoYyA8IDE2KSBlID0gXCIlMFwiICsgYy50b1N0cmluZygxNikudG9VcHBlckNhc2UoKTtlbHNlIGlmIChjIDwgMTI4KSBlID0gXCIlXCIgKyBjLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpO2Vsc2UgaWYgKGMgPCAyMDQ4KSBlID0gXCIlXCIgKyAoYyA+PiA2IHwgMTkyKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKSArIFwiJVwiICsgKGMgJiA2MyB8IDEyOCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7ZWxzZSBlID0gXCIlXCIgKyAoYyA+PiAxMiB8IDIyNCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkgKyBcIiVcIiArIChjID4+IDYgJiA2MyB8IDEyOCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkgKyBcIiVcIiArIChjICYgNjMgfCAxMjgpLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpO1xuICAgIHJldHVybiBlO1xufVxuZnVuY3Rpb24gcGN0RGVjQ2hhcnMoc3RyKSB7XG4gICAgdmFyIG5ld1N0ciA9IFwiXCI7XG4gICAgdmFyIGkgPSAwO1xuICAgIHZhciBpbCA9IHN0ci5sZW5ndGg7XG4gICAgd2hpbGUgKGkgPCBpbCkge1xuICAgICAgICB2YXIgYyA9IHBhcnNlSW50KHN0ci5zdWJzdHIoaSArIDEsIDIpLCAxNik7XG4gICAgICAgIGlmIChjIDwgMTI4KSB7XG4gICAgICAgICAgICBuZXdTdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjKTtcbiAgICAgICAgICAgIGkgKz0gMztcbiAgICAgICAgfSBlbHNlIGlmIChjID49IDE5NCAmJiBjIDwgMjI0KSB7XG4gICAgICAgICAgICBpZiAoaWwgLSBpID49IDYpIHtcbiAgICAgICAgICAgICAgICB2YXIgYzIgPSBwYXJzZUludChzdHIuc3Vic3RyKGkgKyA0LCAyKSwgMTYpO1xuICAgICAgICAgICAgICAgIG5ld1N0ciArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKChjICYgMzEpIDw8IDYgfCBjMiAmIDYzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbmV3U3RyICs9IHN0ci5zdWJzdHIoaSwgNik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpICs9IDY7XG4gICAgICAgIH0gZWxzZSBpZiAoYyA+PSAyMjQpIHtcbiAgICAgICAgICAgIGlmIChpbCAtIGkgPj0gOSkge1xuICAgICAgICAgICAgICAgIHZhciBfYyA9IHBhcnNlSW50KHN0ci5zdWJzdHIoaSArIDQsIDIpLCAxNik7XG4gICAgICAgICAgICAgICAgdmFyIGMzID0gcGFyc2VJbnQoc3RyLnN1YnN0cihpICsgNywgMiksIDE2KTtcbiAgICAgICAgICAgICAgICBuZXdTdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoYyAmIDE1KSA8PCAxMiB8IChfYyAmIDYzKSA8PCA2IHwgYzMgJiA2Myk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5ld1N0ciArPSBzdHIuc3Vic3RyKGksIDkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaSArPSA5O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3U3RyICs9IHN0ci5zdWJzdHIoaSwgMyk7XG4gICAgICAgICAgICBpICs9IDM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG5ld1N0cjtcbn1cbmZ1bmN0aW9uIF9ub3JtYWxpemVDb21wb25lbnRFbmNvZGluZyhjb21wb25lbnRzLCBwcm90b2NvbCkge1xuICAgIGZ1bmN0aW9uIGRlY29kZVVucmVzZXJ2ZWQoc3RyKSB7XG4gICAgICAgIHZhciBkZWNTdHIgPSBwY3REZWNDaGFycyhzdHIpO1xuICAgICAgICByZXR1cm4gIWRlY1N0ci5tYXRjaChwcm90b2NvbC5VTlJFU0VSVkVEKSA/IHN0ciA6IGRlY1N0cjtcbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudHMuc2NoZW1lKSBjb21wb25lbnRzLnNjaGVtZSA9IFN0cmluZyhjb21wb25lbnRzLnNjaGVtZSkucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKHByb3RvY29sLk5PVF9TQ0hFTUUsIFwiXCIpO1xuICAgIGlmIChjb21wb25lbnRzLnVzZXJpbmZvICE9PSB1bmRlZmluZWQpIGNvbXBvbmVudHMudXNlcmluZm8gPSBTdHJpbmcoY29tcG9uZW50cy51c2VyaW5mbykucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkucmVwbGFjZShwcm90b2NvbC5OT1RfVVNFUklORk8sIHBjdEVuY0NoYXIpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKTtcbiAgICBpZiAoY29tcG9uZW50cy5ob3N0ICE9PSB1bmRlZmluZWQpIGNvbXBvbmVudHMuaG9zdCA9IFN0cmluZyhjb21wb25lbnRzLmhvc3QpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnRvTG93ZXJDYXNlKCkucmVwbGFjZShwcm90b2NvbC5OT1RfSE9TVCwgcGN0RW5jQ2hhcikucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpO1xuICAgIGlmIChjb21wb25lbnRzLnBhdGggIT09IHVuZGVmaW5lZCkgY29tcG9uZW50cy5wYXRoID0gU3RyaW5nKGNvbXBvbmVudHMucGF0aCkucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgZGVjb2RlVW5yZXNlcnZlZCkucmVwbGFjZShjb21wb25lbnRzLnNjaGVtZSA/IHByb3RvY29sLk5PVF9QQVRIIDogcHJvdG9jb2wuTk9UX1BBVEhfTk9TQ0hFTUUsIHBjdEVuY0NoYXIpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKTtcbiAgICBpZiAoY29tcG9uZW50cy5xdWVyeSAhPT0gdW5kZWZpbmVkKSBjb21wb25lbnRzLnF1ZXJ5ID0gU3RyaW5nKGNvbXBvbmVudHMucXVlcnkpLnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UocHJvdG9jb2wuTk9UX1FVRVJZLCBwY3RFbmNDaGFyKS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSk7XG4gICAgaWYgKGNvbXBvbmVudHMuZnJhZ21lbnQgIT09IHVuZGVmaW5lZCkgY29tcG9uZW50cy5mcmFnbWVudCA9IFN0cmluZyhjb21wb25lbnRzLmZyYWdtZW50KS5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS5yZXBsYWNlKHByb3RvY29sLk5PVF9GUkFHTUVOVCwgcGN0RW5jQ2hhcikucmVwbGFjZShwcm90b2NvbC5QQ1RfRU5DT0RFRCwgdG9VcHBlckNhc2UpO1xuICAgIHJldHVybiBjb21wb25lbnRzO1xufVxuXG52YXIgVVJJX1BBUlNFID0gL14oPzooW146XFwvPyNdKyk6KT8oPzpcXC9cXC8oKD86KFteXFwvPyNAXSopQCk/KFxcW1tcXGRBLUY6Ll0rXFxdfFteXFwvPyM6XSopKD86XFw6KFxcZCopKT8pKT8oW14/I10qKSg/OlxcPyhbXiNdKikpPyg/OiMoKD86LnxcXG58XFxyKSopKT8vaTtcbnZhciBOT19NQVRDSF9JU19VTkRFRklORUQgPSBcIlwiLm1hdGNoKC8oKXswfS8pWzFdID09PSB1bmRlZmluZWQ7XG5mdW5jdGlvbiBwYXJzZSh1cmlTdHJpbmcpIHtcbiAgICB2YXIgb3B0aW9ucyA9IGFyZ3VtZW50cy5sZW5ndGggPiAxICYmIGFyZ3VtZW50c1sxXSAhPT0gdW5kZWZpbmVkID8gYXJndW1lbnRzWzFdIDoge307XG5cbiAgICB2YXIgY29tcG9uZW50cyA9IHt9O1xuICAgIHZhciBwcm90b2NvbCA9IG9wdGlvbnMuaXJpICE9PSBmYWxzZSA/IElSSV9QUk9UT0NPTCA6IFVSSV9QUk9UT0NPTDtcbiAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgPT09IFwic3VmZml4XCIpIHVyaVN0cmluZyA9IChvcHRpb25zLnNjaGVtZSA/IG9wdGlvbnMuc2NoZW1lICsgXCI6XCIgOiBcIlwiKSArIFwiLy9cIiArIHVyaVN0cmluZztcbiAgICB2YXIgbWF0Y2hlcyA9IHVyaVN0cmluZy5tYXRjaChVUklfUEFSU0UpO1xuICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIGlmIChOT19NQVRDSF9JU19VTkRFRklORUQpIHtcbiAgICAgICAgICAgIC8vc3RvcmUgZWFjaCBjb21wb25lbnRcbiAgICAgICAgICAgIGNvbXBvbmVudHMuc2NoZW1lID0gbWF0Y2hlc1sxXTtcbiAgICAgICAgICAgIGNvbXBvbmVudHMudXNlcmluZm8gPSBtYXRjaGVzWzNdO1xuICAgICAgICAgICAgY29tcG9uZW50cy5ob3N0ID0gbWF0Y2hlc1s0XTtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucG9ydCA9IHBhcnNlSW50KG1hdGNoZXNbNV0sIDEwKTtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucGF0aCA9IG1hdGNoZXNbNl0gfHwgXCJcIjtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucXVlcnkgPSBtYXRjaGVzWzddO1xuICAgICAgICAgICAgY29tcG9uZW50cy5mcmFnbWVudCA9IG1hdGNoZXNbOF07XG4gICAgICAgICAgICAvL2ZpeCBwb3J0IG51bWJlclxuICAgICAgICAgICAgaWYgKGlzTmFOKGNvbXBvbmVudHMucG9ydCkpIHtcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzLnBvcnQgPSBtYXRjaGVzWzVdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy9zdG9yZSBlYWNoIGNvbXBvbmVudFxuICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBtYXRjaGVzWzFdIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbXBvbmVudHMudXNlcmluZm8gPSB1cmlTdHJpbmcuaW5kZXhPZihcIkBcIikgIT09IC0xID8gbWF0Y2hlc1szXSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbXBvbmVudHMuaG9zdCA9IHVyaVN0cmluZy5pbmRleE9mKFwiLy9cIikgIT09IC0xID8gbWF0Y2hlc1s0XSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucG9ydCA9IHBhcnNlSW50KG1hdGNoZXNbNV0sIDEwKTtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucGF0aCA9IG1hdGNoZXNbNl0gfHwgXCJcIjtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucXVlcnkgPSB1cmlTdHJpbmcuaW5kZXhPZihcIj9cIikgIT09IC0xID8gbWF0Y2hlc1s3XSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbXBvbmVudHMuZnJhZ21lbnQgPSB1cmlTdHJpbmcuaW5kZXhPZihcIiNcIikgIT09IC0xID8gbWF0Y2hlc1s4XSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIC8vZml4IHBvcnQgbnVtYmVyXG4gICAgICAgICAgICBpZiAoaXNOYU4oY29tcG9uZW50cy5wb3J0KSkge1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMucG9ydCA9IHVyaVN0cmluZy5tYXRjaCgvXFwvXFwvKD86LnxcXG4pKlxcOig/OlxcL3xcXD98XFwjfCQpLykgPyBtYXRjaGVzWzRdIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vc3RyaXAgYnJhY2tldHMgZnJvbSBJUHY2IGhvc3RzXG4gICAgICAgIGlmIChjb21wb25lbnRzLmhvc3QpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMuaG9zdCA9IGNvbXBvbmVudHMuaG9zdC5yZXBsYWNlKHByb3RvY29sLklQVjZBRERSRVNTLCBcIiQxXCIpO1xuICAgICAgICB9XG4gICAgICAgIC8vZGV0ZXJtaW5lIHJlZmVyZW5jZSB0eXBlXG4gICAgICAgIGlmIChjb21wb25lbnRzLnNjaGVtZSA9PT0gdW5kZWZpbmVkICYmIGNvbXBvbmVudHMudXNlcmluZm8gPT09IHVuZGVmaW5lZCAmJiBjb21wb25lbnRzLmhvc3QgPT09IHVuZGVmaW5lZCAmJiBjb21wb25lbnRzLnBvcnQgPT09IHVuZGVmaW5lZCAmJiAhY29tcG9uZW50cy5wYXRoICYmIGNvbXBvbmVudHMucXVlcnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29tcG9uZW50cy5yZWZlcmVuY2UgPSBcInNhbWUtZG9jdW1lbnRcIjtcbiAgICAgICAgfSBlbHNlIGlmIChjb21wb25lbnRzLnNjaGVtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLnJlZmVyZW5jZSA9IFwicmVsYXRpdmVcIjtcbiAgICAgICAgfSBlbHNlIGlmIChjb21wb25lbnRzLmZyYWdtZW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucmVmZXJlbmNlID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29tcG9uZW50cy5yZWZlcmVuY2UgPSBcInVyaVwiO1xuICAgICAgICB9XG4gICAgICAgIC8vY2hlY2sgZm9yIHJlZmVyZW5jZSBlcnJvcnNcbiAgICAgICAgaWYgKG9wdGlvbnMucmVmZXJlbmNlICYmIG9wdGlvbnMucmVmZXJlbmNlICE9PSBcInN1ZmZpeFwiICYmIG9wdGlvbnMucmVmZXJlbmNlICE9PSBjb21wb25lbnRzLnJlZmVyZW5jZSkge1xuICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJVUkkgaXMgbm90IGEgXCIgKyBvcHRpb25zLnJlZmVyZW5jZSArIFwiIHJlZmVyZW5jZS5cIjtcbiAgICAgICAgfVxuICAgICAgICAvL2ZpbmQgc2NoZW1lIGhhbmRsZXJcbiAgICAgICAgdmFyIHNjaGVtZUhhbmRsZXIgPSBTQ0hFTUVTWyhvcHRpb25zLnNjaGVtZSB8fCBjb21wb25lbnRzLnNjaGVtZSB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpXTtcbiAgICAgICAgLy9jaGVjayBpZiBzY2hlbWUgY2FuJ3QgaGFuZGxlIElSSXNcbiAgICAgICAgaWYgKCFvcHRpb25zLnVuaWNvZGVTdXBwb3J0ICYmICghc2NoZW1lSGFuZGxlciB8fCAhc2NoZW1lSGFuZGxlci51bmljb2RlU3VwcG9ydCkpIHtcbiAgICAgICAgICAgIC8vaWYgaG9zdCBjb21wb25lbnQgaXMgYSBkb21haW4gbmFtZVxuICAgICAgICAgICAgaWYgKGNvbXBvbmVudHMuaG9zdCAmJiAob3B0aW9ucy5kb21haW5Ib3N0IHx8IHNjaGVtZUhhbmRsZXIgJiYgc2NoZW1lSGFuZGxlci5kb21haW5Ib3N0KSkge1xuICAgICAgICAgICAgICAgIC8vY29udmVydCBVbmljb2RlIElETiAtPiBBU0NJSSBJRE5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLmhvc3QgPSBwdW55Y29kZS50b0FTQ0lJKGNvbXBvbmVudHMuaG9zdC5yZXBsYWNlKHByb3RvY29sLlBDVF9FTkNPREVELCBwY3REZWNDaGFycykudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIkhvc3QncyBkb21haW4gbmFtZSBjYW4gbm90IGJlIGNvbnZlcnRlZCB0byBBU0NJSSB2aWEgcHVueWNvZGU6IFwiICsgZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL2NvbnZlcnQgSVJJIC0+IFVSSVxuICAgICAgICAgICAgX25vcm1hbGl6ZUNvbXBvbmVudEVuY29kaW5nKGNvbXBvbmVudHMsIFVSSV9QUk9UT0NPTCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvL25vcm1hbGl6ZSBlbmNvZGluZ3NcbiAgICAgICAgICAgIF9ub3JtYWxpemVDb21wb25lbnRFbmNvZGluZyhjb21wb25lbnRzLCBwcm90b2NvbCk7XG4gICAgICAgIH1cbiAgICAgICAgLy9wZXJmb3JtIHNjaGVtZSBzcGVjaWZpYyBwYXJzaW5nXG4gICAgICAgIGlmIChzY2hlbWVIYW5kbGVyICYmIHNjaGVtZUhhbmRsZXIucGFyc2UpIHtcbiAgICAgICAgICAgIHNjaGVtZUhhbmRsZXIucGFyc2UoY29tcG9uZW50cywgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVSSSBjYW4gbm90IGJlIHBhcnNlZC5cIjtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBvbmVudHM7XG59XG5cbmZ1bmN0aW9uIF9yZWNvbXBvc2VBdXRob3JpdHkoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgIHZhciBwcm90b2NvbCA9IG9wdGlvbnMuaXJpICE9PSBmYWxzZSA/IElSSV9QUk9UT0NPTCA6IFVSSV9QUk9UT0NPTDtcbiAgICB2YXIgdXJpVG9rZW5zID0gW107XG4gICAgaWYgKGNvbXBvbmVudHMudXNlcmluZm8gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB1cmlUb2tlbnMucHVzaChjb21wb25lbnRzLnVzZXJpbmZvKTtcbiAgICAgICAgdXJpVG9rZW5zLnB1c2goXCJAXCIpO1xuICAgIH1cbiAgICBpZiAoY29tcG9uZW50cy5ob3N0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy9lbnN1cmUgSVB2NiBhZGRyZXNzZXMgYXJlIGJyYWNrZXRlZFxuICAgICAgICB1cmlUb2tlbnMucHVzaChTdHJpbmcoY29tcG9uZW50cy5ob3N0KS5yZXBsYWNlKHByb3RvY29sLklQVjZBRERSRVNTLCBcIlskMV1cIikpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGNvbXBvbmVudHMucG9ydCA9PT0gXCJudW1iZXJcIikge1xuICAgICAgICB1cmlUb2tlbnMucHVzaChcIjpcIik7XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKGNvbXBvbmVudHMucG9ydC50b1N0cmluZygxMCkpO1xuICAgIH1cbiAgICByZXR1cm4gdXJpVG9rZW5zLmxlbmd0aCA/IHVyaVRva2Vucy5qb2luKFwiXCIpIDogdW5kZWZpbmVkO1xufVxuXG52YXIgUkRTMSA9IC9eXFwuXFwuP1xcLy87XG52YXIgUkRTMiA9IC9eXFwvXFwuKFxcL3wkKS87XG52YXIgUkRTMyA9IC9eXFwvXFwuXFwuKFxcL3wkKS87XG52YXIgUkRTNSA9IC9eXFwvPyg/Oi58XFxuKSo/KD89XFwvfCQpLztcbmZ1bmN0aW9uIHJlbW92ZURvdFNlZ21lbnRzKGlucHV0KSB7XG4gICAgdmFyIG91dHB1dCA9IFtdO1xuICAgIHdoaWxlIChpbnB1dC5sZW5ndGgpIHtcbiAgICAgICAgaWYgKGlucHV0Lm1hdGNoKFJEUzEpKSB7XG4gICAgICAgICAgICBpbnB1dCA9IGlucHV0LnJlcGxhY2UoUkRTMSwgXCJcIik7XG4gICAgICAgIH0gZWxzZSBpZiAoaW5wdXQubWF0Y2goUkRTMikpIHtcbiAgICAgICAgICAgIGlucHV0ID0gaW5wdXQucmVwbGFjZShSRFMyLCBcIi9cIik7XG4gICAgICAgIH0gZWxzZSBpZiAoaW5wdXQubWF0Y2goUkRTMykpIHtcbiAgICAgICAgICAgIGlucHV0ID0gaW5wdXQucmVwbGFjZShSRFMzLCBcIi9cIik7XG4gICAgICAgICAgICBvdXRwdXQucG9wKCk7XG4gICAgICAgIH0gZWxzZSBpZiAoaW5wdXQgPT09IFwiLlwiIHx8IGlucHV0ID09PSBcIi4uXCIpIHtcbiAgICAgICAgICAgIGlucHV0ID0gXCJcIjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBpbSA9IGlucHV0Lm1hdGNoKFJEUzUpO1xuICAgICAgICAgICAgaWYgKGltKSB7XG4gICAgICAgICAgICAgICAgdmFyIHMgPSBpbVswXTtcbiAgICAgICAgICAgICAgICBpbnB1dCA9IGlucHV0LnNsaWNlKHMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICBvdXRwdXQucHVzaChzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5leHBlY3RlZCBkb3Qgc2VnbWVudCBjb25kaXRpb25cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG91dHB1dC5qb2luKFwiXCIpO1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemUoY29tcG9uZW50cykge1xuICAgIHZhciBvcHRpb25zID0gYXJndW1lbnRzLmxlbmd0aCA+IDEgJiYgYXJndW1lbnRzWzFdICE9PSB1bmRlZmluZWQgPyBhcmd1bWVudHNbMV0gOiB7fTtcblxuICAgIHZhciBwcm90b2NvbCA9IG9wdGlvbnMuaXJpID8gSVJJX1BST1RPQ09MIDogVVJJX1BST1RPQ09MO1xuICAgIHZhciB1cmlUb2tlbnMgPSBbXTtcbiAgICAvL2ZpbmQgc2NoZW1lIGhhbmRsZXJcbiAgICB2YXIgc2NoZW1lSGFuZGxlciA9IFNDSEVNRVNbKG9wdGlvbnMuc2NoZW1lIHx8IGNvbXBvbmVudHMuc2NoZW1lIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCldO1xuICAgIC8vcGVyZm9ybSBzY2hlbWUgc3BlY2lmaWMgc2VyaWFsaXphdGlvblxuICAgIGlmIChzY2hlbWVIYW5kbGVyICYmIHNjaGVtZUhhbmRsZXIuc2VyaWFsaXplKSBzY2hlbWVIYW5kbGVyLnNlcmlhbGl6ZShjb21wb25lbnRzLCBvcHRpb25zKTtcbiAgICBpZiAoY29tcG9uZW50cy5ob3N0KSB7XG4gICAgICAgIC8vaWYgaG9zdCBjb21wb25lbnQgaXMgYW4gSVB2NiBhZGRyZXNzXG4gICAgICAgIGlmIChwcm90b2NvbC5JUFY2QUREUkVTUy50ZXN0KGNvbXBvbmVudHMuaG9zdCkpIHtcbiAgICAgICAgICAgIC8vVE9ETzogbm9ybWFsaXplIElQdjYgYWRkcmVzcyBhcyBwZXIgUkZDIDU5NTJcbiAgICAgICAgfSBlbHNlIGlmIChvcHRpb25zLmRvbWFpbkhvc3QgfHwgc2NoZW1lSGFuZGxlciAmJiBzY2hlbWVIYW5kbGVyLmRvbWFpbkhvc3QpIHtcbiAgICAgICAgICAgIC8vY29udmVydCBJRE4gdmlhIHB1bnljb2RlXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuaG9zdCA9ICFvcHRpb25zLmlyaSA/IHB1bnljb2RlLnRvQVNDSUkoY29tcG9uZW50cy5ob3N0LnJlcGxhY2UocHJvdG9jb2wuUENUX0VOQ09ERUQsIHBjdERlY0NoYXJzKS50b0xvd2VyQ2FzZSgpKSA6IHB1bnljb2RlLnRvVW5pY29kZShjb21wb25lbnRzLmhvc3QpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiSG9zdCdzIGRvbWFpbiBuYW1lIGNhbiBub3QgYmUgY29udmVydGVkIHRvIFwiICsgKCFvcHRpb25zLmlyaSA/IFwiQVNDSUlcIiA6IFwiVW5pY29kZVwiKSArIFwiIHZpYSBwdW55Y29kZTogXCIgKyBlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIC8vbm9ybWFsaXplIGVuY29kaW5nXG4gICAgX25vcm1hbGl6ZUNvbXBvbmVudEVuY29kaW5nKGNvbXBvbmVudHMsIHByb3RvY29sKTtcbiAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgIT09IFwic3VmZml4XCIgJiYgY29tcG9uZW50cy5zY2hlbWUpIHtcbiAgICAgICAgdXJpVG9rZW5zLnB1c2goY29tcG9uZW50cy5zY2hlbWUpO1xuICAgICAgICB1cmlUb2tlbnMucHVzaChcIjpcIik7XG4gICAgfVxuICAgIHZhciBhdXRob3JpdHkgPSBfcmVjb21wb3NlQXV0aG9yaXR5KGNvbXBvbmVudHMsIG9wdGlvbnMpO1xuICAgIGlmIChhdXRob3JpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAob3B0aW9ucy5yZWZlcmVuY2UgIT09IFwic3VmZml4XCIpIHtcbiAgICAgICAgICAgIHVyaVRva2Vucy5wdXNoKFwiLy9cIik7XG4gICAgICAgIH1cbiAgICAgICAgdXJpVG9rZW5zLnB1c2goYXV0aG9yaXR5KTtcbiAgICAgICAgaWYgKGNvbXBvbmVudHMucGF0aCAmJiBjb21wb25lbnRzLnBhdGguY2hhckF0KDApICE9PSBcIi9cIikge1xuICAgICAgICAgICAgdXJpVG9rZW5zLnB1c2goXCIvXCIpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChjb21wb25lbnRzLnBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB2YXIgcyA9IGNvbXBvbmVudHMucGF0aDtcbiAgICAgICAgaWYgKCFvcHRpb25zLmFic29sdXRlUGF0aCAmJiAoIXNjaGVtZUhhbmRsZXIgfHwgIXNjaGVtZUhhbmRsZXIuYWJzb2x1dGVQYXRoKSkge1xuICAgICAgICAgICAgcyA9IHJlbW92ZURvdFNlZ21lbnRzKHMpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhdXRob3JpdHkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcyA9IHMucmVwbGFjZSgvXlxcL1xcLy8sIFwiLyUyRlwiKTsgLy9kb24ndCBhbGxvdyB0aGUgcGF0aCB0byBzdGFydCB3aXRoIFwiLy9cIlxuICAgICAgICB9XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKHMpO1xuICAgIH1cbiAgICBpZiAoY29tcG9uZW50cy5xdWVyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHVyaVRva2Vucy5wdXNoKFwiP1wiKTtcbiAgICAgICAgdXJpVG9rZW5zLnB1c2goY29tcG9uZW50cy5xdWVyeSk7XG4gICAgfVxuICAgIGlmIChjb21wb25lbnRzLmZyYWdtZW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdXJpVG9rZW5zLnB1c2goXCIjXCIpO1xuICAgICAgICB1cmlUb2tlbnMucHVzaChjb21wb25lbnRzLmZyYWdtZW50KTtcbiAgICB9XG4gICAgcmV0dXJuIHVyaVRva2Vucy5qb2luKFwiXCIpOyAvL21lcmdlIHRva2VucyBpbnRvIGEgc3RyaW5nXG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb21wb25lbnRzKGJhc2UsIHJlbGF0aXZlKSB7XG4gICAgdmFyIG9wdGlvbnMgPSBhcmd1bWVudHMubGVuZ3RoID4gMiAmJiBhcmd1bWVudHNbMl0gIT09IHVuZGVmaW5lZCA/IGFyZ3VtZW50c1syXSA6IHt9O1xuICAgIHZhciBza2lwTm9ybWFsaXphdGlvbiA9IGFyZ3VtZW50c1szXTtcblxuICAgIHZhciB0YXJnZXQgPSB7fTtcbiAgICBpZiAoIXNraXBOb3JtYWxpemF0aW9uKSB7XG4gICAgICAgIGJhc2UgPSBwYXJzZShzZXJpYWxpemUoYmFzZSwgb3B0aW9ucyksIG9wdGlvbnMpOyAvL25vcm1hbGl6ZSBiYXNlIGNvbXBvbmVudHNcbiAgICAgICAgcmVsYXRpdmUgPSBwYXJzZShzZXJpYWxpemUocmVsYXRpdmUsIG9wdGlvbnMpLCBvcHRpb25zKTsgLy9ub3JtYWxpemUgcmVsYXRpdmUgY29tcG9uZW50c1xuICAgIH1cbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICBpZiAoIW9wdGlvbnMudG9sZXJhbnQgJiYgcmVsYXRpdmUuc2NoZW1lKSB7XG4gICAgICAgIHRhcmdldC5zY2hlbWUgPSByZWxhdGl2ZS5zY2hlbWU7XG4gICAgICAgIC8vdGFyZ2V0LmF1dGhvcml0eSA9IHJlbGF0aXZlLmF1dGhvcml0eTtcbiAgICAgICAgdGFyZ2V0LnVzZXJpbmZvID0gcmVsYXRpdmUudXNlcmluZm87XG4gICAgICAgIHRhcmdldC5ob3N0ID0gcmVsYXRpdmUuaG9zdDtcbiAgICAgICAgdGFyZ2V0LnBvcnQgPSByZWxhdGl2ZS5wb3J0O1xuICAgICAgICB0YXJnZXQucGF0aCA9IHJlbW92ZURvdFNlZ21lbnRzKHJlbGF0aXZlLnBhdGggfHwgXCJcIik7XG4gICAgICAgIHRhcmdldC5xdWVyeSA9IHJlbGF0aXZlLnF1ZXJ5O1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChyZWxhdGl2ZS51c2VyaW5mbyAhPT0gdW5kZWZpbmVkIHx8IHJlbGF0aXZlLmhvc3QgIT09IHVuZGVmaW5lZCB8fCByZWxhdGl2ZS5wb3J0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vdGFyZ2V0LmF1dGhvcml0eSA9IHJlbGF0aXZlLmF1dGhvcml0eTtcbiAgICAgICAgICAgIHRhcmdldC51c2VyaW5mbyA9IHJlbGF0aXZlLnVzZXJpbmZvO1xuICAgICAgICAgICAgdGFyZ2V0Lmhvc3QgPSByZWxhdGl2ZS5ob3N0O1xuICAgICAgICAgICAgdGFyZ2V0LnBvcnQgPSByZWxhdGl2ZS5wb3J0O1xuICAgICAgICAgICAgdGFyZ2V0LnBhdGggPSByZW1vdmVEb3RTZWdtZW50cyhyZWxhdGl2ZS5wYXRoIHx8IFwiXCIpO1xuICAgICAgICAgICAgdGFyZ2V0LnF1ZXJ5ID0gcmVsYXRpdmUucXVlcnk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoIXJlbGF0aXZlLnBhdGgpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IGJhc2UucGF0aDtcbiAgICAgICAgICAgICAgICBpZiAocmVsYXRpdmUucXVlcnkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXQucXVlcnkgPSBiYXNlLnF1ZXJ5O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKHJlbGF0aXZlLnBhdGguY2hhckF0KDApID09PSBcIi9cIikge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IHJlbW92ZURvdFNlZ21lbnRzKHJlbGF0aXZlLnBhdGgpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICgoYmFzZS51c2VyaW5mbyAhPT0gdW5kZWZpbmVkIHx8IGJhc2UuaG9zdCAhPT0gdW5kZWZpbmVkIHx8IGJhc2UucG9ydCAhPT0gdW5kZWZpbmVkKSAmJiAhYmFzZS5wYXRoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IFwiL1wiICsgcmVsYXRpdmUucGF0aDtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICghYmFzZS5wYXRoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IHJlbGF0aXZlLnBhdGg7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQucGF0aCA9IGJhc2UucGF0aC5zbGljZSgwLCBiYXNlLnBhdGgubGFzdEluZGV4T2YoXCIvXCIpICsgMSkgKyByZWxhdGl2ZS5wYXRoO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldC5wYXRoID0gcmVtb3ZlRG90U2VnbWVudHModGFyZ2V0LnBhdGgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0YXJnZXQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vdGFyZ2V0LmF1dGhvcml0eSA9IGJhc2UuYXV0aG9yaXR5O1xuICAgICAgICAgICAgdGFyZ2V0LnVzZXJpbmZvID0gYmFzZS51c2VyaW5mbztcbiAgICAgICAgICAgIHRhcmdldC5ob3N0ID0gYmFzZS5ob3N0O1xuICAgICAgICAgICAgdGFyZ2V0LnBvcnQgPSBiYXNlLnBvcnQ7XG4gICAgICAgIH1cbiAgICAgICAgdGFyZ2V0LnNjaGVtZSA9IGJhc2Uuc2NoZW1lO1xuICAgIH1cbiAgICB0YXJnZXQuZnJhZ21lbnQgPSByZWxhdGl2ZS5mcmFnbWVudDtcbiAgICByZXR1cm4gdGFyZ2V0O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlKGJhc2VVUkksIHJlbGF0aXZlVVJJLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHNlcmlhbGl6ZShyZXNvbHZlQ29tcG9uZW50cyhwYXJzZShiYXNlVVJJLCBvcHRpb25zKSwgcGFyc2UocmVsYXRpdmVVUkksIG9wdGlvbnMpLCBvcHRpb25zLCB0cnVlKSwgb3B0aW9ucyk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZSh1cmksIG9wdGlvbnMpIHtcbiAgICBpZiAodHlwZW9mIHVyaSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICB1cmkgPSBzZXJpYWxpemUocGFyc2UodXJpLCBvcHRpb25zKSwgb3B0aW9ucyk7XG4gICAgfSBlbHNlIGlmICh0eXBlT2YodXJpKSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB1cmkgPSBwYXJzZShzZXJpYWxpemUodXJpLCBvcHRpb25zKSwgb3B0aW9ucyk7XG4gICAgfVxuICAgIHJldHVybiB1cmk7XG59XG5cbmZ1bmN0aW9uIGVxdWFsKHVyaUEsIHVyaUIsIG9wdGlvbnMpIHtcbiAgICBpZiAodHlwZW9mIHVyaUEgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdXJpQSA9IHNlcmlhbGl6ZShwYXJzZSh1cmlBLCBvcHRpb25zKSwgb3B0aW9ucyk7XG4gICAgfSBlbHNlIGlmICh0eXBlT2YodXJpQSkgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgdXJpQSA9IHNlcmlhbGl6ZSh1cmlBLCBvcHRpb25zKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB1cmlCID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHVyaUIgPSBzZXJpYWxpemUocGFyc2UodXJpQiwgb3B0aW9ucyksIG9wdGlvbnMpO1xuICAgIH0gZWxzZSBpZiAodHlwZU9mKHVyaUIpID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHVyaUIgPSBzZXJpYWxpemUodXJpQiwgb3B0aW9ucyk7XG4gICAgfVxuICAgIHJldHVybiB1cmlBID09PSB1cmlCO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVDb21wb25lbnQoc3RyLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHN0ciAmJiBzdHIudG9TdHJpbmcoKS5yZXBsYWNlKCFvcHRpb25zIHx8ICFvcHRpb25zLmlyaSA/IFVSSV9QUk9UT0NPTC5FU0NBUEUgOiBJUklfUFJPVE9DT0wuRVNDQVBFLCBwY3RFbmNDaGFyKTtcbn1cblxuZnVuY3Rpb24gdW5lc2NhcGVDb21wb25lbnQoc3RyLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHN0ciAmJiBzdHIudG9TdHJpbmcoKS5yZXBsYWNlKCFvcHRpb25zIHx8ICFvcHRpb25zLmlyaSA/IFVSSV9QUk9UT0NPTC5QQ1RfRU5DT0RFRCA6IElSSV9QUk9UT0NPTC5QQ1RfRU5DT0RFRCwgcGN0RGVjQ2hhcnMpO1xufVxuXG52YXIgaHR0cCA9IHtcbiAgICBzY2hlbWU6IFwiaHR0cFwiLFxuICAgIGRvbWFpbkhvc3Q6IHRydWUsXG4gICAgcGFyc2U6IGZ1bmN0aW9uIHBhcnNlKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcbiAgICAgICAgLy9yZXBvcnQgbWlzc2luZyBob3N0XG4gICAgICAgIGlmICghY29tcG9uZW50cy5ob3N0KSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIkhUVFAgVVJJcyBtdXN0IGhhdmUgYSBob3N0LlwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH0sXG4gICAgc2VyaWFsaXplOiBmdW5jdGlvbiBzZXJpYWxpemUoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICAvL25vcm1hbGl6ZSB0aGUgZGVmYXVsdCBwb3J0XG4gICAgICAgIGlmIChjb21wb25lbnRzLnBvcnQgPT09IChTdHJpbmcoY29tcG9uZW50cy5zY2hlbWUpLnRvTG93ZXJDYXNlKCkgIT09IFwiaHR0cHNcIiA/IDgwIDogNDQzKSB8fCBjb21wb25lbnRzLnBvcnQgPT09IFwiXCIpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucG9ydCA9IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICAvL25vcm1hbGl6ZSB0aGUgZW1wdHkgcGF0aFxuICAgICAgICBpZiAoIWNvbXBvbmVudHMucGF0aCkge1xuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gXCIvXCI7XG4gICAgICAgIH1cbiAgICAgICAgLy9OT1RFOiBXZSBkbyBub3QgcGFyc2UgcXVlcnkgc3RyaW5ncyBmb3IgSFRUUCBVUklzXG4gICAgICAgIC8vYXMgV1dXIEZvcm0gVXJsIEVuY29kZWQgcXVlcnkgc3RyaW5ncyBhcmUgcGFydCBvZiB0aGUgSFRNTDQrIHNwZWMsXG4gICAgICAgIC8vYW5kIG5vdCB0aGUgSFRUUCBzcGVjLlxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcbiAgICB9XG59O1xuXG52YXIgaHR0cHMgPSB7XG4gICAgc2NoZW1lOiBcImh0dHBzXCIsXG4gICAgZG9tYWluSG9zdDogaHR0cC5kb21haW5Ib3N0LFxuICAgIHBhcnNlOiBodHRwLnBhcnNlLFxuICAgIHNlcmlhbGl6ZTogaHR0cC5zZXJpYWxpemVcbn07XG5cbnZhciBPID0ge307XG52YXIgaXNJUkkgPSB0cnVlO1xuLy9SRkMgMzk4NlxudmFyIFVOUkVTRVJWRUQkJCA9IFwiW0EtWmEtejAtOVxcXFwtXFxcXC5cXFxcX1xcXFx+XCIgKyAoaXNJUkkgPyBcIlxcXFx4QTAtXFxcXHUyMDBEXFxcXHUyMDEwLVxcXFx1MjAyOVxcXFx1MjAyRi1cXFxcdUQ3RkZcXFxcdUY5MDAtXFxcXHVGRENGXFxcXHVGREYwLVxcXFx1RkZFRlwiIDogXCJcIikgKyBcIl1cIjtcbnZhciBIRVhESUckJCA9IFwiWzAtOUEtRmEtZl1cIjsgLy9jYXNlLWluc2Vuc2l0aXZlXG52YXIgUENUX0VOQ09ERUQkID0gc3ViZXhwKHN1YmV4cChcIiVbRUZlZl1cIiArIEhFWERJRyQkICsgXCIlXCIgKyBIRVhESUckJCArIEhFWERJRyQkICsgXCIlXCIgKyBIRVhESUckJCArIEhFWERJRyQkKSArIFwifFwiICsgc3ViZXhwKFwiJVs4OUEtRmEtZl1cIiArIEhFWERJRyQkICsgXCIlXCIgKyBIRVhESUckJCArIEhFWERJRyQkKSArIFwifFwiICsgc3ViZXhwKFwiJVwiICsgSEVYRElHJCQgKyBIRVhESUckJCkpOyAvL2V4cGFuZGVkXG4vL1JGQyA1MzIyLCBleGNlcHQgdGhlc2Ugc3ltYm9scyBhcyBwZXIgUkZDIDYwNjg6IEAgOiAvID8gIyBbIF0gJiA7ID1cbi8vY29uc3QgQVRFWFQkJCA9IFwiW0EtWmEtejAtOVxcXFwhXFxcXCNcXFxcJFxcXFwlXFxcXCZcXFxcJ1xcXFwqXFxcXCtcXFxcLVxcXFwvXFxcXD1cXFxcP1xcXFxeXFxcXF9cXFxcYFxcXFx7XFxcXHxcXFxcfVxcXFx+XVwiO1xuLy9jb25zdCBXU1AkJCA9IFwiW1xcXFx4MjBcXFxceDA5XVwiO1xuLy9jb25zdCBPQlNfUVRFWFQkJCA9IFwiW1xcXFx4MDEtXFxcXHgwOFxcXFx4MEJcXFxceDBDXFxcXHgwRS1cXFxceDFGXFxcXHg3Rl1cIjsgIC8vKCVkMS04IC8gJWQxMS0xMiAvICVkMTQtMzEgLyAlZDEyNylcbi8vY29uc3QgUVRFWFQkJCA9IG1lcmdlKFwiW1xcXFx4MjFcXFxceDIzLVxcXFx4NUJcXFxceDVELVxcXFx4N0VdXCIsIE9CU19RVEVYVCQkKTsgIC8vJWQzMyAvICVkMzUtOTEgLyAlZDkzLTEyNiAvIG9icy1xdGV4dFxuLy9jb25zdCBWQ0hBUiQkID0gXCJbXFxcXHgyMS1cXFxceDdFXVwiO1xuLy9jb25zdCBXU1AkJCA9IFwiW1xcXFx4MjBcXFxceDA5XVwiO1xuLy9jb25zdCBPQlNfUVAkID0gc3ViZXhwKFwiXFxcXFxcXFxcIiArIG1lcmdlKFwiW1xcXFx4MDBcXFxceDBEXFxcXHgwQV1cIiwgT0JTX1FURVhUJCQpKTsgIC8vJWQwIC8gQ1IgLyBMRiAvIG9icy1xdGV4dFxuLy9jb25zdCBGV1MkID0gc3ViZXhwKHN1YmV4cChXU1AkJCArIFwiKlwiICsgXCJcXFxceDBEXFxcXHgwQVwiKSArIFwiP1wiICsgV1NQJCQgKyBcIitcIik7XG4vL2NvbnN0IFFVT1RFRF9QQUlSJCA9IHN1YmV4cChzdWJleHAoXCJcXFxcXFxcXFwiICsgc3ViZXhwKFZDSEFSJCQgKyBcInxcIiArIFdTUCQkKSkgKyBcInxcIiArIE9CU19RUCQpO1xuLy9jb25zdCBRVU9URURfU1RSSU5HJCA9IHN1YmV4cCgnXFxcXFwiJyArIHN1YmV4cChGV1MkICsgXCI/XCIgKyBRQ09OVEVOVCQpICsgXCIqXCIgKyBGV1MkICsgXCI/XCIgKyAnXFxcXFwiJyk7XG52YXIgQVRFWFQkJCA9IFwiW0EtWmEtejAtOVxcXFwhXFxcXCRcXFxcJVxcXFwnXFxcXCpcXFxcK1xcXFwtXFxcXF5cXFxcX1xcXFxgXFxcXHtcXFxcfFxcXFx9XFxcXH5dXCI7XG52YXIgUVRFWFQkJCA9IFwiW1xcXFwhXFxcXCRcXFxcJVxcXFwnXFxcXChcXFxcKVxcXFwqXFxcXCtcXFxcLFxcXFwtXFxcXC4wLTlcXFxcPFxcXFw+QS1aXFxcXHg1RS1cXFxceDdFXVwiO1xudmFyIFZDSEFSJCQgPSBtZXJnZShRVEVYVCQkLCBcIltcXFxcXFxcIlxcXFxcXFxcXVwiKTtcbnZhciBTT01FX0RFTElNUyQkID0gXCJbXFxcXCFcXFxcJFxcXFwnXFxcXChcXFxcKVxcXFwqXFxcXCtcXFxcLFxcXFw7XFxcXDpcXFxcQF1cIjtcbnZhciBVTlJFU0VSVkVEID0gbmV3IFJlZ0V4cChVTlJFU0VSVkVEJCQsIFwiZ1wiKTtcbnZhciBQQ1RfRU5DT0RFRCA9IG5ldyBSZWdFeHAoUENUX0VOQ09ERUQkLCBcImdcIik7XG52YXIgTk9UX0xPQ0FMX1BBUlQgPSBuZXcgUmVnRXhwKG1lcmdlKFwiW15dXCIsIEFURVhUJCQsIFwiW1xcXFwuXVwiLCAnW1xcXFxcIl0nLCBWQ0hBUiQkKSwgXCJnXCIpO1xudmFyIE5PVF9IRk5BTUUgPSBuZXcgUmVnRXhwKG1lcmdlKFwiW15dXCIsIFVOUkVTRVJWRUQkJCwgU09NRV9ERUxJTVMkJCksIFwiZ1wiKTtcbnZhciBOT1RfSEZWQUxVRSA9IE5PVF9IRk5BTUU7XG5mdW5jdGlvbiBkZWNvZGVVbnJlc2VydmVkKHN0cikge1xuICAgIHZhciBkZWNTdHIgPSBwY3REZWNDaGFycyhzdHIpO1xuICAgIHJldHVybiAhZGVjU3RyLm1hdGNoKFVOUkVTRVJWRUQpID8gc3RyIDogZGVjU3RyO1xufVxudmFyIG1haWx0byA9IHtcbiAgICBzY2hlbWU6IFwibWFpbHRvXCIsXG4gICAgcGFyc2U6IGZ1bmN0aW9uIHBhcnNlJCQxKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHRvID0gY29tcG9uZW50cy50byA9IGNvbXBvbmVudHMucGF0aCA/IGNvbXBvbmVudHMucGF0aC5zcGxpdChcIixcIikgOiBbXTtcbiAgICAgICAgY29tcG9uZW50cy5wYXRoID0gdW5kZWZpbmVkO1xuICAgICAgICBpZiAoY29tcG9uZW50cy5xdWVyeSkge1xuICAgICAgICAgICAgdmFyIHVua25vd25IZWFkZXJzID0gZmFsc2U7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IHt9O1xuICAgICAgICAgICAgdmFyIGhmaWVsZHMgPSBjb21wb25lbnRzLnF1ZXJ5LnNwbGl0KFwiJlwiKTtcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAwLCB4bCA9IGhmaWVsZHMubGVuZ3RoOyB4IDwgeGw7ICsreCkge1xuICAgICAgICAgICAgICAgIHZhciBoZmllbGQgPSBoZmllbGRzW3hdLnNwbGl0KFwiPVwiKTtcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKGhmaWVsZFswXSkge1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwidG9cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciB0b0FkZHJzID0gaGZpZWxkWzFdLnNwbGl0KFwiLFwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIF94ID0gMCwgX3hsID0gdG9BZGRycy5sZW5ndGg7IF94IDwgX3hsOyArK194KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdG8ucHVzaCh0b0FkZHJzW194XSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcInN1YmplY3RcIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuc3ViamVjdCA9IHVuZXNjYXBlQ29tcG9uZW50KGhmaWVsZFsxXSwgb3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcImJvZHlcIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuYm9keSA9IHVuZXNjYXBlQ29tcG9uZW50KGhmaWVsZFsxXSwgb3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIHVua25vd25IZWFkZXJzID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWRlcnNbdW5lc2NhcGVDb21wb25lbnQoaGZpZWxkWzBdLCBvcHRpb25zKV0gPSB1bmVzY2FwZUNvbXBvbmVudChoZmllbGRbMV0sIG9wdGlvbnMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHVua25vd25IZWFkZXJzKSBjb21wb25lbnRzLmhlYWRlcnMgPSBoZWFkZXJzO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudHMucXVlcnkgPSB1bmRlZmluZWQ7XG4gICAgICAgIGZvciAodmFyIF94MiA9IDAsIF94bDIgPSB0by5sZW5ndGg7IF94MiA8IF94bDI7ICsrX3gyKSB7XG4gICAgICAgICAgICB2YXIgYWRkciA9IHRvW194Ml0uc3BsaXQoXCJAXCIpO1xuICAgICAgICAgICAgYWRkclswXSA9IHVuZXNjYXBlQ29tcG9uZW50KGFkZHJbMF0pO1xuICAgICAgICAgICAgaWYgKCFvcHRpb25zLnVuaWNvZGVTdXBwb3J0KSB7XG4gICAgICAgICAgICAgICAgLy9jb252ZXJ0IFVuaWNvZGUgSUROIC0+IEFTQ0lJIElETlxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGFkZHJbMV0gPSBwdW55Y29kZS50b0FTQ0lJKHVuZXNjYXBlQ29tcG9uZW50KGFkZHJbMV0sIG9wdGlvbnMpLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJFbWFpbCBhZGRyZXNzJ3MgZG9tYWluIG5hbWUgY2FuIG5vdCBiZSBjb252ZXJ0ZWQgdG8gQVNDSUkgdmlhIHB1bnljb2RlOiBcIiArIGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBhZGRyWzFdID0gdW5lc2NhcGVDb21wb25lbnQoYWRkclsxXSwgb3B0aW9ucykudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRvW194Ml0gPSBhZGRyLmpvaW4oXCJAXCIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH0sXG4gICAgc2VyaWFsaXplOiBmdW5jdGlvbiBzZXJpYWxpemUkJDEoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICB2YXIgdG8gPSB0b0FycmF5KGNvbXBvbmVudHMudG8pO1xuICAgICAgICBpZiAodG8pIHtcbiAgICAgICAgICAgIGZvciAodmFyIHggPSAwLCB4bCA9IHRvLmxlbmd0aDsgeCA8IHhsOyArK3gpIHtcbiAgICAgICAgICAgICAgICB2YXIgdG9BZGRyID0gU3RyaW5nKHRvW3hdKTtcbiAgICAgICAgICAgICAgICB2YXIgYXRJZHggPSB0b0FkZHIubGFzdEluZGV4T2YoXCJAXCIpO1xuICAgICAgICAgICAgICAgIHZhciBsb2NhbFBhcnQgPSB0b0FkZHIuc2xpY2UoMCwgYXRJZHgpLnJlcGxhY2UoUENUX0VOQ09ERUQsIGRlY29kZVVucmVzZXJ2ZWQpLnJlcGxhY2UoUENUX0VOQ09ERUQsIHRvVXBwZXJDYXNlKS5yZXBsYWNlKE5PVF9MT0NBTF9QQVJULCBwY3RFbmNDaGFyKTtcbiAgICAgICAgICAgICAgICB2YXIgZG9tYWluID0gdG9BZGRyLnNsaWNlKGF0SWR4ICsgMSk7XG4gICAgICAgICAgICAgICAgLy9jb252ZXJ0IElETiB2aWEgcHVueWNvZGVcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBkb21haW4gPSAhb3B0aW9ucy5pcmkgPyBwdW55Y29kZS50b0FTQ0lJKHVuZXNjYXBlQ29tcG9uZW50KGRvbWFpbiwgb3B0aW9ucykudG9Mb3dlckNhc2UoKSkgOiBwdW55Y29kZS50b1VuaWNvZGUoZG9tYWluKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHMuZXJyb3IgPSBjb21wb25lbnRzLmVycm9yIHx8IFwiRW1haWwgYWRkcmVzcydzIGRvbWFpbiBuYW1lIGNhbiBub3QgYmUgY29udmVydGVkIHRvIFwiICsgKCFvcHRpb25zLmlyaSA/IFwiQVNDSUlcIiA6IFwiVW5pY29kZVwiKSArIFwiIHZpYSBwdW55Y29kZTogXCIgKyBlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0b1t4XSA9IGxvY2FsUGFydCArIFwiQFwiICsgZG9tYWluO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gdG8uam9pbihcIixcIik7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGhlYWRlcnMgPSBjb21wb25lbnRzLmhlYWRlcnMgPSBjb21wb25lbnRzLmhlYWRlcnMgfHwge307XG4gICAgICAgIGlmIChjb21wb25lbnRzLnN1YmplY3QpIGhlYWRlcnNbXCJzdWJqZWN0XCJdID0gY29tcG9uZW50cy5zdWJqZWN0O1xuICAgICAgICBpZiAoY29tcG9uZW50cy5ib2R5KSBoZWFkZXJzW1wiYm9keVwiXSA9IGNvbXBvbmVudHMuYm9keTtcbiAgICAgICAgdmFyIGZpZWxkcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBuYW1lIGluIGhlYWRlcnMpIHtcbiAgICAgICAgICAgIGlmIChoZWFkZXJzW25hbWVdICE9PSBPW25hbWVdKSB7XG4gICAgICAgICAgICAgICAgZmllbGRzLnB1c2gobmFtZS5yZXBsYWNlKFBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS5yZXBsYWNlKFBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSkucmVwbGFjZShOT1RfSEZOQU1FLCBwY3RFbmNDaGFyKSArIFwiPVwiICsgaGVhZGVyc1tuYW1lXS5yZXBsYWNlKFBDVF9FTkNPREVELCBkZWNvZGVVbnJlc2VydmVkKS5yZXBsYWNlKFBDVF9FTkNPREVELCB0b1VwcGVyQ2FzZSkucmVwbGFjZShOT1RfSEZWQUxVRSwgcGN0RW5jQ2hhcikpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChmaWVsZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLnF1ZXJ5ID0gZmllbGRzLmpvaW4oXCImXCIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb21wb25lbnRzO1xuICAgIH1cbn07XG5cbnZhciBOSUQkID0gXCIoPzpbMC05QS1aYS16XVswLTlBLVphLXpcXFxcLV17MSwzMX0pXCI7XG52YXIgVVJOX1NDSEVNRSA9IG5ldyBSZWdFeHAoXCJedXJuXFxcXDooXCIgKyBOSUQkICsgXCIpJFwiKTtcbnZhciBVUk5fUEFSU0UgPSAvXihbXlxcOl0rKVxcOiguKikvO1xudmFyIFVSTl9FWENMVURFRCA9IC9bXFx4MDAtXFx4MjBcXFxcXFxcIlxcJlxcPFxcPlxcW1xcXVxcXlxcYFxce1xcfFxcfVxcflxceDdGLVxceEZGXS9nO1xuLy9SRkMgMjE0MVxudmFyIHVybiA9IHtcbiAgICBzY2hlbWU6IFwidXJuXCIsXG4gICAgcGFyc2U6IGZ1bmN0aW9uIHBhcnNlJCQxKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIG1hdGNoZXMgPSBjb21wb25lbnRzLnBhdGggJiYgY29tcG9uZW50cy5wYXRoLm1hdGNoKFVSTl9QQVJTRSk7XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgICB2YXIgc2NoZW1lID0gXCJ1cm46XCIgKyBtYXRjaGVzWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICB2YXIgc2NoZW1lSGFuZGxlciA9IFNDSEVNRVNbc2NoZW1lXTtcbiAgICAgICAgICAgIC8vaW4gb3JkZXIgdG8gc2VyaWFsaXplIHByb3Blcmx5LFxuICAgICAgICAgICAgLy9ldmVyeSBVUk4gbXVzdCBoYXZlIGEgc2VyaWFsaXplciB0aGF0IGNhbGxzIHRoZSBVUk4gc2VyaWFsaXplclxuICAgICAgICAgICAgaWYgKCFzY2hlbWVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgLy9jcmVhdGUgZmFrZSBzY2hlbWUgaGFuZGxlclxuICAgICAgICAgICAgICAgIHNjaGVtZUhhbmRsZXIgPSBTQ0hFTUVTW3NjaGVtZV0gPSB7XG4gICAgICAgICAgICAgICAgICAgIHNjaGVtZTogc2NoZW1lLFxuICAgICAgICAgICAgICAgICAgICBwYXJzZTogZnVuY3Rpb24gcGFyc2UkJDEoY29tcG9uZW50cywgb3B0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNvbXBvbmVudHM7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNlcmlhbGl6ZTogU0NIRU1FU1tcInVyblwiXS5zZXJpYWxpemVcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBzY2hlbWU7XG4gICAgICAgICAgICBjb21wb25lbnRzLnBhdGggPSBtYXRjaGVzWzJdO1xuICAgICAgICAgICAgY29tcG9uZW50cyA9IHNjaGVtZUhhbmRsZXIucGFyc2UoY29tcG9uZW50cywgb3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb21wb25lbnRzLmVycm9yID0gY29tcG9uZW50cy5lcnJvciB8fCBcIlVSTiBjYW4gbm90IGJlIHBhcnNlZC5cIjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcbiAgICB9LFxuICAgIHNlcmlhbGl6ZTogZnVuY3Rpb24gc2VyaWFsaXplJCQxKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHNjaGVtZSA9IGNvbXBvbmVudHMuc2NoZW1lIHx8IG9wdGlvbnMuc2NoZW1lO1xuICAgICAgICBpZiAoc2NoZW1lICYmIHNjaGVtZSAhPT0gXCJ1cm5cIikge1xuICAgICAgICAgICAgdmFyIG1hdGNoZXMgPSBzY2hlbWUubWF0Y2goVVJOX1NDSEVNRSkgfHwgW1widXJuOlwiICsgc2NoZW1lLCBzY2hlbWVdO1xuICAgICAgICAgICAgY29tcG9uZW50cy5zY2hlbWUgPSBcInVyblwiO1xuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gbWF0Y2hlc1sxXSArIFwiOlwiICsgKGNvbXBvbmVudHMucGF0aCA/IGNvbXBvbmVudHMucGF0aC5yZXBsYWNlKFVSTl9FWENMVURFRCwgcGN0RW5jQ2hhcikgOiBcIlwiKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcbiAgICB9XG59O1xuXG52YXIgVVVJRCA9IC9eWzAtOUEtRmEtZl17OH0oPzpcXC1bMC05QS1GYS1mXXs0fSl7M31cXC1bMC05QS1GYS1mXXsxMn0kLztcbi8vUkZDIDQxMjJcbnZhciB1dWlkID0ge1xuICAgIHNjaGVtZTogXCJ1cm46dXVpZFwiLFxuICAgIHBhcnNlOiBmdW5jdGlvbiBwYXJzZSQkMShjb21wb25lbnRzLCBvcHRpb25zKSB7XG4gICAgICAgIGlmICghb3B0aW9ucy50b2xlcmFudCAmJiAoIWNvbXBvbmVudHMucGF0aCB8fCAhY29tcG9uZW50cy5wYXRoLm1hdGNoKFVVSUQpKSkge1xuICAgICAgICAgICAgY29tcG9uZW50cy5lcnJvciA9IGNvbXBvbmVudHMuZXJyb3IgfHwgXCJVVUlEIGlzIG5vdCB2YWxpZC5cIjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29tcG9uZW50cztcbiAgICB9LFxuICAgIHNlcmlhbGl6ZTogZnVuY3Rpb24gc2VyaWFsaXplJCQxKGNvbXBvbmVudHMsIG9wdGlvbnMpIHtcbiAgICAgICAgLy9lbnN1cmUgVVVJRCBpcyB2YWxpZFxuICAgICAgICBpZiAoIW9wdGlvbnMudG9sZXJhbnQgJiYgKCFjb21wb25lbnRzLnBhdGggfHwgIWNvbXBvbmVudHMucGF0aC5tYXRjaChVVUlEKSkpIHtcbiAgICAgICAgICAgIC8vaW52YWxpZCBVVUlEcyBjYW4gbm90IGhhdmUgdGhpcyBzY2hlbWVcbiAgICAgICAgICAgIGNvbXBvbmVudHMuc2NoZW1lID0gdW5kZWZpbmVkO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy9ub3JtYWxpemUgVVVJRFxuICAgICAgICAgICAgY29tcG9uZW50cy5wYXRoID0gKGNvbXBvbmVudHMucGF0aCB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBTQ0hFTUVTW1widXJuXCJdLnNlcmlhbGl6ZShjb21wb25lbnRzLCBvcHRpb25zKTtcbiAgICB9XG59O1xuXG5TQ0hFTUVTW1wiaHR0cFwiXSA9IGh0dHA7XG5TQ0hFTUVTW1wiaHR0cHNcIl0gPSBodHRwcztcblNDSEVNRVNbXCJtYWlsdG9cIl0gPSBtYWlsdG87XG5TQ0hFTUVTW1widXJuXCJdID0gdXJuO1xuU0NIRU1FU1tcInVybjp1dWlkXCJdID0gdXVpZDtcblxuZXhwb3J0cy5TQ0hFTUVTID0gU0NIRU1FUztcbmV4cG9ydHMucGN0RW5jQ2hhciA9IHBjdEVuY0NoYXI7XG5leHBvcnRzLnBjdERlY0NoYXJzID0gcGN0RGVjQ2hhcnM7XG5leHBvcnRzLnBhcnNlID0gcGFyc2U7XG5leHBvcnRzLnJlbW92ZURvdFNlZ21lbnRzID0gcmVtb3ZlRG90U2VnbWVudHM7XG5leHBvcnRzLnNlcmlhbGl6ZSA9IHNlcmlhbGl6ZTtcbmV4cG9ydHMucmVzb2x2ZUNvbXBvbmVudHMgPSByZXNvbHZlQ29tcG9uZW50cztcbmV4cG9ydHMucmVzb2x2ZSA9IHJlc29sdmU7XG5leHBvcnRzLm5vcm1hbGl6ZSA9IG5vcm1hbGl6ZTtcbmV4cG9ydHMuZXF1YWwgPSBlcXVhbDtcbmV4cG9ydHMuZXNjYXBlQ29tcG9uZW50ID0gZXNjYXBlQ29tcG9uZW50O1xuZXhwb3J0cy51bmVzY2FwZUNvbXBvbmVudCA9IHVuZXNjYXBlQ29tcG9uZW50O1xuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xuXG59KSkpO1xuLy8jIHNvdXJjZU1hcHBpbmdVUkw9dXJpLmFsbC5qcy5tYXBcbiJdfQ==
