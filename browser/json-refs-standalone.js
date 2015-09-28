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

// Load promises polyfill if necessary
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

var _ = require('./lib/utils');
var pathLoader = require('path-loader');
var traverse = require('traverse');

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
 * @param {object} json - The JSON document to find references in
 *
 * @returns {object} An object whose keys are JSON Pointers to the '$ref' node of the JSON Reference
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
  _.each(findRefs(json), function (ref, refPtr) {
    if (!isRemotePointer(ref)) {
      replaceReference(ref, refPtr);
    }
  });

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
    if (isRemotePointer(ptr)) {
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

              // Record the parent
              parents[remoteLocation] = {
                ref: parentPtr
              };

              if (_.isError(response)) {
                metadata[newParentPtr] = {
                  err: response,
                  missing: true,
                  ref: ptr
                };
              } else {
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
 * @param {object} json - The JSON  document having zero or more JSON References
 * @param {object} [options] - The options (All options are passed down to whitlockjc/path-loader)
 * @param {number} [options.depth=1] - The depth to resolve circular references
 * @param {string} [options.location] - The location to which relative references should be resolved
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
    } else if (!_.isPlainObject(json)) {
      throw new Error('json must be an object');
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

},{"./lib/utils":2,"native-promise-only":3,"path-loader":4,"traverse":10}],2:[function(require,module,exports){
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

var traverse = require('traverse');

function isType (obj, type) {
  return Object.prototype.toString.call(obj) === '[object ' + type + ']';
}

module.exports.cloneDeep = function (obj) {
  return traverse(obj).clone();
};

var isArray = module.exports.isArray = function (obj) {
  return isType(obj, 'Array');
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

},{"traverse":10}],3:[function(require,module,exports){
(function (global){
/*! Native Promise Only
    v0.8.0-a (c) Kyle Simpson
    MIT License: http://getify.mit-license.org
*/
!function(t,n,e){n[t]=n[t]||e(),"undefined"!=typeof module&&module.exports?module.exports=n[t]:"function"==typeof define&&define.amd&&define(function(){return n[t]})}("Promise","undefined"!=typeof global?global:this,function(){"use strict";function t(t,n){l.add(t,n),h||(h=y(l.drain))}function n(t){var n,e=typeof t;return null==t||"object"!=e&&"function"!=e||(n=t.then),"function"==typeof n?n:!1}function e(){for(var t=0;t<this.chain.length;t++)o(this,1===this.state?this.chain[t].success:this.chain[t].failure,this.chain[t]);this.chain.length=0}function o(t,e,o){var r,i;try{e===!1?o.reject(t.msg):(r=e===!0?t.msg:e.call(void 0,t.msg),r===o.promise?o.reject(TypeError("Promise-chain cycle")):(i=n(r))?i.call(r,o.resolve,o.reject):o.resolve(r))}catch(c){o.reject(c)}}function r(o){var c,u=this;if(!u.triggered){u.triggered=!0,u.def&&(u=u.def);try{(c=n(o))?t(function(){var t=new f(u);try{c.call(o,function(){r.apply(t,arguments)},function(){i.apply(t,arguments)})}catch(n){i.call(t,n)}}):(u.msg=o,u.state=1,u.chain.length>0&&t(e,u))}catch(a){i.call(new f(u),a)}}}function i(n){var o=this;o.triggered||(o.triggered=!0,o.def&&(o=o.def),o.msg=n,o.state=2,o.chain.length>0&&t(e,o))}function c(t,n,e,o){for(var r=0;r<n.length;r++)!function(r){t.resolve(n[r]).then(function(t){e(r,t)},o)}(r)}function f(t){this.def=t,this.triggered=!1}function u(t){this.promise=t,this.state=0,this.triggered=!1,this.chain=[],this.msg=void 0}function a(n){if("function"!=typeof n)throw TypeError("Not a function");if(0!==this.__NPO__)throw TypeError("Not a promise");this.__NPO__=1;var o=new u(this);this.then=function(n,r){var i={success:"function"==typeof n?n:!0,failure:"function"==typeof r?r:!1};return i.promise=new this.constructor(function(t,n){if("function"!=typeof t||"function"!=typeof n)throw TypeError("Not a function");i.resolve=t,i.reject=n}),o.chain.push(i),0!==o.state&&t(e,o),i.promise},this["catch"]=function(t){return this.then(void 0,t)};try{n.call(void 0,function(t){r.call(o,t)},function(t){i.call(o,t)})}catch(c){i.call(o,c)}}var s,h,l,p=Object.prototype.toString,y="undefined"!=typeof setImmediate?function(t){return setImmediate(t)}:setTimeout;try{Object.defineProperty({},"x",{}),s=function(t,n,e,o){return Object.defineProperty(t,n,{value:e,writable:!0,configurable:o!==!1})}}catch(d){s=function(t,n,e){return t[n]=e,t}}l=function(){function t(t,n){this.fn=t,this.self=n,this.next=void 0}var n,e,o;return{add:function(r,i){o=new t(r,i),e?e.next=o:n=o,e=o,o=void 0},drain:function(){var t=n;for(n=e=h=void 0;t;)t.fn.call(t.self),t=t.next}}}();var g=s({},"constructor",a,!1);return a.prototype=g,s(g,"__NPO__",0,!1),s(a,"resolve",function(t){var n=this;return t&&"object"==typeof t&&1===t.__NPO__?t:new n(function(n,e){if("function"!=typeof n||"function"!=typeof e)throw TypeError("Not a function");n(t)})}),s(a,"reject",function(t){return new this(function(n,e){if("function"!=typeof n||"function"!=typeof e)throw TypeError("Not a function");e(t)})}),s(a,"all",function(t){var n=this;return"[object Array]"!=p.call(t)?n.reject(TypeError("Not an array")):0===t.length?n.resolve([]):new n(function(e,o){if("function"!=typeof e||"function"!=typeof o)throw TypeError("Not a function");var r=t.length,i=Array(r),f=0;c(n,t,function(t,n){i[t]=n,++f===r&&e(i)},o)})}),s(a,"race",function(t){var n=this;return"[object Array]"!=p.call(t)?n.reject(TypeError("Not an array")):new n(function(e,o){if("function"!=typeof e||"function"!=typeof o)throw TypeError("Not a function");c(n,t,function(t,n){e(n)},o)})}),a});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],4:[function(require,module,exports){
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

var supportedLoaders = {
  file: require('./lib/loaders/file'),
  http: require('./lib/loaders/http'),
  https: require('./lib/loaders/http')
};
var defaultLoader = typeof window === 'object' || typeof importScripts === 'function' ?
      supportedLoaders.http :
      supportedLoaders.file;

// Load promises polyfill if necessary
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

/**
 * Error-first callback.
 *
 * @param {error} [err] - The error if there is a problem
 * @param {string} [result] - The result of the function
 *
 * @callback resultCallback
 */

/**
 * Callback used to provide access to altering a remote request prior to the request being made.
 *
 * @param {object} req - The Superagent request object
 * @param {string} location - The location being retrieved
 *
 * @callback prepareRequestCallback
 */

/**
 * Returns the loader for the given location.
 *
 * @param {string} location - The location to load
 *
 * @returns {object} The loader to use
 */
function getLoader (location) {
  return supportedLoaders[location.split(':')[0]] || defaultLoader;
}

/**
 * Loads a document at the provided location and returns a JavaScript object representation.
 *
 * @param {object} location - The location to the document
 * @param {object} [options] - The options
 * @param {prepareRequestCallback} [options.prepareRequest] - The callback used to prepare the request
 * @param {resultCallback} done - The result callback
 *
 * @returns {Promise} Always returns a promise even if there is a callback provided
 *
 * @example
 * // Example using callbacks
 *
 * PathLoader
 *   .load('./package.json', function (err, document) {
 *     if (err) {
 *       console.error(err.stack);
 *     } else {
 *       try {
 *         document = JSON.parse(document)
 *         console.log(document.name + ' (' + document.version + '): ' + document.description);
 *       } catch (err2) {
 *         callback(err2);
 *       }
 *     });
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
 *     prepareRequest: function (req) {
 *       req.auth('my-username', 'my-password')
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
 */
module.exports.load = function (location, options, done) {
  var allTasks = Promise.resolve();

  if (arguments.length === 2 && typeof options === 'function') {
    done = options;
    options = undefined;
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
      }
    } else {
      options = {};
    }

    if (typeof done !== 'undefined' && typeof done !== 'function') {
      throw new TypeError('callback must be a function');
    }
  });

  // Load the document from the provided location and process it
  allTasks = allTasks.then(function () {
    return new Promise(function (resolve, reject) {
      var loader = getLoader(location);

      loader.load(location, options, function (err, document) {
        if (err) {
          reject(err);
        } else {
          resolve(document);
        }
      });
    });
  });

  // Use the callback if provided and it is a function
  if (typeof done === 'function') {
    allTasks = allTasks
      .then(function (document) {
        done(undefined, document);
      }, function (err) {
        done(err);
      });
  }

  return allTasks;
};

},{"./lib/loaders/file":5,"./lib/loaders/http":6,"native-promise-only":3}],5:[function(require,module,exports){
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
 * Loads a file from the filesystem.
 *
 * @param {string} location - The filesystem location (If relative, location is relative to process.cwd()).
 * @param {object} options - The loader options (Unused)
 * @param {function} callback - The error-first callback
 */
module.exports.load = function (location, options, callback) {
  callback(new TypeError('The \'file\' scheme is not supported in the browser'));
};

},{}],6:[function(require,module,exports){
/*eslint-env node, browser */

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
 * @param {string} location - The document URL (If relative, location is relative to window.location).
 * @param {object} options - The loader options
 * @param {string} [options.method=get] - The HTTP method to use for the request
 * @param {prepareRequestCallback} [options.prepareRequest] - The callback used to prepare a request
 * @param {function} callback - The error-first callback
 */
module.exports.load = function (location, options, callback) {
  var realUrl = location.split('#')[0];
  var realMethod = options.method ? options.method.toLowerCase() : 'get';
  var err;
  var realRequest;

  if (typeof options.prepareRequest !== 'undefined' && typeof options.prepareRequest !== 'function') {
    err = new TypeError('options.prepareRequest must be a function');
  } else if (typeof options.method !== 'undefined') {
    if (typeof options.method !== 'string') {
      err = new TypeError('options.method must be a string');
    } else if (supportedHttpMethods.indexOf(options.method) === -1) {
      err = new TypeError('options.method must be one of the following: ' +
        supportedHttpMethods.slice(0, supportedHttpMethods.length - 1).join(', ') + ' or ' +
        supportedHttpMethods[supportedHttpMethods.length - 1]);
    }
  }

  if (!err) {
    realRequest = request[realMethod === 'delete' ? 'del' : realMethod](realUrl);

    if (options.prepareRequest) {
      options.prepareRequest(realRequest);
    }

    // buffer() is only available in Node.js
    if (typeof realRequest.buffer === 'function') {
      realRequest.buffer(true);
    }

    realRequest
      .end(function (err2, res) {
        callback(err2, res ? res.text : res);
      });
  } else {
    callback(err);
  }
};

},{"superagent":7}],7:[function(require,module,exports){
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
      pairs.push(encodeURIComponent(key)
        + '=' + encodeURIComponent(obj[key]));
    }
  }
  return pairs.join('&');
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
 * Force given parser
 * 
 * Sets the body parser no matter type.
 * 
 * @param {Function}
 * @api public
 */

Response.prototype.parse = function(fn){
  this.parser = fn;
  return this;
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
  var parse = this.parser || request.parse[this.type];
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
  this._formData.append(field, file, filename);
  return this;
};

/**
 * Send `data`, defaulting the `.type()` to "json" when
 * an object is given.
 *
 * Examples:
 *
 *       // querystring
 *       request.get('/search')
 *         .end(callback)
 *
 *       // multiple data "writes"
 *       request.get('/search')
 *         .send({ search: 'query' })
 *         .send({ range: '1..5' })
 *         .send({ order: 'desc' })
 *         .end(callback)
 *
 *       // manual json
 *       request.post('/user')
 *         .type('json')
 *         .send('{"name":"tj"})
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
  var err = new Error('Origin is not allowed by Access-Control-Allow-Origin');
  err.crossDomain = true;
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
    var serialize = request.serialize[contentType ? contentType.split(';')[0] : ''];
    if (serialize) data = serialize(data);
  }

  // set header fields
  for (var field in this.header) {
    if (null == this.header[field]) continue;
    xhr.setRequestHeader(field, this.header[field]);
  }

  // send stuff
  this.emit('request', this);
  xhr.send(data);
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

request.del = function(url, fn){
  var req = request('DELETE', url);
  if (fn) req.end(fn);
  return req;
};

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

},{"emitter":8,"reduce":9}],8:[function(require,module,exports){

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
  (this._callbacks[event] = this._callbacks[event] || [])
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
  var self = this;
  this._callbacks = this._callbacks || {};

  function on() {
    self.off(event, on);
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
  var callbacks = this._callbacks[event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks[event];
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
    , callbacks = this._callbacks[event];

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
  return this._callbacks[event] || [];
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

},{}],9:[function(require,module,exports){

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
},{}],10:[function(require,module,exports){
var traverse = module.exports = function (obj) {
    return new Traverse(obj);
};

function Traverse (obj) {
    this.value = obj;
}

Traverse.prototype.get = function (ps) {
    var node = this.value;
    for (var i = 0; i < ps.length; i ++) {
        var key = ps[i];
        if (!node || !hasOwnProperty.call(node, key)) {
            node = undefined;
            break;
        }
        node = node[key];
    }
    return node;
};

Traverse.prototype.has = function (ps) {
    var node = this.value;
    for (var i = 0; i < ps.length; i ++) {
        var key = ps[i];
        if (!node || !hasOwnProperty.call(node, key)) {
            return false;
        }
        node = node[key];
    }
    return true;
};

Traverse.prototype.set = function (ps, value) {
    var node = this.value;
    for (var i = 0; i < ps.length - 1; i ++) {
        var key = ps[i];
        if (!hasOwnProperty.call(node, key)) node[key] = {};
        node = node[key];
    }
    node[ps[i]] = value;
    return value;
};

Traverse.prototype.map = function (cb) {
    return walk(this.value, cb, true);
};

Traverse.prototype.forEach = function (cb) {
    this.value = walk(this.value, cb, false);
    return this.value;
};

Traverse.prototype.reduce = function (cb, init) {
    var skip = arguments.length === 1;
    var acc = skip ? this.value : init;
    this.forEach(function (x) {
        if (!this.isRoot || !skip) {
            acc = cb.call(this, acc, x);
        }
    });
    return acc;
};

Traverse.prototype.paths = function () {
    var acc = [];
    this.forEach(function (x) {
        acc.push(this.path); 
    });
    return acc;
};

Traverse.prototype.nodes = function () {
    var acc = [];
    this.forEach(function (x) {
        acc.push(this.node);
    });
    return acc;
};

Traverse.prototype.clone = function () {
    var parents = [], nodes = [];
    
    return (function clone (src) {
        for (var i = 0; i < parents.length; i++) {
            if (parents[i] === src) {
                return nodes[i];
            }
        }
        
        if (typeof src === 'object' && src !== null) {
            var dst = copy(src);
            
            parents.push(src);
            nodes.push(dst);
            
            forEach(objectKeys(src), function (key) {
                dst[key] = clone(src[key]);
            });
            
            parents.pop();
            nodes.pop();
            return dst;
        }
        else {
            return src;
        }
    })(this.value);
};

function walk (root, cb, immutable) {
    var path = [];
    var parents = [];
    var alive = true;
    
    return (function walker (node_) {
        var node = immutable ? copy(node_) : node_;
        var modifiers = {};
        
        var keepGoing = true;
        
        var state = {
            node : node,
            node_ : node_,
            path : [].concat(path),
            parent : parents[parents.length - 1],
            parents : parents,
            key : path.slice(-1)[0],
            isRoot : path.length === 0,
            level : path.length,
            circular : null,
            update : function (x, stopHere) {
                if (!state.isRoot) {
                    state.parent.node[state.key] = x;
                }
                state.node = x;
                if (stopHere) keepGoing = false;
            },
            'delete' : function (stopHere) {
                delete state.parent.node[state.key];
                if (stopHere) keepGoing = false;
            },
            remove : function (stopHere) {
                if (isArray(state.parent.node)) {
                    state.parent.node.splice(state.key, 1);
                }
                else {
                    delete state.parent.node[state.key];
                }
                if (stopHere) keepGoing = false;
            },
            keys : null,
            before : function (f) { modifiers.before = f },
            after : function (f) { modifiers.after = f },
            pre : function (f) { modifiers.pre = f },
            post : function (f) { modifiers.post = f },
            stop : function () { alive = false },
            block : function () { keepGoing = false }
        };
        
        if (!alive) return state;
        
        function updateState() {
            if (typeof state.node === 'object' && state.node !== null) {
                if (!state.keys || state.node_ !== state.node) {
                    state.keys = objectKeys(state.node)
                }
                
                state.isLeaf = state.keys.length == 0;
                
                for (var i = 0; i < parents.length; i++) {
                    if (parents[i].node_ === node_) {
                        state.circular = parents[i];
                        break;
                    }
                }
            }
            else {
                state.isLeaf = true;
                state.keys = null;
            }
            
            state.notLeaf = !state.isLeaf;
            state.notRoot = !state.isRoot;
        }
        
        updateState();
        
        // use return values to update if defined
        var ret = cb.call(state, state.node);
        if (ret !== undefined && state.update) state.update(ret);
        
        if (modifiers.before) modifiers.before.call(state, state.node);
        
        if (!keepGoing) return state;
        
        if (typeof state.node == 'object'
        && state.node !== null && !state.circular) {
            parents.push(state);
            
            updateState();
            
            forEach(state.keys, function (key, i) {
                path.push(key);
                
                if (modifiers.pre) modifiers.pre.call(state, state.node[key], key);
                
                var child = walker(state.node[key]);
                if (immutable && hasOwnProperty.call(state.node, key)) {
                    state.node[key] = child.node;
                }
                
                child.isLast = i == state.keys.length - 1;
                child.isFirst = i == 0;
                
                if (modifiers.post) modifiers.post.call(state, child);
                
                path.pop();
            });
            parents.pop();
        }
        
        if (modifiers.after) modifiers.after.call(state, state.node);
        
        return state;
    })(root).node;
}

function copy (src) {
    if (typeof src === 'object' && src !== null) {
        var dst;
        
        if (isArray(src)) {
            dst = [];
        }
        else if (isDate(src)) {
            dst = new Date(src.getTime ? src.getTime() : src);
        }
        else if (isRegExp(src)) {
            dst = new RegExp(src);
        }
        else if (isError(src)) {
            dst = { message: src.message };
        }
        else if (isBoolean(src)) {
            dst = new Boolean(src);
        }
        else if (isNumber(src)) {
            dst = new Number(src);
        }
        else if (isString(src)) {
            dst = new String(src);
        }
        else if (Object.create && Object.getPrototypeOf) {
            dst = Object.create(Object.getPrototypeOf(src));
        }
        else if (src.constructor === Object) {
            dst = {};
        }
        else {
            var proto =
                (src.constructor && src.constructor.prototype)
                || src.__proto__
                || {}
            ;
            var T = function () {};
            T.prototype = proto;
            dst = new T;
        }
        
        forEach(objectKeys(src), function (key) {
            dst[key] = src[key];
        });
        return dst;
    }
    else return src;
}

var objectKeys = Object.keys || function keys (obj) {
    var res = [];
    for (var key in obj) res.push(key)
    return res;
};

function toS (obj) { return Object.prototype.toString.call(obj) }
function isDate (obj) { return toS(obj) === '[object Date]' }
function isRegExp (obj) { return toS(obj) === '[object RegExp]' }
function isError (obj) { return toS(obj) === '[object Error]' }
function isBoolean (obj) { return toS(obj) === '[object Boolean]' }
function isNumber (obj) { return toS(obj) === '[object Number]' }
function isString (obj) { return toS(obj) === '[object String]' }

var isArray = Array.isArray || function isArray (xs) {
    return Object.prototype.toString.call(xs) === '[object Array]';
};

var forEach = function (xs, fn) {
    if (xs.forEach) return xs.forEach(fn)
    else for (var i = 0; i < xs.length; i++) {
        fn(xs[i], i, xs);
    }
};

forEach(objectKeys(Traverse.prototype), function (key) {
    traverse[key] = function (obj) {
        var args = [].slice.call(arguments, 1);
        var t = new Traverse(obj);
        return t[key].apply(t, args);
    };
});

var hasOwnProperty = Object.hasOwnProperty || function (obj, key) {
    return key in obj;
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi91dGlscy5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L25wby5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9saWIvbG9hZGVycy9maWxlLWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcGF0aC1sb2FkZXIvbGliL2xvYWRlcnMvaHR0cC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9ub2RlX21vZHVsZXMvc3VwZXJhZ2VudC9saWIvY2xpZW50LmpzIiwibm9kZV9tb2R1bGVzL3BhdGgtbG9hZGVyL25vZGVfbW9kdWxlcy9zdXBlcmFnZW50L25vZGVfbW9kdWxlcy9jb21wb25lbnQtZW1pdHRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9ub2RlX21vZHVsZXMvc3VwZXJhZ2VudC9ub2RlX21vZHVsZXMvcmVkdWNlLWNvbXBvbmVudC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy90cmF2ZXJzZS9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDL0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyb0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNCBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuLy8gTG9hZCBwcm9taXNlcyBwb2x5ZmlsbCBpZiBuZWNlc3NhcnlcbmlmICh0eXBlb2YgUHJvbWlzZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgcmVxdWlyZSgnbmF0aXZlLXByb21pc2Utb25seScpO1xufVxuXG52YXIgXyA9IHJlcXVpcmUoJy4vbGliL3V0aWxzJyk7XG52YXIgcGF0aExvYWRlciA9IHJlcXVpcmUoJ3BhdGgtbG9hZGVyJyk7XG52YXIgdHJhdmVyc2UgPSByZXF1aXJlKCd0cmF2ZXJzZScpO1xuXG52YXIgcmVtb3RlQ2FjaGUgPSB7fTtcbnZhciBzdXBwb3J0ZWRTY2hlbWVzID0gWydmaWxlJywgJ2h0dHAnLCAnaHR0cHMnXTtcblxuLyoqXG4gKiBDYWxsYmFjayB1c2VkIGJ5IHtAbGluayByZXNvbHZlUmVmc30uXG4gKlxuICogQHBhcmFtIHtlcnJvcn0gW2Vycl0gLSBUaGUgZXJyb3IgaWYgdGhlcmUgaXMgYSBwcm9ibGVtXG4gKiBAcGFyYW0ge29iamVjdH0gW3Jlc29sdmVkXSAtIFRoZSByZXNvbHZlZCByZXN1bHRzXG4gKiBAcGFyYW0ge29iamVjdH0gW21ldGFkYXRhXSAtIFRoZSByZWZlcmVuY2UgcmVzb2x1dGlvbiBtZXRhZGF0YS4gICooVGhlIGtleSBhIEpTT04gUG9pbnRlciB0byBhIHBhdGggaW4gdGhlIHJlc29sdmVkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvY3VtZW50IHdoZXJlIGEgSlNPTiBSZWZlcmVuY2Ugd2FzIGRlcmVmZXJlbmNlZC4gIFRoZSB2YWx1ZSBpcyBhbHNvIGFuIG9iamVjdC4gIEV2ZXJ5XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1ldGFkYXRhIGVudHJ5IGhhcyBhIGByZWZgIHByb3BlcnR5IHRvIHRlbGwgeW91IHdoZXJlIHRoZSBkZXJlZmVyZW5jZWQgdmFsdWUgY2FtZSBmcm9tLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBJZiB0aGVyZSBpcyBhbiBgZXJyYCBwcm9wZXJ0eSwgaXQgaXMgdGhlIGBFcnJvcmAgb2JqZWN0IGVuY291bnRlcmVkIHJldHJpZXZpbmcgdGhlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZmVyZW5jZWQgdmFsdWUuICBJZiB0aGVyZSBpcyBhIGBtaXNzaW5nYCBwcm9wZXJ0eSwgaXQgbWVhbnMgdGhlIHJlZmVyZW5jZWQgdmFsdWUgY291bGRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbm90IGJlIHJlc29sdmVkLikqXG4gKlxuICogQGNhbGxiYWNrIHJlc3VsdENhbGxiYWNrXG4gKi9cblxuLyoqXG4gKiBDYWxsYmFjayB1c2VkIHRvIHByb3ZpZGUgYWNjZXNzIHRvIGFsdGVyaW5nIGEgcmVtb3RlIHJlcXVlc3QgcHJpb3IgdG8gdGhlIHJlcXVlc3QgYmVpbmcgbWFkZS5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gcmVxIC0gVGhlIFN1cGVyYWdlbnQgcmVxdWVzdCBvYmplY3RcbiAqIEBwYXJhbSB7c3RyaW5nfSByZWYgLSBUaGUgcmVmZXJlbmNlIGJlaW5nIHJlc29sdmVkIChXaGVuIGFwcGxpY2FibGUpXG4gKlxuICogQGNhbGxiYWNrIHByZXBhcmVSZXF1ZXN0Q2FsbGJhY2tcbiAqL1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgdG8gcHJvY2VzcyB0aGUgY29udGVudCBvZiBhIHJlZmVyZW5jZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gY29udGVudCAtIFRoZSBjb250ZW50IGxvYWRlZCBmcm9tIHRoZSBmaWxlL1VSTFxuICogQHBhcmFtIHtzdHJpbmd9IHJlZiAtIFRoZSByZWZlcmVuY2Ugc3RyaW5nIChXaGVuIGFwcGxpY2FibGUpXG4gKiBAcGFyYW0ge29iamVjdH0gW3Jlc10gLSBUaGUgU3VwZXJhZ2VudCByZXNwb25zZSBvYmplY3QgKEZvciByZW1vdGUgVVJMIHJlcXVlc3RzIG9ubHkpXG4gKlxuICogQHJldHVybnMge29iamVjdH0gVGhlIEphdmFTY3JpcHQgb2JqZWN0IHJlcHJlc2VudGF0aW9uIG9mIHRoZSByZWZlcmVuY2VcbiAqXG4gKiBAY2FsbGJhY2sgcHJvY2Vzc0NvbnRlbnRDYWxsYmFja1xuICovXG5cbi8qIEludGVybmFsIEZ1bmN0aW9ucyAqL1xuXG4vKipcbiAqIFJldHJpZXZlcyB0aGUgY29udGVudCBhdCB0aGUgVVJMIGFuZCByZXR1cm5zIGl0cyBKU09OIGNvbnRlbnQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFRoZSBVUkwgdG8gcmV0cmlldmVcbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgcGFzc2VkIHRvIHJlc29sdmVSZWZzXG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGVyZSBpcyBhIHByb2JsZW0gbWFraW5nIHRoZSByZXF1ZXN0IG9yIHRoZSBjb250ZW50IGlzIG5vdCBKU09OXG4gKlxuICogQHJldHVybnMge1Byb21pc2V9IFRoZSBwcm9taXNlXG4gKi9cbmZ1bmN0aW9uIGdldFJlbW90ZUpzb24gKHVybCwgb3B0aW9ucykge1xuICB2YXIganNvbiA9IHJlbW90ZUNhY2hlW3VybF07XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuICB2YXIgc2NoZW1lID0gdXJsLmluZGV4T2YoJzonKSA9PT0gLTEgPyB1bmRlZmluZWQgOiB1cmwuc3BsaXQoJzonKVswXTtcblxuICBpZiAoIV8uaXNVbmRlZmluZWQoanNvbikpIHtcbiAgICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIGpzb247XG4gICAgfSk7XG4gIH0gZWxzZSBpZiAoc3VwcG9ydGVkU2NoZW1lcy5pbmRleE9mKHNjaGVtZSkgPT09IC0xICYmICFfLmlzVW5kZWZpbmVkKHNjaGVtZSkpIHtcbiAgICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvcignVW5zdXBwb3J0ZWQgcmVtb3RlIHJlZmVyZW5jZSBzY2hlbWU6ICcgKyBzY2hlbWUpKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBhbGxUYXNrcyA9IHBhdGhMb2FkZXIubG9hZCh1cmwsIG9wdGlvbnMpO1xuXG4gICAgaWYgKG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQpIHtcbiAgICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoY29udGVudCkge1xuICAgICAgICByZXR1cm4gb3B0aW9ucy5wcm9jZXNzQ29udGVudChjb250ZW50LCB1cmwpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihKU09OLnBhcnNlKTtcbiAgICB9XG5cbiAgICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKG5Kc29uKSB7XG4gICAgICByZW1vdGVDYWNoZVt1cmxdID0gbkpzb247XG5cbiAgICAgIHJldHVybiBuSnNvbjtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIGNsb25lZCB2ZXJzaW9uIHRvIGF2b2lkIHVwZGF0aW5nIHRoZSBjYWNoZVxuICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKG5Kc29uKSB7XG4gICAgcmV0dXJuIF8uY2xvbmVEZWVwKG5Kc29uKTtcbiAgfSk7XG5cbiAgcmV0dXJuIGFsbFRhc2tzO1xufVxuXG4vKiBFeHBvcnRlZCBGdW5jdGlvbnMgKi9cblxuLyoqXG4gKiBDbGVhcnMgdGhlIGludGVybmFsIGNhY2hlIG9mIHVybCAtPiBKYXZhU2NyaXB0IG9iamVjdCBtYXBwaW5ncyBiYXNlZCBvbiBwcmV2aW91c2x5IHJlc29sdmVkIHJlZmVyZW5jZXMuXG4gKi9cbm1vZHVsZS5leHBvcnRzLmNsZWFyQ2FjaGUgPSBmdW5jdGlvbiBjbGVhckNhY2hlICgpIHtcbiAgcmVtb3RlQ2FjaGUgPSB7fTtcbn07XG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIG9yIG5vdCB0aGUgb2JqZWN0IHJlcHJlc2VudHMgYSBKU09OIFJlZmVyZW5jZS5cbiAqXG4gKiBAcGFyYW0ge29iamVjdHxzdHJpbmd9IFtvYmpdIC0gVGhlIG9iamVjdCB0byBjaGVja1xuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSB0cnVlIGlmIHRoZSBhcmd1bWVudCBpcyBhbiBvYmplY3QgYW5kIGl0cyAkcmVmIHByb3BlcnR5IGlzIGEgc3RyaW5nIGFuZCBmYWxzZSBvdGhlcndpc2VcbiAqL1xudmFyIGlzSnNvblJlZmVyZW5jZSA9IG1vZHVsZS5leHBvcnRzLmlzSnNvblJlZmVyZW5jZSA9IGZ1bmN0aW9uIGlzSnNvblJlZmVyZW5jZSAob2JqKSB7XG4gIC8vIFRPRE86IEFkZCBjaGVjayB0aGF0IHRoZSB2YWx1ZSBpcyBhIHZhbGlkIEpTT04gUG9pbnRlclxuICByZXR1cm4gXy5pc1BsYWluT2JqZWN0KG9iaikgJiYgXy5pc1N0cmluZyhvYmouJHJlZik7XG59O1xuXG4vKipcbiAqIFRha2VzIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgYW5kIGNyZWF0ZXMgYSBKU09OIFBvaW50ZXIgZnJvbSBpdC5cbiAqXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxfVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBUaGUgcGF0aCBzZWdtZW50c1xuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IEEgSlNPTiBQb2ludGVyIGJhc2VkIG9uIHRoZSBwYXRoIHNlZ21lbnRzXG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIHBhdGhUb1BvaW50ZXIgPSBtb2R1bGUuZXhwb3J0cy5wYXRoVG9Qb2ludGVyID0gZnVuY3Rpb24gcGF0aFRvUG9pbnRlciAocGF0aCkge1xuICBpZiAoXy5pc1VuZGVmaW5lZChwYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncGF0aCBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzQXJyYXkocGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3BhdGggbXVzdCBiZSBhbiBhcnJheScpO1xuICB9XG5cbiAgdmFyIHB0ciA9ICcjJztcblxuICBpZiAocGF0aC5sZW5ndGggPiAwKSB7XG4gICAgcHRyICs9ICcvJyArIHBhdGgubWFwKGZ1bmN0aW9uIChwYXJ0KSB7XG4gICAgICByZXR1cm4gcGFydC5yZXBsYWNlKC9+L2csICd+MCcpLnJlcGxhY2UoL1xcLy9nLCAnfjEnKTtcbiAgICB9KS5qb2luKCcvJyk7XG4gIH1cblxuICByZXR1cm4gcHRyO1xufTtcblxuLyoqXG4gKiBGaW5kIGFsbCBKU09OIFJlZmVyZW5jZXMgaW4gdGhlIGRvY3VtZW50LlxuICpcbiAqIEBzZWUge0BsaW5rIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL2RyYWZ0LXBicnlhbi16eXAtanNvbi1yZWYtMDMjc2VjdGlvbi0zfVxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBqc29uIC0gVGhlIEpTT04gZG9jdW1lbnQgdG8gZmluZCByZWZlcmVuY2VzIGluXG4gKlxuICogQHJldHVybnMge29iamVjdH0gQW4gb2JqZWN0IHdob3NlIGtleXMgYXJlIEpTT04gUG9pbnRlcnMgdG8gdGhlICckcmVmJyBub2RlIG9mIHRoZSBKU09OIFJlZmVyZW5jZVxuICpcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdGhlIGFyZ3VtZW50cyBhcmUgbWlzc2luZyBvciBpbnZhbGlkXG4gKi9cbnZhciBmaW5kUmVmcyA9IG1vZHVsZS5leHBvcnRzLmZpbmRSZWZzID0gZnVuY3Rpb24gZmluZFJlZnMgKGpzb24pIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQoanNvbikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2pzb24gaXMgcmVxdWlyZWQnKTtcbiAgfSBlbHNlIGlmICghXy5pc1BsYWluT2JqZWN0KGpzb24pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gIH1cblxuICByZXR1cm4gdHJhdmVyc2UoanNvbikucmVkdWNlKGZ1bmN0aW9uIChhY2MpIHtcbiAgICB2YXIgdmFsID0gdGhpcy5ub2RlO1xuXG4gICAgaWYgKHRoaXMua2V5ID09PSAnJHJlZicgJiYgaXNKc29uUmVmZXJlbmNlKHRoaXMucGFyZW50Lm5vZGUpKSB7XG4gICAgICBhY2NbcGF0aFRvUG9pbnRlcih0aGlzLnBhdGgpXSA9IHZhbDtcbiAgICB9XG5cbiAgICByZXR1cm4gYWNjO1xuICB9LCB7fSk7XG59O1xuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIEpTT04gUG9pbnRlciBpcyBhIHJlbW90ZSByZWZlcmVuY2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHB0ciAtIFRoZSBKU09OIFBvaW50ZXJcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdHJ1ZSBpZiB0aGUgSlNPTiBQb2ludGVyIGlzIHJlbW90ZSBvciBmYWxzZSBpZiBub3RcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICovXG52YXIgaXNSZW1vdGVQb2ludGVyID0gbW9kdWxlLmV4cG9ydHMuaXNSZW1vdGVQb2ludGVyID0gZnVuY3Rpb24gaXNSZW1vdGVQb2ludGVyIChwdHIpIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQocHRyKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHRyIGlzIHJlcXVpcmVkJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNTdHJpbmcocHRyKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHRyIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgfVxuXG4gIC8vIFdlIHRyZWF0IGFueXRoaW5nIG90aGVyIHRoYW4gbG9jYWwsIHZhbGlkIEpTT04gUG9pbnRlciB2YWx1ZXMgYXMgcmVtb3RlXG4gIHJldHVybiBwdHIgIT09ICcnICYmIHB0ci5jaGFyQXQoMCkgIT09ICcjJztcbn07XG5cbi8qKlxuICogVGFrZXMgYSBKU09OIFJlZmVyZW5jZSBhbmQgcmV0dXJucyBhbiBhcnJheSBvZiBwYXRoIHNlZ21lbnRzLlxuICpcbiAqIEBzZWUge0BsaW5rIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzY5MDF9XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHB0ciAtIFRoZSBKU09OIFBvaW50ZXIgZm9yIHRoZSBKU09OIFJlZmVyZW5jZVxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gQW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cyBvciB0aGUgcGFzc2VkIGluIHN0cmluZyBpZiBpdCBpcyBhIHJlbW90ZSByZWZlcmVuY2VcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICovXG52YXIgcGF0aEZyb21Qb2ludGVyID0gbW9kdWxlLmV4cG9ydHMucGF0aEZyb21Qb2ludGVyID0gZnVuY3Rpb24gcGF0aEZyb21Qb2ludGVyIChwdHIpIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQocHRyKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHRyIGlzIHJlcXVpcmVkJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNTdHJpbmcocHRyKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHRyIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgfVxuXG4gIHZhciBwYXRoID0gW107XG4gIHZhciByb290UGF0aHMgPSBbJycsICcjJywgJyMvJ107XG5cbiAgaWYgKGlzUmVtb3RlUG9pbnRlcihwdHIpKSB7XG4gICAgcGF0aCA9IHB0cjtcbiAgfSBlbHNlIHtcbiAgICBpZiAocm9vdFBhdGhzLmluZGV4T2YocHRyKSA9PT0gLTEgJiYgcHRyLmNoYXJBdCgwKSA9PT0gJyMnKSB7XG4gICAgICBwYXRoID0gcHRyLnN1YnN0cmluZyhwdHIuaW5kZXhPZignLycpKS5zcGxpdCgnLycpLnJlZHVjZShmdW5jdGlvbiAocGFydHMsIHBhcnQpIHtcbiAgICAgICAgaWYgKHBhcnQgIT09ICcnKSB7XG4gICAgICAgICAgcGFydHMucHVzaChwYXJ0LnJlcGxhY2UoL34wL2csICd+JykucmVwbGFjZSgvfjEvZywgJy8nKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGFydHM7XG4gICAgICB9LCBbXSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHBhdGg7XG59O1xuXG5mdW5jdGlvbiBjb21iaW5lUmVmcyAoYmFzZSwgcmVmKSB7XG4gIHZhciBiYXNlUGF0aCA9IHBhdGhGcm9tUG9pbnRlcihiYXNlKTtcblxuICBpZiAoaXNSZW1vdGVQb2ludGVyKHJlZikpIHtcbiAgICBpZiAocmVmLmluZGV4T2YoJyMnKSA9PT0gLTEpIHtcbiAgICAgIHJlZiA9ICcjJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmVmID0gcmVmLnN1YnN0cmluZyhyZWYuaW5kZXhPZignIycpKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcGF0aFRvUG9pbnRlcihiYXNlUGF0aC5jb25jYXQocGF0aEZyb21Qb2ludGVyKHJlZikpKS5yZXBsYWNlKC9cXC9cXCRyZWYvZywgJycpO1xufVxuXG5mdW5jdGlvbiBjb21wdXRlVXJsIChiYXNlLCByZWYpIHtcbiAgdmFyIGlzUmVsYXRpdmUgPSByZWYuY2hhckF0KDApICE9PSAnIycgJiYgcmVmLmluZGV4T2YoJzonKSA9PT0gLTE7XG4gIHZhciBuZXdMb2NhdGlvbiA9IFtdO1xuICB2YXIgcmVmU2VnbWVudHMgPSAocmVmLmluZGV4T2YoJyMnKSA+IC0xID8gcmVmLnNwbGl0KCcjJylbMF0gOiByZWYpLnNwbGl0KCcvJyk7XG5cbiAgZnVuY3Rpb24gc2VnbWVudEhhbmRsZXIgKHNlZ21lbnQpIHtcbiAgICBpZiAoc2VnbWVudCA9PT0gJy4uJykge1xuICAgICAgbmV3TG9jYXRpb24ucG9wKCk7XG4gICAgfSBlbHNlIGlmIChzZWdtZW50ICE9PSAnLicpIHtcbiAgICAgIG5ld0xvY2F0aW9uLnB1c2goc2VnbWVudCk7XG4gICAgfVxuICB9XG5cbiAgaWYgKGJhc2UpIHtcbiAgICAvLyBSZW1vdmUgaGFzaFxuICAgIGlmIChiYXNlLmluZGV4T2YoJyMnKSA+IC0xKSB7XG4gICAgICBiYXNlID0gYmFzZS5zdWJzdHJpbmcoMCwgYmFzZS5pbmRleE9mKCcjJykpO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaFxuICAgIGlmIChiYXNlLmxlbmd0aCA+IDEgJiYgYmFzZVtiYXNlLmxlbmd0aCAtIDFdID09PSAnLycpIHtcbiAgICAgIGJhc2UgPSBiYXNlLnN1YnN0cmluZygwLCBiYXNlLmxlbmd0aCAtIDEpO1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGl6ZSB0aGUgYmFzZVxuICAgIGJhc2Uuc3BsaXQoJyMnKVswXS5zcGxpdCgnLycpLmZvckVhY2goc2VnbWVudEhhbmRsZXIpO1xuICB9XG5cbiAgaWYgKGlzUmVsYXRpdmUpIHtcbiAgICAvLyBBZGQgcmVmZXJlbmNlIHNlZ21lbnRzXG4gICAgcmVmU2VnbWVudHMuZm9yRWFjaChzZWdtZW50SGFuZGxlcik7XG4gIH0gZWxzZSB7XG4gICAgbmV3TG9jYXRpb24gPSByZWZTZWdtZW50cztcbiAgfVxuXG4gIHJldHVybiBuZXdMb2NhdGlvbi5qb2luKCcvJyk7XG59XG5cbmZ1bmN0aW9uIHJlYWxSZXNvbHZlUmVmcyAoanNvbiwgb3B0aW9ucywgbWV0YWRhdGEpIHtcbiAgdmFyIGRlcHRoID0gXy5pc1VuZGVmaW5lZChvcHRpb25zLmRlcHRoKSA/IDEgOiBvcHRpb25zLmRlcHRoO1xuICB2YXIganNvblQgPSB0cmF2ZXJzZShqc29uKTtcblxuICBmdW5jdGlvbiBmaW5kUGFyZW50UmVmZXJlbmNlIChwYXRoKSB7XG4gICAgdmFyIHBQYXRoID0gcGF0aC5zbGljZSgwLCBwYXRoLmxhc3RJbmRleE9mKCdhbGxPZicpKTtcbiAgICB2YXIgcmVmTWV0YWRhdGEgPSBtZXRhZGF0YVtwYXRoVG9Qb2ludGVyKHBQYXRoKV07XG5cbiAgICBpZiAoIV8uaXNVbmRlZmluZWQocmVmTWV0YWRhdGEpKSB7XG4gICAgICByZXR1cm4gcGF0aFRvUG9pbnRlcihwUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChwUGF0aC5pbmRleE9mKCdhbGxPZicpID4gLTEpIHtcbiAgICAgICAgcmV0dXJuIGZpbmRQYXJlbnRSZWZlcmVuY2UocFBhdGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBmaXhDaXJjdWxhcnMgKHJKc29uVCkge1xuICAgIHZhciBjaXJjdWxhclB0cnMgPSBbXTtcbiAgICB2YXIgc2NydWJiZWQgPSBySnNvblQubWFwKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBwdHIgPSBwYXRoVG9Qb2ludGVyKHRoaXMucGF0aCk7XG4gICAgICB2YXIgcmVmTWV0YWRhdGEgPSBtZXRhZGF0YVtwdHJdO1xuICAgICAgdmFyIHBQdHI7XG5cbiAgICAgIGlmICh0aGlzLmNpcmN1bGFyKSB7XG4gICAgICAgIGNpcmN1bGFyUHRycy5wdXNoKHB0cik7XG5cbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQocmVmTWV0YWRhdGEpKSB7XG4gICAgICAgICAgLy8gVGhpcyBtdXN0IGJlIGNpcmN1bGFyIGNvbXBvc2l0aW9uL2luaGVyaXRhbmNlXG4gICAgICAgICAgcFB0ciA9IGZpbmRQYXJlbnRSZWZlcmVuY2UodGhpcy5wYXRoKTtcbiAgICAgICAgICByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3BQdHJdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVmZXJlbmNlIG1ldGFkYXRhIGNhbiBiZSB1bmRlZmluZWQgZm9yIHJlZmVyZW5jZXMgdG8gc2NoZW1hcyB0aGF0IGhhdmUgY2lyY3VsYXIgY29tcG9zaXRpb24vaW5oZXJpdGFuY2UgYW5kXG4gICAgICAgIC8vIGFyZSBzYWZlbHkgaWdub3JlYWJsZS5cbiAgICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHJlZk1ldGFkYXRhKSkge1xuICAgICAgICAgIHJlZk1ldGFkYXRhLmNpcmN1bGFyID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgIHRoaXMudXBkYXRlKHt9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZSh0cmF2ZXJzZSh0aGlzLm5vZGUpLm1hcChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5jaXJjdWxhcikge1xuICAgICAgICAgICAgICB0aGlzLnBhcmVudC51cGRhdGUoe30pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gUmVwbGFjZSBzY3J1YmJlZCBjaXJjdWxhcnMgYmFzZWQgb24gZGVwdGhcbiAgICBfLmVhY2goY2lyY3VsYXJQdHJzLCBmdW5jdGlvbiAocHRyKSB7XG4gICAgICB2YXIgZGVwdGhQYXRoID0gW107XG4gICAgICB2YXIgcGF0aCA9IHBhdGhGcm9tUG9pbnRlcihwdHIpO1xuICAgICAgdmFyIHZhbHVlID0gdHJhdmVyc2Uoc2NydWJiZWQpLmdldChwYXRoKTtcbiAgICAgIHZhciBpO1xuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgZGVwdGg7IGkrKykge1xuICAgICAgICBkZXB0aFBhdGgucHVzaC5hcHBseShkZXB0aFBhdGgsIHBhdGgpO1xuXG4gICAgICAgIHRyYXZlcnNlKHNjcnViYmVkKS5zZXQoZGVwdGhQYXRoLCBfLmNsb25lRGVlcCh2YWx1ZSkpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHNjcnViYmVkO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVwbGFjZVJlZmVyZW5jZSAocmVmLCByZWZQdHIpIHtcbiAgICB2YXIgcmVmTWV0YWRhdGFLZXkgPSBjb21iaW5lUmVmcyhyZWZQdHIsICcjJyk7XG4gICAgdmFyIGxvY2FsUmVmID0gcmVmID0gcmVmLmluZGV4T2YoJyMnKSA9PT0gLTEgP1xuICAgICAgICAgICcjJyA6XG4gICAgICAgICAgcmVmLnN1YnN0cmluZyhyZWYuaW5kZXhPZignIycpKTtcbiAgICB2YXIgbG9jYWxQYXRoID0gcGF0aEZyb21Qb2ludGVyKGxvY2FsUmVmKTtcbiAgICB2YXIgbWlzc2luZyA9ICFqc29uVC5oYXMobG9jYWxQYXRoKTtcbiAgICB2YXIgdmFsdWUgPSBqc29uVC5nZXQobG9jYWxQYXRoKTtcbiAgICB2YXIgcmVmUHRyUGF0aCA9IHBhdGhGcm9tUG9pbnRlcihyZWZQdHIpO1xuICAgIHZhciBwYXJlbnRQYXRoID0gcmVmUHRyUGF0aC5zbGljZSgwLCByZWZQdHJQYXRoLmxlbmd0aCAtIDEpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3JlZk1ldGFkYXRhS2V5XSB8fCB7XG4gICAgICByZWY6IHJlZlxuICAgIH07XG5cbiAgICBpZiAoIW1pc3NpbmcpIHtcbiAgICAgIGlmIChwYXJlbnRQYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBTZWxmIHJlZmVyZW5jZXMgYXJlIHNwZWNpYWxcbiAgICAgICAgaWYgKGpzb25ULnZhbHVlID09PSB2YWx1ZSkge1xuICAgICAgICAgIHZhbHVlID0ge307XG5cbiAgICAgICAgICByZWZNZXRhZGF0YS5jaXJjdWxhciA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBqc29uVC52YWx1ZSA9IHZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGpzb25ULmdldChwYXJlbnRQYXRoKSA9PT0gdmFsdWUpIHtcbiAgICAgICAgICB2YWx1ZSA9IHt9O1xuXG4gICAgICAgICAgcmVmTWV0YWRhdGEuY2lyY3VsYXIgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAganNvblQuc2V0KHBhcmVudFBhdGgsIHZhbHVlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmVmTWV0YWRhdGEubWlzc2luZyA9IHRydWU7XG4gICAgfVxuXG4gICAgbWV0YWRhdGFbcmVmTWV0YWRhdGFLZXldID0gcmVmTWV0YWRhdGE7XG4gIH1cblxuICAvLyBBbGwgcmVmZXJlbmNlcyBhdCB0aGlzIHBvaW50IHNob3VsZCBiZSBsb2NhbCBleGNlcHQgbWlzc2luZy9pbnZhbGlkIHJlZmVyZW5jZXNcbiAgXy5lYWNoKGZpbmRSZWZzKGpzb24pLCBmdW5jdGlvbiAocmVmLCByZWZQdHIpIHtcbiAgICBpZiAoIWlzUmVtb3RlUG9pbnRlcihyZWYpKSB7XG4gICAgICByZXBsYWNlUmVmZXJlbmNlKHJlZiwgcmVmUHRyKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFJlbW92ZSBmdWxsIGxvY2F0aW9ucyBmcm9tIHJlZmVyZW5jZSBtZXRhZGF0YVxuICBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5sb2NhdGlvbikpIHtcbiAgICBfLmVhY2gobWV0YWRhdGEsIGZ1bmN0aW9uIChyZWZNZXRhZGF0YSkge1xuICAgICAgdmFyIG5vcm1hbGl6ZWRQdHIgPSByZWZNZXRhZGF0YS5yZWY7XG5cbiAgICAgIC8vIFJlbW92ZSB0aGUgYmFzZSB3aGVuIGFwcGxpY2FibGVcbiAgICAgIGlmIChub3JtYWxpemVkUHRyLmluZGV4T2Yob3B0aW9ucy5sb2NhdGlvbikgPT09IDApIHtcbiAgICAgICAgbm9ybWFsaXplZFB0ciA9IG5vcm1hbGl6ZWRQdHIuc3Vic3RyaW5nKG9wdGlvbnMubG9jYXRpb24ubGVuZ3RoKTtcblxuICAgICAgICAvLyBSZW1vdmUgdGhlIC8gcHJlZml4XG4gICAgICAgIGlmIChub3JtYWxpemVkUHRyLmNoYXJBdCgwKSA9PT0gJy8nKSB7XG4gICAgICAgICAgbm9ybWFsaXplZFB0ciA9IG5vcm1hbGl6ZWRQdHIuc3Vic3RyaW5nKDEpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJlZk1ldGFkYXRhLnJlZiA9IG5vcm1hbGl6ZWRQdHI7XG4gICAgfSk7XG4gIH1cblxuICAvLyBGaXggY2lyY3VsYXJzXG4gIHJldHVybiB7XG4gICAgbWV0YWRhdGE6IG1ldGFkYXRhLFxuICAgIHJlc29sdmVkOiBmaXhDaXJjdWxhcnMoanNvblQpXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVSZW1vdGVSZWZzIChqc29uLCBvcHRpb25zLCBwYXJlbnRQdHIsIHBhcmVudHMsIG1ldGFkYXRhKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuICB2YXIganNvblQgPSB0cmF2ZXJzZShqc29uKTtcblxuICBmdW5jdGlvbiByZXBsYWNlUmVtb3RlUmVmIChyZWZQdHIsIHB0ciwgcmVtb3RlTG9jYXRpb24sIHJlbW90ZVB0ciwgcmVzb2x2ZWQpIHtcbiAgICB2YXIgbm9ybWFsaXplZFB0ciA9IHJlbW90ZUxvY2F0aW9uICsgKHJlbW90ZVB0ciA9PT0gJyMnID8gJycgOiByZW1vdGVQdHIpO1xuICAgIHZhciByZWZNZXRhZGF0YUtleSA9IGNvbWJpbmVSZWZzKHBhcmVudFB0ciwgcmVmUHRyKTtcbiAgICB2YXIgcmVmTWV0YWRhdGEgPSBtZXRhZGF0YVtyZWZNZXRhZGF0YUtleV0gfHwge307XG4gICAgdmFyIHJlZlBhdGggPSBwYXRoRnJvbVBvaW50ZXIocmVmUHRyKTtcbiAgICB2YXIgdmFsdWU7XG5cbiAgICBpZiAoXy5pc1VuZGVmaW5lZChyZXNvbHZlZCkpIHtcbiAgICAgIHJlZk1ldGFkYXRhLmNpcmN1bGFyID0gdHJ1ZTtcblxuICAgICAgLy8gVXNlIHRoZSBwYXJlbnQgcmVmZXJlbmNlIGxvb2NhdGlvblxuICAgICAgdmFsdWUgPSBwYXJlbnRzW3JlbW90ZUxvY2F0aW9uXS5yZWY7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEdldCB0aGUgcmVtb3RlIHZhbHVlXG4gICAgICB2YWx1ZSA9IHRyYXZlcnNlKHJlc29sdmVkKS5nZXQocGF0aEZyb21Qb2ludGVyKHJlbW90ZVB0cikpO1xuXG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZCh2YWx1ZSkpIHtcbiAgICAgICAgcmVmTWV0YWRhdGEubWlzc2luZyA9IHRydWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZiB0aGUgcmVtb3RlIHZhbHVlIGlzIGl0c2VsZiBhIHJlZmVyZW5jZSwgdXBkYXRlIHRoZSByZWZlcmVuY2UgdG8gYmUgcmVwbGFjZWQgd2l0aCBpdHMgcmVmZXJlbmNlIHZhbHVlLlxuICAgICAgICAvLyBPdGhlcndpc2UsIHJlcGxhY2UgdGhlIHJlbW90ZSByZWZlcmVuY2UuXG4gICAgICAgIGlmICh2YWx1ZS4kcmVmKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS4kcmVmO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlZlBhdGgucG9wKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDb2xsYXBzZSBzZWxmIHJlZmVyZW5jZXNcbiAgICBpZiAocmVmUGF0aC5sZW5ndGggPT09IDApIHtcbiAgICAgIGpzb25ULnZhbHVlID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGpzb25ULnNldChyZWZQYXRoLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgcmVmTWV0YWRhdGEucmVmID0gbm9ybWFsaXplZFB0cjtcblxuICAgIG1ldGFkYXRhW3JlZk1ldGFkYXRhS2V5XSA9IHJlZk1ldGFkYXRhO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVzb2x2ZXIgKCkge1xuICAgIHJldHVybiB7XG4gICAgICBtZXRhZGF0YTogbWV0YWRhdGEsXG4gICAgICByZXNvbHZlZDoganNvblQudmFsdWVcbiAgICB9O1xuICB9XG5cbiAgXy5lYWNoKGZpbmRSZWZzKGpzb24pLCBmdW5jdGlvbiAocHRyLCByZWZQdHIpIHtcbiAgICBpZiAoaXNSZW1vdGVQb2ludGVyKHB0cikpIHtcbiAgICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciByZW1vdGVMb2NhdGlvbiA9IGNvbXB1dGVVcmwob3B0aW9ucy5sb2NhdGlvbiwgcHRyKTtcbiAgICAgICAgdmFyIHJlZlBhcnRzID0gcHRyLnNwbGl0KCcjJyk7XG4gICAgICAgIHZhciBoYXNoID0gJyMnICsgKHJlZlBhcnRzWzFdIHx8ICcnKTtcblxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChwYXJlbnRzW3JlbW90ZUxvY2F0aW9uXSkpIHtcbiAgICAgICAgICByZXR1cm4gZ2V0UmVtb3RlSnNvbihyZW1vdGVMb2NhdGlvbiwgb3B0aW9ucylcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChyZW1vdGVKc29uKSB7XG4gICAgICAgICAgICAgIHJldHVybiByZW1vdGVKc29uO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICByZXR1cm4gZXJyO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgICB2YXIgcmVmQmFzZSA9IHJlZlBhcnRzWzBdO1xuICAgICAgICAgICAgICB2YXIgck9wdGlvbnMgPSBfLmNsb25lRGVlcChvcHRpb25zKTtcbiAgICAgICAgICAgICAgdmFyIG5ld1BhcmVudFB0ciA9IGNvbWJpbmVSZWZzKHBhcmVudFB0ciwgcmVmUHRyKTtcblxuICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGxhc3QgcGF0aCBzZWdtZW50XG4gICAgICAgICAgICAgIHJlZkJhc2UgPSByZWZCYXNlLnN1YnN0cmluZygwLCByZWZCYXNlLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcblxuICAgICAgICAgICAgICAvLyBVcGRhdGUgdGhlIHJlY3Vyc2l2ZSBsb2NhdGlvblxuICAgICAgICAgICAgICByT3B0aW9ucy5sb2NhdGlvbiA9IGNvbXB1dGVVcmwob3B0aW9ucy5sb2NhdGlvbiwgcmVmQmFzZSk7XG5cbiAgICAgICAgICAgICAgLy8gUmVjb3JkIHRoZSBwYXJlbnRcbiAgICAgICAgICAgICAgcGFyZW50c1tyZW1vdGVMb2NhdGlvbl0gPSB7XG4gICAgICAgICAgICAgICAgcmVmOiBwYXJlbnRQdHJcbiAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICBpZiAoXy5pc0Vycm9yKHJlc3BvbnNlKSkge1xuICAgICAgICAgICAgICAgIG1ldGFkYXRhW25ld1BhcmVudFB0cl0gPSB7XG4gICAgICAgICAgICAgICAgICBlcnI6IHJlc3BvbnNlLFxuICAgICAgICAgICAgICAgICAgbWlzc2luZzogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHJlZjogcHRyXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIHJlbW90ZSByZWZlcmVuY2VzXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc29sdmVSZW1vdGVSZWZzKHJlc3BvbnNlLCByT3B0aW9ucywgbmV3UGFyZW50UHRyLCBwYXJlbnRzLCBtZXRhZGF0YSlcbiAgICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChyTWV0YWRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHBhcmVudHNbcmVtb3RlTG9jYXRpb25dO1xuXG4gICAgICAgICAgICAgICAgICAgIHJlcGxhY2VSZW1vdGVSZWYocmVmUHRyLCBwdHIsIHJlbW90ZUxvY2F0aW9uLCBoYXNoLCByTWV0YWRhdGEucmVzb2x2ZWQpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByTWV0YWRhdGE7XG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBhIGNpcmN1bGFyIHJlZmVyZW5jZVxuICAgICAgICAgIHJlcGxhY2VSZW1vdGVSZWYocmVmUHRyLCBwdHIsIHJlbW90ZUxvY2F0aW9uLCBoYXNoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmVhbFJlc29sdmVSZWZzKGpzb25ULnZhbHVlLCBvcHRpb25zLCBtZXRhZGF0YSk7XG4gICAgfSlcbiAgICAudGhlbihyZXNvbHZlciwgcmVzb2x2ZXIpO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyoqXG4gKiBUYWtlcyBhIEpTT04gZG9jdW1lbnQsIHJlc29sdmVzIGFsbCBKU09OIFJlZmVyZW5jZXMgYW5kIHJldHVybnMgYSBmdWxseSByZXNvbHZlZCBlcXVpdmFsZW50IGFsb25nIHdpdGggcmVmZXJlbmNlXG4gKiByZXNvbHV0aW9uIG1ldGFkYXRhLlxuICpcbiAqICoqSW1wb3J0YW50IERldGFpbHMqKlxuICpcbiAqICogVGhlIGlucHV0IGFyZ3VtZW50cyBhcmUgbmV2ZXIgYWx0ZXJlZFxuICogKiBXaGVuIHVzaW5nIHByb21pc2VzLCBvbmx5IG9uZSB2YWx1ZSBjYW4gYmUgcmVzb2x2ZWQgc28gaXQgaXMgYW4gb2JqZWN0IHdob3NlIGtleXMgYW5kIHZhbHVlcyBhcmUgdGhlIHNhbWUgbmFtZSBhbmRcbiAqICAgdmFsdWUgYXMgYXJndW1lbnRzIDEgYW5kIDIgZm9yIHtAbGluayByZXN1bHRDYWxsYmFja31cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0ganNvbiAtIFRoZSBKU09OICBkb2N1bWVudCBoYXZpbmcgemVybyBvciBtb3JlIEpTT04gUmVmZXJlbmNlc1xuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFRoZSBvcHRpb25zIChBbGwgb3B0aW9ucyBhcmUgcGFzc2VkIGRvd24gdG8gd2hpdGxvY2tqYy9wYXRoLWxvYWRlcilcbiAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0aW9ucy5kZXB0aD0xXSAtIFRoZSBkZXB0aCB0byByZXNvbHZlIGNpcmN1bGFyIHJlZmVyZW5jZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5sb2NhdGlvbl0gLSBUaGUgbG9jYXRpb24gdG8gd2hpY2ggcmVsYXRpdmUgcmVmZXJlbmNlcyBzaG91bGQgYmUgcmVzb2x2ZWRcbiAqIEBwYXJhbSB7cHJlcGFyZVJlcXVlc3RDYWxsYmFja30gW29wdGlvbnMucHJlcGFyZVJlcXVlc3RdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJlcGFyZSBhbiBIVFRQIHJlcXVlc3RcbiAqIEBwYXJhbSB7cHJvY2Vzc0NvbnRlbnRDYWxsYmFja30gW29wdGlvbnMucHJvY2Vzc0NvbnRlbnRdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJvY2VzcyBhIHJlZmVyZW5jZSdzIGNvbnRlbnRcbiAqIEBwYXJhbSB7cmVzdWx0Q2FsbGJhY2t9IFtkb25lXSAtIFRoZSByZXN1bHQgY2FsbGJhY2tcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBUaGUgcHJvbWlzZS5cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBjYWxsYmFja3NcbiAqXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyh7XG4gKiAgIG5hbWU6ICdqc29uLXJlZnMnLFxuICogICBvd25lcjoge1xuICogICAgICRyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcidcbiAqICAgfVxuICogfSwgZnVuY3Rpb24gKGVyciwgcmVzb2x2ZWQsIG1ldGFkYXRhKSB7XG4gKiAgIGlmIChlcnIpIHRocm93IGVycjtcbiAqXG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KG1ldGFkYXRhKSk7IC8vIHsnIy9vd25lcic6IHtyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcid9fVxuICogfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgcHJvbWlzZXNcbiAqXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyh7XG4gKiAgIG5hbWU6ICdqc29uLXJlZnMnLFxuICogICBvd25lcjoge1xuICogICAgICRyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcidcbiAqICAgfVxuICogfSkudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLnJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdHMubWV0YWRhdGEpKTsgLy8geycjL293bmVyJzoge3JlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ319XG4gKiB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBvcHRpb25zLnByZXBhcmVSZXF1ZXN0ICh0byBhZGQgYXV0aGVudGljYXRpb24gY3JlZGVudGlhbHMpIGFuZCBvcHRpb25zLnByb2Nlc3NDb250ZW50ICh0byBwcm9jZXNzIFlBTUwpXG4gKlxuICogSnNvblJlZnMucmVzb2x2ZVJlZnMoe1xuICogICBuYW1lOiAnanNvbi1yZWZzJyxcbiAqICAgb3duZXI6IHtcbiAqICAgICAkcmVmOiAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL2pzb24tcmVmcyMvb3duZXInXG4gKiAgIH1cbiAqIH0sIHtcbiAqICAgcHJlcGFyZVJlcXVlc3Q6IGZ1bmN0aW9uIChyZXEpIHtcbiAqICAgICAvLyBBZGQgdGhlICdCYXNpYyBBdXRoZW50aWNhdGlvbicgY3JlZGVudGlhbHNcbiAqICAgICByZXEuYXV0aCgnd2hpdGxvY2tqYycsICdNWV9HSVRIVUJfUEFTU1dPUkQnKTtcbiAqXG4gKiAgICAgLy8gQWRkIHRoZSAnWC1BUEktS2V5JyBoZWFkZXIgZm9yIGFuIEFQSSBLZXkgYmFzZWQgYXV0aGVudGljYXRpb25cbiAqICAgICAvLyByZXEuc2V0KCdYLUFQSS1LZXknLCAnTVlfQVBJX0tFWScpO1xuICogICB9LFxuICogICBwcm9jZXNzQ29udGVudDogZnVuY3Rpb24gKGNvbnRlbnQpIHtcbiAqICAgICByZXR1cm4gWUFNTC5wYXJzZShjb250ZW50KTtcbiAqICAgfVxuICogfSkudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLnJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdHMubWV0YWRhdGEpKTsgLy8geycjL293bmVyJzoge3JlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ319XG4gKiB9KTtcbiAqL1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnMgPSBmdW5jdGlvbiByZXNvbHZlUmVmcyAoanNvbiwgb3B0aW9ucywgZG9uZSkge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMikge1xuICAgIGlmIChfLmlzRnVuY3Rpb24ob3B0aW9ucykpIHtcbiAgICAgIGRvbmUgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMpKSB7XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIGlzIHJlcXVpcmVkJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1BsYWluT2JqZWN0KGpzb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2pzb24gbXVzdCBiZSBhbiBvYmplY3QnKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzUGxhaW5PYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucyBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQoZG9uZSkgJiYgIV8uaXNGdW5jdGlvbihkb25lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdkb25lIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHRoZSBvcHRpb25zIChUaGlzIG9wdGlvbiBkb2VzIG5vdCBhcHBseSB0byApXG4gICAgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQpICYmICFfLmlzRnVuY3Rpb24ob3B0aW9ucy5wcm9jZXNzQ29udGVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5wcm9jZXNzQ29udGVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucHJlcGFyZVJlcXVlc3QpICYmICFfLmlzRnVuY3Rpb24ob3B0aW9ucy5wcmVwYXJlUmVxdWVzdCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5wcmVwYXJlUmVxdWVzdCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMubG9jYXRpb24pICYmICFfLmlzU3RyaW5nKG9wdGlvbnMubG9jYXRpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMubG9jYXRpb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5kZXB0aCkgJiYgIV8uaXNOdW1iZXIob3B0aW9ucy5kZXB0aCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5kZXB0aCBtdXN0IGJlIGEgbnVtYmVyJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmRlcHRoKSAmJiBvcHRpb25zLmRlcHRoIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zLmRlcHRoIG11c3QgYmUgZ3JlYXRlciBvciBlcXVhbCB0byB6ZXJvJyk7XG4gICAgfVxuICB9KTtcblxuICAvLyBDbG9uZSB0aGUgaW5wdXRzIHNvIHdlIGRvIG5vdCBhbHRlciB0aGVtXG4gIGpzb24gPSB0cmF2ZXJzZShqc29uKS5jbG9uZSgpO1xuICBvcHRpb25zID0gdHJhdmVyc2Uob3B0aW9ucykuY2xvbmUoKTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHJlc29sdmVSZW1vdGVSZWZzKGpzb24sIG9wdGlvbnMsICcjJywge30sIHt9KTtcbiAgICB9KVxuICAgIC50aGVuKGZ1bmN0aW9uIChtZXRhZGF0YSkge1xuICAgICAgcmV0dXJuIHJlYWxSZXNvbHZlUmVmcyhtZXRhZGF0YS5yZXNvbHZlZCwgb3B0aW9ucywgbWV0YWRhdGEubWV0YWRhdGEpO1xuICAgIH0pO1xuXG4gIC8vIFVzZSB0aGUgY2FsbGJhY2sgaWYgcHJvdmlkZWQgYW5kIGl0IGlzIGEgZnVuY3Rpb25cbiAgaWYgKCFfLmlzVW5kZWZpbmVkKGRvbmUpICYmIF8uaXNGdW5jdGlvbihkb25lKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXN1bHRzKSB7XG4gICAgICAgIGRvbmUodW5kZWZpbmVkLCByZXN1bHRzLnJlc29sdmVkLCByZXN1bHRzLm1ldGFkYXRhKTtcbiAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgZG9uZShlcnIpO1xuICAgICAgfSk7XG4gIH1cblxuICByZXR1cm4gYWxsVGFza3M7XG59O1xuIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNCBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuLy8gVGhpcyBpcyBhIHNpbXBsZSB3cmFwcGVyIGZvciBMb2Rhc2ggZnVuY3Rpb25zIGJ1dCB1c2luZyBzaW1wbGUgRVM1IGFuZCBleGlzdGluZyByZXF1aXJlZCBkZXBlbmRlbmNpZXNcbi8vIChjbG9uZURlZXAgdXNlcyB0cmF2ZXJzZSBmb3IgZXhhbXBsZSkuICBUaGUgcmVhc29uIGZvciB0aGlzIHdhcyBhIG11Y2ggc21hbGxlciBmaWxlIHNpemUuICBBbGwgZXhwb3J0ZWQgZnVuY3Rpb25zXG4vLyBtYXRjaCBtYXAgdG8gYSBsb2Rhc2ggZXF1aXZhbGVudC5cblxudmFyIHRyYXZlcnNlID0gcmVxdWlyZSgndHJhdmVyc2UnKTtcblxuZnVuY3Rpb24gaXNUeXBlIChvYmosIHR5cGUpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCAnICsgdHlwZSArICddJztcbn1cblxubW9kdWxlLmV4cG9ydHMuY2xvbmVEZWVwID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gdHJhdmVyc2Uob2JqKS5jbG9uZSgpO1xufTtcblxudmFyIGlzQXJyYXkgPSBtb2R1bGUuZXhwb3J0cy5pc0FycmF5ID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0FycmF5Jyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc0Vycm9yID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0Vycm9yJyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc0Z1bmN0aW9uID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0Z1bmN0aW9uJyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc051bWJlciA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdOdW1iZXInKTtcbn07XG5cbnZhciBpc1BsYWluT2JqZWN0ID0gbW9kdWxlLmV4cG9ydHMuaXNQbGFpbk9iamVjdCA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdPYmplY3QnKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzU3RyaW5nID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ1N0cmluZycpO1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNVbmRlZmluZWQgPSBmdW5jdGlvbiAob2JqKSB7XG4gIC8vIENvbW1lbnRlZCBvdXQgZHVlIHRvIFBoYW50b21KUyBidWcgKGh0dHBzOi8vZ2l0aHViLmNvbS9hcml5YS9waGFudG9tanMvaXNzdWVzLzExNzIyKVxuICAvLyByZXR1cm4gaXNUeXBlKG9iaiwgJ1VuZGVmaW5lZCcpO1xuICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCc7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5lYWNoID0gZnVuY3Rpb24gKHNvdXJjZSwgaGFuZGxlcikge1xuICBpZiAoaXNBcnJheShzb3VyY2UpKSB7XG4gICAgc291cmNlLmZvckVhY2goaGFuZGxlcik7XG4gIH0gZWxzZSBpZiAoaXNQbGFpbk9iamVjdChzb3VyY2UpKSB7XG4gICAgT2JqZWN0LmtleXMoc291cmNlKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGhhbmRsZXIoc291cmNlW2tleV0sIGtleSk7XG4gICAgfSk7XG4gIH1cbn07XG4iLCIvKiEgTmF0aXZlIFByb21pc2UgT25seVxuICAgIHYwLjguMC1hIChjKSBLeWxlIFNpbXBzb25cbiAgICBNSVQgTGljZW5zZTogaHR0cDovL2dldGlmeS5taXQtbGljZW5zZS5vcmdcbiovXG4hZnVuY3Rpb24odCxuLGUpe25bdF09blt0XXx8ZSgpLFwidW5kZWZpbmVkXCIhPXR5cGVvZiBtb2R1bGUmJm1vZHVsZS5leHBvcnRzP21vZHVsZS5leHBvcnRzPW5bdF06XCJmdW5jdGlvblwiPT10eXBlb2YgZGVmaW5lJiZkZWZpbmUuYW1kJiZkZWZpbmUoZnVuY3Rpb24oKXtyZXR1cm4gblt0XX0pfShcIlByb21pc2VcIixcInVuZGVmaW5lZFwiIT10eXBlb2YgZ2xvYmFsP2dsb2JhbDp0aGlzLGZ1bmN0aW9uKCl7XCJ1c2Ugc3RyaWN0XCI7ZnVuY3Rpb24gdCh0LG4pe2wuYWRkKHQsbiksaHx8KGg9eShsLmRyYWluKSl9ZnVuY3Rpb24gbih0KXt2YXIgbixlPXR5cGVvZiB0O3JldHVybiBudWxsPT10fHxcIm9iamVjdFwiIT1lJiZcImZ1bmN0aW9uXCIhPWV8fChuPXQudGhlbiksXCJmdW5jdGlvblwiPT10eXBlb2Ygbj9uOiExfWZ1bmN0aW9uIGUoKXtmb3IodmFyIHQ9MDt0PHRoaXMuY2hhaW4ubGVuZ3RoO3QrKylvKHRoaXMsMT09PXRoaXMuc3RhdGU/dGhpcy5jaGFpblt0XS5zdWNjZXNzOnRoaXMuY2hhaW5bdF0uZmFpbHVyZSx0aGlzLmNoYWluW3RdKTt0aGlzLmNoYWluLmxlbmd0aD0wfWZ1bmN0aW9uIG8odCxlLG8pe3ZhciByLGk7dHJ5e2U9PT0hMT9vLnJlamVjdCh0Lm1zZyk6KHI9ZT09PSEwP3QubXNnOmUuY2FsbCh2b2lkIDAsdC5tc2cpLHI9PT1vLnByb21pc2U/by5yZWplY3QoVHlwZUVycm9yKFwiUHJvbWlzZS1jaGFpbiBjeWNsZVwiKSk6KGk9bihyKSk/aS5jYWxsKHIsby5yZXNvbHZlLG8ucmVqZWN0KTpvLnJlc29sdmUocikpfWNhdGNoKGMpe28ucmVqZWN0KGMpfX1mdW5jdGlvbiByKG8pe3ZhciBjLHU9dGhpcztpZighdS50cmlnZ2VyZWQpe3UudHJpZ2dlcmVkPSEwLHUuZGVmJiYodT11LmRlZik7dHJ5eyhjPW4obykpP3QoZnVuY3Rpb24oKXt2YXIgdD1uZXcgZih1KTt0cnl7Yy5jYWxsKG8sZnVuY3Rpb24oKXtyLmFwcGx5KHQsYXJndW1lbnRzKX0sZnVuY3Rpb24oKXtpLmFwcGx5KHQsYXJndW1lbnRzKX0pfWNhdGNoKG4pe2kuY2FsbCh0LG4pfX0pOih1Lm1zZz1vLHUuc3RhdGU9MSx1LmNoYWluLmxlbmd0aD4wJiZ0KGUsdSkpfWNhdGNoKGEpe2kuY2FsbChuZXcgZih1KSxhKX19fWZ1bmN0aW9uIGkobil7dmFyIG89dGhpcztvLnRyaWdnZXJlZHx8KG8udHJpZ2dlcmVkPSEwLG8uZGVmJiYobz1vLmRlZiksby5tc2c9bixvLnN0YXRlPTIsby5jaGFpbi5sZW5ndGg+MCYmdChlLG8pKX1mdW5jdGlvbiBjKHQsbixlLG8pe2Zvcih2YXIgcj0wO3I8bi5sZW5ndGg7cisrKSFmdW5jdGlvbihyKXt0LnJlc29sdmUobltyXSkudGhlbihmdW5jdGlvbih0KXtlKHIsdCl9LG8pfShyKX1mdW5jdGlvbiBmKHQpe3RoaXMuZGVmPXQsdGhpcy50cmlnZ2VyZWQ9ITF9ZnVuY3Rpb24gdSh0KXt0aGlzLnByb21pc2U9dCx0aGlzLnN0YXRlPTAsdGhpcy50cmlnZ2VyZWQ9ITEsdGhpcy5jaGFpbj1bXSx0aGlzLm1zZz12b2lkIDB9ZnVuY3Rpb24gYShuKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBuKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2lmKDAhPT10aGlzLl9fTlBPX18pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgcHJvbWlzZVwiKTt0aGlzLl9fTlBPX189MTt2YXIgbz1uZXcgdSh0aGlzKTt0aGlzLnRoZW49ZnVuY3Rpb24obixyKXt2YXIgaT17c3VjY2VzczpcImZ1bmN0aW9uXCI9PXR5cGVvZiBuP246ITAsZmFpbHVyZTpcImZ1bmN0aW9uXCI9PXR5cGVvZiByP3I6ITF9O3JldHVybiBpLnByb21pc2U9bmV3IHRoaXMuY29uc3RydWN0b3IoZnVuY3Rpb24odCxuKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiB0fHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBuKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2kucmVzb2x2ZT10LGkucmVqZWN0PW59KSxvLmNoYWluLnB1c2goaSksMCE9PW8uc3RhdGUmJnQoZSxvKSxpLnByb21pc2V9LHRoaXNbXCJjYXRjaFwiXT1mdW5jdGlvbih0KXtyZXR1cm4gdGhpcy50aGVuKHZvaWQgMCx0KX07dHJ5e24uY2FsbCh2b2lkIDAsZnVuY3Rpb24odCl7ci5jYWxsKG8sdCl9LGZ1bmN0aW9uKHQpe2kuY2FsbChvLHQpfSl9Y2F0Y2goYyl7aS5jYWxsKG8sYyl9fXZhciBzLGgsbCxwPU9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcseT1cInVuZGVmaW5lZFwiIT10eXBlb2Ygc2V0SW1tZWRpYXRlP2Z1bmN0aW9uKHQpe3JldHVybiBzZXRJbW1lZGlhdGUodCl9OnNldFRpbWVvdXQ7dHJ5e09iamVjdC5kZWZpbmVQcm9wZXJ0eSh7fSxcInhcIix7fSkscz1mdW5jdGlvbih0LG4sZSxvKXtyZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KHQsbix7dmFsdWU6ZSx3cml0YWJsZTohMCxjb25maWd1cmFibGU6byE9PSExfSl9fWNhdGNoKGQpe3M9ZnVuY3Rpb24odCxuLGUpe3JldHVybiB0W25dPWUsdH19bD1mdW5jdGlvbigpe2Z1bmN0aW9uIHQodCxuKXt0aGlzLmZuPXQsdGhpcy5zZWxmPW4sdGhpcy5uZXh0PXZvaWQgMH12YXIgbixlLG87cmV0dXJue2FkZDpmdW5jdGlvbihyLGkpe289bmV3IHQocixpKSxlP2UubmV4dD1vOm49byxlPW8sbz12b2lkIDB9LGRyYWluOmZ1bmN0aW9uKCl7dmFyIHQ9bjtmb3Iobj1lPWg9dm9pZCAwO3Q7KXQuZm4uY2FsbCh0LnNlbGYpLHQ9dC5uZXh0fX19KCk7dmFyIGc9cyh7fSxcImNvbnN0cnVjdG9yXCIsYSwhMSk7cmV0dXJuIGEucHJvdG90eXBlPWcscyhnLFwiX19OUE9fX1wiLDAsITEpLHMoYSxcInJlc29sdmVcIixmdW5jdGlvbih0KXt2YXIgbj10aGlzO3JldHVybiB0JiZcIm9iamVjdFwiPT10eXBlb2YgdCYmMT09PXQuX19OUE9fXz90Om5ldyBuKGZ1bmN0aW9uKG4sZSl7aWYoXCJmdW5jdGlvblwiIT10eXBlb2Ygbnx8XCJmdW5jdGlvblwiIT10eXBlb2YgZSl0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtuKHQpfSl9KSxzKGEsXCJyZWplY3RcIixmdW5jdGlvbih0KXtyZXR1cm4gbmV3IHRoaXMoZnVuY3Rpb24obixlKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBufHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBlKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2UodCl9KX0pLHMoYSxcImFsbFwiLGZ1bmN0aW9uKHQpe3ZhciBuPXRoaXM7cmV0dXJuXCJbb2JqZWN0IEFycmF5XVwiIT1wLmNhbGwodCk/bi5yZWplY3QoVHlwZUVycm9yKFwiTm90IGFuIGFycmF5XCIpKTowPT09dC5sZW5ndGg/bi5yZXNvbHZlKFtdKTpuZXcgbihmdW5jdGlvbihlLG8pe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIGV8fFwiZnVuY3Rpb25cIiE9dHlwZW9mIG8pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7dmFyIHI9dC5sZW5ndGgsaT1BcnJheShyKSxmPTA7YyhuLHQsZnVuY3Rpb24odCxuKXtpW3RdPW4sKytmPT09ciYmZShpKX0sbyl9KX0pLHMoYSxcInJhY2VcIixmdW5jdGlvbih0KXt2YXIgbj10aGlzO3JldHVyblwiW29iamVjdCBBcnJheV1cIiE9cC5jYWxsKHQpP24ucmVqZWN0KFR5cGVFcnJvcihcIk5vdCBhbiBhcnJheVwiKSk6bmV3IG4oZnVuY3Rpb24oZSxvKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBlfHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBvKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2Mobix0LGZ1bmN0aW9uKHQsbil7ZShuKX0sbyl9KX0pLGF9KTtcbiIsIi8qXG4gKiBUaGUgTUlUIExpY2Vuc2UgKE1JVClcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTUgSmVyZW15IFdoaXRsb2NrXG4gKlxuICogUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuICogb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuICogaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuICogdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuICogY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4gKiBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4gKiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4gKiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuICogQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuICogTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbiAqIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbiAqIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBzdXBwb3J0ZWRMb2FkZXJzID0ge1xuICBmaWxlOiByZXF1aXJlKCcuL2xpYi9sb2FkZXJzL2ZpbGUnKSxcbiAgaHR0cDogcmVxdWlyZSgnLi9saWIvbG9hZGVycy9odHRwJyksXG4gIGh0dHBzOiByZXF1aXJlKCcuL2xpYi9sb2FkZXJzL2h0dHAnKVxufTtcbnZhciBkZWZhdWx0TG9hZGVyID0gdHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIGltcG9ydFNjcmlwdHMgPT09ICdmdW5jdGlvbicgP1xuICAgICAgc3VwcG9ydGVkTG9hZGVycy5odHRwIDpcbiAgICAgIHN1cHBvcnRlZExvYWRlcnMuZmlsZTtcblxuLy8gTG9hZCBwcm9taXNlcyBwb2x5ZmlsbCBpZiBuZWNlc3NhcnlcbmlmICh0eXBlb2YgUHJvbWlzZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgcmVxdWlyZSgnbmF0aXZlLXByb21pc2Utb25seScpO1xufVxuXG4vKipcbiAqIEVycm9yLWZpcnN0IGNhbGxiYWNrLlxuICpcbiAqIEBwYXJhbSB7ZXJyb3J9IFtlcnJdIC0gVGhlIGVycm9yIGlmIHRoZXJlIGlzIGEgcHJvYmxlbVxuICogQHBhcmFtIHtzdHJpbmd9IFtyZXN1bHRdIC0gVGhlIHJlc3VsdCBvZiB0aGUgZnVuY3Rpb25cbiAqXG4gKiBAY2FsbGJhY2sgcmVzdWx0Q2FsbGJhY2tcbiAqL1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgdG8gcHJvdmlkZSBhY2Nlc3MgdG8gYWx0ZXJpbmcgYSByZW1vdGUgcmVxdWVzdCBwcmlvciB0byB0aGUgcmVxdWVzdCBiZWluZyBtYWRlLlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSByZXEgLSBUaGUgU3VwZXJhZ2VudCByZXF1ZXN0IG9iamVjdFxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2F0aW9uIC0gVGhlIGxvY2F0aW9uIGJlaW5nIHJldHJpZXZlZFxuICpcbiAqIEBjYWxsYmFjayBwcmVwYXJlUmVxdWVzdENhbGxiYWNrXG4gKi9cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBsb2FkZXIgZm9yIHRoZSBnaXZlbiBsb2NhdGlvbi5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gdG8gbG9hZFxuICpcbiAqIEByZXR1cm5zIHtvYmplY3R9IFRoZSBsb2FkZXIgdG8gdXNlXG4gKi9cbmZ1bmN0aW9uIGdldExvYWRlciAobG9jYXRpb24pIHtcbiAgcmV0dXJuIHN1cHBvcnRlZExvYWRlcnNbbG9jYXRpb24uc3BsaXQoJzonKVswXV0gfHwgZGVmYXVsdExvYWRlcjtcbn1cblxuLyoqXG4gKiBMb2FkcyBhIGRvY3VtZW50IGF0IHRoZSBwcm92aWRlZCBsb2NhdGlvbiBhbmQgcmV0dXJucyBhIEphdmFTY3JpcHQgb2JqZWN0IHJlcHJlc2VudGF0aW9uLlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBsb2NhdGlvbiAtIFRoZSBsb2NhdGlvbiB0byB0aGUgZG9jdW1lbnRcbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBUaGUgb3B0aW9uc1xuICogQHBhcmFtIHtwcmVwYXJlUmVxdWVzdENhbGxiYWNrfSBbb3B0aW9ucy5wcmVwYXJlUmVxdWVzdF0gLSBUaGUgY2FsbGJhY2sgdXNlZCB0byBwcmVwYXJlIHRoZSByZXF1ZXN0XG4gKiBAcGFyYW0ge3Jlc3VsdENhbGxiYWNrfSBkb25lIC0gVGhlIHJlc3VsdCBjYWxsYmFja1xuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBBbHdheXMgcmV0dXJucyBhIHByb21pc2UgZXZlbiBpZiB0aGVyZSBpcyBhIGNhbGxiYWNrIHByb3ZpZGVkXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgY2FsbGJhY2tzXG4gKlxuICogUGF0aExvYWRlclxuICogICAubG9hZCgnLi9wYWNrYWdlLmpzb24nLCBmdW5jdGlvbiAoZXJyLCBkb2N1bWVudCkge1xuICogICAgIGlmIChlcnIpIHtcbiAqICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyLnN0YWNrKTtcbiAqICAgICB9IGVsc2Uge1xuICogICAgICAgdHJ5IHtcbiAqICAgICAgICAgZG9jdW1lbnQgPSBKU09OLnBhcnNlKGRvY3VtZW50KVxuICogICAgICAgICBjb25zb2xlLmxvZyhkb2N1bWVudC5uYW1lICsgJyAoJyArIGRvY3VtZW50LnZlcnNpb24gKyAnKTogJyArIGRvY3VtZW50LmRlc2NyaXB0aW9uKTtcbiAqICAgICAgIH0gY2F0Y2ggKGVycjIpIHtcbiAqICAgICAgICAgY2FsbGJhY2soZXJyMik7XG4gKiAgICAgICB9XG4gKiAgICAgfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgUHJvbWlzZXNcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCcuL3BhY2thZ2UuanNvbicpXG4gKiAgIC50aGVuKEpTT04ucGFyc2UpXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICogICAgIGNvbnNvbGUubG9nKGRvY3VtZW50Lm5hbWUgKyAnICgnICsgZG9jdW1lbnQudmVyc2lvbiArICcpOiAnICsgZG9jdW1lbnQuZGVzY3JpcHRpb24pO1xuICogICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gKiAgICAgY29uc29sZS5lcnJvcihlcnIuc3RhY2spO1xuICogICB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBvcHRpb25zLnByZXBhcmVSZXF1ZXN0IHRvIHByb3ZpZGUgYXV0aGVudGljYXRpb24gZGV0YWlscyBmb3IgYSByZW1vdGVseSBzZWN1cmUgVVJMXG4gKlxuICogUGF0aExvYWRlclxuICogICAubG9hZCgnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL3BhdGgtbG9hZGVyJywge1xuICogICAgIHByZXBhcmVSZXF1ZXN0OiBmdW5jdGlvbiAocmVxKSB7XG4gKiAgICAgICByZXEuYXV0aCgnbXktdXNlcm5hbWUnLCAnbXktcGFzc3dvcmQnKVxuICogICAgIH1cbiAqICAgfSlcbiAqICAgLnRoZW4oSlNPTi5wYXJzZSlcbiAqICAgLnRoZW4oZnVuY3Rpb24gKGRvY3VtZW50KSB7XG4gKiAgICAgY29uc29sZS5sb2coZG9jdW1lbnQuZnVsbF9uYW1lICsgJzogJyArIGRvY3VtZW50LmRlc2NyaXB0aW9uKTtcbiAqICAgfSwgZnVuY3Rpb24gKGVycikge1xuICogICAgIGNvbnNvbGUuZXJyb3IoZXJyLnN0YWNrKTtcbiAqICAgfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgbG9hZGluZyBhIFlBTUwgZmlsZVxuICpcbiAqIFBhdGhMb2FkZXJcbiAqICAgLmxvYWQoJy9Vc2Vycy9ub3QteW91L3Byb2plY3RzL3BhdGgtbG9hZGVyLy50cmF2aXMueW1sJylcbiAqICAgLnRoZW4oWUFNTC5zYWZlTG9hZClcbiAqICAgLnRoZW4oZnVuY3Rpb24gKGRvY3VtZW50KSB7XG4gKiAgICAgY29uc29sZS5sb2coJ3BhdGgtbG9hZGVyIHVzZXMgdGhlJywgZG9jdW1lbnQubGFuZ3VhZ2UsICdsYW5ndWFnZS4nKTtcbiAqICAgfSwgZnVuY3Rpb24gKGVycikge1xuICogICAgIGNvbnNvbGUuZXJyb3IoZXJyLnN0YWNrKTtcbiAqICAgfSk7XG4gKi9cbm1vZHVsZS5leHBvcnRzLmxvYWQgPSBmdW5jdGlvbiAobG9jYXRpb24sIG9wdGlvbnMsIGRvbmUpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDIgJiYgdHlwZW9mIG9wdGlvbnMgPT09ICdmdW5jdGlvbicpIHtcbiAgICBkb25lID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgYXJndW1lbnRzXG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHR5cGVvZiBsb2NhdGlvbiA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xvY2F0aW9uIGlzIHJlcXVpcmVkJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgbG9jYXRpb24gIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsb2NhdGlvbiBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBvcHRpb25zICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgaWYgKHR5cGVvZiBvcHRpb25zICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zIG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRvbmUgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBkb25lICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIExvYWQgdGhlIGRvY3VtZW50IGZyb20gdGhlIHByb3ZpZGVkIGxvY2F0aW9uIGFuZCBwcm9jZXNzIGl0XG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHZhciBsb2FkZXIgPSBnZXRMb2FkZXIobG9jYXRpb24pO1xuXG4gICAgICBsb2FkZXIubG9hZChsb2NhdGlvbiwgb3B0aW9ucywgZnVuY3Rpb24gKGVyciwgZG9jdW1lbnQpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmUoZG9jdW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gVXNlIHRoZSBjYWxsYmFjayBpZiBwcm92aWRlZCBhbmQgaXQgaXMgYSBmdW5jdGlvblxuICBpZiAodHlwZW9mIGRvbmUgPT09ICdmdW5jdGlvbicpIHtcbiAgICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgICAudGhlbihmdW5jdGlvbiAoZG9jdW1lbnQpIHtcbiAgICAgICAgZG9uZSh1bmRlZmluZWQsIGRvY3VtZW50KTtcbiAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgZG9uZShlcnIpO1xuICAgICAgfSk7XG4gIH1cblxuICByZXR1cm4gYWxsVGFza3M7XG59O1xuIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNSBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBMb2FkcyBhIGZpbGUgZnJvbSB0aGUgZmlsZXN5c3RlbS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgZmlsZXN5c3RlbSBsb2NhdGlvbiAoSWYgcmVsYXRpdmUsIGxvY2F0aW9uIGlzIHJlbGF0aXZlIHRvIHByb2Nlc3MuY3dkKCkpLlxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBUaGUgbG9hZGVyIG9wdGlvbnMgKFVudXNlZClcbiAqIEBwYXJhbSB7ZnVuY3Rpb259IGNhbGxiYWNrIC0gVGhlIGVycm9yLWZpcnN0IGNhbGxiYWNrXG4gKi9cbm1vZHVsZS5leHBvcnRzLmxvYWQgPSBmdW5jdGlvbiAobG9jYXRpb24sIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIGNhbGxiYWNrKG5ldyBUeXBlRXJyb3IoJ1RoZSBcXCdmaWxlXFwnIHNjaGVtZSBpcyBub3Qgc3VwcG9ydGVkIGluIHRoZSBicm93c2VyJykpO1xufTtcbiIsIi8qZXNsaW50LWVudiBub2RlLCBicm93c2VyICovXG5cbi8qXG4gKiBUaGUgTUlUIExpY2Vuc2UgKE1JVClcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTUgSmVyZW15IFdoaXRsb2NrXG4gKlxuICogUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuICogb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuICogaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuICogdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuICogY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4gKiBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4gKiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4gKiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuICogQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuICogTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbiAqIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbiAqIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciByZXF1ZXN0ID0gcmVxdWlyZSgnc3VwZXJhZ2VudCcpO1xuXG52YXIgc3VwcG9ydGVkSHR0cE1ldGhvZHMgPSBbJ2RlbGV0ZScsICdnZXQnLCAnaGVhZCcsICdwYXRjaCcsICdwb3N0JywgJ3B1dCddO1xuXG4vKipcbiAqIExvYWRzIGEgZmlsZSBmcm9tIGFuIGh0dHAgb3IgaHR0cHMgVVJMLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhdGlvbiAtIFRoZSBkb2N1bWVudCBVUkwgKElmIHJlbGF0aXZlLCBsb2NhdGlvbiBpcyByZWxhdGl2ZSB0byB3aW5kb3cubG9jYXRpb24pLlxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBUaGUgbG9hZGVyIG9wdGlvbnNcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5tZXRob2Q9Z2V0XSAtIFRoZSBIVFRQIG1ldGhvZCB0byB1c2UgZm9yIHRoZSByZXF1ZXN0XG4gKiBAcGFyYW0ge3ByZXBhcmVSZXF1ZXN0Q2FsbGJhY2t9IFtvcHRpb25zLnByZXBhcmVSZXF1ZXN0XSAtIFRoZSBjYWxsYmFjayB1c2VkIHRvIHByZXBhcmUgYSByZXF1ZXN0XG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIFRoZSBlcnJvci1maXJzdCBjYWxsYmFja1xuICovXG5tb2R1bGUuZXhwb3J0cy5sb2FkID0gZnVuY3Rpb24gKGxvY2F0aW9uLCBvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgcmVhbFVybCA9IGxvY2F0aW9uLnNwbGl0KCcjJylbMF07XG4gIHZhciByZWFsTWV0aG9kID0gb3B0aW9ucy5tZXRob2QgPyBvcHRpb25zLm1ldGhvZC50b0xvd2VyQ2FzZSgpIDogJ2dldCc7XG4gIHZhciBlcnI7XG4gIHZhciByZWFsUmVxdWVzdDtcblxuICBpZiAodHlwZW9mIG9wdGlvbnMucHJlcGFyZVJlcXVlc3QgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBvcHRpb25zLnByZXBhcmVSZXF1ZXN0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgZXJyID0gbmV3IFR5cGVFcnJvcignb3B0aW9ucy5wcmVwYXJlUmVxdWVzdCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfSBlbHNlIGlmICh0eXBlb2Ygb3B0aW9ucy5tZXRob2QgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLm1ldGhvZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGVyciA9IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMubWV0aG9kIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9IGVsc2UgaWYgKHN1cHBvcnRlZEh0dHBNZXRob2RzLmluZGV4T2Yob3B0aW9ucy5tZXRob2QpID09PSAtMSkge1xuICAgICAgZXJyID0gbmV3IFR5cGVFcnJvcignb3B0aW9ucy5tZXRob2QgbXVzdCBiZSBvbmUgb2YgdGhlIGZvbGxvd2luZzogJyArXG4gICAgICAgIHN1cHBvcnRlZEh0dHBNZXRob2RzLnNsaWNlKDAsIHN1cHBvcnRlZEh0dHBNZXRob2RzLmxlbmd0aCAtIDEpLmpvaW4oJywgJykgKyAnIG9yICcgK1xuICAgICAgICBzdXBwb3J0ZWRIdHRwTWV0aG9kc1tzdXBwb3J0ZWRIdHRwTWV0aG9kcy5sZW5ndGggLSAxXSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFlcnIpIHtcbiAgICByZWFsUmVxdWVzdCA9IHJlcXVlc3RbcmVhbE1ldGhvZCA9PT0gJ2RlbGV0ZScgPyAnZGVsJyA6IHJlYWxNZXRob2RdKHJlYWxVcmwpO1xuXG4gICAgaWYgKG9wdGlvbnMucHJlcGFyZVJlcXVlc3QpIHtcbiAgICAgIG9wdGlvbnMucHJlcGFyZVJlcXVlc3QocmVhbFJlcXVlc3QpO1xuICAgIH1cblxuICAgIC8vIGJ1ZmZlcigpIGlzIG9ubHkgYXZhaWxhYmxlIGluIE5vZGUuanNcbiAgICBpZiAodHlwZW9mIHJlYWxSZXF1ZXN0LmJ1ZmZlciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmVhbFJlcXVlc3QuYnVmZmVyKHRydWUpO1xuICAgIH1cblxuICAgIHJlYWxSZXF1ZXN0XG4gICAgICAuZW5kKGZ1bmN0aW9uIChlcnIyLCByZXMpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyMiwgcmVzID8gcmVzLnRleHQgOiByZXMpO1xuICAgICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgY2FsbGJhY2soZXJyKTtcbiAgfVxufTtcbiIsIi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIgRW1pdHRlciA9IHJlcXVpcmUoJ2VtaXR0ZXInKTtcbnZhciByZWR1Y2UgPSByZXF1aXJlKCdyZWR1Y2UnKTtcblxuLyoqXG4gKiBSb290IHJlZmVyZW5jZSBmb3IgaWZyYW1lcy5cbiAqL1xuXG52YXIgcm9vdDtcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykgeyAvLyBCcm93c2VyIHdpbmRvd1xuICByb290ID0gd2luZG93O1xufSBlbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsgLy8gV2ViIFdvcmtlclxuICByb290ID0gc2VsZjtcbn0gZWxzZSB7IC8vIE90aGVyIGVudmlyb25tZW50c1xuICByb290ID0gdGhpcztcbn1cblxuLyoqXG4gKiBOb29wLlxuICovXG5cbmZ1bmN0aW9uIG5vb3AoKXt9O1xuXG4vKipcbiAqIENoZWNrIGlmIGBvYmpgIGlzIGEgaG9zdCBvYmplY3QsXG4gKiB3ZSBkb24ndCB3YW50IHRvIHNlcmlhbGl6ZSB0aGVzZSA6KVxuICpcbiAqIFRPRE86IGZ1dHVyZSBwcm9vZiwgbW92ZSB0byBjb21wb2VudCBsYW5kXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGlzSG9zdChvYmopIHtcbiAgdmFyIHN0ciA9IHt9LnRvU3RyaW5nLmNhbGwob2JqKTtcblxuICBzd2l0Y2ggKHN0cikge1xuICAgIGNhc2UgJ1tvYmplY3QgRmlsZV0nOlxuICAgIGNhc2UgJ1tvYmplY3QgQmxvYl0nOlxuICAgIGNhc2UgJ1tvYmplY3QgRm9ybURhdGFdJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgWEhSLlxuICovXG5cbnJlcXVlc3QuZ2V0WEhSID0gZnVuY3Rpb24gKCkge1xuICBpZiAocm9vdC5YTUxIdHRwUmVxdWVzdFxuICAgICAgJiYgKCFyb290LmxvY2F0aW9uIHx8ICdmaWxlOicgIT0gcm9vdC5sb2NhdGlvbi5wcm90b2NvbFxuICAgICAgICAgIHx8ICFyb290LkFjdGl2ZVhPYmplY3QpKSB7XG4gICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdDtcbiAgfSBlbHNlIHtcbiAgICB0cnkgeyByZXR1cm4gbmV3IEFjdGl2ZVhPYmplY3QoJ01pY3Jvc29mdC5YTUxIVFRQJyk7IH0gY2F0Y2goZSkge31cbiAgICB0cnkgeyByZXR1cm4gbmV3IEFjdGl2ZVhPYmplY3QoJ01zeG1sMi5YTUxIVFRQLjYuMCcpOyB9IGNhdGNoKGUpIHt9XG4gICAgdHJ5IHsgcmV0dXJuIG5ldyBBY3RpdmVYT2JqZWN0KCdNc3htbDIuWE1MSFRUUC4zLjAnKTsgfSBjYXRjaChlKSB7fVxuICAgIHRyeSB7IHJldHVybiBuZXcgQWN0aXZlWE9iamVjdCgnTXN4bWwyLlhNTEhUVFAnKTsgfSBjYXRjaChlKSB7fVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbi8qKlxuICogUmVtb3ZlcyBsZWFkaW5nIGFuZCB0cmFpbGluZyB3aGl0ZXNwYWNlLCBhZGRlZCB0byBzdXBwb3J0IElFLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG52YXIgdHJpbSA9ICcnLnRyaW1cbiAgPyBmdW5jdGlvbihzKSB7IHJldHVybiBzLnRyaW0oKTsgfVxuICA6IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMucmVwbGFjZSgvKF5cXHMqfFxccyokKS9nLCAnJyk7IH07XG5cbi8qKlxuICogQ2hlY2sgaWYgYG9iamAgaXMgYW4gb2JqZWN0LlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBpc09iamVjdChvYmopIHtcbiAgcmV0dXJuIG9iaiA9PT0gT2JqZWN0KG9iaik7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIHRoZSBnaXZlbiBgb2JqYC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzZXJpYWxpemUob2JqKSB7XG4gIGlmICghaXNPYmplY3Qob2JqKSkgcmV0dXJuIG9iajtcbiAgdmFyIHBhaXJzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICBpZiAobnVsbCAhPSBvYmpba2V5XSkge1xuICAgICAgcGFpcnMucHVzaChlbmNvZGVVUklDb21wb25lbnQoa2V5KVxuICAgICAgICArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudChvYmpba2V5XSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFpcnMuam9pbignJicpO1xufVxuXG4vKipcbiAqIEV4cG9zZSBzZXJpYWxpemF0aW9uIG1ldGhvZC5cbiAqL1xuXG4gcmVxdWVzdC5zZXJpYWxpemVPYmplY3QgPSBzZXJpYWxpemU7XG5cbiAvKipcbiAgKiBQYXJzZSB0aGUgZ2l2ZW4geC13d3ctZm9ybS11cmxlbmNvZGVkIGBzdHJgLlxuICAqXG4gICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICAqIEByZXR1cm4ge09iamVjdH1cbiAgKiBAYXBpIHByaXZhdGVcbiAgKi9cblxuZnVuY3Rpb24gcGFyc2VTdHJpbmcoc3RyKSB7XG4gIHZhciBvYmogPSB7fTtcbiAgdmFyIHBhaXJzID0gc3RyLnNwbGl0KCcmJyk7XG4gIHZhciBwYXJ0cztcbiAgdmFyIHBhaXI7XG5cbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHBhaXJzLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gICAgcGFpciA9IHBhaXJzW2ldO1xuICAgIHBhcnRzID0gcGFpci5zcGxpdCgnPScpO1xuICAgIG9ialtkZWNvZGVVUklDb21wb25lbnQocGFydHNbMF0pXSA9IGRlY29kZVVSSUNvbXBvbmVudChwYXJ0c1sxXSk7XG4gIH1cblxuICByZXR1cm4gb2JqO1xufVxuXG4vKipcbiAqIEV4cG9zZSBwYXJzZXIuXG4gKi9cblxucmVxdWVzdC5wYXJzZVN0cmluZyA9IHBhcnNlU3RyaW5nO1xuXG4vKipcbiAqIERlZmF1bHQgTUlNRSB0eXBlIG1hcC5cbiAqXG4gKiAgICAgc3VwZXJhZ2VudC50eXBlcy54bWwgPSAnYXBwbGljYXRpb24veG1sJztcbiAqXG4gKi9cblxucmVxdWVzdC50eXBlcyA9IHtcbiAgaHRtbDogJ3RleHQvaHRtbCcsXG4gIGpzb246ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgeG1sOiAnYXBwbGljYXRpb24veG1sJyxcbiAgdXJsZW5jb2RlZDogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXG4gICdmb3JtJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXG4gICdmb3JtLWRhdGEnOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1xufTtcblxuLyoqXG4gKiBEZWZhdWx0IHNlcmlhbGl6YXRpb24gbWFwLlxuICpcbiAqICAgICBzdXBlcmFnZW50LnNlcmlhbGl6ZVsnYXBwbGljYXRpb24veG1sJ10gPSBmdW5jdGlvbihvYmope1xuICogICAgICAgcmV0dXJuICdnZW5lcmF0ZWQgeG1sIGhlcmUnO1xuICogICAgIH07XG4gKlxuICovXG5cbiByZXF1ZXN0LnNlcmlhbGl6ZSA9IHtcbiAgICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiBzZXJpYWxpemUsXG4gICAnYXBwbGljYXRpb24vanNvbic6IEpTT04uc3RyaW5naWZ5XG4gfTtcblxuIC8qKlxuICAqIERlZmF1bHQgcGFyc2Vycy5cbiAgKlxuICAqICAgICBzdXBlcmFnZW50LnBhcnNlWydhcHBsaWNhdGlvbi94bWwnXSA9IGZ1bmN0aW9uKHN0cil7XG4gICogICAgICAgcmV0dXJuIHsgb2JqZWN0IHBhcnNlZCBmcm9tIHN0ciB9O1xuICAqICAgICB9O1xuICAqXG4gICovXG5cbnJlcXVlc3QucGFyc2UgPSB7XG4gICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnOiBwYXJzZVN0cmluZyxcbiAgJ2FwcGxpY2F0aW9uL2pzb24nOiBKU09OLnBhcnNlXG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBoZWFkZXIgYHN0cmAgaW50b1xuICogYW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIG1hcHBlZCBmaWVsZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gcGFyc2VIZWFkZXIoc3RyKSB7XG4gIHZhciBsaW5lcyA9IHN0ci5zcGxpdCgvXFxyP1xcbi8pO1xuICB2YXIgZmllbGRzID0ge307XG4gIHZhciBpbmRleDtcbiAgdmFyIGxpbmU7XG4gIHZhciBmaWVsZDtcbiAgdmFyIHZhbDtcblxuICBsaW5lcy5wb3AoKTsgLy8gdHJhaWxpbmcgQ1JMRlxuXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBsaW5lcy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xuICAgIGxpbmUgPSBsaW5lc1tpXTtcbiAgICBpbmRleCA9IGxpbmUuaW5kZXhPZignOicpO1xuICAgIGZpZWxkID0gbGluZS5zbGljZSgwLCBpbmRleCkudG9Mb3dlckNhc2UoKTtcbiAgICB2YWwgPSB0cmltKGxpbmUuc2xpY2UoaW5kZXggKyAxKSk7XG4gICAgZmllbGRzW2ZpZWxkXSA9IHZhbDtcbiAgfVxuXG4gIHJldHVybiBmaWVsZHM7XG59XG5cbi8qKlxuICogUmV0dXJuIHRoZSBtaW1lIHR5cGUgZm9yIHRoZSBnaXZlbiBgc3RyYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiB0eXBlKHN0cil7XG4gIHJldHVybiBzdHIuc3BsaXQoLyAqOyAqLykuc2hpZnQoKTtcbn07XG5cbi8qKlxuICogUmV0dXJuIGhlYWRlciBmaWVsZCBwYXJhbWV0ZXJzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcmFtcyhzdHIpe1xuICByZXR1cm4gcmVkdWNlKHN0ci5zcGxpdCgvICo7ICovKSwgZnVuY3Rpb24ob2JqLCBzdHIpe1xuICAgIHZhciBwYXJ0cyA9IHN0ci5zcGxpdCgvICo9ICovKVxuICAgICAgLCBrZXkgPSBwYXJ0cy5zaGlmdCgpXG4gICAgICAsIHZhbCA9IHBhcnRzLnNoaWZ0KCk7XG5cbiAgICBpZiAoa2V5ICYmIHZhbCkgb2JqW2tleV0gPSB2YWw7XG4gICAgcmV0dXJuIG9iajtcbiAgfSwge30pO1xufTtcblxuLyoqXG4gKiBJbml0aWFsaXplIGEgbmV3IGBSZXNwb25zZWAgd2l0aCB0aGUgZ2l2ZW4gYHhocmAuXG4gKlxuICogIC0gc2V0IGZsYWdzICgub2ssIC5lcnJvciwgZXRjKVxuICogIC0gcGFyc2UgaGVhZGVyXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogIEFsaWFzaW5nIGBzdXBlcmFnZW50YCBhcyBgcmVxdWVzdGAgaXMgbmljZTpcbiAqXG4gKiAgICAgIHJlcXVlc3QgPSBzdXBlcmFnZW50O1xuICpcbiAqICBXZSBjYW4gdXNlIHRoZSBwcm9taXNlLWxpa2UgQVBJLCBvciBwYXNzIGNhbGxiYWNrczpcbiAqXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvJykuZW5kKGZ1bmN0aW9uKHJlcyl7fSk7XG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvJywgZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiAgU2VuZGluZyBkYXRhIGNhbiBiZSBjaGFpbmVkOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0pXG4gKiAgICAgICAgLmVuZChmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqICBPciBwYXNzZWQgdG8gYC5zZW5kKClgOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0sIGZ1bmN0aW9uKHJlcyl7fSk7XG4gKlxuICogIE9yIHBhc3NlZCB0byBgLnBvc3QoKWA6XG4gKlxuICogICAgICByZXF1ZXN0XG4gKiAgICAgICAgLnBvc3QoJy91c2VyJywgeyBuYW1lOiAndGonIH0pXG4gKiAgICAgICAgLmVuZChmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqIE9yIGZ1cnRoZXIgcmVkdWNlZCB0byBhIHNpbmdsZSBjYWxsIGZvciBzaW1wbGUgY2FzZXM6XG4gKlxuICogICAgICByZXF1ZXN0XG4gKiAgICAgICAgLnBvc3QoJy91c2VyJywgeyBuYW1lOiAndGonIH0sIGZ1bmN0aW9uKHJlcyl7fSk7XG4gKlxuICogQHBhcmFtIHtYTUxIVFRQUmVxdWVzdH0geGhyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gUmVzcG9uc2UocmVxLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICB0aGlzLnJlcSA9IHJlcTtcbiAgdGhpcy54aHIgPSB0aGlzLnJlcS54aHI7XG4gIC8vIHJlc3BvbnNlVGV4dCBpcyBhY2Nlc3NpYmxlIG9ubHkgaWYgcmVzcG9uc2VUeXBlIGlzICcnIG9yICd0ZXh0JyBhbmQgb24gb2xkZXIgYnJvd3NlcnNcbiAgdGhpcy50ZXh0ID0gKCh0aGlzLnJlcS5tZXRob2QgIT0nSEVBRCcgJiYgKHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJycgfHwgdGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAndGV4dCcpKSB8fCB0eXBlb2YgdGhpcy54aHIucmVzcG9uc2VUeXBlID09PSAndW5kZWZpbmVkJylcbiAgICAgPyB0aGlzLnhoci5yZXNwb25zZVRleHRcbiAgICAgOiBudWxsO1xuICB0aGlzLnN0YXR1c1RleHQgPSB0aGlzLnJlcS54aHIuc3RhdHVzVGV4dDtcbiAgdGhpcy5zZXRTdGF0dXNQcm9wZXJ0aWVzKHRoaXMueGhyLnN0YXR1cyk7XG4gIHRoaXMuaGVhZGVyID0gdGhpcy5oZWFkZXJzID0gcGFyc2VIZWFkZXIodGhpcy54aHIuZ2V0QWxsUmVzcG9uc2VIZWFkZXJzKCkpO1xuICAvLyBnZXRBbGxSZXNwb25zZUhlYWRlcnMgc29tZXRpbWVzIGZhbHNlbHkgcmV0dXJucyBcIlwiIGZvciBDT1JTIHJlcXVlc3RzLCBidXRcbiAgLy8gZ2V0UmVzcG9uc2VIZWFkZXIgc3RpbGwgd29ya3MuIHNvIHdlIGdldCBjb250ZW50LXR5cGUgZXZlbiBpZiBnZXR0aW5nXG4gIC8vIG90aGVyIGhlYWRlcnMgZmFpbHMuXG4gIHRoaXMuaGVhZGVyWydjb250ZW50LXR5cGUnXSA9IHRoaXMueGhyLmdldFJlc3BvbnNlSGVhZGVyKCdjb250ZW50LXR5cGUnKTtcbiAgdGhpcy5zZXRIZWFkZXJQcm9wZXJ0aWVzKHRoaXMuaGVhZGVyKTtcbiAgdGhpcy5ib2R5ID0gdGhpcy5yZXEubWV0aG9kICE9ICdIRUFEJ1xuICAgID8gdGhpcy5wYXJzZUJvZHkodGhpcy50ZXh0ID8gdGhpcy50ZXh0IDogdGhpcy54aHIucmVzcG9uc2UpXG4gICAgOiBudWxsO1xufVxuXG4vKipcbiAqIEdldCBjYXNlLWluc2Vuc2l0aXZlIGBmaWVsZGAgdmFsdWUuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGZpZWxkXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlc3BvbnNlLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihmaWVsZCl7XG4gIHJldHVybiB0aGlzLmhlYWRlcltmaWVsZC50b0xvd2VyQ2FzZSgpXTtcbn07XG5cbi8qKlxuICogU2V0IGhlYWRlciByZWxhdGVkIHByb3BlcnRpZXM6XG4gKlxuICogICAtIGAudHlwZWAgdGhlIGNvbnRlbnQgdHlwZSB3aXRob3V0IHBhcmFtc1xuICpcbiAqIEEgcmVzcG9uc2Ugb2YgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9dXRmLThcIlxuICogd2lsbCBwcm92aWRlIHlvdSB3aXRoIGEgYC50eXBlYCBvZiBcInRleHQvcGxhaW5cIi5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gaGVhZGVyXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXNwb25zZS5wcm90b3R5cGUuc2V0SGVhZGVyUHJvcGVydGllcyA9IGZ1bmN0aW9uKGhlYWRlcil7XG4gIC8vIGNvbnRlbnQtdHlwZVxuICB2YXIgY3QgPSB0aGlzLmhlYWRlclsnY29udGVudC10eXBlJ10gfHwgJyc7XG4gIHRoaXMudHlwZSA9IHR5cGUoY3QpO1xuXG4gIC8vIHBhcmFtc1xuICB2YXIgb2JqID0gcGFyYW1zKGN0KTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikgdGhpc1trZXldID0gb2JqW2tleV07XG59O1xuXG4vKipcbiAqIEZvcmNlIGdpdmVuIHBhcnNlclxuICogXG4gKiBTZXRzIHRoZSBib2R5IHBhcnNlciBubyBtYXR0ZXIgdHlwZS5cbiAqIFxuICogQHBhcmFtIHtGdW5jdGlvbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnBhcnNlID0gZnVuY3Rpb24oZm4pe1xuICB0aGlzLnBhcnNlciA9IGZuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUGFyc2UgdGhlIGdpdmVuIGJvZHkgYHN0cmAuXG4gKlxuICogVXNlZCBmb3IgYXV0by1wYXJzaW5nIG9mIGJvZGllcy4gUGFyc2Vyc1xuICogYXJlIGRlZmluZWQgb24gdGhlIGBzdXBlcmFnZW50LnBhcnNlYCBvYmplY3QuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7TWl4ZWR9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXNwb25zZS5wcm90b3R5cGUucGFyc2VCb2R5ID0gZnVuY3Rpb24oc3RyKXtcbiAgdmFyIHBhcnNlID0gdGhpcy5wYXJzZXIgfHwgcmVxdWVzdC5wYXJzZVt0aGlzLnR5cGVdO1xuICByZXR1cm4gcGFyc2UgJiYgc3RyICYmIChzdHIubGVuZ3RoIHx8IHN0ciBpbnN0YW5jZW9mIE9iamVjdClcbiAgICA/IHBhcnNlKHN0cilcbiAgICA6IG51bGw7XG59O1xuXG4vKipcbiAqIFNldCBmbGFncyBzdWNoIGFzIGAub2tgIGJhc2VkIG9uIGBzdGF0dXNgLlxuICpcbiAqIEZvciBleGFtcGxlIGEgMnh4IHJlc3BvbnNlIHdpbGwgZ2l2ZSB5b3UgYSBgLm9rYCBvZiBfX3RydWVfX1xuICogd2hlcmVhcyA1eHggd2lsbCBiZSBfX2ZhbHNlX18gYW5kIGAuZXJyb3JgIHdpbGwgYmUgX190cnVlX18uIFRoZVxuICogYC5jbGllbnRFcnJvcmAgYW5kIGAuc2VydmVyRXJyb3JgIGFyZSBhbHNvIGF2YWlsYWJsZSB0byBiZSBtb3JlXG4gKiBzcGVjaWZpYywgYW5kIGAuc3RhdHVzVHlwZWAgaXMgdGhlIGNsYXNzIG9mIGVycm9yIHJhbmdpbmcgZnJvbSAxLi41XG4gKiBzb21ldGltZXMgdXNlZnVsIGZvciBtYXBwaW5nIHJlc3BvbmQgY29sb3JzIGV0Yy5cbiAqXG4gKiBcInN1Z2FyXCIgcHJvcGVydGllcyBhcmUgYWxzbyBkZWZpbmVkIGZvciBjb21tb24gY2FzZXMuIEN1cnJlbnRseSBwcm92aWRpbmc6XG4gKlxuICogICAtIC5ub0NvbnRlbnRcbiAqICAgLSAuYmFkUmVxdWVzdFxuICogICAtIC51bmF1dGhvcml6ZWRcbiAqICAgLSAubm90QWNjZXB0YWJsZVxuICogICAtIC5ub3RGb3VuZFxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBzdGF0dXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlc3BvbnNlLnByb3RvdHlwZS5zZXRTdGF0dXNQcm9wZXJ0aWVzID0gZnVuY3Rpb24oc3RhdHVzKXtcbiAgLy8gaGFuZGxlIElFOSBidWc6IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMTAwNDY5NzIvbXNpZS1yZXR1cm5zLXN0YXR1cy1jb2RlLW9mLTEyMjMtZm9yLWFqYXgtcmVxdWVzdFxuICBpZiAoc3RhdHVzID09PSAxMjIzKSB7XG4gICAgc3RhdHVzID0gMjA0O1xuICB9XG5cbiAgdmFyIHR5cGUgPSBzdGF0dXMgLyAxMDAgfCAwO1xuXG4gIC8vIHN0YXR1cyAvIGNsYXNzXG4gIHRoaXMuc3RhdHVzID0gdGhpcy5zdGF0dXNDb2RlID0gc3RhdHVzO1xuICB0aGlzLnN0YXR1c1R5cGUgPSB0eXBlO1xuXG4gIC8vIGJhc2ljc1xuICB0aGlzLmluZm8gPSAxID09IHR5cGU7XG4gIHRoaXMub2sgPSAyID09IHR5cGU7XG4gIHRoaXMuY2xpZW50RXJyb3IgPSA0ID09IHR5cGU7XG4gIHRoaXMuc2VydmVyRXJyb3IgPSA1ID09IHR5cGU7XG4gIHRoaXMuZXJyb3IgPSAoNCA9PSB0eXBlIHx8IDUgPT0gdHlwZSlcbiAgICA/IHRoaXMudG9FcnJvcigpXG4gICAgOiBmYWxzZTtcblxuICAvLyBzdWdhclxuICB0aGlzLmFjY2VwdGVkID0gMjAyID09IHN0YXR1cztcbiAgdGhpcy5ub0NvbnRlbnQgPSAyMDQgPT0gc3RhdHVzO1xuICB0aGlzLmJhZFJlcXVlc3QgPSA0MDAgPT0gc3RhdHVzO1xuICB0aGlzLnVuYXV0aG9yaXplZCA9IDQwMSA9PSBzdGF0dXM7XG4gIHRoaXMubm90QWNjZXB0YWJsZSA9IDQwNiA9PSBzdGF0dXM7XG4gIHRoaXMubm90Rm91bmQgPSA0MDQgPT0gc3RhdHVzO1xuICB0aGlzLmZvcmJpZGRlbiA9IDQwMyA9PSBzdGF0dXM7XG59O1xuXG4vKipcbiAqIFJldHVybiBhbiBgRXJyb3JgIHJlcHJlc2VudGF0aXZlIG9mIHRoaXMgcmVzcG9uc2UuXG4gKlxuICogQHJldHVybiB7RXJyb3J9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlc3BvbnNlLnByb3RvdHlwZS50b0Vycm9yID0gZnVuY3Rpb24oKXtcbiAgdmFyIHJlcSA9IHRoaXMucmVxO1xuICB2YXIgbWV0aG9kID0gcmVxLm1ldGhvZDtcbiAgdmFyIHVybCA9IHJlcS51cmw7XG5cbiAgdmFyIG1zZyA9ICdjYW5ub3QgJyArIG1ldGhvZCArICcgJyArIHVybCArICcgKCcgKyB0aGlzLnN0YXR1cyArICcpJztcbiAgdmFyIGVyciA9IG5ldyBFcnJvcihtc2cpO1xuICBlcnIuc3RhdHVzID0gdGhpcy5zdGF0dXM7XG4gIGVyci5tZXRob2QgPSBtZXRob2Q7XG4gIGVyci51cmwgPSB1cmw7XG5cbiAgcmV0dXJuIGVycjtcbn07XG5cbi8qKlxuICogRXhwb3NlIGBSZXNwb25zZWAuXG4gKi9cblxucmVxdWVzdC5SZXNwb25zZSA9IFJlc3BvbnNlO1xuXG4vKipcbiAqIEluaXRpYWxpemUgYSBuZXcgYFJlcXVlc3RgIHdpdGggdGhlIGdpdmVuIGBtZXRob2RgIGFuZCBgdXJsYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIFJlcXVlc3QobWV0aG9kLCB1cmwpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBFbWl0dGVyLmNhbGwodGhpcyk7XG4gIHRoaXMuX3F1ZXJ5ID0gdGhpcy5fcXVlcnkgfHwgW107XG4gIHRoaXMubWV0aG9kID0gbWV0aG9kO1xuICB0aGlzLnVybCA9IHVybDtcbiAgdGhpcy5oZWFkZXIgPSB7fTtcbiAgdGhpcy5faGVhZGVyID0ge307XG4gIHRoaXMub24oJ2VuZCcsIGZ1bmN0aW9uKCl7XG4gICAgdmFyIGVyciA9IG51bGw7XG4gICAgdmFyIHJlcyA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzID0gbmV3IFJlc3BvbnNlKHNlbGYpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgZXJyID0gbmV3IEVycm9yKCdQYXJzZXIgaXMgdW5hYmxlIHRvIHBhcnNlIHRoZSByZXNwb25zZScpO1xuICAgICAgZXJyLnBhcnNlID0gdHJ1ZTtcbiAgICAgIGVyci5vcmlnaW5hbCA9IGU7XG4gICAgICByZXR1cm4gc2VsZi5jYWxsYmFjayhlcnIpO1xuICAgIH1cblxuICAgIHNlbGYuZW1pdCgncmVzcG9uc2UnLCByZXMpO1xuXG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIHNlbGYuY2FsbGJhY2soZXJyLCByZXMpO1xuICAgIH1cblxuICAgIGlmIChyZXMuc3RhdHVzID49IDIwMCAmJiByZXMuc3RhdHVzIDwgMzAwKSB7XG4gICAgICByZXR1cm4gc2VsZi5jYWxsYmFjayhlcnIsIHJlcyk7XG4gICAgfVxuXG4gICAgdmFyIG5ld19lcnIgPSBuZXcgRXJyb3IocmVzLnN0YXR1c1RleHQgfHwgJ1Vuc3VjY2Vzc2Z1bCBIVFRQIHJlc3BvbnNlJyk7XG4gICAgbmV3X2Vyci5vcmlnaW5hbCA9IGVycjtcbiAgICBuZXdfZXJyLnJlc3BvbnNlID0gcmVzO1xuICAgIG5ld19lcnIuc3RhdHVzID0gcmVzLnN0YXR1cztcblxuICAgIHNlbGYuY2FsbGJhY2sobmV3X2VyciwgcmVzKTtcbiAgfSk7XG59XG5cbi8qKlxuICogTWl4aW4gYEVtaXR0ZXJgLlxuICovXG5cbkVtaXR0ZXIoUmVxdWVzdC5wcm90b3R5cGUpO1xuXG4vKipcbiAqIEFsbG93IGZvciBleHRlbnNpb25cbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihmbikge1xuICBmbih0aGlzKTtcbiAgcmV0dXJuIHRoaXM7XG59XG5cbi8qKlxuICogU2V0IHRpbWVvdXQgdG8gYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50aW1lb3V0ID0gZnVuY3Rpb24obXMpe1xuICB0aGlzLl90aW1lb3V0ID0gbXM7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBDbGVhciBwcmV2aW91cyB0aW1lb3V0LlxuICpcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5jbGVhclRpbWVvdXQgPSBmdW5jdGlvbigpe1xuICB0aGlzLl90aW1lb3V0ID0gMDtcbiAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpbWVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFib3J0IHRoZSByZXF1ZXN0LCBhbmQgY2xlYXIgcG90ZW50aWFsIHRpbWVvdXQuXG4gKlxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYWJvcnQgPSBmdW5jdGlvbigpe1xuICBpZiAodGhpcy5hYm9ydGVkKSByZXR1cm47XG4gIHRoaXMuYWJvcnRlZCA9IHRydWU7XG4gIHRoaXMueGhyLmFib3J0KCk7XG4gIHRoaXMuY2xlYXJUaW1lb3V0KCk7XG4gIHRoaXMuZW1pdCgnYWJvcnQnKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCBoZWFkZXIgYGZpZWxkYCB0byBgdmFsYCwgb3IgbXVsdGlwbGUgZmllbGRzIHdpdGggb25lIG9iamVjdC5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC5zZXQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJylcbiAqICAgICAgICAuc2V0KCdYLUFQSS1LZXknLCAnZm9vYmFyJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC5zZXQoeyBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJywgJ1gtQVBJLUtleSc6ICdmb29iYXInIH0pXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBmaWVsZFxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGZpZWxkLCB2YWwpe1xuICBpZiAoaXNPYmplY3QoZmllbGQpKSB7XG4gICAgZm9yICh2YXIga2V5IGluIGZpZWxkKSB7XG4gICAgICB0aGlzLnNldChrZXksIGZpZWxkW2tleV0pO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV0gPSB2YWw7XG4gIHRoaXMuaGVhZGVyW2ZpZWxkXSA9IHZhbDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBoZWFkZXIgYGZpZWxkYC5cbiAqXG4gKiBFeGFtcGxlOlxuICpcbiAqICAgICAgcmVxLmdldCgnLycpXG4gKiAgICAgICAgLnVuc2V0KCdVc2VyLUFnZW50JylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS51bnNldCA9IGZ1bmN0aW9uKGZpZWxkKXtcbiAgZGVsZXRlIHRoaXMuX2hlYWRlcltmaWVsZC50b0xvd2VyQ2FzZSgpXTtcbiAgZGVsZXRlIHRoaXMuaGVhZGVyW2ZpZWxkXTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEdldCBjYXNlLWluc2Vuc2l0aXZlIGhlYWRlciBgZmllbGRgIHZhbHVlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuZ2V0SGVhZGVyID0gZnVuY3Rpb24oZmllbGQpe1xuICByZXR1cm4gdGhpcy5faGVhZGVyW2ZpZWxkLnRvTG93ZXJDYXNlKCldO1xufTtcblxuLyoqXG4gKiBTZXQgQ29udGVudC1UeXBlIHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICBzdXBlcmFnZW50LnR5cGVzLnhtbCA9ICdhcHBsaWNhdGlvbi94bWwnO1xuICpcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcbiAqICAgICAgICAudHlwZSgneG1sJylcbiAqICAgICAgICAuc2VuZCh4bWxzdHJpbmcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogICAgICByZXF1ZXN0LnBvc3QoJy8nKVxuICogICAgICAgIC50eXBlKCdhcHBsaWNhdGlvbi94bWwnKVxuICogICAgICAgIC5zZW5kKHhtbHN0cmluZylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZVxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbih0eXBlKXtcbiAgdGhpcy5zZXQoJ0NvbnRlbnQtVHlwZScsIHJlcXVlc3QudHlwZXNbdHlwZV0gfHwgdHlwZSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgQWNjZXB0IHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICBzdXBlcmFnZW50LnR5cGVzLmpzb24gPSAnYXBwbGljYXRpb24vanNvbic7XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcbiAqICAgICAgICAuYWNjZXB0KCdqc29uJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxuICogICAgICAgIC5hY2NlcHQoJ2FwcGxpY2F0aW9uL2pzb24nKVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBhY2NlcHRcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5hY2NlcHQgPSBmdW5jdGlvbih0eXBlKXtcbiAgdGhpcy5zZXQoJ0FjY2VwdCcsIHJlcXVlc3QudHlwZXNbdHlwZV0gfHwgdHlwZSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgQXV0aG9yaXphdGlvbiBmaWVsZCB2YWx1ZSB3aXRoIGB1c2VyYCBhbmQgYHBhc3NgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1c2VyXG4gKiBAcGFyYW0ge1N0cmluZ30gcGFzc1xuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmF1dGggPSBmdW5jdGlvbih1c2VyLCBwYXNzKXtcbiAgdmFyIHN0ciA9IGJ0b2EodXNlciArICc6JyArIHBhc3MpO1xuICB0aGlzLnNldCgnQXV0aG9yaXphdGlvbicsICdCYXNpYyAnICsgc3RyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiogQWRkIHF1ZXJ5LXN0cmluZyBgdmFsYC5cbipcbiogRXhhbXBsZXM6XG4qXG4qICAgcmVxdWVzdC5nZXQoJy9zaG9lcycpXG4qICAgICAucXVlcnkoJ3NpemU9MTAnKVxuKiAgICAgLnF1ZXJ5KHsgY29sb3I6ICdibHVlJyB9KVxuKlxuKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IHZhbFxuKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiogQGFwaSBwdWJsaWNcbiovXG5cblJlcXVlc3QucHJvdG90eXBlLnF1ZXJ5ID0gZnVuY3Rpb24odmFsKXtcbiAgaWYgKCdzdHJpbmcnICE9IHR5cGVvZiB2YWwpIHZhbCA9IHNlcmlhbGl6ZSh2YWwpO1xuICBpZiAodmFsKSB0aGlzLl9xdWVyeS5wdXNoKHZhbCk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBXcml0ZSB0aGUgZmllbGQgYG5hbWVgIGFuZCBgdmFsYCBmb3IgXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCJcbiAqIHJlcXVlc3QgYm9kaWVzLlxuICpcbiAqIGBgYCBqc1xuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcbiAqICAgLmZpZWxkKCdmb28nLCAnYmFyJylcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICogQHBhcmFtIHtTdHJpbmd8QmxvYnxGaWxlfSB2YWxcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5maWVsZCA9IGZ1bmN0aW9uKG5hbWUsIHZhbCl7XG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHRoaXMuX2Zvcm1EYXRhID0gbmV3IHJvb3QuRm9ybURhdGEoKTtcbiAgdGhpcy5fZm9ybURhdGEuYXBwZW5kKG5hbWUsIHZhbCk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBRdWV1ZSB0aGUgZ2l2ZW4gYGZpbGVgIGFzIGFuIGF0dGFjaG1lbnQgdG8gdGhlIHNwZWNpZmllZCBgZmllbGRgLFxuICogd2l0aCBvcHRpb25hbCBgZmlsZW5hbWVgLlxuICpcbiAqIGBgYCBqc1xuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcbiAqICAgLmF0dGFjaChuZXcgQmxvYihbJzxhIGlkPVwiYVwiPjxiIGlkPVwiYlwiPmhleSE8L2I+PC9hPiddLCB7IHR5cGU6IFwidGV4dC9odG1sXCJ9KSlcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcbiAqIEBwYXJhbSB7QmxvYnxGaWxlfSBmaWxlXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlsZW5hbWVcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihmaWVsZCwgZmlsZSwgZmlsZW5hbWUpe1xuICBpZiAoIXRoaXMuX2Zvcm1EYXRhKSB0aGlzLl9mb3JtRGF0YSA9IG5ldyByb290LkZvcm1EYXRhKCk7XG4gIHRoaXMuX2Zvcm1EYXRhLmFwcGVuZChmaWVsZCwgZmlsZSwgZmlsZW5hbWUpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2VuZCBgZGF0YWAsIGRlZmF1bHRpbmcgdGhlIGAudHlwZSgpYCB0byBcImpzb25cIiB3aGVuXG4gKiBhbiBvYmplY3QgaXMgZ2l2ZW4uXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICAgLy8gcXVlcnlzdHJpbmdcbiAqICAgICAgIHJlcXVlc3QuZ2V0KCcvc2VhcmNoJylcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBtdWx0aXBsZSBkYXRhIFwid3JpdGVzXCJcbiAqICAgICAgIHJlcXVlc3QuZ2V0KCcvc2VhcmNoJylcbiAqICAgICAgICAgLnNlbmQoeyBzZWFyY2g6ICdxdWVyeScgfSlcbiAqICAgICAgICAgLnNlbmQoeyByYW5nZTogJzEuLjUnIH0pXG4gKiAgICAgICAgIC5zZW5kKHsgb3JkZXI6ICdkZXNjJyB9KVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIG1hbnVhbCBqc29uXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnR5cGUoJ2pzb24nKVxuICogICAgICAgICAuc2VuZCgne1wibmFtZVwiOlwidGpcIn0pXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogICAgICAgLy8gYXV0byBqc29uXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0pXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogICAgICAgLy8gbWFudWFsIHgtd3d3LWZvcm0tdXJsZW5jb2RlZFxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgIC50eXBlKCdmb3JtJylcbiAqICAgICAgICAgLnNlbmQoJ25hbWU9dGonKVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIGF1dG8geC13d3ctZm9ybS11cmxlbmNvZGVkXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnR5cGUoJ2Zvcm0nKVxuICogICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBkZWZhdWx0cyB0byB4LXd3dy1mb3JtLXVybGVuY29kZWRcbiAgKiAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxuICAqICAgICAgICAuc2VuZCgnbmFtZT10b2JpJylcbiAgKiAgICAgICAgLnNlbmQoJ3NwZWNpZXM9ZmVycmV0JylcbiAgKiAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IGRhdGFcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24oZGF0YSl7XG4gIHZhciBvYmogPSBpc09iamVjdChkYXRhKTtcbiAgdmFyIHR5cGUgPSB0aGlzLmdldEhlYWRlcignQ29udGVudC1UeXBlJyk7XG5cbiAgLy8gbWVyZ2VcbiAgaWYgKG9iaiAmJiBpc09iamVjdCh0aGlzLl9kYXRhKSkge1xuICAgIGZvciAodmFyIGtleSBpbiBkYXRhKSB7XG4gICAgICB0aGlzLl9kYXRhW2tleV0gPSBkYXRhW2tleV07XG4gICAgfVxuICB9IGVsc2UgaWYgKCdzdHJpbmcnID09IHR5cGVvZiBkYXRhKSB7XG4gICAgaWYgKCF0eXBlKSB0aGlzLnR5cGUoJ2Zvcm0nKTtcbiAgICB0eXBlID0gdGhpcy5nZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScpO1xuICAgIGlmICgnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyA9PSB0eXBlKSB7XG4gICAgICB0aGlzLl9kYXRhID0gdGhpcy5fZGF0YVxuICAgICAgICA/IHRoaXMuX2RhdGEgKyAnJicgKyBkYXRhXG4gICAgICAgIDogZGF0YTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZGF0YSA9ICh0aGlzLl9kYXRhIHx8ICcnKSArIGRhdGE7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRoaXMuX2RhdGEgPSBkYXRhO1xuICB9XG5cbiAgaWYgKCFvYmogfHwgaXNIb3N0KGRhdGEpKSByZXR1cm4gdGhpcztcbiAgaWYgKCF0eXBlKSB0aGlzLnR5cGUoJ2pzb24nKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEludm9rZSB0aGUgY2FsbGJhY2sgd2l0aCBgZXJyYCBhbmQgYHJlc2BcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXG4gKlxuICogQHBhcmFtIHtFcnJvcn0gZXJyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCByZXMpe1xuICB2YXIgZm4gPSB0aGlzLl9jYWxsYmFjaztcbiAgdGhpcy5jbGVhclRpbWVvdXQoKTtcbiAgZm4oZXJyLCByZXMpO1xufTtcblxuLyoqXG4gKiBJbnZva2UgY2FsbGJhY2sgd2l0aCB4LWRvbWFpbiBlcnJvci5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5jcm9zc0RvbWFpbkVycm9yID0gZnVuY3Rpb24oKXtcbiAgdmFyIGVyciA9IG5ldyBFcnJvcignT3JpZ2luIGlzIG5vdCBhbGxvd2VkIGJ5IEFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicpO1xuICBlcnIuY3Jvc3NEb21haW4gPSB0cnVlO1xuICB0aGlzLmNhbGxiYWNrKGVycik7XG59O1xuXG4vKipcbiAqIEludm9rZSBjYWxsYmFjayB3aXRoIHRpbWVvdXQgZXJyb3IuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUudGltZW91dEVycm9yID0gZnVuY3Rpb24oKXtcbiAgdmFyIHRpbWVvdXQgPSB0aGlzLl90aW1lb3V0O1xuICB2YXIgZXJyID0gbmV3IEVycm9yKCd0aW1lb3V0IG9mICcgKyB0aW1lb3V0ICsgJ21zIGV4Y2VlZGVkJyk7XG4gIGVyci50aW1lb3V0ID0gdGltZW91dDtcbiAgdGhpcy5jYWxsYmFjayhlcnIpO1xufTtcblxuLyoqXG4gKiBFbmFibGUgdHJhbnNtaXNzaW9uIG9mIGNvb2tpZXMgd2l0aCB4LWRvbWFpbiByZXF1ZXN0cy5cbiAqXG4gKiBOb3RlIHRoYXQgZm9yIHRoaXMgdG8gd29yayB0aGUgb3JpZ2luIG11c3Qgbm90IGJlXG4gKiB1c2luZyBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiIHdpdGggYSB3aWxkY2FyZCxcbiAqIGFuZCBhbHNvIG11c3Qgc2V0IFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHNcIlxuICogdG8gXCJ0cnVlXCIuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS53aXRoQ3JlZGVudGlhbHMgPSBmdW5jdGlvbigpe1xuICB0aGlzLl93aXRoQ3JlZGVudGlhbHMgPSB0cnVlO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogSW5pdGlhdGUgcmVxdWVzdCwgaW52b2tpbmcgY2FsbGJhY2sgYGZuKHJlcylgXG4gKiB3aXRoIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmVuZCA9IGZ1bmN0aW9uKGZuKXtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgeGhyID0gdGhpcy54aHIgPSByZXF1ZXN0LmdldFhIUigpO1xuICB2YXIgcXVlcnkgPSB0aGlzLl9xdWVyeS5qb2luKCcmJyk7XG4gIHZhciB0aW1lb3V0ID0gdGhpcy5fdGltZW91dDtcbiAgdmFyIGRhdGEgPSB0aGlzLl9mb3JtRGF0YSB8fCB0aGlzLl9kYXRhO1xuXG4gIC8vIHN0b3JlIGNhbGxiYWNrXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcblxuICAvLyBzdGF0ZSBjaGFuZ2VcbiAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uKCl7XG4gICAgaWYgKDQgIT0geGhyLnJlYWR5U3RhdGUpIHJldHVybjtcblxuICAgIC8vIEluIElFOSwgcmVhZHMgdG8gYW55IHByb3BlcnR5IChlLmcuIHN0YXR1cykgb2ZmIG9mIGFuIGFib3J0ZWQgWEhSIHdpbGxcbiAgICAvLyByZXN1bHQgaW4gdGhlIGVycm9yIFwiQ291bGQgbm90IGNvbXBsZXRlIHRoZSBvcGVyYXRpb24gZHVlIHRvIGVycm9yIGMwMGMwMjNmXCJcbiAgICB2YXIgc3RhdHVzO1xuICAgIHRyeSB7IHN0YXR1cyA9IHhoci5zdGF0dXMgfSBjYXRjaChlKSB7IHN0YXR1cyA9IDA7IH1cblxuICAgIGlmICgwID09IHN0YXR1cykge1xuICAgICAgaWYgKHNlbGYudGltZWRvdXQpIHJldHVybiBzZWxmLnRpbWVvdXRFcnJvcigpO1xuICAgICAgaWYgKHNlbGYuYWJvcnRlZCkgcmV0dXJuO1xuICAgICAgcmV0dXJuIHNlbGYuY3Jvc3NEb21haW5FcnJvcigpO1xuICAgIH1cbiAgICBzZWxmLmVtaXQoJ2VuZCcpO1xuICB9O1xuXG4gIC8vIHByb2dyZXNzXG4gIHZhciBoYW5kbGVQcm9ncmVzcyA9IGZ1bmN0aW9uKGUpe1xuICAgIGlmIChlLnRvdGFsID4gMCkge1xuICAgICAgZS5wZXJjZW50ID0gZS5sb2FkZWQgLyBlLnRvdGFsICogMTAwO1xuICAgIH1cbiAgICBzZWxmLmVtaXQoJ3Byb2dyZXNzJywgZSk7XG4gIH07XG4gIGlmICh0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xuICAgIHhoci5vbnByb2dyZXNzID0gaGFuZGxlUHJvZ3Jlc3M7XG4gIH1cbiAgdHJ5IHtcbiAgICBpZiAoeGhyLnVwbG9hZCAmJiB0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xuICAgICAgeGhyLnVwbG9hZC5vbnByb2dyZXNzID0gaGFuZGxlUHJvZ3Jlc3M7XG4gICAgfVxuICB9IGNhdGNoKGUpIHtcbiAgICAvLyBBY2Nlc3NpbmcgeGhyLnVwbG9hZCBmYWlscyBpbiBJRSBmcm9tIGEgd2ViIHdvcmtlciwgc28ganVzdCBwcmV0ZW5kIGl0IGRvZXNuJ3QgZXhpc3QuXG4gICAgLy8gUmVwb3J0ZWQgaGVyZTpcbiAgICAvLyBodHRwczovL2Nvbm5lY3QubWljcm9zb2Z0LmNvbS9JRS9mZWVkYmFjay9kZXRhaWxzLzgzNzI0NS94bWxodHRwcmVxdWVzdC11cGxvYWQtdGhyb3dzLWludmFsaWQtYXJndW1lbnQtd2hlbi11c2VkLWZyb20td2ViLXdvcmtlci1jb250ZXh0XG4gIH1cblxuICAvLyB0aW1lb3V0XG4gIGlmICh0aW1lb3V0ICYmICF0aGlzLl90aW1lcikge1xuICAgIHRoaXMuX3RpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgc2VsZi50aW1lZG91dCA9IHRydWU7XG4gICAgICBzZWxmLmFib3J0KCk7XG4gICAgfSwgdGltZW91dCk7XG4gIH1cblxuICAvLyBxdWVyeXN0cmluZ1xuICBpZiAocXVlcnkpIHtcbiAgICBxdWVyeSA9IHJlcXVlc3Quc2VyaWFsaXplT2JqZWN0KHF1ZXJ5KTtcbiAgICB0aGlzLnVybCArPSB+dGhpcy51cmwuaW5kZXhPZignPycpXG4gICAgICA/ICcmJyArIHF1ZXJ5XG4gICAgICA6ICc/JyArIHF1ZXJ5O1xuICB9XG5cbiAgLy8gaW5pdGlhdGUgcmVxdWVzdFxuICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmwsIHRydWUpO1xuXG4gIC8vIENPUlNcbiAgaWYgKHRoaXMuX3dpdGhDcmVkZW50aWFscykgeGhyLndpdGhDcmVkZW50aWFscyA9IHRydWU7XG5cbiAgLy8gYm9keVxuICBpZiAoJ0dFVCcgIT0gdGhpcy5tZXRob2QgJiYgJ0hFQUQnICE9IHRoaXMubWV0aG9kICYmICdzdHJpbmcnICE9IHR5cGVvZiBkYXRhICYmICFpc0hvc3QoZGF0YSkpIHtcbiAgICAvLyBzZXJpYWxpemUgc3R1ZmZcbiAgICB2YXIgY29udGVudFR5cGUgPSB0aGlzLmdldEhlYWRlcignQ29udGVudC1UeXBlJyk7XG4gICAgdmFyIHNlcmlhbGl6ZSA9IHJlcXVlc3Quc2VyaWFsaXplW2NvbnRlbnRUeXBlID8gY29udGVudFR5cGUuc3BsaXQoJzsnKVswXSA6ICcnXTtcbiAgICBpZiAoc2VyaWFsaXplKSBkYXRhID0gc2VyaWFsaXplKGRhdGEpO1xuICB9XG5cbiAgLy8gc2V0IGhlYWRlciBmaWVsZHNcbiAgZm9yICh2YXIgZmllbGQgaW4gdGhpcy5oZWFkZXIpIHtcbiAgICBpZiAobnVsbCA9PSB0aGlzLmhlYWRlcltmaWVsZF0pIGNvbnRpbnVlO1xuICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGZpZWxkLCB0aGlzLmhlYWRlcltmaWVsZF0pO1xuICB9XG5cbiAgLy8gc2VuZCBzdHVmZlxuICB0aGlzLmVtaXQoJ3JlcXVlc3QnLCB0aGlzKTtcbiAgeGhyLnNlbmQoZGF0YSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBGYXV4IHByb21pc2Ugc3VwcG9ydFxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bGZpbGxcbiAqIEBwYXJhbSB7RnVuY3Rpb259IHJlamVjdFxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50aGVuID0gZnVuY3Rpb24gKGZ1bGZpbGwsIHJlamVjdCkge1xuICByZXR1cm4gdGhpcy5lbmQoZnVuY3Rpb24oZXJyLCByZXMpIHtcbiAgICBlcnIgPyByZWplY3QoZXJyKSA6IGZ1bGZpbGwocmVzKTtcbiAgfSk7XG59XG5cbi8qKlxuICogRXhwb3NlIGBSZXF1ZXN0YC5cbiAqL1xuXG5yZXF1ZXN0LlJlcXVlc3QgPSBSZXF1ZXN0O1xuXG4vKipcbiAqIElzc3VlIGEgcmVxdWVzdDpcbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICByZXF1ZXN0KCdHRVQnLCAnL3VzZXJzJykuZW5kKGNhbGxiYWNrKVxuICogICAgcmVxdWVzdCgnL3VzZXJzJykuZW5kKGNhbGxiYWNrKVxuICogICAgcmVxdWVzdCgnL3VzZXJzJywgY2FsbGJhY2spXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZFxuICogQHBhcmFtIHtTdHJpbmd8RnVuY3Rpb259IHVybCBvciBjYWxsYmFja1xuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gcmVxdWVzdChtZXRob2QsIHVybCkge1xuICAvLyBjYWxsYmFja1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgdXJsKSB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0KCdHRVQnLCBtZXRob2QpLmVuZCh1cmwpO1xuICB9XG5cbiAgLy8gdXJsIGZpcnN0XG4gIGlmICgxID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3QoJ0dFVCcsIG1ldGhvZCk7XG4gIH1cblxuICByZXR1cm4gbmV3IFJlcXVlc3QobWV0aG9kLCB1cmwpO1xufVxuXG4vKipcbiAqIEdFVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfEZ1bmN0aW9ufSBkYXRhIG9yIGZuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5nZXQgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ0dFVCcsIHVybCk7XG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiBkYXRhKSBmbiA9IGRhdGEsIGRhdGEgPSBudWxsO1xuICBpZiAoZGF0YSkgcmVxLnF1ZXJ5KGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBIRUFEIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IGRhdGEgb3IgZm5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LmhlYWQgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ0hFQUQnLCB1cmwpO1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgZGF0YSkgZm4gPSBkYXRhLCBkYXRhID0gbnVsbDtcbiAgaWYgKGRhdGEpIHJlcS5zZW5kKGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBERUxFVEUgYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QuZGVsID0gZnVuY3Rpb24odXJsLCBmbil7XG4gIHZhciByZXEgPSByZXF1ZXN0KCdERUxFVEUnLCB1cmwpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBQQVRDSCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR9IGRhdGFcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LnBhdGNoID0gZnVuY3Rpb24odXJsLCBkYXRhLCBmbil7XG4gIHZhciByZXEgPSByZXF1ZXN0KCdQQVRDSCcsIHVybCk7XG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiBkYXRhKSBmbiA9IGRhdGEsIGRhdGEgPSBudWxsO1xuICBpZiAoZGF0YSkgcmVxLnNlbmQoZGF0YSk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG4vKipcbiAqIFBPU1QgYHVybGAgd2l0aCBvcHRpb25hbCBgZGF0YWAgYW5kIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfSBkYXRhXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5wb3N0ID0gZnVuY3Rpb24odXJsLCBkYXRhLCBmbil7XG4gIHZhciByZXEgPSByZXF1ZXN0KCdQT1NUJywgdXJsKTtcbiAgaWYgKCdmdW5jdGlvbicgPT0gdHlwZW9mIGRhdGEpIGZuID0gZGF0YSwgZGF0YSA9IG51bGw7XG4gIGlmIChkYXRhKSByZXEuc2VuZChkYXRhKTtcbiAgaWYgKGZuKSByZXEuZW5kKGZuKTtcbiAgcmV0dXJuIHJlcTtcbn07XG5cbi8qKlxuICogUFVUIGB1cmxgIHdpdGggb3B0aW9uYWwgYGRhdGFgIGFuZCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZHxGdW5jdGlvbn0gZGF0YSBvciBmblxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QucHV0ID0gZnVuY3Rpb24odXJsLCBkYXRhLCBmbil7XG4gIHZhciByZXEgPSByZXF1ZXN0KCdQVVQnLCB1cmwpO1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgZGF0YSkgZm4gPSBkYXRhLCBkYXRhID0gbnVsbDtcbiAgaWYgKGRhdGEpIHJlcS5zZW5kKGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBFeHBvc2UgYHJlcXVlc3RgLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWVzdDtcbiIsIlxuLyoqXG4gKiBFeHBvc2UgYEVtaXR0ZXJgLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gRW1pdHRlcjtcblxuLyoqXG4gKiBJbml0aWFsaXplIGEgbmV3IGBFbWl0dGVyYC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIEVtaXR0ZXIob2JqKSB7XG4gIGlmIChvYmopIHJldHVybiBtaXhpbihvYmopO1xufTtcblxuLyoqXG4gKiBNaXhpbiB0aGUgZW1pdHRlciBwcm9wZXJ0aWVzLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIG1peGluKG9iaikge1xuICBmb3IgKHZhciBrZXkgaW4gRW1pdHRlci5wcm90b3R5cGUpIHtcbiAgICBvYmpba2V5XSA9IEVtaXR0ZXIucHJvdG90eXBlW2tleV07XG4gIH1cbiAgcmV0dXJuIG9iajtcbn1cblxuLyoqXG4gKiBMaXN0ZW4gb24gdGhlIGdpdmVuIGBldmVudGAgd2l0aCBgZm5gLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9uID1cbkVtaXR0ZXIucHJvdG90eXBlLmFkZEV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG4gICh0aGlzLl9jYWxsYmFja3NbZXZlbnRdID0gdGhpcy5fY2FsbGJhY2tzW2V2ZW50XSB8fCBbXSlcbiAgICAucHVzaChmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBBZGRzIGFuIGBldmVudGAgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGludm9rZWQgYSBzaW5nbGVcbiAqIHRpbWUgdGhlbiBhdXRvbWF0aWNhbGx5IHJlbW92ZWQuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuXG4gIGZ1bmN0aW9uIG9uKCkge1xuICAgIHNlbGYub2ZmKGV2ZW50LCBvbik7XG4gICAgZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfVxuXG4gIG9uLmZuID0gZm47XG4gIHRoaXMub24oZXZlbnQsIG9uKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJlbW92ZSB0aGUgZ2l2ZW4gY2FsbGJhY2sgZm9yIGBldmVudGAgb3IgYWxsXG4gKiByZWdpc3RlcmVkIGNhbGxiYWNrcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vZmYgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID1cbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG5cbiAgLy8gYWxsXG4gIGlmICgwID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICB0aGlzLl9jYWxsYmFja3MgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHNwZWNpZmljIGV2ZW50XG4gIHZhciBjYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3NbZXZlbnRdO1xuICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuIHRoaXM7XG5cbiAgLy8gcmVtb3ZlIGFsbCBoYW5kbGVyc1xuICBpZiAoMSA9PSBhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1tldmVudF07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyByZW1vdmUgc3BlY2lmaWMgaGFuZGxlclxuICB2YXIgY2I7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgY2IgPSBjYWxsYmFja3NbaV07XG4gICAgaWYgKGNiID09PSBmbiB8fCBjYi5mbiA9PT0gZm4pIHtcbiAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaSwgMSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEVtaXQgYGV2ZW50YCB3aXRoIHRoZSBnaXZlbiBhcmdzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtNaXhlZH0gLi4uXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihldmVudCl7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgdmFyIGFyZ3MgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAsIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1tldmVudF07XG5cbiAgaWYgKGNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrcyA9IGNhbGxiYWNrcy5zbGljZSgwKTtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gY2FsbGJhY2tzLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gICAgICBjYWxsYmFja3NbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJldHVybiBhcnJheSBvZiBjYWxsYmFja3MgZm9yIGBldmVudGAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcmV0dXJuIHtBcnJheX1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24oZXZlbnQpe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG4gIHJldHVybiB0aGlzLl9jYWxsYmFja3NbZXZlbnRdIHx8IFtdO1xufTtcblxuLyoqXG4gKiBDaGVjayBpZiB0aGlzIGVtaXR0ZXIgaGFzIGBldmVudGAgaGFuZGxlcnMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5oYXNMaXN0ZW5lcnMgPSBmdW5jdGlvbihldmVudCl7XG4gIHJldHVybiAhISB0aGlzLmxpc3RlbmVycyhldmVudCkubGVuZ3RoO1xufTtcbiIsIlxuLyoqXG4gKiBSZWR1Y2UgYGFycmAgd2l0aCBgZm5gLlxuICpcbiAqIEBwYXJhbSB7QXJyYXl9IGFyclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEBwYXJhbSB7TWl4ZWR9IGluaXRpYWxcbiAqXG4gKiBUT0RPOiBjb21iYXRpYmxlIGVycm9yIGhhbmRsaW5nP1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oYXJyLCBmbiwgaW5pdGlhbCl7ICBcbiAgdmFyIGlkeCA9IDA7XG4gIHZhciBsZW4gPSBhcnIubGVuZ3RoO1xuICB2YXIgY3VyciA9IGFyZ3VtZW50cy5sZW5ndGggPT0gM1xuICAgID8gaW5pdGlhbFxuICAgIDogYXJyW2lkeCsrXTtcblxuICB3aGlsZSAoaWR4IDwgbGVuKSB7XG4gICAgY3VyciA9IGZuLmNhbGwobnVsbCwgY3VyciwgYXJyW2lkeF0sICsraWR4LCBhcnIpO1xuICB9XG4gIFxuICByZXR1cm4gY3Vycjtcbn07IiwidmFyIHRyYXZlcnNlID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG4gICAgcmV0dXJuIG5ldyBUcmF2ZXJzZShvYmopO1xufTtcblxuZnVuY3Rpb24gVHJhdmVyc2UgKG9iaikge1xuICAgIHRoaXMudmFsdWUgPSBvYmo7XG59XG5cblRyYXZlcnNlLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAocHMpIHtcbiAgICB2YXIgbm9kZSA9IHRoaXMudmFsdWU7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcy5sZW5ndGg7IGkgKyspIHtcbiAgICAgICAgdmFyIGtleSA9IHBzW2ldO1xuICAgICAgICBpZiAoIW5vZGUgfHwgIWhhc093blByb3BlcnR5LmNhbGwobm9kZSwga2V5KSkge1xuICAgICAgICAgICAgbm9kZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIG5vZGUgPSBub2RlW2tleV07XG4gICAgfVxuICAgIHJldHVybiBub2RlO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLmhhcyA9IGZ1bmN0aW9uIChwcykge1xuICAgIHZhciBub2RlID0gdGhpcy52YWx1ZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBzLmxlbmd0aDsgaSArKykge1xuICAgICAgICB2YXIga2V5ID0gcHNbaV07XG4gICAgICAgIGlmICghbm9kZSB8fCAhaGFzT3duUHJvcGVydHkuY2FsbChub2RlLCBrZXkpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgbm9kZSA9IG5vZGVba2V5XTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5UcmF2ZXJzZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKHBzLCB2YWx1ZSkge1xuICAgIHZhciBub2RlID0gdGhpcy52YWx1ZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBzLmxlbmd0aCAtIDE7IGkgKyspIHtcbiAgICAgICAgdmFyIGtleSA9IHBzW2ldO1xuICAgICAgICBpZiAoIWhhc093blByb3BlcnR5LmNhbGwobm9kZSwga2V5KSkgbm9kZVtrZXldID0ge307XG4gICAgICAgIG5vZGUgPSBub2RlW2tleV07XG4gICAgfVxuICAgIG5vZGVbcHNbaV1dID0gdmFsdWU7XG4gICAgcmV0dXJuIHZhbHVlO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLm1hcCA9IGZ1bmN0aW9uIChjYikge1xuICAgIHJldHVybiB3YWxrKHRoaXMudmFsdWUsIGNiLCB0cnVlKTtcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5mb3JFYWNoID0gZnVuY3Rpb24gKGNiKSB7XG4gICAgdGhpcy52YWx1ZSA9IHdhbGsodGhpcy52YWx1ZSwgY2IsIGZhbHNlKTtcbiAgICByZXR1cm4gdGhpcy52YWx1ZTtcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5yZWR1Y2UgPSBmdW5jdGlvbiAoY2IsIGluaXQpIHtcbiAgICB2YXIgc2tpcCA9IGFyZ3VtZW50cy5sZW5ndGggPT09IDE7XG4gICAgdmFyIGFjYyA9IHNraXAgPyB0aGlzLnZhbHVlIDogaW5pdDtcbiAgICB0aGlzLmZvckVhY2goZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzUm9vdCB8fCAhc2tpcCkge1xuICAgICAgICAgICAgYWNjID0gY2IuY2FsbCh0aGlzLCBhY2MsIHgpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGFjYztcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5wYXRocyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgYWNjID0gW107XG4gICAgdGhpcy5mb3JFYWNoKGZ1bmN0aW9uICh4KSB7XG4gICAgICAgIGFjYy5wdXNoKHRoaXMucGF0aCk7IFxuICAgIH0pO1xuICAgIHJldHVybiBhY2M7XG59O1xuXG5UcmF2ZXJzZS5wcm90b3R5cGUubm9kZXMgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGFjYyA9IFtdO1xuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbiAoeCkge1xuICAgICAgICBhY2MucHVzaCh0aGlzLm5vZGUpO1xuICAgIH0pO1xuICAgIHJldHVybiBhY2M7XG59O1xuXG5UcmF2ZXJzZS5wcm90b3R5cGUuY2xvbmUgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHBhcmVudHMgPSBbXSwgbm9kZXMgPSBbXTtcbiAgICBcbiAgICByZXR1cm4gKGZ1bmN0aW9uIGNsb25lIChzcmMpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJlbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAocGFyZW50c1tpXSA9PT0gc3JjKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5vZGVzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAodHlwZW9mIHNyYyA9PT0gJ29iamVjdCcgJiYgc3JjICE9PSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgZHN0ID0gY29weShzcmMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBwYXJlbnRzLnB1c2goc3JjKTtcbiAgICAgICAgICAgIG5vZGVzLnB1c2goZHN0KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZm9yRWFjaChvYmplY3RLZXlzKHNyYyksIGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgICAgICAgICBkc3Rba2V5XSA9IGNsb25lKHNyY1trZXldKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBwYXJlbnRzLnBvcCgpO1xuICAgICAgICAgICAgbm9kZXMucG9wKCk7XG4gICAgICAgICAgICByZXR1cm4gZHN0O1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHNyYztcbiAgICAgICAgfVxuICAgIH0pKHRoaXMudmFsdWUpO1xufTtcblxuZnVuY3Rpb24gd2FsayAocm9vdCwgY2IsIGltbXV0YWJsZSkge1xuICAgIHZhciBwYXRoID0gW107XG4gICAgdmFyIHBhcmVudHMgPSBbXTtcbiAgICB2YXIgYWxpdmUgPSB0cnVlO1xuICAgIFxuICAgIHJldHVybiAoZnVuY3Rpb24gd2Fsa2VyIChub2RlXykge1xuICAgICAgICB2YXIgbm9kZSA9IGltbXV0YWJsZSA/IGNvcHkobm9kZV8pIDogbm9kZV87XG4gICAgICAgIHZhciBtb2RpZmllcnMgPSB7fTtcbiAgICAgICAgXG4gICAgICAgIHZhciBrZWVwR29pbmcgPSB0cnVlO1xuICAgICAgICBcbiAgICAgICAgdmFyIHN0YXRlID0ge1xuICAgICAgICAgICAgbm9kZSA6IG5vZGUsXG4gICAgICAgICAgICBub2RlXyA6IG5vZGVfLFxuICAgICAgICAgICAgcGF0aCA6IFtdLmNvbmNhdChwYXRoKSxcbiAgICAgICAgICAgIHBhcmVudCA6IHBhcmVudHNbcGFyZW50cy5sZW5ndGggLSAxXSxcbiAgICAgICAgICAgIHBhcmVudHMgOiBwYXJlbnRzLFxuICAgICAgICAgICAga2V5IDogcGF0aC5zbGljZSgtMSlbMF0sXG4gICAgICAgICAgICBpc1Jvb3QgOiBwYXRoLmxlbmd0aCA9PT0gMCxcbiAgICAgICAgICAgIGxldmVsIDogcGF0aC5sZW5ndGgsXG4gICAgICAgICAgICBjaXJjdWxhciA6IG51bGwsXG4gICAgICAgICAgICB1cGRhdGUgOiBmdW5jdGlvbiAoeCwgc3RvcEhlcmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLmlzUm9vdCkge1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5wYXJlbnQubm9kZVtzdGF0ZS5rZXldID0geDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc3RhdGUubm9kZSA9IHg7XG4gICAgICAgICAgICAgICAgaWYgKHN0b3BIZXJlKSBrZWVwR29pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAnZGVsZXRlJyA6IGZ1bmN0aW9uIChzdG9wSGVyZSkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBzdGF0ZS5wYXJlbnQubm9kZVtzdGF0ZS5rZXldO1xuICAgICAgICAgICAgICAgIGlmIChzdG9wSGVyZSkga2VlcEdvaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVtb3ZlIDogZnVuY3Rpb24gKHN0b3BIZXJlKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlzQXJyYXkoc3RhdGUucGFyZW50Lm5vZGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnBhcmVudC5ub2RlLnNwbGljZShzdGF0ZS5rZXksIDEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHN0YXRlLnBhcmVudC5ub2RlW3N0YXRlLmtleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChzdG9wSGVyZSkga2VlcEdvaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAga2V5cyA6IG51bGwsXG4gICAgICAgICAgICBiZWZvcmUgOiBmdW5jdGlvbiAoZikgeyBtb2RpZmllcnMuYmVmb3JlID0gZiB9LFxuICAgICAgICAgICAgYWZ0ZXIgOiBmdW5jdGlvbiAoZikgeyBtb2RpZmllcnMuYWZ0ZXIgPSBmIH0sXG4gICAgICAgICAgICBwcmUgOiBmdW5jdGlvbiAoZikgeyBtb2RpZmllcnMucHJlID0gZiB9LFxuICAgICAgICAgICAgcG9zdCA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5wb3N0ID0gZiB9LFxuICAgICAgICAgICAgc3RvcCA6IGZ1bmN0aW9uICgpIHsgYWxpdmUgPSBmYWxzZSB9LFxuICAgICAgICAgICAgYmxvY2sgOiBmdW5jdGlvbiAoKSB7IGtlZXBHb2luZyA9IGZhbHNlIH1cbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGlmICghYWxpdmUpIHJldHVybiBzdGF0ZTtcbiAgICAgICAgXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZVN0YXRlKCkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBzdGF0ZS5ub2RlID09PSAnb2JqZWN0JyAmJiBzdGF0ZS5ub2RlICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5rZXlzIHx8IHN0YXRlLm5vZGVfICE9PSBzdGF0ZS5ub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmtleXMgPSBvYmplY3RLZXlzKHN0YXRlLm5vZGUpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHN0YXRlLmlzTGVhZiA9IHN0YXRlLmtleXMubGVuZ3RoID09IDA7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJlbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXJlbnRzW2ldLm5vZGVfID09PSBub2RlXykge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUuY2lyY3VsYXIgPSBwYXJlbnRzW2ldO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5pc0xlYWYgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHN0YXRlLmtleXMgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBzdGF0ZS5ub3RMZWFmID0gIXN0YXRlLmlzTGVhZjtcbiAgICAgICAgICAgIHN0YXRlLm5vdFJvb3QgPSAhc3RhdGUuaXNSb290O1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB1cGRhdGVTdGF0ZSgpO1xuICAgICAgICBcbiAgICAgICAgLy8gdXNlIHJldHVybiB2YWx1ZXMgdG8gdXBkYXRlIGlmIGRlZmluZWRcbiAgICAgICAgdmFyIHJldCA9IGNiLmNhbGwoc3RhdGUsIHN0YXRlLm5vZGUpO1xuICAgICAgICBpZiAocmV0ICE9PSB1bmRlZmluZWQgJiYgc3RhdGUudXBkYXRlKSBzdGF0ZS51cGRhdGUocmV0KTtcbiAgICAgICAgXG4gICAgICAgIGlmIChtb2RpZmllcnMuYmVmb3JlKSBtb2RpZmllcnMuYmVmb3JlLmNhbGwoc3RhdGUsIHN0YXRlLm5vZGUpO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFrZWVwR29pbmcpIHJldHVybiBzdGF0ZTtcbiAgICAgICAgXG4gICAgICAgIGlmICh0eXBlb2Ygc3RhdGUubm9kZSA9PSAnb2JqZWN0J1xuICAgICAgICAmJiBzdGF0ZS5ub2RlICE9PSBudWxsICYmICFzdGF0ZS5jaXJjdWxhcikge1xuICAgICAgICAgICAgcGFyZW50cy5wdXNoKHN0YXRlKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdXBkYXRlU3RhdGUoKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZm9yRWFjaChzdGF0ZS5rZXlzLCBmdW5jdGlvbiAoa2V5LCBpKSB7XG4gICAgICAgICAgICAgICAgcGF0aC5wdXNoKGtleSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVycy5wcmUpIG1vZGlmaWVycy5wcmUuY2FsbChzdGF0ZSwgc3RhdGUubm9kZVtrZXldLCBrZXkpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBjaGlsZCA9IHdhbGtlcihzdGF0ZS5ub2RlW2tleV0pO1xuICAgICAgICAgICAgICAgIGlmIChpbW11dGFibGUgJiYgaGFzT3duUHJvcGVydHkuY2FsbChzdGF0ZS5ub2RlLCBrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLm5vZGVba2V5XSA9IGNoaWxkLm5vZGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNoaWxkLmlzTGFzdCA9IGkgPT0gc3RhdGUua2V5cy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgICAgIGNoaWxkLmlzRmlyc3QgPSBpID09IDA7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVycy5wb3N0KSBtb2RpZmllcnMucG9zdC5jYWxsKHN0YXRlLCBjaGlsZCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcGF0aC5wb3AoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcGFyZW50cy5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKG1vZGlmaWVycy5hZnRlcikgbW9kaWZpZXJzLmFmdGVyLmNhbGwoc3RhdGUsIHN0YXRlLm5vZGUpO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH0pKHJvb3QpLm5vZGU7XG59XG5cbmZ1bmN0aW9uIGNvcHkgKHNyYykge1xuICAgIGlmICh0eXBlb2Ygc3JjID09PSAnb2JqZWN0JyAmJiBzcmMgIT09IG51bGwpIHtcbiAgICAgICAgdmFyIGRzdDtcbiAgICAgICAgXG4gICAgICAgIGlmIChpc0FycmF5KHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzRGF0ZShzcmMpKSB7XG4gICAgICAgICAgICBkc3QgPSBuZXcgRGF0ZShzcmMuZ2V0VGltZSA/IHNyYy5nZXRUaW1lKCkgOiBzcmMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzUmVnRXhwKHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IG5ldyBSZWdFeHAoc3JjKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0Vycm9yKHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IHsgbWVzc2FnZTogc3JjLm1lc3NhZ2UgfTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0Jvb2xlYW4oc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0gbmV3IEJvb2xlYW4oc3JjKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc051bWJlcihzcmMpKSB7XG4gICAgICAgICAgICBkc3QgPSBuZXcgTnVtYmVyKHNyYyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoaXNTdHJpbmcoc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0gbmV3IFN0cmluZyhzcmMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKE9iamVjdC5jcmVhdGUgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKSB7XG4gICAgICAgICAgICBkc3QgPSBPYmplY3QuY3JlYXRlKE9iamVjdC5nZXRQcm90b3R5cGVPZihzcmMpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChzcmMuY29uc3RydWN0b3IgPT09IE9iamVjdCkge1xuICAgICAgICAgICAgZHN0ID0ge307XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB2YXIgcHJvdG8gPVxuICAgICAgICAgICAgICAgIChzcmMuY29uc3RydWN0b3IgJiYgc3JjLmNvbnN0cnVjdG9yLnByb3RvdHlwZSlcbiAgICAgICAgICAgICAgICB8fCBzcmMuX19wcm90b19fXG4gICAgICAgICAgICAgICAgfHwge31cbiAgICAgICAgICAgIDtcbiAgICAgICAgICAgIHZhciBUID0gZnVuY3Rpb24gKCkge307XG4gICAgICAgICAgICBULnByb3RvdHlwZSA9IHByb3RvO1xuICAgICAgICAgICAgZHN0ID0gbmV3IFQ7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGZvckVhY2gob2JqZWN0S2V5cyhzcmMpLCBmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgICAgICBkc3Rba2V5XSA9IHNyY1trZXldO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGRzdDtcbiAgICB9XG4gICAgZWxzZSByZXR1cm4gc3JjO1xufVxuXG52YXIgb2JqZWN0S2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIGtleXMgKG9iaikge1xuICAgIHZhciByZXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSByZXMucHVzaChrZXkpXG4gICAgcmV0dXJuIHJlcztcbn07XG5cbmZ1bmN0aW9uIHRvUyAob2JqKSB7IHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqKSB9XG5mdW5jdGlvbiBpc0RhdGUgKG9iaikgeyByZXR1cm4gdG9TKG9iaikgPT09ICdbb2JqZWN0IERhdGVdJyB9XG5mdW5jdGlvbiBpc1JlZ0V4cCAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgUmVnRXhwXScgfVxuZnVuY3Rpb24gaXNFcnJvciAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgRXJyb3JdJyB9XG5mdW5jdGlvbiBpc0Jvb2xlYW4gKG9iaikgeyByZXR1cm4gdG9TKG9iaikgPT09ICdbb2JqZWN0IEJvb2xlYW5dJyB9XG5mdW5jdGlvbiBpc051bWJlciAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgTnVtYmVyXScgfVxuZnVuY3Rpb24gaXNTdHJpbmcgKG9iaikgeyByZXR1cm4gdG9TKG9iaikgPT09ICdbb2JqZWN0IFN0cmluZ10nIH1cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIGlzQXJyYXkgKHhzKSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh4cykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuXG52YXIgZm9yRWFjaCA9IGZ1bmN0aW9uICh4cywgZm4pIHtcbiAgICBpZiAoeHMuZm9yRWFjaCkgcmV0dXJuIHhzLmZvckVhY2goZm4pXG4gICAgZWxzZSBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGZuKHhzW2ldLCBpLCB4cyk7XG4gICAgfVxufTtcblxuZm9yRWFjaChvYmplY3RLZXlzKFRyYXZlcnNlLnByb3RvdHlwZSksIGZ1bmN0aW9uIChrZXkpIHtcbiAgICB0cmF2ZXJzZVtrZXldID0gZnVuY3Rpb24gKG9iaikge1xuICAgICAgICB2YXIgYXJncyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAgICAgdmFyIHQgPSBuZXcgVHJhdmVyc2Uob2JqKTtcbiAgICAgICAgcmV0dXJuIHRba2V5XS5hcHBseSh0LCBhcmdzKTtcbiAgICB9O1xufSk7XG5cbnZhciBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5oYXNPd25Qcm9wZXJ0eSB8fCBmdW5jdGlvbiAob2JqLCBrZXkpIHtcbiAgICByZXR1cm4ga2V5IGluIG9iajtcbn07XG4iXX0=
