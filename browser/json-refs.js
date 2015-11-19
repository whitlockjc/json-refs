(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.JsonRefs = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
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

// Load promises polyfill if necessary
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

var _ = require('./lib/utils');
var pathLoader = (typeof window !== "undefined" ? window['PathLoader'] : typeof global !== "undefined" ? global['PathLoader'] : null);
var traverse = (typeof window !== "undefined" ? window['traverse'] : typeof global !== "undefined" ? global['traverse'] : null);

var remoteCache = {};
var supportedSchemes = ['file', 'http', 'https'];

/**
 * Callback used by {@link resolveRefs}.
 *
 * @param {error} [err] - The error if there is a problem
 * @param {object} [resolved] - The resolved results
 * @param {object} [metadata] - The reference resolution metadata.  *(The key a JSON Pointer to a path in the resolved
 *                              document where a JSON Reference was dereferenced.  The value is also an object.  Every
 *                              metadata entry has a `ref` property to tell you where the dereferenced value came from.
 *                              If there is an `err` property, it is the `Error` object encountered retrieving the
 *                              referenced value.  If there is a `missing` property, it means the referenced value could
 *                              not be resolved.)*
 *
 * @callback resultCallback
 */

/**
 * Callback used to provide access to altering a remote request prior to the request being made.
 *
 * @param {object} req - The Superagent request object
 * @param {string} ref - The reference being resolved (When applicable)
 *
 * @callback prepareRequestCallback
 */

/**
 * Callback used to process the content of a reference.
 *
 * @param {string} content - The content loaded from the file/URL
 * @param {string} ref - The reference string (When applicable)
 * @param {object} [res] - The Superagent response object (For remote URL requests only)
 *
 * @returns {object} The JavaScript object representation of the reference
 *
 * @callback processContentCallback
 */

/* Internal Functions */

/**
 * Retrieves the content at the URL and returns its JSON content.
 *
 * @param {string} url - The URL to retrieve
 * @param {object} options - The options passed to resolveRefs
 *
 * @throws Error if there is a problem making the request or the content is not JSON
 *
 * @returns {Promise} The promise
 */
function getRemoteJson (url, options) {
  var json = remoteCache[url];
  var allTasks = Promise.resolve();
  var scheme = url.indexOf(':') === -1 ? undefined : url.split(':')[0];

  if (!_.isUndefined(json)) {
    allTasks = allTasks.then(function () {
      return json;
    });
  } else if (supportedSchemes.indexOf(scheme) === -1 && !_.isUndefined(scheme)) {
    allTasks = allTasks.then(function () {
      return Promise.reject(new Error('Unsupported remote reference scheme: ' + scheme));
    });
  } else {
    allTasks = pathLoader.load(url, options);

    if (options.processContent) {
      allTasks = allTasks.then(function (content) {
        return options.processContent(content, url);
      });
    } else {
      allTasks = allTasks.then(JSON.parse);
    }

    allTasks = allTasks.then(function (nJson) {
      remoteCache[url] = nJson;

      return nJson;
    });
  }

  // Return a cloned version to avoid updating the cache
  allTasks = allTasks.then(function (nJson) {
    return _.cloneDeep(nJson);
  });

  return allTasks;
}

/* Exported Functions */

/**
 * Clears the internal cache of url -> JavaScript object mappings based on previously resolved references.
 */
module.exports.clearCache = function clearCache () {
  remoteCache = {};
};

/**
 * Returns whether or not the object represents a JSON Reference.
 *
 * @param {object|string} [obj] - The object to check
 *
 * @returns {boolean} true if the argument is an object and its $ref property is a string and false otherwise
 */
var isJsonReference = module.exports.isJsonReference = function isJsonReference (obj) {
  // TODO: Add check that the value is a valid JSON Pointer
  return _.isPlainObject(obj) && _.isString(obj.$ref);
};

/**
 * Takes an array of path segments and creates a JSON Pointer from it.
 *
 * @see {@link http://tools.ietf.org/html/rfc6901}
 *
 * @param {string[]} path - The path segments
 *
 * @returns {string} A JSON Pointer based on the path segments
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
    ptr += '/' + path.map(function (part) {
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
 * @param {array|object} json - The JSON document to find references in
 *
 * @returns {object} An object whose keys are JSON Pointers to the '$ref' node of the JSON Reference
 *
 * @throws Error if the arguments are missing or invalid
 */
var findRefs = module.exports.findRefs = function findRefs (json) {
  if (_.isUndefined(json)) {
    throw new Error('json is required');
  } else if (!_.isArray(json) && !_.isPlainObject(json)) {
    throw new Error('json must be an array or an object');
  }

  return traverse(json).reduce(function (acc) {
    var val = this.node;

    if (this.key === '$ref' && isJsonReference(this.parent.node)) {
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
 * @returns {boolean} true if the JSON Pointer is remote or false if not
 *
 * @throws Error if the arguments are missing or invalid
 */
var isRemotePointer = module.exports.isRemotePointer = function isRemotePointer (ptr) {
  if (_.isUndefined(ptr)) {
    throw new Error('ptr is required');
  } else if (!_.isString(ptr)) {
    throw new Error('ptr must be a string');
  }

  // We treat anything other than local, valid JSON Pointer values as remote
  return ptr !== '' && ptr.charAt(0) !== '#';
};

/**
 * Returns whether or not the JSON Pointer is a file reference.
 *
 * @param {string} ptr - The JSON Pointer
 *
 * @returns {boolean} true if the JSON Pointer is a file or false if not
 *
 * @throws Error if the arguments are missing or invalid
 */
var isFilePointer = module.exports.isFilePointer = function isFilePointer (ptr) {
  // The set of file pointers is a subset of the set of remote pointers without scheme prefix
  return isRemotePointer(ptr) && !(/^[a-zA-Z]+:\/\//.test(ptr));
};

/**
 * Takes a JSON Reference and returns an array of path segments.
 *
 * @see {@link http://tools.ietf.org/html/rfc6901}
 *
 * @param {string} ptr - The JSON Pointer for the JSON Reference
 *
 * @returns {string[]} An array of path segments or the passed in string if it is a remote reference
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
  var rootPaths = ['', '#', '#/'];

  if (isRemotePointer(ptr)) {
    path = ptr;
  } else {
    if (rootPaths.indexOf(ptr) === -1 && ptr.charAt(0) === '#') {
      path = ptr.substring(ptr.indexOf('/')).split('/').reduce(function (parts, part) {
        if (part !== '') {
          parts.push(part.replace(/~0/g, '~').replace(/~1/g, '/'));
        }

        return parts;
      }, []);
    }
  }

  return path;
};

function combineRefs (base, ref) {
  var basePath = pathFromPointer(base);

  if (isRemotePointer(ref)) {
    if (ref.indexOf('#') === -1) {
      ref = '#';
    } else {
      ref = ref.substring(ref.indexOf('#'));
    }
  }

  return pathToPointer(basePath.concat(pathFromPointer(ref))).replace(/\/\$ref/g, '');
}

function computeUrl (base, ref) {
  var isRelative = ref.charAt(0) !== '#' && ref.indexOf(':') === -1;
  var newLocation = [];
  var refSegments = (ref.indexOf('#') > -1 ? ref.split('#')[0] : ref).split('/');

  function segmentHandler (segment) {
    if (segment === '..') {
      newLocation.pop();
    } else if (segment !== '.') {
      newLocation.push(segment);
    }
  }

  if (base) {
    // Remove hash
    if (base.indexOf('#') > -1) {
      base = base.substring(0, base.indexOf('#'));
    }

    // Remove trailing slash
    if (base.length > 1 && base[base.length - 1] === '/') {
      base = base.substring(0, base.length - 1);
    }

    // Normalize the base
    base.split('#')[0].split('/').forEach(segmentHandler);
  }

  if (isRelative) {
    // Add reference segments
    refSegments.forEach(segmentHandler);
  } else {
    newLocation = refSegments;
  }

  return newLocation.join('/');
}

function realResolveRefs (json, options, metadata) {
  var depth = _.isUndefined(options.depth) ? 1 : options.depth;
  var jsonT = traverse(json);

  function findParentReference (path) {
    var pPath = path.slice(0, path.lastIndexOf('allOf'));
    var refMetadata = metadata[pathToPointer(pPath)];

    if (!_.isUndefined(refMetadata)) {
      return pathToPointer(pPath);
    } else {
      if (pPath.indexOf('allOf') > -1) {
        return findParentReference(pPath);
      } else {
        return undefined;
      }
    }
  }

  function fixCirculars (rJsonT) {
    var circularPtrs = [];
    var scrubbed = rJsonT.map(function () {
      var ptr = pathToPointer(this.path);
      var refMetadata = metadata[ptr];
      var pPtr;

      if (this.circular) {
        circularPtrs.push(ptr);

        if (_.isUndefined(refMetadata)) {
          // This must be circular composition/inheritance
          pPtr = findParentReference(this.path);
          refMetadata = metadata[pPtr];
        }

        // Reference metadata can be undefined for references to schemas that have circular composition/inheritance and
        // are safely ignoreable.
        if (!_.isUndefined(refMetadata)) {
          refMetadata.circular = true;
        }

        if (depth === 0) {
          this.update({});
        } else {
          this.update(traverse(this.node).map(function () {
            if (this.circular) {
              this.parent.update({});
            }
          }));
        }
      }
    });

    // Replace scrubbed circulars based on depth
    _.each(circularPtrs, function (ptr) {
      var depthPath = [];
      var path = pathFromPointer(ptr);
      var value = traverse(scrubbed).get(path);
      var i;

      for (i = 0; i < depth; i++) {
        depthPath.push.apply(depthPath, path);

        traverse(scrubbed).set(depthPath, _.cloneDeep(value));
      }
    });

    return scrubbed;
  }

  function replaceReference (ref, refPtr) {
    var refMetadataKey = combineRefs(refPtr, '#');
    var localRef = ref = ref.indexOf('#') === -1 ?
          '#' :
          ref.substring(ref.indexOf('#'));
    var localPath = pathFromPointer(localRef);
    var missing = !jsonT.has(localPath);
    var value = jsonT.get(localPath);
    var refPtrPath = pathFromPointer(refPtr);
    var parentPath = refPtrPath.slice(0, refPtrPath.length - 1);
    var refMetadata = metadata[refMetadataKey] || {
      ref: ref
    };

    if (!missing) {
      if (parentPath.length === 0) {
        // Self references are special
        if (jsonT.value === value) {
          value = {};

          refMetadata.circular = true;
        }

        jsonT.value = value;
      } else {
        if (jsonT.get(parentPath) === value) {
          value = {};

          refMetadata.circular = true;
        }

        jsonT.set(parentPath, value);
      }
    } else {
      refMetadata.missing = true;
    }

    metadata[refMetadataKey] = refMetadata;
  }

  // All references at this point should be local except missing/invalid references
  if (_.isUndefined(options.resolveLocalRefs) || options.resolveLocalRefs) {
    _.each(findRefs(json), function (ref, refPtr) {
      if (!isRemotePointer(ref)) {
        replaceReference(ref, refPtr);
      }
    });
  }

  // Remove full locations from reference metadata
  if (!_.isUndefined(options.location)) {
    _.each(metadata, function (refMetadata) {
      var normalizedPtr = refMetadata.ref;

      // Remove the base when applicable
      if (normalizedPtr.indexOf(options.location) === 0) {
        normalizedPtr = normalizedPtr.substring(options.location.length);

        // Remove the / prefix
        if (normalizedPtr.charAt(0) === '/') {
          normalizedPtr = normalizedPtr.substring(1);
        }
      }

      refMetadata.ref = normalizedPtr;
    });
  }

  // Fix circulars
  return {
    metadata: metadata,
    resolved: fixCirculars(jsonT)
  };
}

function resolveRemoteRefs (json, options, parentPtr, parents, metadata) {
  var allTasks = Promise.resolve();
  var jsonT = traverse(json);

  function replaceRemoteRef (refPtr, ptr, remoteLocation, remotePtr, resolved) {
    var normalizedPtr = remoteLocation + (remotePtr === '#' ? '' : remotePtr);
    var refMetadataKey = combineRefs(parentPtr, refPtr);
    var refMetadata = metadata[refMetadataKey] || {};
    var refPath = pathFromPointer(refPtr);
    var value;

    refMetadata.remote = true;

    if (_.isUndefined(resolved)) {
      refMetadata.circular = true;

      // Use the parent reference loocation
      value = parents[remoteLocation].ref;
    } else {
      // Get the remote value
      value = traverse(resolved).get(pathFromPointer(remotePtr));

      if (_.isUndefined(value)) {
        refMetadata.missing = true;
      } else {
        // If the remote value is itself a reference, update the reference to be replaced with its reference value.
        // Otherwise, replace the remote reference.
        if (value.$ref) {
          value = value.$ref;
        } else {
          refPath.pop();
        }
      }
    }

    // Collapse self references
    if (refPath.length === 0) {
      jsonT.value = value;
    } else {
      jsonT.set(refPath, value);
    }

    refMetadata.ref = normalizedPtr;

    metadata[refMetadataKey] = refMetadata;
  }

  function resolver () {
    return {
      metadata: metadata,
      resolved: jsonT.value
    };
  }

  _.each(findRefs(json), function (ptr, refPtr) {
    // Use resolve filters from options to resolve/not resolve references
    var isFilePtr = isFilePointer(ptr);
    var isRemotePtr = isRemotePointer(ptr);

    if ((isFilePtr && (_.isUndefined(options.resolveFileRefs) || options.resolveFileRefs)) ||
        (!isFilePtr && isRemotePtr && (_.isUndefined(options.resolveRemoteRefs) || options.resolveRemoteRefs))) {
      allTasks = allTasks.then(function () {
        var remoteLocation = computeUrl(options.location, ptr);
        var refParts = ptr.split('#');
        var hash = '#' + (refParts[1] || '');

        if (_.isUndefined(parents[remoteLocation])) {
          return getRemoteJson(remoteLocation, options)
            .then(function (remoteJson) {
              return remoteJson;
            }, function (err) {
              return err;
            })
            .then(function (response) {
              var refBase = refParts[0];
              var rOptions = _.cloneDeep(options);
              var newParentPtr = combineRefs(parentPtr, refPtr);

              // Remove the last path segment
              refBase = refBase.substring(0, refBase.lastIndexOf('/') + 1);

              // Update the recursive location
              rOptions.location = computeUrl(options.location, refBase);

              if (_.isError(response)) {
                metadata[newParentPtr] = {
                  err: response,
                  missing: true,
                  ref: ptr
                };
              } else {
                // Record the parent
                parents[remoteLocation] = {
                  ref: parentPtr
                };

                // Resolve remote references
                return resolveRemoteRefs(response, rOptions, newParentPtr, parents, metadata)
                  .then(function (rMetadata) {
                    delete parents[remoteLocation];

                    replaceRemoteRef(refPtr, ptr, remoteLocation, hash, rMetadata.resolved);

                    return rMetadata;
                  });
              }
            });
        } else {
          // This is a circular reference
          replaceRemoteRef(refPtr, ptr, remoteLocation, hash);
        }
      });
    }
  });

  allTasks = allTasks
    .then(function () {
      realResolveRefs(jsonT.value, options, metadata);
    })
    .then(resolver, resolver);

  return allTasks;
}

/**
 * Takes a JSON document, resolves all JSON References and returns a fully resolved equivalent along with reference
 * resolution metadata.
 *
 * **Important Details**
 *
 * * The input arguments are never altered
 * * When using promises, only one value can be resolved so it is an object whose keys and values are the same name and
 *   value as arguments 1 and 2 for {@link resultCallback}
 *
 * @param {array|object} json - The JSON  document having zero or more JSON References
 * @param {object} [options] - The options (All options are passed down to whitlockjc/path-loader)
 * @param {number} [options.depth=1] - The depth to resolve circular references
 * @param {string} [options.location] - The location to which relative references should be resolved
 * @param {boolean} [options.resolveLocalRefs=true] - Resolve local references
 * @param {boolean} [options.resolveRemoteRefs=true] - Resolve remote references
 * @param {boolean} [options.resolveFileRefs=true] - Resolve file references
 * @param {prepareRequestCallback} [options.prepareRequest] - The callback used to prepare an HTTP request
 * @param {processContentCallback} [options.processContent] - The callback used to process a reference's content
 * @param {resultCallback} [done] - The result callback
 *
 * @throws Error if the arguments are missing or invalid
 *
 * @returns {Promise} The promise.
 *
 * @example
 * // Example using callbacks
 *
 * JsonRefs.resolveRefs({
 *   name: 'json-refs',
 *   owner: {
 *     $ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'
 *   }
 * }, function (err, resolved, metadata) {
 *   if (err) throw err;
 *
 *   console.log(JSON.stringify(resolved)); // {name: 'json-refs', owner: { ... }}
 *   console.log(JSON.stringify(metadata)); // {'#/owner': {ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'}}
 * });
 *
 * @example
 * // Example using promises
 *
 * JsonRefs.resolveRefs({
 *   name: 'json-refs',
 *   owner: {
 *     $ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'
 *   }
 * }).then(function (results) {
 *   console.log(JSON.stringify(results.resolved)); // {name: 'json-refs', owner: { ... }}
 *   console.log(JSON.stringify(results.metadata)); // {'#/owner': {ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'}}
 * });
 *
 * @example
 * // Example using options.prepareRequest (to add authentication credentials) and options.processContent (to process YAML)
 *
 * JsonRefs.resolveRefs({
 *   name: 'json-refs',
 *   owner: {
 *     $ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'
 *   }
 * }, {
 *   prepareRequest: function (req) {
 *     // Add the 'Basic Authentication' credentials
 *     req.auth('whitlockjc', 'MY_GITHUB_PASSWORD');
 *
 *     // Add the 'X-API-Key' header for an API Key based authentication
 *     // req.set('X-API-Key', 'MY_API_KEY');
 *   },
 *   processContent: function (content) {
 *     return YAML.parse(content);
 *   }
 * }).then(function (results) {
 *   console.log(JSON.stringify(results.resolved)); // {name: 'json-refs', owner: { ... }}
 *   console.log(JSON.stringify(results.metadata)); // {'#/owner': {ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'}}
 * });
 */
module.exports.resolveRefs = function resolveRefs (json, options, done) {
  var allTasks = Promise.resolve();

  if (arguments.length === 2) {
    if (_.isFunction(options)) {
      done = options;
      options = {};
    }
  }

  if (_.isUndefined(options)) {
    options = {};
  }

  allTasks = allTasks.then(function () {
    if (_.isUndefined(json)) {
      throw new Error('json is required');
    } else if (!_.isArray(json) && !_.isPlainObject(json)) {
      throw new Error('json must be an array or an object');
    } else if (!_.isPlainObject(options)) {
      throw new Error('options must be an object');
    } else if (!_.isUndefined(done) && !_.isFunction(done)) {
      throw new Error('done must be a function');
    }

    // Validate the options (This option does not apply to )
    if (!_.isUndefined(options.processContent) && !_.isFunction(options.processContent)) {
      throw new Error('options.processContent must be a function');
    } else if (!_.isUndefined(options.prepareRequest) && !_.isFunction(options.prepareRequest)) {
      throw new Error('options.prepareRequest must be a function');
    } else if (!_.isUndefined(options.location) && !_.isString(options.location)) {
      throw new Error('options.location must be a string');
    } else if (!_.isUndefined(options.depth) && !_.isNumber(options.depth)) {
      throw new Error('options.depth must be a number');
    } else if (!_.isUndefined(options.depth) && options.depth < 0) {
      throw new Error('options.depth must be greater or equal to zero');
    } else if (!_.isUndefined(options.resolveLocalRefs) && !_.isBoolean(options.resolveLocalRefs)) {
      throw new Error('options.resolveLocalRefs must be a boolean');
    } else if (!_.isUndefined(options.resolveRemoteRefs) && !_.isBoolean(options.resolveRemoteRefs)) {
      throw new Error('options.resolveRemoteRefs must be a boolean');
    } else if (!_.isUndefined(options.resolveFileRefs) && !_.isBoolean(options.resolveFileRefs)) {
      throw new Error('options.resolveFileRefs must be a boolean');
    }
  });

  // Clone the inputs so we do not alter them
  json = traverse(json).clone();
  options = traverse(options).clone();

  allTasks = allTasks
    .then(function () {
      return resolveRemoteRefs(json, options, '#', {}, {});
    })
    .then(function (metadata) {
      return realResolveRefs(metadata.resolved, options, metadata.metadata);
    });

  // Use the callback if provided and it is a function
  if (!_.isUndefined(done) && _.isFunction(done)) {
    allTasks = allTasks
      .then(function (results) {
        done(undefined, results.resolved, results.metadata);
      }, function (err) {
        done(err);
      });
  }

  return allTasks;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./lib/utils":2,"native-promise-only":3}],2:[function(require,module,exports){
(function (global){
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

// This is a simple wrapper for Lodash functions but using simple ES5 and existing required dependencies
// (cloneDeep uses traverse for example).  The reason for this was a much smaller file size.  All exported functions
// match map to a lodash equivalent.

var traverse = (typeof window !== "undefined" ? window['traverse'] : typeof global !== "undefined" ? global['traverse'] : null);

function isType (obj, type) {
  return Object.prototype.toString.call(obj) === '[object ' + type + ']';
}

module.exports.cloneDeep = function (obj) {
  return traverse(obj).clone();
};

var isArray = module.exports.isArray = function (obj) {
  return isType(obj, 'Array');
};

module.exports.isBoolean = function (obj) {
  return isType(obj, 'Boolean');
};

module.exports.isError = function (obj) {
  return isType(obj, 'Error');
};

module.exports.isFunction = function (obj) {
  return isType(obj, 'Function');
};

module.exports.isNumber = function (obj) {
  return isType(obj, 'Number');
};

var isPlainObject = module.exports.isPlainObject = function (obj) {
  return isType(obj, 'Object');
};

module.exports.isString = function (obj) {
  return isType(obj, 'String');
};

module.exports.isUndefined = function (obj) {
  // Commented out due to PhantomJS bug (https://github.com/ariya/phantomjs/issues/11722)
  // return isType(obj, 'Undefined');
  return typeof obj === 'undefined';
};

module.exports.each = function (source, handler) {
  if (isArray(source)) {
    source.forEach(handler);
  } else if (isPlainObject(source)) {
    Object.keys(source).forEach(function (key) {
      handler(source[key], key);
    });
  }
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],3:[function(require,module,exports){
(function (global){
/*! Native Promise Only
    v0.8.0-a (c) Kyle Simpson
    MIT License: http://getify.mit-license.org
*/
!function(t,n,e){n[t]=n[t]||e(),"undefined"!=typeof module&&module.exports?module.exports=n[t]:"function"==typeof define&&define.amd&&define(function(){return n[t]})}("Promise","undefined"!=typeof global?global:this,function(){"use strict";function t(t,n){l.add(t,n),h||(h=y(l.drain))}function n(t){var n,e=typeof t;return null==t||"object"!=e&&"function"!=e||(n=t.then),"function"==typeof n?n:!1}function e(){for(var t=0;t<this.chain.length;t++)o(this,1===this.state?this.chain[t].success:this.chain[t].failure,this.chain[t]);this.chain.length=0}function o(t,e,o){var r,i;try{e===!1?o.reject(t.msg):(r=e===!0?t.msg:e.call(void 0,t.msg),r===o.promise?o.reject(TypeError("Promise-chain cycle")):(i=n(r))?i.call(r,o.resolve,o.reject):o.resolve(r))}catch(c){o.reject(c)}}function r(o){var c,u=this;if(!u.triggered){u.triggered=!0,u.def&&(u=u.def);try{(c=n(o))?t(function(){var t=new f(u);try{c.call(o,function(){r.apply(t,arguments)},function(){i.apply(t,arguments)})}catch(n){i.call(t,n)}}):(u.msg=o,u.state=1,u.chain.length>0&&t(e,u))}catch(a){i.call(new f(u),a)}}}function i(n){var o=this;o.triggered||(o.triggered=!0,o.def&&(o=o.def),o.msg=n,o.state=2,o.chain.length>0&&t(e,o))}function c(t,n,e,o){for(var r=0;r<n.length;r++)!function(r){t.resolve(n[r]).then(function(t){e(r,t)},o)}(r)}function f(t){this.def=t,this.triggered=!1}function u(t){this.promise=t,this.state=0,this.triggered=!1,this.chain=[],this.msg=void 0}function a(n){if("function"!=typeof n)throw TypeError("Not a function");if(0!==this.__NPO__)throw TypeError("Not a promise");this.__NPO__=1;var o=new u(this);this.then=function(n,r){var i={success:"function"==typeof n?n:!0,failure:"function"==typeof r?r:!1};return i.promise=new this.constructor(function(t,n){if("function"!=typeof t||"function"!=typeof n)throw TypeError("Not a function");i.resolve=t,i.reject=n}),o.chain.push(i),0!==o.state&&t(e,o),i.promise},this["catch"]=function(t){return this.then(void 0,t)};try{n.call(void 0,function(t){r.call(o,t)},function(t){i.call(o,t)})}catch(c){i.call(o,c)}}var s,h,l,p=Object.prototype.toString,y="undefined"!=typeof setImmediate?function(t){return setImmediate(t)}:setTimeout;try{Object.defineProperty({},"x",{}),s=function(t,n,e,o){return Object.defineProperty(t,n,{value:e,writable:!0,configurable:o!==!1})}}catch(d){s=function(t,n,e){return t[n]=e,t}}l=function(){function t(t,n){this.fn=t,this.self=n,this.next=void 0}var n,e,o;return{add:function(r,i){o=new t(r,i),e?e.next=o:n=o,e=o,o=void 0},drain:function(){var t=n;for(n=e=h=void 0;t;)t.fn.call(t.self),t=t.next}}}();var g=s({},"constructor",a,!1);return a.prototype=g,s(g,"__NPO__",0,!1),s(a,"resolve",function(t){var n=this;return t&&"object"==typeof t&&1===t.__NPO__?t:new n(function(n,e){if("function"!=typeof n||"function"!=typeof e)throw TypeError("Not a function");n(t)})}),s(a,"reject",function(t){return new this(function(n,e){if("function"!=typeof n||"function"!=typeof e)throw TypeError("Not a function");e(t)})}),s(a,"all",function(t){var n=this;return"[object Array]"!=p.call(t)?n.reject(TypeError("Not an array")):0===t.length?n.resolve([]):new n(function(e,o){if("function"!=typeof e||"function"!=typeof o)throw TypeError("Not a function");var r=t.length,i=Array(r),f=0;c(n,t,function(t,n){i[t]=n,++f===r&&e(i)},o)})}),s(a,"race",function(t){var n=this;return"[object Array]"!=p.call(t)?n.reject(TypeError("Not an array")):new n(function(e,o){if("function"!=typeof e||"function"!=typeof o)throw TypeError("Not a function");c(n,t,function(t,n){e(n)},o)})}),a});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi91dGlscy5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L25wby5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDdnVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDbkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vLyBMb2FkIHByb21pc2VzIHBvbHlmaWxsIGlmIG5lY2Vzc2FyeVxuaWYgKHR5cGVvZiBQcm9taXNlID09PSAndW5kZWZpbmVkJykge1xuICByZXF1aXJlKCduYXRpdmUtcHJvbWlzZS1vbmx5Jyk7XG59XG5cbnZhciBfID0gcmVxdWlyZSgnLi9saWIvdXRpbHMnKTtcbnZhciBwYXRoTG9hZGVyID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ1BhdGhMb2FkZXInXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ1BhdGhMb2FkZXInXSA6IG51bGwpO1xudmFyIHRyYXZlcnNlID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ3RyYXZlcnNlJ10gOiB0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsWyd0cmF2ZXJzZSddIDogbnVsbCk7XG5cbnZhciByZW1vdGVDYWNoZSA9IHt9O1xudmFyIHN1cHBvcnRlZFNjaGVtZXMgPSBbJ2ZpbGUnLCAnaHR0cCcsICdodHRwcyddO1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgYnkge0BsaW5rIHJlc29sdmVSZWZzfS5cbiAqXG4gKiBAcGFyYW0ge2Vycm9yfSBbZXJyXSAtIFRoZSBlcnJvciBpZiB0aGVyZSBpcyBhIHByb2JsZW1cbiAqIEBwYXJhbSB7b2JqZWN0fSBbcmVzb2x2ZWRdIC0gVGhlIHJlc29sdmVkIHJlc3VsdHNcbiAqIEBwYXJhbSB7b2JqZWN0fSBbbWV0YWRhdGFdIC0gVGhlIHJlZmVyZW5jZSByZXNvbHV0aW9uIG1ldGFkYXRhLiAgKihUaGUga2V5IGEgSlNPTiBQb2ludGVyIHRvIGEgcGF0aCBpbiB0aGUgcmVzb2x2ZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQgd2hlcmUgYSBKU09OIFJlZmVyZW5jZSB3YXMgZGVyZWZlcmVuY2VkLiAgVGhlIHZhbHVlIGlzIGFsc28gYW4gb2JqZWN0LiAgRXZlcnlcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YWRhdGEgZW50cnkgaGFzIGEgYHJlZmAgcHJvcGVydHkgdG8gdGVsbCB5b3Ugd2hlcmUgdGhlIGRlcmVmZXJlbmNlZCB2YWx1ZSBjYW1lIGZyb20uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIElmIHRoZXJlIGlzIGFuIGBlcnJgIHByb3BlcnR5LCBpdCBpcyB0aGUgYEVycm9yYCBvYmplY3QgZW5jb3VudGVyZWQgcmV0cmlldmluZyB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmZXJlbmNlZCB2YWx1ZS4gIElmIHRoZXJlIGlzIGEgYG1pc3NpbmdgIHByb3BlcnR5LCBpdCBtZWFucyB0aGUgcmVmZXJlbmNlZCB2YWx1ZSBjb3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBub3QgYmUgcmVzb2x2ZWQuKSpcbiAqXG4gKiBAY2FsbGJhY2sgcmVzdWx0Q2FsbGJhY2tcbiAqL1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgdG8gcHJvdmlkZSBhY2Nlc3MgdG8gYWx0ZXJpbmcgYSByZW1vdGUgcmVxdWVzdCBwcmlvciB0byB0aGUgcmVxdWVzdCBiZWluZyBtYWRlLlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSByZXEgLSBUaGUgU3VwZXJhZ2VudCByZXF1ZXN0IG9iamVjdFxuICogQHBhcmFtIHtzdHJpbmd9IHJlZiAtIFRoZSByZWZlcmVuY2UgYmVpbmcgcmVzb2x2ZWQgKFdoZW4gYXBwbGljYWJsZSlcbiAqXG4gKiBAY2FsbGJhY2sgcHJlcGFyZVJlcXVlc3RDYWxsYmFja1xuICovXG5cbi8qKlxuICogQ2FsbGJhY2sgdXNlZCB0byBwcm9jZXNzIHRoZSBjb250ZW50IG9mIGEgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gVGhlIGNvbnRlbnQgbG9hZGVkIGZyb20gdGhlIGZpbGUvVVJMXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVmIC0gVGhlIHJlZmVyZW5jZSBzdHJpbmcgKFdoZW4gYXBwbGljYWJsZSlcbiAqIEBwYXJhbSB7b2JqZWN0fSBbcmVzXSAtIFRoZSBTdXBlcmFnZW50IHJlc3BvbnNlIG9iamVjdCAoRm9yIHJlbW90ZSBVUkwgcmVxdWVzdHMgb25seSlcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBUaGUgSmF2YVNjcmlwdCBvYmplY3QgcmVwcmVzZW50YXRpb24gb2YgdGhlIHJlZmVyZW5jZVxuICpcbiAqIEBjYWxsYmFjayBwcm9jZXNzQ29udGVudENhbGxiYWNrXG4gKi9cblxuLyogSW50ZXJuYWwgRnVuY3Rpb25zICovXG5cbi8qKlxuICogUmV0cmlldmVzIHRoZSBjb250ZW50IGF0IHRoZSBVUkwgYW5kIHJldHVybnMgaXRzIEpTT04gY29udGVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVGhlIFVSTCB0byByZXRyaWV2ZVxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBwYXNzZWQgdG8gcmVzb2x2ZVJlZnNcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZXJlIGlzIGEgcHJvYmxlbSBtYWtpbmcgdGhlIHJlcXVlc3Qgb3IgdGhlIGNvbnRlbnQgaXMgbm90IEpTT05cbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gVGhlIHByb21pc2VcbiAqL1xuZnVuY3Rpb24gZ2V0UmVtb3RlSnNvbiAodXJsLCBvcHRpb25zKSB7XG4gIHZhciBqc29uID0gcmVtb3RlQ2FjaGVbdXJsXTtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHZhciBzY2hlbWUgPSB1cmwuaW5kZXhPZignOicpID09PSAtMSA/IHVuZGVmaW5lZCA6IHVybC5zcGxpdCgnOicpWzBdO1xuXG4gIGlmICghXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4ganNvbjtcbiAgICB9KTtcbiAgfSBlbHNlIGlmIChzdXBwb3J0ZWRTY2hlbWVzLmluZGV4T2Yoc2NoZW1lKSA9PT0gLTEgJiYgIV8uaXNVbmRlZmluZWQoc2NoZW1lKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IEVycm9yKCdVbnN1cHBvcnRlZCByZW1vdGUgcmVmZXJlbmNlIHNjaGVtZTogJyArIHNjaGVtZSkpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGFsbFRhc2tzID0gcGF0aExvYWRlci5sb2FkKHVybCwgb3B0aW9ucyk7XG5cbiAgICBpZiAob3B0aW9ucy5wcm9jZXNzQ29udGVudCkge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uIChjb250ZW50KSB7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnByb2Nlc3NDb250ZW50KGNvbnRlbnQsIHVybCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKEpTT04ucGFyc2UpO1xuICAgIH1cblxuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAobkpzb24pIHtcbiAgICAgIHJlbW90ZUNhY2hlW3VybF0gPSBuSnNvbjtcblxuICAgICAgcmV0dXJuIG5Kc29uO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgY2xvbmVkIHZlcnNpb24gdG8gYXZvaWQgdXBkYXRpbmcgdGhlIGNhY2hlXG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAobkpzb24pIHtcbiAgICByZXR1cm4gXy5jbG9uZURlZXAobkpzb24pO1xuICB9KTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbi8qIEV4cG9ydGVkIEZ1bmN0aW9ucyAqL1xuXG4vKipcbiAqIENsZWFycyB0aGUgaW50ZXJuYWwgY2FjaGUgb2YgdXJsIC0+IEphdmFTY3JpcHQgb2JqZWN0IG1hcHBpbmdzIGJhc2VkIG9uIHByZXZpb3VzbHkgcmVzb2x2ZWQgcmVmZXJlbmNlcy5cbiAqL1xubW9kdWxlLmV4cG9ydHMuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uIGNsZWFyQ2FjaGUgKCkge1xuICByZW1vdGVDYWNoZSA9IHt9O1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSBvYmplY3QgcmVwcmVzZW50cyBhIEpTT04gUmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fHN0cmluZ30gW29ial0gLSBUaGUgb2JqZWN0IHRvIGNoZWNrXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgdGhlIGFyZ3VtZW50IGlzIGFuIG9iamVjdCBhbmQgaXRzICRyZWYgcHJvcGVydHkgaXMgYSBzdHJpbmcgYW5kIGZhbHNlIG90aGVyd2lzZVxuICovXG52YXIgaXNKc29uUmVmZXJlbmNlID0gbW9kdWxlLmV4cG9ydHMuaXNKc29uUmVmZXJlbmNlID0gZnVuY3Rpb24gaXNKc29uUmVmZXJlbmNlIChvYmopIHtcbiAgLy8gVE9ETzogQWRkIGNoZWNrIHRoYXQgdGhlIHZhbHVlIGlzIGEgdmFsaWQgSlNPTiBQb2ludGVyXG4gIHJldHVybiBfLmlzUGxhaW5PYmplY3Qob2JqKSAmJiBfLmlzU3RyaW5nKG9iai4kcmVmKTtcbn07XG5cbi8qKlxuICogVGFrZXMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cyBhbmQgY3JlYXRlcyBhIEpTT04gUG9pbnRlciBmcm9tIGl0LlxuICpcbiAqIEBzZWUge0BsaW5rIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDF9XG4gKlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFRoZSBwYXRoIHNlZ21lbnRzXG4gKlxuICogQHJldHVybnMge3N0cmluZ30gQSBKU09OIFBvaW50ZXIgYmFzZWQgb24gdGhlIHBhdGggc2VnbWVudHNcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICovXG52YXIgcGF0aFRvUG9pbnRlciA9IG1vZHVsZS5leHBvcnRzLnBhdGhUb1BvaW50ZXIgPSBmdW5jdGlvbiBwYXRoVG9Qb2ludGVyIChwYXRoKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwYXRoIGlzIHJlcXVpcmVkJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNBcnJheShwYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncGF0aCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gIH1cblxuICB2YXIgcHRyID0gJyMnO1xuXG4gIGlmIChwYXRoLmxlbmd0aCA+IDApIHtcbiAgICBwdHIgKz0gJy8nICsgcGF0aC5tYXAoZnVuY3Rpb24gKHBhcnQpIHtcbiAgICAgIHJldHVybiBwYXJ0LnJlcGxhY2UoL34vZywgJ34wJykucmVwbGFjZSgvXFwvL2csICd+MScpO1xuICAgIH0pLmpvaW4oJy8nKTtcbiAgfVxuXG4gIHJldHVybiBwdHI7XG59O1xuXG4vKipcbiAqIEZpbmQgYWxsIEpTT04gUmVmZXJlbmNlcyBpbiB0aGUgZG9jdW1lbnQuXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtcGJyeWFuLXp5cC1qc29uLXJlZi0wMyNzZWN0aW9uLTN9XG4gKlxuICogQHBhcmFtIHthcnJheXxvYmplY3R9IGpzb24gLSBUaGUgSlNPTiBkb2N1bWVudCB0byBmaW5kIHJlZmVyZW5jZXMgaW5cbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBBbiBvYmplY3Qgd2hvc2Uga2V5cyBhcmUgSlNPTiBQb2ludGVycyB0byB0aGUgJyRyZWYnIG5vZGUgb2YgdGhlIEpTT04gUmVmZXJlbmNlXG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIGZpbmRSZWZzID0gbW9kdWxlLmV4cG9ydHMuZmluZFJlZnMgPSBmdW5jdGlvbiBmaW5kUmVmcyAoanNvbikge1xuICBpZiAoXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignanNvbiBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzQXJyYXkoanNvbikgJiYgIV8uaXNQbGFpbk9iamVjdChqc29uKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignanNvbiBtdXN0IGJlIGFuIGFycmF5IG9yIGFuIG9iamVjdCcpO1xuICB9XG5cbiAgcmV0dXJuIHRyYXZlcnNlKGpzb24pLnJlZHVjZShmdW5jdGlvbiAoYWNjKSB7XG4gICAgdmFyIHZhbCA9IHRoaXMubm9kZTtcblxuICAgIGlmICh0aGlzLmtleSA9PT0gJyRyZWYnICYmIGlzSnNvblJlZmVyZW5jZSh0aGlzLnBhcmVudC5ub2RlKSkge1xuICAgICAgYWNjW3BhdGhUb1BvaW50ZXIodGhpcy5wYXRoKV0gPSB2YWw7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjYztcbiAgfSwge30pO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSBKU09OIFBvaW50ZXIgaXMgYSByZW1vdGUgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgdGhlIEpTT04gUG9pbnRlciBpcyByZW1vdGUgb3IgZmFsc2UgaWYgbm90XG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIGlzUmVtb3RlUG9pbnRlciA9IG1vZHVsZS5leHBvcnRzLmlzUmVtb3RlUG9pbnRlciA9IGZ1bmN0aW9uIGlzUmVtb3RlUG9pbnRlciAocHRyKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzU3RyaW5nKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gIH1cblxuICAvLyBXZSB0cmVhdCBhbnl0aGluZyBvdGhlciB0aGFuIGxvY2FsLCB2YWxpZCBKU09OIFBvaW50ZXIgdmFsdWVzIGFzIHJlbW90ZVxuICByZXR1cm4gcHRyICE9PSAnJyAmJiBwdHIuY2hhckF0KDApICE9PSAnIyc7XG59O1xuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIEpTT04gUG9pbnRlciBpcyBhIGZpbGUgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgdGhlIEpTT04gUG9pbnRlciBpcyBhIGZpbGUgb3IgZmFsc2UgaWYgbm90XG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIGlzRmlsZVBvaW50ZXIgPSBtb2R1bGUuZXhwb3J0cy5pc0ZpbGVQb2ludGVyID0gZnVuY3Rpb24gaXNGaWxlUG9pbnRlciAocHRyKSB7XG4gIC8vIFRoZSBzZXQgb2YgZmlsZSBwb2ludGVycyBpcyBhIHN1YnNldCBvZiB0aGUgc2V0IG9mIHJlbW90ZSBwb2ludGVycyB3aXRob3V0IHNjaGVtZSBwcmVmaXhcbiAgcmV0dXJuIGlzUmVtb3RlUG9pbnRlcihwdHIpICYmICEoL15bYS16QS1aXSs6XFwvXFwvLy50ZXN0KHB0cikpO1xufTtcblxuLyoqXG4gKiBUYWtlcyBhIEpTT04gUmVmZXJlbmNlIGFuZCByZXR1cm5zIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMuXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjkwMX1cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHRyIC0gVGhlIEpTT04gUG9pbnRlciBmb3IgdGhlIEpTT04gUmVmZXJlbmNlXG4gKlxuICogQHJldHVybnMge3N0cmluZ1tdfSBBbiBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIG9yIHRoZSBwYXNzZWQgaW4gc3RyaW5nIGlmIGl0IGlzIGEgcmVtb3RlIHJlZmVyZW5jZVxuICpcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdGhlIGFyZ3VtZW50cyBhcmUgbWlzc2luZyBvciBpbnZhbGlkXG4gKi9cbnZhciBwYXRoRnJvbVBvaW50ZXIgPSBtb2R1bGUuZXhwb3J0cy5wYXRoRnJvbVBvaW50ZXIgPSBmdW5jdGlvbiBwYXRoRnJvbVBvaW50ZXIgKHB0cikge1xuICBpZiAoXy5pc1VuZGVmaW5lZChwdHIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgaXMgcmVxdWlyZWQnKTtcbiAgfSBlbHNlIGlmICghXy5pc1N0cmluZyhwdHIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdHIgbXVzdCBiZSBhIHN0cmluZycpO1xuICB9XG5cbiAgdmFyIHBhdGggPSBbXTtcbiAgdmFyIHJvb3RQYXRocyA9IFsnJywgJyMnLCAnIy8nXTtcblxuICBpZiAoaXNSZW1vdGVQb2ludGVyKHB0cikpIHtcbiAgICBwYXRoID0gcHRyO1xuICB9IGVsc2Uge1xuICAgIGlmIChyb290UGF0aHMuaW5kZXhPZihwdHIpID09PSAtMSAmJiBwdHIuY2hhckF0KDApID09PSAnIycpIHtcbiAgICAgIHBhdGggPSBwdHIuc3Vic3RyaW5nKHB0ci5pbmRleE9mKCcvJykpLnNwbGl0KCcvJykucmVkdWNlKGZ1bmN0aW9uIChwYXJ0cywgcGFydCkge1xuICAgICAgICBpZiAocGFydCAhPT0gJycpIHtcbiAgICAgICAgICBwYXJ0cy5wdXNoKHBhcnQucmVwbGFjZSgvfjAvZywgJ34nKS5yZXBsYWNlKC9+MS9nLCAnLycpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwYXJ0cztcbiAgICAgIH0sIFtdKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcGF0aDtcbn07XG5cbmZ1bmN0aW9uIGNvbWJpbmVSZWZzIChiYXNlLCByZWYpIHtcbiAgdmFyIGJhc2VQYXRoID0gcGF0aEZyb21Qb2ludGVyKGJhc2UpO1xuXG4gIGlmIChpc1JlbW90ZVBvaW50ZXIocmVmKSkge1xuICAgIGlmIChyZWYuaW5kZXhPZignIycpID09PSAtMSkge1xuICAgICAgcmVmID0gJyMnO1xuICAgIH0gZWxzZSB7XG4gICAgICByZWYgPSByZWYuc3Vic3RyaW5nKHJlZi5pbmRleE9mKCcjJykpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXRoVG9Qb2ludGVyKGJhc2VQYXRoLmNvbmNhdChwYXRoRnJvbVBvaW50ZXIocmVmKSkpLnJlcGxhY2UoL1xcL1xcJHJlZi9nLCAnJyk7XG59XG5cbmZ1bmN0aW9uIGNvbXB1dGVVcmwgKGJhc2UsIHJlZikge1xuICB2YXIgaXNSZWxhdGl2ZSA9IHJlZi5jaGFyQXQoMCkgIT09ICcjJyAmJiByZWYuaW5kZXhPZignOicpID09PSAtMTtcbiAgdmFyIG5ld0xvY2F0aW9uID0gW107XG4gIHZhciByZWZTZWdtZW50cyA9IChyZWYuaW5kZXhPZignIycpID4gLTEgPyByZWYuc3BsaXQoJyMnKVswXSA6IHJlZikuc3BsaXQoJy8nKTtcblxuICBmdW5jdGlvbiBzZWdtZW50SGFuZGxlciAoc2VnbWVudCkge1xuICAgIGlmIChzZWdtZW50ID09PSAnLi4nKSB7XG4gICAgICBuZXdMb2NhdGlvbi5wb3AoKTtcbiAgICB9IGVsc2UgaWYgKHNlZ21lbnQgIT09ICcuJykge1xuICAgICAgbmV3TG9jYXRpb24ucHVzaChzZWdtZW50KTtcbiAgICB9XG4gIH1cblxuICBpZiAoYmFzZSkge1xuICAgIC8vIFJlbW92ZSBoYXNoXG4gICAgaWYgKGJhc2UuaW5kZXhPZignIycpID4gLTEpIHtcbiAgICAgIGJhc2UgPSBiYXNlLnN1YnN0cmluZygwLCBiYXNlLmluZGV4T2YoJyMnKSk7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIHRyYWlsaW5nIHNsYXNoXG4gICAgaWYgKGJhc2UubGVuZ3RoID4gMSAmJiBiYXNlW2Jhc2UubGVuZ3RoIC0gMV0gPT09ICcvJykge1xuICAgICAgYmFzZSA9IGJhc2Uuc3Vic3RyaW5nKDAsIGJhc2UubGVuZ3RoIC0gMSk7XG4gICAgfVxuXG4gICAgLy8gTm9ybWFsaXplIHRoZSBiYXNlXG4gICAgYmFzZS5zcGxpdCgnIycpWzBdLnNwbGl0KCcvJykuZm9yRWFjaChzZWdtZW50SGFuZGxlcik7XG4gIH1cblxuICBpZiAoaXNSZWxhdGl2ZSkge1xuICAgIC8vIEFkZCByZWZlcmVuY2Ugc2VnbWVudHNcbiAgICByZWZTZWdtZW50cy5mb3JFYWNoKHNlZ21lbnRIYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBuZXdMb2NhdGlvbiA9IHJlZlNlZ21lbnRzO1xuICB9XG5cbiAgcmV0dXJuIG5ld0xvY2F0aW9uLmpvaW4oJy8nKTtcbn1cblxuZnVuY3Rpb24gcmVhbFJlc29sdmVSZWZzIChqc29uLCBvcHRpb25zLCBtZXRhZGF0YSkge1xuICB2YXIgZGVwdGggPSBfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZGVwdGgpID8gMSA6IG9wdGlvbnMuZGVwdGg7XG4gIHZhciBqc29uVCA9IHRyYXZlcnNlKGpzb24pO1xuXG4gIGZ1bmN0aW9uIGZpbmRQYXJlbnRSZWZlcmVuY2UgKHBhdGgpIHtcbiAgICB2YXIgcFBhdGggPSBwYXRoLnNsaWNlKDAsIHBhdGgubGFzdEluZGV4T2YoJ2FsbE9mJykpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3BhdGhUb1BvaW50ZXIocFBhdGgpXTtcblxuICAgIGlmICghXy5pc1VuZGVmaW5lZChyZWZNZXRhZGF0YSkpIHtcbiAgICAgIHJldHVybiBwYXRoVG9Qb2ludGVyKHBQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHBQYXRoLmluZGV4T2YoJ2FsbE9mJykgPiAtMSkge1xuICAgICAgICByZXR1cm4gZmluZFBhcmVudFJlZmVyZW5jZShwUGF0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZpeENpcmN1bGFycyAockpzb25UKSB7XG4gICAgdmFyIGNpcmN1bGFyUHRycyA9IFtdO1xuICAgIHZhciBzY3J1YmJlZCA9IHJKc29uVC5tYXAoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIHB0ciA9IHBhdGhUb1BvaW50ZXIodGhpcy5wYXRoKTtcbiAgICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3B0cl07XG4gICAgICB2YXIgcFB0cjtcblxuICAgICAgaWYgKHRoaXMuY2lyY3VsYXIpIHtcbiAgICAgICAgY2lyY3VsYXJQdHJzLnB1c2gocHRyKTtcblxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChyZWZNZXRhZGF0YSkpIHtcbiAgICAgICAgICAvLyBUaGlzIG11c3QgYmUgY2lyY3VsYXIgY29tcG9zaXRpb24vaW5oZXJpdGFuY2VcbiAgICAgICAgICBwUHRyID0gZmluZFBhcmVudFJlZmVyZW5jZSh0aGlzLnBhdGgpO1xuICAgICAgICAgIHJlZk1ldGFkYXRhID0gbWV0YWRhdGFbcFB0cl07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWZlcmVuY2UgbWV0YWRhdGEgY2FuIGJlIHVuZGVmaW5lZCBmb3IgcmVmZXJlbmNlcyB0byBzY2hlbWFzIHRoYXQgaGF2ZSBjaXJjdWxhciBjb21wb3NpdGlvbi9pbmhlcml0YW5jZSBhbmRcbiAgICAgICAgLy8gYXJlIHNhZmVseSBpZ25vcmVhYmxlLlxuICAgICAgICBpZiAoIV8uaXNVbmRlZmluZWQocmVmTWV0YWRhdGEpKSB7XG4gICAgICAgICAgcmVmTWV0YWRhdGEuY2lyY3VsYXIgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGUoe30pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudXBkYXRlKHRyYXZlcnNlKHRoaXMubm9kZSkubWFwKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmNpcmN1bGFyKSB7XG4gICAgICAgICAgICAgIHRoaXMucGFyZW50LnVwZGF0ZSh7fSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBSZXBsYWNlIHNjcnViYmVkIGNpcmN1bGFycyBiYXNlZCBvbiBkZXB0aFxuICAgIF8uZWFjaChjaXJjdWxhclB0cnMsIGZ1bmN0aW9uIChwdHIpIHtcbiAgICAgIHZhciBkZXB0aFBhdGggPSBbXTtcbiAgICAgIHZhciBwYXRoID0gcGF0aEZyb21Qb2ludGVyKHB0cik7XG4gICAgICB2YXIgdmFsdWUgPSB0cmF2ZXJzZShzY3J1YmJlZCkuZ2V0KHBhdGgpO1xuICAgICAgdmFyIGk7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBkZXB0aDsgaSsrKSB7XG4gICAgICAgIGRlcHRoUGF0aC5wdXNoLmFwcGx5KGRlcHRoUGF0aCwgcGF0aCk7XG5cbiAgICAgICAgdHJhdmVyc2Uoc2NydWJiZWQpLnNldChkZXB0aFBhdGgsIF8uY2xvbmVEZWVwKHZhbHVlKSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gc2NydWJiZWQ7XG4gIH1cblxuICBmdW5jdGlvbiByZXBsYWNlUmVmZXJlbmNlIChyZWYsIHJlZlB0cikge1xuICAgIHZhciByZWZNZXRhZGF0YUtleSA9IGNvbWJpbmVSZWZzKHJlZlB0ciwgJyMnKTtcbiAgICB2YXIgbG9jYWxSZWYgPSByZWYgPSByZWYuaW5kZXhPZignIycpID09PSAtMSA/XG4gICAgICAgICAgJyMnIDpcbiAgICAgICAgICByZWYuc3Vic3RyaW5nKHJlZi5pbmRleE9mKCcjJykpO1xuICAgIHZhciBsb2NhbFBhdGggPSBwYXRoRnJvbVBvaW50ZXIobG9jYWxSZWYpO1xuICAgIHZhciBtaXNzaW5nID0gIWpzb25ULmhhcyhsb2NhbFBhdGgpO1xuICAgIHZhciB2YWx1ZSA9IGpzb25ULmdldChsb2NhbFBhdGgpO1xuICAgIHZhciByZWZQdHJQYXRoID0gcGF0aEZyb21Qb2ludGVyKHJlZlB0cik7XG4gICAgdmFyIHBhcmVudFBhdGggPSByZWZQdHJQYXRoLnNsaWNlKDAsIHJlZlB0clBhdGgubGVuZ3RoIC0gMSk7XG4gICAgdmFyIHJlZk1ldGFkYXRhID0gbWV0YWRhdGFbcmVmTWV0YWRhdGFLZXldIHx8IHtcbiAgICAgIHJlZjogcmVmXG4gICAgfTtcblxuICAgIGlmICghbWlzc2luZykge1xuICAgICAgaWYgKHBhcmVudFBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIFNlbGYgcmVmZXJlbmNlcyBhcmUgc3BlY2lhbFxuICAgICAgICBpZiAoanNvblQudmFsdWUgPT09IHZhbHVlKSB7XG4gICAgICAgICAgdmFsdWUgPSB7fTtcblxuICAgICAgICAgIHJlZk1ldGFkYXRhLmNpcmN1bGFyID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpzb25ULnZhbHVlID0gdmFsdWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoanNvblQuZ2V0KHBhcmVudFBhdGgpID09PSB2YWx1ZSkge1xuICAgICAgICAgIHZhbHVlID0ge307XG5cbiAgICAgICAgICByZWZNZXRhZGF0YS5jaXJjdWxhciA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBqc29uVC5zZXQocGFyZW50UGF0aCwgdmFsdWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZWZNZXRhZGF0YS5taXNzaW5nID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBtZXRhZGF0YVtyZWZNZXRhZGF0YUtleV0gPSByZWZNZXRhZGF0YTtcbiAgfVxuXG4gIC8vIEFsbCByZWZlcmVuY2VzIGF0IHRoaXMgcG9pbnQgc2hvdWxkIGJlIGxvY2FsIGV4Y2VwdCBtaXNzaW5nL2ludmFsaWQgcmVmZXJlbmNlc1xuICBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zLnJlc29sdmVMb2NhbFJlZnMpIHx8IG9wdGlvbnMucmVzb2x2ZUxvY2FsUmVmcykge1xuICAgIF8uZWFjaChmaW5kUmVmcyhqc29uKSwgZnVuY3Rpb24gKHJlZiwgcmVmUHRyKSB7XG4gICAgICBpZiAoIWlzUmVtb3RlUG9pbnRlcihyZWYpKSB7XG4gICAgICAgIHJlcGxhY2VSZWZlcmVuY2UocmVmLCByZWZQdHIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gUmVtb3ZlIGZ1bGwgbG9jYXRpb25zIGZyb20gcmVmZXJlbmNlIG1ldGFkYXRhXG4gIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmxvY2F0aW9uKSkge1xuICAgIF8uZWFjaChtZXRhZGF0YSwgZnVuY3Rpb24gKHJlZk1ldGFkYXRhKSB7XG4gICAgICB2YXIgbm9ybWFsaXplZFB0ciA9IHJlZk1ldGFkYXRhLnJlZjtcblxuICAgICAgLy8gUmVtb3ZlIHRoZSBiYXNlIHdoZW4gYXBwbGljYWJsZVxuICAgICAgaWYgKG5vcm1hbGl6ZWRQdHIuaW5kZXhPZihvcHRpb25zLmxvY2F0aW9uKSA9PT0gMCkge1xuICAgICAgICBub3JtYWxpemVkUHRyID0gbm9ybWFsaXplZFB0ci5zdWJzdHJpbmcob3B0aW9ucy5sb2NhdGlvbi5sZW5ndGgpO1xuXG4gICAgICAgIC8vIFJlbW92ZSB0aGUgLyBwcmVmaXhcbiAgICAgICAgaWYgKG5vcm1hbGl6ZWRQdHIuY2hhckF0KDApID09PSAnLycpIHtcbiAgICAgICAgICBub3JtYWxpemVkUHRyID0gbm9ybWFsaXplZFB0ci5zdWJzdHJpbmcoMSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmVmTWV0YWRhdGEucmVmID0gbm9ybWFsaXplZFB0cjtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEZpeCBjaXJjdWxhcnNcbiAgcmV0dXJuIHtcbiAgICBtZXRhZGF0YTogbWV0YWRhdGEsXG4gICAgcmVzb2x2ZWQ6IGZpeENpcmN1bGFycyhqc29uVClcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlbW90ZVJlZnMgKGpzb24sIG9wdGlvbnMsIHBhcmVudFB0ciwgcGFyZW50cywgbWV0YWRhdGEpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHZhciBqc29uVCA9IHRyYXZlcnNlKGpzb24pO1xuXG4gIGZ1bmN0aW9uIHJlcGxhY2VSZW1vdGVSZWYgKHJlZlB0ciwgcHRyLCByZW1vdGVMb2NhdGlvbiwgcmVtb3RlUHRyLCByZXNvbHZlZCkge1xuICAgIHZhciBub3JtYWxpemVkUHRyID0gcmVtb3RlTG9jYXRpb24gKyAocmVtb3RlUHRyID09PSAnIycgPyAnJyA6IHJlbW90ZVB0cik7XG4gICAgdmFyIHJlZk1ldGFkYXRhS2V5ID0gY29tYmluZVJlZnMocGFyZW50UHRyLCByZWZQdHIpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3JlZk1ldGFkYXRhS2V5XSB8fCB7fTtcbiAgICB2YXIgcmVmUGF0aCA9IHBhdGhGcm9tUG9pbnRlcihyZWZQdHIpO1xuICAgIHZhciB2YWx1ZTtcblxuICAgIHJlZk1ldGFkYXRhLnJlbW90ZSA9IHRydWU7XG5cbiAgICBpZiAoXy5pc1VuZGVmaW5lZChyZXNvbHZlZCkpIHtcbiAgICAgIHJlZk1ldGFkYXRhLmNpcmN1bGFyID0gdHJ1ZTtcblxuICAgICAgLy8gVXNlIHRoZSBwYXJlbnQgcmVmZXJlbmNlIGxvb2NhdGlvblxuICAgICAgdmFsdWUgPSBwYXJlbnRzW3JlbW90ZUxvY2F0aW9uXS5yZWY7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEdldCB0aGUgcmVtb3RlIHZhbHVlXG4gICAgICB2YWx1ZSA9IHRyYXZlcnNlKHJlc29sdmVkKS5nZXQocGF0aEZyb21Qb2ludGVyKHJlbW90ZVB0cikpO1xuXG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZCh2YWx1ZSkpIHtcbiAgICAgICAgcmVmTWV0YWRhdGEubWlzc2luZyA9IHRydWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZiB0aGUgcmVtb3RlIHZhbHVlIGlzIGl0c2VsZiBhIHJlZmVyZW5jZSwgdXBkYXRlIHRoZSByZWZlcmVuY2UgdG8gYmUgcmVwbGFjZWQgd2l0aCBpdHMgcmVmZXJlbmNlIHZhbHVlLlxuICAgICAgICAvLyBPdGhlcndpc2UsIHJlcGxhY2UgdGhlIHJlbW90ZSByZWZlcmVuY2UuXG4gICAgICAgIGlmICh2YWx1ZS4kcmVmKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS4kcmVmO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlZlBhdGgucG9wKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDb2xsYXBzZSBzZWxmIHJlZmVyZW5jZXNcbiAgICBpZiAocmVmUGF0aC5sZW5ndGggPT09IDApIHtcbiAgICAgIGpzb25ULnZhbHVlID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGpzb25ULnNldChyZWZQYXRoLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgcmVmTWV0YWRhdGEucmVmID0gbm9ybWFsaXplZFB0cjtcblxuICAgIG1ldGFkYXRhW3JlZk1ldGFkYXRhS2V5XSA9IHJlZk1ldGFkYXRhO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVzb2x2ZXIgKCkge1xuICAgIHJldHVybiB7XG4gICAgICBtZXRhZGF0YTogbWV0YWRhdGEsXG4gICAgICByZXNvbHZlZDoganNvblQudmFsdWVcbiAgICB9O1xuICB9XG5cbiAgXy5lYWNoKGZpbmRSZWZzKGpzb24pLCBmdW5jdGlvbiAocHRyLCByZWZQdHIpIHtcbiAgICAvLyBVc2UgcmVzb2x2ZSBmaWx0ZXJzIGZyb20gb3B0aW9ucyB0byByZXNvbHZlL25vdCByZXNvbHZlIHJlZmVyZW5jZXNcbiAgICB2YXIgaXNGaWxlUHRyID0gaXNGaWxlUG9pbnRlcihwdHIpO1xuICAgIHZhciBpc1JlbW90ZVB0ciA9IGlzUmVtb3RlUG9pbnRlcihwdHIpO1xuXG4gICAgaWYgKChpc0ZpbGVQdHIgJiYgKF8uaXNVbmRlZmluZWQob3B0aW9ucy5yZXNvbHZlRmlsZVJlZnMpIHx8IG9wdGlvbnMucmVzb2x2ZUZpbGVSZWZzKSkgfHxcbiAgICAgICAgKCFpc0ZpbGVQdHIgJiYgaXNSZW1vdGVQdHIgJiYgKF8uaXNVbmRlZmluZWQob3B0aW9ucy5yZXNvbHZlUmVtb3RlUmVmcykgfHwgb3B0aW9ucy5yZXNvbHZlUmVtb3RlUmVmcykpKSB7XG4gICAgICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcmVtb3RlTG9jYXRpb24gPSBjb21wdXRlVXJsKG9wdGlvbnMubG9jYXRpb24sIHB0cik7XG4gICAgICAgIHZhciByZWZQYXJ0cyA9IHB0ci5zcGxpdCgnIycpO1xuICAgICAgICB2YXIgaGFzaCA9ICcjJyArIChyZWZQYXJ0c1sxXSB8fCAnJyk7XG5cbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQocGFyZW50c1tyZW1vdGVMb2NhdGlvbl0pKSB7XG4gICAgICAgICAgcmV0dXJuIGdldFJlbW90ZUpzb24ocmVtb3RlTG9jYXRpb24sIG9wdGlvbnMpXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocmVtb3RlSnNvbikge1xuICAgICAgICAgICAgICByZXR1cm4gcmVtb3RlSnNvbjtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGVycjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgdmFyIHJlZkJhc2UgPSByZWZQYXJ0c1swXTtcbiAgICAgICAgICAgICAgdmFyIHJPcHRpb25zID0gXy5jbG9uZURlZXAob3B0aW9ucyk7XG4gICAgICAgICAgICAgIHZhciBuZXdQYXJlbnRQdHIgPSBjb21iaW5lUmVmcyhwYXJlbnRQdHIsIHJlZlB0cik7XG5cbiAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBsYXN0IHBhdGggc2VnbWVudFxuICAgICAgICAgICAgICByZWZCYXNlID0gcmVmQmFzZS5zdWJzdHJpbmcoMCwgcmVmQmFzZS5sYXN0SW5kZXhPZignLycpICsgMSk7XG5cbiAgICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSByZWN1cnNpdmUgbG9jYXRpb25cbiAgICAgICAgICAgICAgck9wdGlvbnMubG9jYXRpb24gPSBjb21wdXRlVXJsKG9wdGlvbnMubG9jYXRpb24sIHJlZkJhc2UpO1xuXG4gICAgICAgICAgICAgIGlmIChfLmlzRXJyb3IocmVzcG9uc2UpKSB7XG4gICAgICAgICAgICAgICAgbWV0YWRhdGFbbmV3UGFyZW50UHRyXSA9IHtcbiAgICAgICAgICAgICAgICAgIGVycjogcmVzcG9uc2UsXG4gICAgICAgICAgICAgICAgICBtaXNzaW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcmVmOiBwdHJcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIFJlY29yZCB0aGUgcGFyZW50XG4gICAgICAgICAgICAgICAgcGFyZW50c1tyZW1vdGVMb2NhdGlvbl0gPSB7XG4gICAgICAgICAgICAgICAgICByZWY6IHBhcmVudFB0clxuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIHJlbW90ZSByZWZlcmVuY2VzXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc29sdmVSZW1vdGVSZWZzKHJlc3BvbnNlLCByT3B0aW9ucywgbmV3UGFyZW50UHRyLCBwYXJlbnRzLCBtZXRhZGF0YSlcbiAgICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChyTWV0YWRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHBhcmVudHNbcmVtb3RlTG9jYXRpb25dO1xuXG4gICAgICAgICAgICAgICAgICAgIHJlcGxhY2VSZW1vdGVSZWYocmVmUHRyLCBwdHIsIHJlbW90ZUxvY2F0aW9uLCBoYXNoLCByTWV0YWRhdGEucmVzb2x2ZWQpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByTWV0YWRhdGE7XG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBhIGNpcmN1bGFyIHJlZmVyZW5jZVxuICAgICAgICAgIHJlcGxhY2VSZW1vdGVSZWYocmVmUHRyLCBwdHIsIHJlbW90ZUxvY2F0aW9uLCBoYXNoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmVhbFJlc29sdmVSZWZzKGpzb25ULnZhbHVlLCBvcHRpb25zLCBtZXRhZGF0YSk7XG4gICAgfSlcbiAgICAudGhlbihyZXNvbHZlciwgcmVzb2x2ZXIpO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyoqXG4gKiBUYWtlcyBhIEpTT04gZG9jdW1lbnQsIHJlc29sdmVzIGFsbCBKU09OIFJlZmVyZW5jZXMgYW5kIHJldHVybnMgYSBmdWxseSByZXNvbHZlZCBlcXVpdmFsZW50IGFsb25nIHdpdGggcmVmZXJlbmNlXG4gKiByZXNvbHV0aW9uIG1ldGFkYXRhLlxuICpcbiAqICoqSW1wb3J0YW50IERldGFpbHMqKlxuICpcbiAqICogVGhlIGlucHV0IGFyZ3VtZW50cyBhcmUgbmV2ZXIgYWx0ZXJlZFxuICogKiBXaGVuIHVzaW5nIHByb21pc2VzLCBvbmx5IG9uZSB2YWx1ZSBjYW4gYmUgcmVzb2x2ZWQgc28gaXQgaXMgYW4gb2JqZWN0IHdob3NlIGtleXMgYW5kIHZhbHVlcyBhcmUgdGhlIHNhbWUgbmFtZSBhbmRcbiAqICAgdmFsdWUgYXMgYXJndW1lbnRzIDEgYW5kIDIgZm9yIHtAbGluayByZXN1bHRDYWxsYmFja31cbiAqXG4gKiBAcGFyYW0ge2FycmF5fG9iamVjdH0ganNvbiAtIFRoZSBKU09OICBkb2N1bWVudCBoYXZpbmcgemVybyBvciBtb3JlIEpTT04gUmVmZXJlbmNlc1xuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFRoZSBvcHRpb25zIChBbGwgb3B0aW9ucyBhcmUgcGFzc2VkIGRvd24gdG8gd2hpdGxvY2tqYy9wYXRoLWxvYWRlcilcbiAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0aW9ucy5kZXB0aD0xXSAtIFRoZSBkZXB0aCB0byByZXNvbHZlIGNpcmN1bGFyIHJlZmVyZW5jZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5sb2NhdGlvbl0gLSBUaGUgbG9jYXRpb24gdG8gd2hpY2ggcmVsYXRpdmUgcmVmZXJlbmNlcyBzaG91bGQgYmUgcmVzb2x2ZWRcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMucmVzb2x2ZUxvY2FsUmVmcz10cnVlXSAtIFJlc29sdmUgbG9jYWwgcmVmZXJlbmNlc1xuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXNvbHZlUmVtb3RlUmVmcz10cnVlXSAtIFJlc29sdmUgcmVtb3RlIHJlZmVyZW5jZXNcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMucmVzb2x2ZUZpbGVSZWZzPXRydWVdIC0gUmVzb2x2ZSBmaWxlIHJlZmVyZW5jZXNcbiAqIEBwYXJhbSB7cHJlcGFyZVJlcXVlc3RDYWxsYmFja30gW29wdGlvbnMucHJlcGFyZVJlcXVlc3RdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJlcGFyZSBhbiBIVFRQIHJlcXVlc3RcbiAqIEBwYXJhbSB7cHJvY2Vzc0NvbnRlbnRDYWxsYmFja30gW29wdGlvbnMucHJvY2Vzc0NvbnRlbnRdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJvY2VzcyBhIHJlZmVyZW5jZSdzIGNvbnRlbnRcbiAqIEBwYXJhbSB7cmVzdWx0Q2FsbGJhY2t9IFtkb25lXSAtIFRoZSByZXN1bHQgY2FsbGJhY2tcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBUaGUgcHJvbWlzZS5cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBjYWxsYmFja3NcbiAqXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyh7XG4gKiAgIG5hbWU6ICdqc29uLXJlZnMnLFxuICogICBvd25lcjoge1xuICogICAgICRyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcidcbiAqICAgfVxuICogfSwgZnVuY3Rpb24gKGVyciwgcmVzb2x2ZWQsIG1ldGFkYXRhKSB7XG4gKiAgIGlmIChlcnIpIHRocm93IGVycjtcbiAqXG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KG1ldGFkYXRhKSk7IC8vIHsnIy9vd25lcic6IHtyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcid9fVxuICogfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgcHJvbWlzZXNcbiAqXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyh7XG4gKiAgIG5hbWU6ICdqc29uLXJlZnMnLFxuICogICBvd25lcjoge1xuICogICAgICRyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcidcbiAqICAgfVxuICogfSkudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLnJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdHMubWV0YWRhdGEpKTsgLy8geycjL293bmVyJzoge3JlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ319XG4gKiB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBvcHRpb25zLnByZXBhcmVSZXF1ZXN0ICh0byBhZGQgYXV0aGVudGljYXRpb24gY3JlZGVudGlhbHMpIGFuZCBvcHRpb25zLnByb2Nlc3NDb250ZW50ICh0byBwcm9jZXNzIFlBTUwpXG4gKlxuICogSnNvblJlZnMucmVzb2x2ZVJlZnMoe1xuICogICBuYW1lOiAnanNvbi1yZWZzJyxcbiAqICAgb3duZXI6IHtcbiAqICAgICAkcmVmOiAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL2pzb24tcmVmcyMvb3duZXInXG4gKiAgIH1cbiAqIH0sIHtcbiAqICAgcHJlcGFyZVJlcXVlc3Q6IGZ1bmN0aW9uIChyZXEpIHtcbiAqICAgICAvLyBBZGQgdGhlICdCYXNpYyBBdXRoZW50aWNhdGlvbicgY3JlZGVudGlhbHNcbiAqICAgICByZXEuYXV0aCgnd2hpdGxvY2tqYycsICdNWV9HSVRIVUJfUEFTU1dPUkQnKTtcbiAqXG4gKiAgICAgLy8gQWRkIHRoZSAnWC1BUEktS2V5JyBoZWFkZXIgZm9yIGFuIEFQSSBLZXkgYmFzZWQgYXV0aGVudGljYXRpb25cbiAqICAgICAvLyByZXEuc2V0KCdYLUFQSS1LZXknLCAnTVlfQVBJX0tFWScpO1xuICogICB9LFxuICogICBwcm9jZXNzQ29udGVudDogZnVuY3Rpb24gKGNvbnRlbnQpIHtcbiAqICAgICByZXR1cm4gWUFNTC5wYXJzZShjb250ZW50KTtcbiAqICAgfVxuICogfSkudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLnJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdHMubWV0YWRhdGEpKTsgLy8geycjL293bmVyJzoge3JlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ319XG4gKiB9KTtcbiAqL1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnMgPSBmdW5jdGlvbiByZXNvbHZlUmVmcyAoanNvbiwgb3B0aW9ucywgZG9uZSkge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMikge1xuICAgIGlmIChfLmlzRnVuY3Rpb24ob3B0aW9ucykpIHtcbiAgICAgIGRvbmUgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMpKSB7XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIGlzIHJlcXVpcmVkJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc0FycmF5KGpzb24pICYmICFfLmlzUGxhaW5PYmplY3QoanNvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignanNvbiBtdXN0IGJlIGFuIGFycmF5IG9yIGFuIG9iamVjdCcpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNQbGFpbk9iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zIG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChkb25lKSAmJiAhXy5pc0Z1bmN0aW9uKGRvbmUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2RvbmUgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgdGhlIG9wdGlvbnMgKFRoaXMgb3B0aW9uIGRvZXMgbm90IGFwcGx5IHRvIClcbiAgICBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5wcm9jZXNzQ29udGVudCkgJiYgIV8uaXNGdW5jdGlvbihvcHRpb25zLnByb2Nlc3NDb250ZW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zLnByb2Nlc3NDb250ZW50IG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5wcmVwYXJlUmVxdWVzdCkgJiYgIV8uaXNGdW5jdGlvbihvcHRpb25zLnByZXBhcmVSZXF1ZXN0KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zLnByZXBhcmVSZXF1ZXN0IG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5sb2NhdGlvbikgJiYgIV8uaXNTdHJpbmcob3B0aW9ucy5sb2NhdGlvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5sb2NhdGlvbiBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmRlcHRoKSAmJiAhXy5pc051bWJlcihvcHRpb25zLmRlcHRoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zLmRlcHRoIG11c3QgYmUgYSBudW1iZXInKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZGVwdGgpICYmIG9wdGlvbnMuZGVwdGggPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMuZGVwdGggbXVzdCBiZSBncmVhdGVyIG9yIGVxdWFsIHRvIHplcm8nKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucmVzb2x2ZUxvY2FsUmVmcykgJiYgIV8uaXNCb29sZWFuKG9wdGlvbnMucmVzb2x2ZUxvY2FsUmVmcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5yZXNvbHZlTG9jYWxSZWZzIG11c3QgYmUgYSBib29sZWFuJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLnJlc29sdmVSZW1vdGVSZWZzKSAmJiAhXy5pc0Jvb2xlYW4ob3B0aW9ucy5yZXNvbHZlUmVtb3RlUmVmcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5yZXNvbHZlUmVtb3RlUmVmcyBtdXN0IGJlIGEgYm9vbGVhbicpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5yZXNvbHZlRmlsZVJlZnMpICYmICFfLmlzQm9vbGVhbihvcHRpb25zLnJlc29sdmVGaWxlUmVmcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5yZXNvbHZlRmlsZVJlZnMgbXVzdCBiZSBhIGJvb2xlYW4nKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIENsb25lIHRoZSBpbnB1dHMgc28gd2UgZG8gbm90IGFsdGVyIHRoZW1cbiAganNvbiA9IHRyYXZlcnNlKGpzb24pLmNsb25lKCk7XG4gIG9wdGlvbnMgPSB0cmF2ZXJzZShvcHRpb25zKS5jbG9uZSgpO1xuXG4gIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gcmVzb2x2ZVJlbW90ZVJlZnMoanNvbiwgb3B0aW9ucywgJyMnLCB7fSwge30pO1xuICAgIH0pXG4gICAgLnRoZW4oZnVuY3Rpb24gKG1ldGFkYXRhKSB7XG4gICAgICByZXR1cm4gcmVhbFJlc29sdmVSZWZzKG1ldGFkYXRhLnJlc29sdmVkLCBvcHRpb25zLCBtZXRhZGF0YS5tZXRhZGF0YSk7XG4gICAgfSk7XG5cbiAgLy8gVXNlIHRoZSBjYWxsYmFjayBpZiBwcm92aWRlZCBhbmQgaXQgaXMgYSBmdW5jdGlvblxuICBpZiAoIV8uaXNVbmRlZmluZWQoZG9uZSkgJiYgXy5pc0Z1bmN0aW9uKGRvbmUpKSB7XG4gICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgLnRoZW4oZnVuY3Rpb24gKHJlc3VsdHMpIHtcbiAgICAgICAgZG9uZSh1bmRlZmluZWQsIHJlc3VsdHMucmVzb2x2ZWQsIHJlc3VsdHMubWV0YWRhdGEpO1xuICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICBkb25lKGVycik7XG4gICAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBhbGxUYXNrcztcbn07XG4iLCIvKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vLyBUaGlzIGlzIGEgc2ltcGxlIHdyYXBwZXIgZm9yIExvZGFzaCBmdW5jdGlvbnMgYnV0IHVzaW5nIHNpbXBsZSBFUzUgYW5kIGV4aXN0aW5nIHJlcXVpcmVkIGRlcGVuZGVuY2llc1xuLy8gKGNsb25lRGVlcCB1c2VzIHRyYXZlcnNlIGZvciBleGFtcGxlKS4gIFRoZSByZWFzb24gZm9yIHRoaXMgd2FzIGEgbXVjaCBzbWFsbGVyIGZpbGUgc2l6ZS4gIEFsbCBleHBvcnRlZCBmdW5jdGlvbnNcbi8vIG1hdGNoIG1hcCB0byBhIGxvZGFzaCBlcXVpdmFsZW50LlxuXG52YXIgdHJhdmVyc2UgPSAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvd1sndHJhdmVyc2UnXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ3RyYXZlcnNlJ10gOiBudWxsKTtcblxuZnVuY3Rpb24gaXNUeXBlIChvYmosIHR5cGUpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCAnICsgdHlwZSArICddJztcbn1cblxubW9kdWxlLmV4cG9ydHMuY2xvbmVEZWVwID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gdHJhdmVyc2Uob2JqKS5jbG9uZSgpO1xufTtcblxudmFyIGlzQXJyYXkgPSBtb2R1bGUuZXhwb3J0cy5pc0FycmF5ID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0FycmF5Jyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc0Jvb2xlYW4gPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnQm9vbGVhbicpO1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNFcnJvciA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdFcnJvcicpO1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNGdW5jdGlvbiA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdGdW5jdGlvbicpO1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNOdW1iZXIgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnTnVtYmVyJyk7XG59O1xuXG52YXIgaXNQbGFpbk9iamVjdCA9IG1vZHVsZS5leHBvcnRzLmlzUGxhaW5PYmplY3QgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnT2JqZWN0Jyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc1N0cmluZyA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdTdHJpbmcnKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzVW5kZWZpbmVkID0gZnVuY3Rpb24gKG9iaikge1xuICAvLyBDb21tZW50ZWQgb3V0IGR1ZSB0byBQaGFudG9tSlMgYnVnIChodHRwczovL2dpdGh1Yi5jb20vYXJpeWEvcGhhbnRvbWpzL2lzc3Vlcy8xMTcyMilcbiAgLy8gcmV0dXJuIGlzVHlwZShvYmosICdVbmRlZmluZWQnKTtcbiAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICd1bmRlZmluZWQnO1xufTtcblxubW9kdWxlLmV4cG9ydHMuZWFjaCA9IGZ1bmN0aW9uIChzb3VyY2UsIGhhbmRsZXIpIHtcbiAgaWYgKGlzQXJyYXkoc291cmNlKSkge1xuICAgIHNvdXJjZS5mb3JFYWNoKGhhbmRsZXIpO1xuICB9IGVsc2UgaWYgKGlzUGxhaW5PYmplY3Qoc291cmNlKSkge1xuICAgIE9iamVjdC5rZXlzKHNvdXJjZSkuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBoYW5kbGVyKHNvdXJjZVtrZXldLCBrZXkpO1xuICAgIH0pO1xuICB9XG59O1xuIiwiLyohIE5hdGl2ZSBQcm9taXNlIE9ubHlcbiAgICB2MC44LjAtYSAoYykgS3lsZSBTaW1wc29uXG4gICAgTUlUIExpY2Vuc2U6IGh0dHA6Ly9nZXRpZnkubWl0LWxpY2Vuc2Uub3JnXG4qL1xuIWZ1bmN0aW9uKHQsbixlKXtuW3RdPW5bdF18fGUoKSxcInVuZGVmaW5lZFwiIT10eXBlb2YgbW9kdWxlJiZtb2R1bGUuZXhwb3J0cz9tb2R1bGUuZXhwb3J0cz1uW3RdOlwiZnVuY3Rpb25cIj09dHlwZW9mIGRlZmluZSYmZGVmaW5lLmFtZCYmZGVmaW5lKGZ1bmN0aW9uKCl7cmV0dXJuIG5bdF19KX0oXCJQcm9taXNlXCIsXCJ1bmRlZmluZWRcIiE9dHlwZW9mIGdsb2JhbD9nbG9iYWw6dGhpcyxmdW5jdGlvbigpe1widXNlIHN0cmljdFwiO2Z1bmN0aW9uIHQodCxuKXtsLmFkZCh0LG4pLGh8fChoPXkobC5kcmFpbikpfWZ1bmN0aW9uIG4odCl7dmFyIG4sZT10eXBlb2YgdDtyZXR1cm4gbnVsbD09dHx8XCJvYmplY3RcIiE9ZSYmXCJmdW5jdGlvblwiIT1lfHwobj10LnRoZW4pLFwiZnVuY3Rpb25cIj09dHlwZW9mIG4/bjohMX1mdW5jdGlvbiBlKCl7Zm9yKHZhciB0PTA7dDx0aGlzLmNoYWluLmxlbmd0aDt0Kyspbyh0aGlzLDE9PT10aGlzLnN0YXRlP3RoaXMuY2hhaW5bdF0uc3VjY2Vzczp0aGlzLmNoYWluW3RdLmZhaWx1cmUsdGhpcy5jaGFpblt0XSk7dGhpcy5jaGFpbi5sZW5ndGg9MH1mdW5jdGlvbiBvKHQsZSxvKXt2YXIgcixpO3RyeXtlPT09ITE/by5yZWplY3QodC5tc2cpOihyPWU9PT0hMD90Lm1zZzplLmNhbGwodm9pZCAwLHQubXNnKSxyPT09by5wcm9taXNlP28ucmVqZWN0KFR5cGVFcnJvcihcIlByb21pc2UtY2hhaW4gY3ljbGVcIikpOihpPW4ocikpP2kuY2FsbChyLG8ucmVzb2x2ZSxvLnJlamVjdCk6by5yZXNvbHZlKHIpKX1jYXRjaChjKXtvLnJlamVjdChjKX19ZnVuY3Rpb24gcihvKXt2YXIgYyx1PXRoaXM7aWYoIXUudHJpZ2dlcmVkKXt1LnRyaWdnZXJlZD0hMCx1LmRlZiYmKHU9dS5kZWYpO3RyeXsoYz1uKG8pKT90KGZ1bmN0aW9uKCl7dmFyIHQ9bmV3IGYodSk7dHJ5e2MuY2FsbChvLGZ1bmN0aW9uKCl7ci5hcHBseSh0LGFyZ3VtZW50cyl9LGZ1bmN0aW9uKCl7aS5hcHBseSh0LGFyZ3VtZW50cyl9KX1jYXRjaChuKXtpLmNhbGwodCxuKX19KToodS5tc2c9byx1LnN0YXRlPTEsdS5jaGFpbi5sZW5ndGg+MCYmdChlLHUpKX1jYXRjaChhKXtpLmNhbGwobmV3IGYodSksYSl9fX1mdW5jdGlvbiBpKG4pe3ZhciBvPXRoaXM7by50cmlnZ2VyZWR8fChvLnRyaWdnZXJlZD0hMCxvLmRlZiYmKG89by5kZWYpLG8ubXNnPW4sby5zdGF0ZT0yLG8uY2hhaW4ubGVuZ3RoPjAmJnQoZSxvKSl9ZnVuY3Rpb24gYyh0LG4sZSxvKXtmb3IodmFyIHI9MDtyPG4ubGVuZ3RoO3IrKykhZnVuY3Rpb24ocil7dC5yZXNvbHZlKG5bcl0pLnRoZW4oZnVuY3Rpb24odCl7ZShyLHQpfSxvKX0ocil9ZnVuY3Rpb24gZih0KXt0aGlzLmRlZj10LHRoaXMudHJpZ2dlcmVkPSExfWZ1bmN0aW9uIHUodCl7dGhpcy5wcm9taXNlPXQsdGhpcy5zdGF0ZT0wLHRoaXMudHJpZ2dlcmVkPSExLHRoaXMuY2hhaW49W10sdGhpcy5tc2c9dm9pZCAwfWZ1bmN0aW9uIGEobil7aWYoXCJmdW5jdGlvblwiIT10eXBlb2Ygbil0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtpZigwIT09dGhpcy5fX05QT19fKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIHByb21pc2VcIik7dGhpcy5fX05QT19fPTE7dmFyIG89bmV3IHUodGhpcyk7dGhpcy50aGVuPWZ1bmN0aW9uKG4scil7dmFyIGk9e3N1Y2Nlc3M6XCJmdW5jdGlvblwiPT10eXBlb2Ygbj9uOiEwLGZhaWx1cmU6XCJmdW5jdGlvblwiPT10eXBlb2Ygcj9yOiExfTtyZXR1cm4gaS5wcm9taXNlPW5ldyB0aGlzLmNvbnN0cnVjdG9yKGZ1bmN0aW9uKHQsbil7aWYoXCJmdW5jdGlvblwiIT10eXBlb2YgdHx8XCJmdW5jdGlvblwiIT10eXBlb2Ygbil0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtpLnJlc29sdmU9dCxpLnJlamVjdD1ufSksby5jaGFpbi5wdXNoKGkpLDAhPT1vLnN0YXRlJiZ0KGUsbyksaS5wcm9taXNlfSx0aGlzW1wiY2F0Y2hcIl09ZnVuY3Rpb24odCl7cmV0dXJuIHRoaXMudGhlbih2b2lkIDAsdCl9O3RyeXtuLmNhbGwodm9pZCAwLGZ1bmN0aW9uKHQpe3IuY2FsbChvLHQpfSxmdW5jdGlvbih0KXtpLmNhbGwobyx0KX0pfWNhdGNoKGMpe2kuY2FsbChvLGMpfX12YXIgcyxoLGwscD1PYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLHk9XCJ1bmRlZmluZWRcIiE9dHlwZW9mIHNldEltbWVkaWF0ZT9mdW5jdGlvbih0KXtyZXR1cm4gc2V0SW1tZWRpYXRlKHQpfTpzZXRUaW1lb3V0O3RyeXtPYmplY3QuZGVmaW5lUHJvcGVydHkoe30sXCJ4XCIse30pLHM9ZnVuY3Rpb24odCxuLGUsbyl7cmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0LG4se3ZhbHVlOmUsd3JpdGFibGU6ITAsY29uZmlndXJhYmxlOm8hPT0hMX0pfX1jYXRjaChkKXtzPWZ1bmN0aW9uKHQsbixlKXtyZXR1cm4gdFtuXT1lLHR9fWw9ZnVuY3Rpb24oKXtmdW5jdGlvbiB0KHQsbil7dGhpcy5mbj10LHRoaXMuc2VsZj1uLHRoaXMubmV4dD12b2lkIDB9dmFyIG4sZSxvO3JldHVybnthZGQ6ZnVuY3Rpb24ocixpKXtvPW5ldyB0KHIsaSksZT9lLm5leHQ9bzpuPW8sZT1vLG89dm9pZCAwfSxkcmFpbjpmdW5jdGlvbigpe3ZhciB0PW47Zm9yKG49ZT1oPXZvaWQgMDt0Oyl0LmZuLmNhbGwodC5zZWxmKSx0PXQubmV4dH19fSgpO3ZhciBnPXMoe30sXCJjb25zdHJ1Y3RvclwiLGEsITEpO3JldHVybiBhLnByb3RvdHlwZT1nLHMoZyxcIl9fTlBPX19cIiwwLCExKSxzKGEsXCJyZXNvbHZlXCIsZnVuY3Rpb24odCl7dmFyIG49dGhpcztyZXR1cm4gdCYmXCJvYmplY3RcIj09dHlwZW9mIHQmJjE9PT10Ll9fTlBPX18/dDpuZXcgbihmdW5jdGlvbihuLGUpe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIG58fFwiZnVuY3Rpb25cIiE9dHlwZW9mIGUpdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7bih0KX0pfSkscyhhLFwicmVqZWN0XCIsZnVuY3Rpb24odCl7cmV0dXJuIG5ldyB0aGlzKGZ1bmN0aW9uKG4sZSl7aWYoXCJmdW5jdGlvblwiIT10eXBlb2Ygbnx8XCJmdW5jdGlvblwiIT10eXBlb2YgZSl0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtlKHQpfSl9KSxzKGEsXCJhbGxcIixmdW5jdGlvbih0KXt2YXIgbj10aGlzO3JldHVyblwiW29iamVjdCBBcnJheV1cIiE9cC5jYWxsKHQpP24ucmVqZWN0KFR5cGVFcnJvcihcIk5vdCBhbiBhcnJheVwiKSk6MD09PXQubGVuZ3RoP24ucmVzb2x2ZShbXSk6bmV3IG4oZnVuY3Rpb24oZSxvKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBlfHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBvKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO3ZhciByPXQubGVuZ3RoLGk9QXJyYXkociksZj0wO2Mobix0LGZ1bmN0aW9uKHQsbil7aVt0XT1uLCsrZj09PXImJmUoaSl9LG8pfSl9KSxzKGEsXCJyYWNlXCIsZnVuY3Rpb24odCl7dmFyIG49dGhpcztyZXR1cm5cIltvYmplY3QgQXJyYXldXCIhPXAuY2FsbCh0KT9uLnJlamVjdChUeXBlRXJyb3IoXCJOb3QgYW4gYXJyYXlcIikpOm5ldyBuKGZ1bmN0aW9uKGUsbyl7aWYoXCJmdW5jdGlvblwiIT10eXBlb2YgZXx8XCJmdW5jdGlvblwiIT10eXBlb2Ygbyl0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtjKG4sdCxmdW5jdGlvbih0LG4pe2Uobil9LG8pfSl9KSxhfSk7XG4iXX0=
