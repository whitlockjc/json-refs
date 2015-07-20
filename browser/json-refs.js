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

    allTasks.then(function (nJson) {
      remoteCache[url] = nJson;

      return nJson;
    });
  }

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

  // Remove trailing slash
  if (base && base.length > 1 && base[base.length - 1] === '/') {
    base = base.substring(0, base.length - 1);
  }

  // Normalize the base (when available)
  if (base) {
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

        if (!_.isUndefined(refMetadata)) {
          refMetadata.circular = true;
        } else {
          // This should never happen but we need to know about it if it does
          throw new Error('Unable to find reference leading to circular composition: ' + ptr);
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

      // Remove the base
      normalizedPtr = normalizedPtr.replace(options.location, '');

      // Remove the / prefix
      if (normalizedPtr.charAt(0) === '/') {
        normalizedPtr = normalizedPtr.substring(1);
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

      // If the remote value is itself a reference, update the reference to be replaced with its reference value.
      // Otherwise, replace the remote reference.
      if (value.$ref) {
        value = value.$ref;
      } else {
        refPath.pop();
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

  allTasks = allTasks.then(resolver, resolver);

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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi91dGlscy5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L25wby5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNsckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDL0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vLyBMb2FkIHByb21pc2VzIHBvbHlmaWxsIGlmIG5lY2Vzc2FyeVxuaWYgKHR5cGVvZiBQcm9taXNlID09PSAndW5kZWZpbmVkJykge1xuICByZXF1aXJlKCduYXRpdmUtcHJvbWlzZS1vbmx5Jyk7XG59XG5cbnZhciBfID0gcmVxdWlyZSgnLi9saWIvdXRpbHMnKTtcbnZhciBwYXRoTG9hZGVyID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ1BhdGhMb2FkZXInXSA6IHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWxbJ1BhdGhMb2FkZXInXSA6IG51bGwpO1xudmFyIHRyYXZlcnNlID0gKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3dbJ3RyYXZlcnNlJ10gOiB0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsWyd0cmF2ZXJzZSddIDogbnVsbCk7XG5cbnZhciByZW1vdGVDYWNoZSA9IHt9O1xudmFyIHN1cHBvcnRlZFNjaGVtZXMgPSBbJ2ZpbGUnLCAnaHR0cCcsICdodHRwcyddO1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgYnkge0BsaW5rIHJlc29sdmVSZWZzfS5cbiAqXG4gKiBAcGFyYW0ge2Vycm9yfSBbZXJyXSAtIFRoZSBlcnJvciBpZiB0aGVyZSBpcyBhIHByb2JsZW1cbiAqIEBwYXJhbSB7b2JqZWN0fSBbcmVzb2x2ZWRdIC0gVGhlIHJlc29sdmVkIHJlc3VsdHNcbiAqIEBwYXJhbSB7b2JqZWN0fSBbbWV0YWRhdGFdIC0gVGhlIHJlZmVyZW5jZSByZXNvbHV0aW9uIG1ldGFkYXRhLiAgKihUaGUga2V5IGEgSlNPTiBQb2ludGVyIHRvIGEgcGF0aCBpbiB0aGUgcmVzb2x2ZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQgd2hlcmUgYSBKU09OIFJlZmVyZW5jZSB3YXMgZGVyZWZlcmVuY2VkLiAgVGhlIHZhbHVlIGlzIGFsc28gYW4gb2JqZWN0LiAgRXZlcnlcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YWRhdGEgZW50cnkgaGFzIGEgYHJlZmAgcHJvcGVydHkgdG8gdGVsbCB5b3Ugd2hlcmUgdGhlIGRlcmVmZXJlbmNlZCB2YWx1ZSBjYW1lIGZyb20uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIElmIHRoZXJlIGlzIGFuIGBlcnJgIHByb3BlcnR5LCBpdCBpcyB0aGUgYEVycm9yYCBvYmplY3QgZW5jb3VudGVyZWQgcmV0cmlldmluZyB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmZXJlbmNlZCB2YWx1ZS4gIElmIHRoZXJlIGlzIGEgYG1pc3NpbmdgIHByb3BlcnR5LCBpdCBtZWFucyB0aGUgcmVmZXJlbmNlZCB2YWx1ZSBjb3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBub3QgYmUgcmVzb2x2ZWQuKSpcbiAqXG4gKiBAY2FsbGJhY2sgcmVzdWx0Q2FsbGJhY2tcbiAqL1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgdG8gcHJvdmlkZSBhY2Nlc3MgdG8gYWx0ZXJpbmcgYSByZW1vdGUgcmVxdWVzdCBwcmlvciB0byB0aGUgcmVxdWVzdCBiZWluZyBtYWRlLlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSByZXEgLSBUaGUgU3VwZXJhZ2VudCByZXF1ZXN0IG9iamVjdFxuICogQHBhcmFtIHtzdHJpbmd9IHJlZiAtIFRoZSByZWZlcmVuY2UgYmVpbmcgcmVzb2x2ZWQgKFdoZW4gYXBwbGljYWJsZSlcbiAqXG4gKiBAY2FsbGJhY2sgcHJlcGFyZVJlcXVlc3RDYWxsYmFja1xuICovXG5cbi8qKlxuICogQ2FsbGJhY2sgdXNlZCB0byBwcm9jZXNzIHRoZSBjb250ZW50IG9mIGEgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gVGhlIGNvbnRlbnQgbG9hZGVkIGZyb20gdGhlIGZpbGUvVVJMXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVmIC0gVGhlIHJlZmVyZW5jZSBzdHJpbmcgKFdoZW4gYXBwbGljYWJsZSlcbiAqIEBwYXJhbSB7b2JqZWN0fSBbcmVzXSAtIFRoZSBTdXBlcmFnZW50IHJlc3BvbnNlIG9iamVjdCAoRm9yIHJlbW90ZSBVUkwgcmVxdWVzdHMgb25seSlcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBUaGUgSmF2YVNjcmlwdCBvYmplY3QgcmVwcmVzZW50YXRpb24gb2YgdGhlIHJlZmVyZW5jZVxuICpcbiAqIEBjYWxsYmFjayBwcm9jZXNzQ29udGVudENhbGxiYWNrXG4gKi9cblxuLyogSW50ZXJuYWwgRnVuY3Rpb25zICovXG5cbi8qKlxuICogUmV0cmlldmVzIHRoZSBjb250ZW50IGF0IHRoZSBVUkwgYW5kIHJldHVybnMgaXRzIEpTT04gY29udGVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVGhlIFVSTCB0byByZXRyaWV2ZVxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBwYXNzZWQgdG8gcmVzb2x2ZVJlZnNcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZXJlIGlzIGEgcHJvYmxlbSBtYWtpbmcgdGhlIHJlcXVlc3Qgb3IgdGhlIGNvbnRlbnQgaXMgbm90IEpTT05cbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gVGhlIHByb21pc2VcbiAqL1xuZnVuY3Rpb24gZ2V0UmVtb3RlSnNvbiAodXJsLCBvcHRpb25zKSB7XG4gIHZhciBqc29uID0gcmVtb3RlQ2FjaGVbdXJsXTtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHZhciBzY2hlbWUgPSB1cmwuaW5kZXhPZignOicpID09PSAtMSA/IHVuZGVmaW5lZCA6IHVybC5zcGxpdCgnOicpWzBdO1xuXG4gIGlmICghXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4ganNvbjtcbiAgICB9KTtcbiAgfSBlbHNlIGlmIChzdXBwb3J0ZWRTY2hlbWVzLmluZGV4T2Yoc2NoZW1lKSA9PT0gLTEgJiYgIV8uaXNVbmRlZmluZWQoc2NoZW1lKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IEVycm9yKCdVbnN1cHBvcnRlZCByZW1vdGUgcmVmZXJlbmNlIHNjaGVtZTogJyArIHNjaGVtZSkpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGFsbFRhc2tzID0gcGF0aExvYWRlci5sb2FkKHVybCwgb3B0aW9ucyk7XG5cbiAgICBpZiAob3B0aW9ucy5wcm9jZXNzQ29udGVudCkge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uIChjb250ZW50KSB7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnByb2Nlc3NDb250ZW50KGNvbnRlbnQsIHVybCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKEpTT04ucGFyc2UpO1xuICAgIH1cblxuICAgIGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKG5Kc29uKSB7XG4gICAgICByZW1vdGVDYWNoZVt1cmxdID0gbkpzb247XG5cbiAgICAgIHJldHVybiBuSnNvbjtcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyogRXhwb3J0ZWQgRnVuY3Rpb25zICovXG5cbi8qKlxuICogQ2xlYXJzIHRoZSBpbnRlcm5hbCBjYWNoZSBvZiB1cmwgLT4gSmF2YVNjcmlwdCBvYmplY3QgbWFwcGluZ3MgYmFzZWQgb24gcHJldmlvdXNseSByZXNvbHZlZCByZWZlcmVuY2VzLlxuICovXG5tb2R1bGUuZXhwb3J0cy5jbGVhckNhY2hlID0gZnVuY3Rpb24gY2xlYXJDYWNoZSAoKSB7XG4gIHJlbW90ZUNhY2hlID0ge307XG59O1xuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIG9iamVjdCByZXByZXNlbnRzIGEgSlNPTiBSZWZlcmVuY2UuXG4gKlxuICogQHBhcmFtIHtvYmplY3R8c3RyaW5nfSBbb2JqXSAtIFRoZSBvYmplY3QgdG8gY2hlY2tcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdHJ1ZSBpZiB0aGUgYXJndW1lbnQgaXMgYW4gb2JqZWN0IGFuZCBpdHMgJHJlZiBwcm9wZXJ0eSBpcyBhIHN0cmluZyBhbmQgZmFsc2Ugb3RoZXJ3aXNlXG4gKi9cbnZhciBpc0pzb25SZWZlcmVuY2UgPSBtb2R1bGUuZXhwb3J0cy5pc0pzb25SZWZlcmVuY2UgPSBmdW5jdGlvbiBpc0pzb25SZWZlcmVuY2UgKG9iaikge1xuICAvLyBUT0RPOiBBZGQgY2hlY2sgdGhhdCB0aGUgdmFsdWUgaXMgYSB2YWxpZCBKU09OIFBvaW50ZXJcbiAgcmV0dXJuIF8uaXNQbGFpbk9iamVjdChvYmopICYmIF8uaXNTdHJpbmcob2JqLiRyZWYpO1xufTtcblxuLyoqXG4gKiBUYWtlcyBhbiBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIGFuZCBjcmVhdGVzIGEgSlNPTiBQb2ludGVyIGZyb20gaXQuXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjkwMX1cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIHBhdGggc2VnbWVudHNcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBBIEpTT04gUG9pbnRlciBiYXNlZCBvbiB0aGUgcGF0aCBzZWdtZW50c1xuICpcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdGhlIGFyZ3VtZW50cyBhcmUgbWlzc2luZyBvciBpbnZhbGlkXG4gKi9cbnZhciBwYXRoVG9Qb2ludGVyID0gbW9kdWxlLmV4cG9ydHMucGF0aFRvUG9pbnRlciA9IGZ1bmN0aW9uIHBhdGhUb1BvaW50ZXIgKHBhdGgpIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQocGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3BhdGggaXMgcmVxdWlyZWQnKTtcbiAgfSBlbHNlIGlmICghXy5pc0FycmF5KHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwYXRoIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgfVxuXG4gIHZhciBwdHIgPSAnIyc7XG5cbiAgaWYgKHBhdGgubGVuZ3RoID4gMCkge1xuICAgIHB0ciArPSAnLycgKyBwYXRoLm1hcChmdW5jdGlvbiAocGFydCkge1xuICAgICAgcmV0dXJuIHBhcnQucmVwbGFjZSgvfi9nLCAnfjAnKS5yZXBsYWNlKC9cXC8vZywgJ34xJyk7XG4gICAgfSkuam9pbignLycpO1xuICB9XG5cbiAgcmV0dXJuIHB0cjtcbn07XG5cbi8qKlxuICogRmluZCBhbGwgSlNPTiBSZWZlcmVuY2VzIGluIHRoZSBkb2N1bWVudC5cbiAqXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzI3NlY3Rpb24tM31cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0ganNvbiAtIFRoZSBKU09OIGRvY3VtZW50IHRvIGZpbmQgcmVmZXJlbmNlcyBpblxuICpcbiAqIEByZXR1cm5zIHtvYmplY3R9IEFuIG9iamVjdCB3aG9zZSBrZXlzIGFyZSBKU09OIFBvaW50ZXJzIHRvIHRoZSAnJHJlZicgbm9kZSBvZiB0aGUgSlNPTiBSZWZlcmVuY2VcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICovXG52YXIgZmluZFJlZnMgPSBtb2R1bGUuZXhwb3J0cy5maW5kUmVmcyA9IGZ1bmN0aW9uIGZpbmRSZWZzIChqc29uKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKGpzb24pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIGlzIHJlcXVpcmVkJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNQbGFpbk9iamVjdChqc29uKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignanNvbiBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICB9XG5cbiAgcmV0dXJuIHRyYXZlcnNlKGpzb24pLnJlZHVjZShmdW5jdGlvbiAoYWNjKSB7XG4gICAgdmFyIHZhbCA9IHRoaXMubm9kZTtcblxuICAgIGlmICh0aGlzLmtleSA9PT0gJyRyZWYnICYmIGlzSnNvblJlZmVyZW5jZSh0aGlzLnBhcmVudC5ub2RlKSkge1xuICAgICAgYWNjW3BhdGhUb1BvaW50ZXIodGhpcy5wYXRoKV0gPSB2YWw7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjYztcbiAgfSwge30pO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSBKU09OIFBvaW50ZXIgaXMgYSByZW1vdGUgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgdGhlIEpTT04gUG9pbnRlciBpcyByZW1vdGUgb3IgZmFsc2UgaWYgbm90XG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIGlzUmVtb3RlUG9pbnRlciA9IG1vZHVsZS5leHBvcnRzLmlzUmVtb3RlUG9pbnRlciA9IGZ1bmN0aW9uIGlzUmVtb3RlUG9pbnRlciAocHRyKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzU3RyaW5nKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gIH1cblxuICAvLyBXZSB0cmVhdCBhbnl0aGluZyBvdGhlciB0aGFuIGxvY2FsLCB2YWxpZCBKU09OIFBvaW50ZXIgdmFsdWVzIGFzIHJlbW90ZVxuICByZXR1cm4gcHRyICE9PSAnJyAmJiBwdHIuY2hhckF0KDApICE9PSAnIyc7XG59O1xuXG4vKipcbiAqIFRha2VzIGEgSlNPTiBSZWZlcmVuY2UgYW5kIHJldHVybnMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cy5cbiAqXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxfVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyIGZvciB0aGUgSlNPTiBSZWZlcmVuY2VcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IEFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgb3IgdGhlIHBhc3NlZCBpbiBzdHJpbmcgaWYgaXQgaXMgYSByZW1vdGUgcmVmZXJlbmNlXG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIHBhdGhGcm9tUG9pbnRlciA9IG1vZHVsZS5leHBvcnRzLnBhdGhGcm9tUG9pbnRlciA9IGZ1bmN0aW9uIHBhdGhGcm9tUG9pbnRlciAocHRyKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzU3RyaW5nKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gIH1cblxuICB2YXIgcGF0aCA9IFtdO1xuICB2YXIgcm9vdFBhdGhzID0gWycnLCAnIycsICcjLyddO1xuXG4gIGlmIChpc1JlbW90ZVBvaW50ZXIocHRyKSkge1xuICAgIHBhdGggPSBwdHI7XG4gIH0gZWxzZSB7XG4gICAgaWYgKHJvb3RQYXRocy5pbmRleE9mKHB0cikgPT09IC0xICYmIHB0ci5jaGFyQXQoMCkgPT09ICcjJykge1xuICAgICAgcGF0aCA9IHB0ci5zdWJzdHJpbmcocHRyLmluZGV4T2YoJy8nKSkuc3BsaXQoJy8nKS5yZWR1Y2UoZnVuY3Rpb24gKHBhcnRzLCBwYXJ0KSB7XG4gICAgICAgIGlmIChwYXJ0ICE9PSAnJykge1xuICAgICAgICAgIHBhcnRzLnB1c2gocGFydC5yZXBsYWNlKC9+MC9nLCAnficpLnJlcGxhY2UoL34xL2csICcvJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHBhcnRzO1xuICAgICAgfSwgW10pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXRoO1xufTtcblxuZnVuY3Rpb24gY29tYmluZVJlZnMgKGJhc2UsIHJlZikge1xuICB2YXIgYmFzZVBhdGggPSBwYXRoRnJvbVBvaW50ZXIoYmFzZSk7XG5cbiAgaWYgKGlzUmVtb3RlUG9pbnRlcihyZWYpKSB7XG4gICAgaWYgKHJlZi5pbmRleE9mKCcjJykgPT09IC0xKSB7XG4gICAgICByZWYgPSAnIyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlZiA9IHJlZi5zdWJzdHJpbmcocmVmLmluZGV4T2YoJyMnKSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHBhdGhUb1BvaW50ZXIoYmFzZVBhdGguY29uY2F0KHBhdGhGcm9tUG9pbnRlcihyZWYpKSkucmVwbGFjZSgvXFwvXFwkcmVmL2csICcnKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVVybCAoYmFzZSwgcmVmKSB7XG4gIHZhciBpc1JlbGF0aXZlID0gcmVmLmNoYXJBdCgwKSAhPT0gJyMnICYmIHJlZi5pbmRleE9mKCc6JykgPT09IC0xO1xuICB2YXIgbmV3TG9jYXRpb24gPSBbXTtcbiAgdmFyIHJlZlNlZ21lbnRzID0gKHJlZi5pbmRleE9mKCcjJykgPiAtMSA/IHJlZi5zcGxpdCgnIycpWzBdIDogcmVmKS5zcGxpdCgnLycpO1xuXG4gIGZ1bmN0aW9uIHNlZ21lbnRIYW5kbGVyIChzZWdtZW50KSB7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcuLicpIHtcbiAgICAgIG5ld0xvY2F0aW9uLnBvcCgpO1xuICAgIH0gZWxzZSBpZiAoc2VnbWVudCAhPT0gJy4nKSB7XG4gICAgICBuZXdMb2NhdGlvbi5wdXNoKHNlZ21lbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaFxuICBpZiAoYmFzZSAmJiBiYXNlLmxlbmd0aCA+IDEgJiYgYmFzZVtiYXNlLmxlbmd0aCAtIDFdID09PSAnLycpIHtcbiAgICBiYXNlID0gYmFzZS5zdWJzdHJpbmcoMCwgYmFzZS5sZW5ndGggLSAxKTtcbiAgfVxuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgYmFzZSAod2hlbiBhdmFpbGFibGUpXG4gIGlmIChiYXNlKSB7XG4gICAgYmFzZS5zcGxpdCgnIycpWzBdLnNwbGl0KCcvJykuZm9yRWFjaChzZWdtZW50SGFuZGxlcik7XG4gIH1cblxuICBpZiAoaXNSZWxhdGl2ZSkge1xuICAgIC8vIEFkZCByZWZlcmVuY2Ugc2VnbWVudHNcbiAgICByZWZTZWdtZW50cy5mb3JFYWNoKHNlZ21lbnRIYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBuZXdMb2NhdGlvbiA9IHJlZlNlZ21lbnRzO1xuICB9XG5cbiAgcmV0dXJuIG5ld0xvY2F0aW9uLmpvaW4oJy8nKTtcbn1cblxuZnVuY3Rpb24gcmVhbFJlc29sdmVSZWZzIChqc29uLCBvcHRpb25zLCBtZXRhZGF0YSkge1xuICB2YXIgZGVwdGggPSBfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZGVwdGgpID8gMSA6IG9wdGlvbnMuZGVwdGg7XG4gIHZhciBqc29uVCA9IHRyYXZlcnNlKGpzb24pO1xuXG4gIGZ1bmN0aW9uIGZpbmRQYXJlbnRSZWZlcmVuY2UgKHBhdGgpIHtcbiAgICB2YXIgcFBhdGggPSBwYXRoLnNsaWNlKDAsIHBhdGgubGFzdEluZGV4T2YoJ2FsbE9mJykpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3BhdGhUb1BvaW50ZXIocFBhdGgpXTtcblxuICAgIGlmICghXy5pc1VuZGVmaW5lZChyZWZNZXRhZGF0YSkpIHtcbiAgICAgIHJldHVybiBwYXRoVG9Qb2ludGVyKHBQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHBQYXRoLmluZGV4T2YoJ2FsbE9mJykgPiAtMSkge1xuICAgICAgICByZXR1cm4gZmluZFBhcmVudFJlZmVyZW5jZShwUGF0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZpeENpcmN1bGFycyAockpzb25UKSB7XG4gICAgdmFyIGNpcmN1bGFyUHRycyA9IFtdO1xuICAgIHZhciBzY3J1YmJlZCA9IHJKc29uVC5tYXAoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIHB0ciA9IHBhdGhUb1BvaW50ZXIodGhpcy5wYXRoKTtcbiAgICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3B0cl07XG4gICAgICB2YXIgcFB0cjtcblxuICAgICAgaWYgKHRoaXMuY2lyY3VsYXIpIHtcbiAgICAgICAgY2lyY3VsYXJQdHJzLnB1c2gocHRyKTtcblxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChyZWZNZXRhZGF0YSkpIHtcbiAgICAgICAgICAvLyBUaGlzIG11c3QgYmUgY2lyY3VsYXIgY29tcG9zaXRpb24vaW5oZXJpdGFuY2VcbiAgICAgICAgICBwUHRyID0gZmluZFBhcmVudFJlZmVyZW5jZSh0aGlzLnBhdGgpO1xuICAgICAgICAgIHJlZk1ldGFkYXRhID0gbWV0YWRhdGFbcFB0cl07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIV8uaXNVbmRlZmluZWQocmVmTWV0YWRhdGEpKSB7XG4gICAgICAgICAgcmVmTWV0YWRhdGEuY2lyY3VsYXIgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFRoaXMgc2hvdWxkIG5ldmVyIGhhcHBlbiBidXQgd2UgbmVlZCB0byBrbm93IGFib3V0IGl0IGlmIGl0IGRvZXNcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byBmaW5kIHJlZmVyZW5jZSBsZWFkaW5nIHRvIGNpcmN1bGFyIGNvbXBvc2l0aW9uOiAnICsgcHRyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgIHRoaXMudXBkYXRlKHt9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZSh0cmF2ZXJzZSh0aGlzLm5vZGUpLm1hcChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5jaXJjdWxhcikge1xuICAgICAgICAgICAgICB0aGlzLnBhcmVudC51cGRhdGUoe30pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gUmVwbGFjZSBzY3J1YmJlZCBjaXJjdWxhcnMgYmFzZWQgb24gZGVwdGhcbiAgICBfLmVhY2goY2lyY3VsYXJQdHJzLCBmdW5jdGlvbiAocHRyKSB7XG4gICAgICB2YXIgZGVwdGhQYXRoID0gW107XG4gICAgICB2YXIgcGF0aCA9IHBhdGhGcm9tUG9pbnRlcihwdHIpO1xuICAgICAgdmFyIHZhbHVlID0gdHJhdmVyc2Uoc2NydWJiZWQpLmdldChwYXRoKTtcbiAgICAgIHZhciBpO1xuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgZGVwdGg7IGkrKykge1xuICAgICAgICBkZXB0aFBhdGgucHVzaC5hcHBseShkZXB0aFBhdGgsIHBhdGgpO1xuXG4gICAgICAgIHRyYXZlcnNlKHNjcnViYmVkKS5zZXQoZGVwdGhQYXRoLCBfLmNsb25lRGVlcCh2YWx1ZSkpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHNjcnViYmVkO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVwbGFjZVJlZmVyZW5jZSAocmVmLCByZWZQdHIpIHtcbiAgICB2YXIgcmVmTWV0YWRhdGFLZXkgPSBjb21iaW5lUmVmcyhyZWZQdHIsICcjJyk7XG4gICAgdmFyIGxvY2FsUmVmID0gcmVmID0gcmVmLmluZGV4T2YoJyMnKSA9PT0gLTEgP1xuICAgICAgICAgICcjJyA6XG4gICAgICAgICAgcmVmLnN1YnN0cmluZyhyZWYuaW5kZXhPZignIycpKTtcbiAgICB2YXIgbG9jYWxQYXRoID0gcGF0aEZyb21Qb2ludGVyKGxvY2FsUmVmKTtcbiAgICB2YXIgbWlzc2luZyA9ICFqc29uVC5oYXMobG9jYWxQYXRoKTtcbiAgICB2YXIgdmFsdWUgPSBqc29uVC5nZXQobG9jYWxQYXRoKTtcbiAgICB2YXIgcmVmUHRyUGF0aCA9IHBhdGhGcm9tUG9pbnRlcihyZWZQdHIpO1xuICAgIHZhciBwYXJlbnRQYXRoID0gcmVmUHRyUGF0aC5zbGljZSgwLCByZWZQdHJQYXRoLmxlbmd0aCAtIDEpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3JlZk1ldGFkYXRhS2V5XSB8fCB7XG4gICAgICByZWY6IHJlZlxuICAgIH07XG5cbiAgICBpZiAoIW1pc3NpbmcpIHtcbiAgICAgIGlmIChwYXJlbnRQYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBTZWxmIHJlZmVyZW5jZXMgYXJlIHNwZWNpYWxcbiAgICAgICAgaWYgKGpzb25ULnZhbHVlID09PSB2YWx1ZSkge1xuICAgICAgICAgIHZhbHVlID0ge307XG5cbiAgICAgICAgICByZWZNZXRhZGF0YS5jaXJjdWxhciA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBqc29uVC52YWx1ZSA9IHZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGpzb25ULmdldChwYXJlbnRQYXRoKSA9PT0gdmFsdWUpIHtcbiAgICAgICAgICB2YWx1ZSA9IHt9O1xuXG4gICAgICAgICAgcmVmTWV0YWRhdGEuY2lyY3VsYXIgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAganNvblQuc2V0KHBhcmVudFBhdGgsIHZhbHVlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmVmTWV0YWRhdGEubWlzc2luZyA9IHRydWU7XG4gICAgfVxuXG4gICAgbWV0YWRhdGFbcmVmTWV0YWRhdGFLZXldID0gcmVmTWV0YWRhdGE7XG4gIH1cblxuICAvLyBBbGwgcmVmZXJlbmNlcyBhdCB0aGlzIHBvaW50IHNob3VsZCBiZSBsb2NhbCBleGNlcHQgbWlzc2luZy9pbnZhbGlkIHJlZmVyZW5jZXNcbiAgXy5lYWNoKGZpbmRSZWZzKGpzb24pLCBmdW5jdGlvbiAocmVmLCByZWZQdHIpIHtcbiAgICBpZiAoIWlzUmVtb3RlUG9pbnRlcihyZWYpKSB7XG4gICAgICByZXBsYWNlUmVmZXJlbmNlKHJlZiwgcmVmUHRyKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFJlbW92ZSBmdWxsIGxvY2F0aW9ucyBmcm9tIHJlZmVyZW5jZSBtZXRhZGF0YVxuICBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5sb2NhdGlvbikpIHtcbiAgICBfLmVhY2gobWV0YWRhdGEsIGZ1bmN0aW9uIChyZWZNZXRhZGF0YSkge1xuICAgICAgdmFyIG5vcm1hbGl6ZWRQdHIgPSByZWZNZXRhZGF0YS5yZWY7XG5cbiAgICAgIC8vIFJlbW92ZSB0aGUgYmFzZVxuICAgICAgbm9ybWFsaXplZFB0ciA9IG5vcm1hbGl6ZWRQdHIucmVwbGFjZShvcHRpb25zLmxvY2F0aW9uLCAnJyk7XG5cbiAgICAgIC8vIFJlbW92ZSB0aGUgLyBwcmVmaXhcbiAgICAgIGlmIChub3JtYWxpemVkUHRyLmNoYXJBdCgwKSA9PT0gJy8nKSB7XG4gICAgICAgIG5vcm1hbGl6ZWRQdHIgPSBub3JtYWxpemVkUHRyLnN1YnN0cmluZygxKTtcbiAgICAgIH1cblxuICAgICAgcmVmTWV0YWRhdGEucmVmID0gbm9ybWFsaXplZFB0cjtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEZpeCBjaXJjdWxhcnNcbiAgcmV0dXJuIHtcbiAgICBtZXRhZGF0YTogbWV0YWRhdGEsXG4gICAgcmVzb2x2ZWQ6IGZpeENpcmN1bGFycyhqc29uVClcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlbW90ZVJlZnMgKGpzb24sIG9wdGlvbnMsIHBhcmVudFB0ciwgcGFyZW50cywgbWV0YWRhdGEpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHZhciBqc29uVCA9IHRyYXZlcnNlKGpzb24pO1xuXG4gIGZ1bmN0aW9uIHJlcGxhY2VSZW1vdGVSZWYgKHJlZlB0ciwgcHRyLCByZW1vdGVMb2NhdGlvbiwgcmVtb3RlUHRyLCByZXNvbHZlZCkge1xuICAgIHZhciBub3JtYWxpemVkUHRyID0gcmVtb3RlTG9jYXRpb24gKyAocmVtb3RlUHRyID09PSAnIycgPyAnJyA6IHJlbW90ZVB0cik7XG4gICAgdmFyIHJlZk1ldGFkYXRhS2V5ID0gY29tYmluZVJlZnMocGFyZW50UHRyLCByZWZQdHIpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3JlZk1ldGFkYXRhS2V5XSB8fCB7fTtcbiAgICB2YXIgcmVmUGF0aCA9IHBhdGhGcm9tUG9pbnRlcihyZWZQdHIpO1xuICAgIHZhciB2YWx1ZTtcblxuICAgIGlmIChfLmlzVW5kZWZpbmVkKHJlc29sdmVkKSkge1xuICAgICAgcmVmTWV0YWRhdGEuY2lyY3VsYXIgPSB0cnVlO1xuXG4gICAgICAvLyBVc2UgdGhlIHBhcmVudCByZWZlcmVuY2UgbG9vY2F0aW9uXG4gICAgICB2YWx1ZSA9IHBhcmVudHNbcmVtb3RlTG9jYXRpb25dLnJlZjtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gR2V0IHRoZSByZW1vdGUgdmFsdWVcbiAgICAgIHZhbHVlID0gdHJhdmVyc2UocmVzb2x2ZWQpLmdldChwYXRoRnJvbVBvaW50ZXIocmVtb3RlUHRyKSk7XG5cbiAgICAgIC8vIElmIHRoZSByZW1vdGUgdmFsdWUgaXMgaXRzZWxmIGEgcmVmZXJlbmNlLCB1cGRhdGUgdGhlIHJlZmVyZW5jZSB0byBiZSByZXBsYWNlZCB3aXRoIGl0cyByZWZlcmVuY2UgdmFsdWUuXG4gICAgICAvLyBPdGhlcndpc2UsIHJlcGxhY2UgdGhlIHJlbW90ZSByZWZlcmVuY2UuXG4gICAgICBpZiAodmFsdWUuJHJlZikge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLiRyZWY7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZWZQYXRoLnBvcCgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvbGxhcHNlIHNlbGYgcmVmZXJlbmNlc1xuICAgIGlmIChyZWZQYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAganNvblQudmFsdWUgPSB2YWx1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAganNvblQuc2V0KHJlZlBhdGgsIHZhbHVlKTtcbiAgICB9XG5cbiAgICByZWZNZXRhZGF0YS5yZWYgPSBub3JtYWxpemVkUHRyO1xuXG4gICAgbWV0YWRhdGFbcmVmTWV0YWRhdGFLZXldID0gcmVmTWV0YWRhdGE7XG4gIH1cblxuICBmdW5jdGlvbiByZXNvbHZlciAoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGFkYXRhOiBtZXRhZGF0YSxcbiAgICAgIHJlc29sdmVkOiBqc29uVC52YWx1ZVxuICAgIH07XG4gIH1cblxuICBfLmVhY2goZmluZFJlZnMoanNvbiksIGZ1bmN0aW9uIChwdHIsIHJlZlB0cikge1xuICAgIGlmIChpc1JlbW90ZVBvaW50ZXIocHRyKSkge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHJlbW90ZUxvY2F0aW9uID0gY29tcHV0ZVVybChvcHRpb25zLmxvY2F0aW9uLCBwdHIpO1xuICAgICAgICB2YXIgcmVmUGFydHMgPSBwdHIuc3BsaXQoJyMnKTtcbiAgICAgICAgdmFyIGhhc2ggPSAnIycgKyAocmVmUGFydHNbMV0gfHwgJycpO1xuXG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKHBhcmVudHNbcmVtb3RlTG9jYXRpb25dKSkge1xuICAgICAgICAgIHJldHVybiBnZXRSZW1vdGVKc29uKHJlbW90ZUxvY2F0aW9uLCBvcHRpb25zKVxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJlbW90ZUpzb24pIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlbW90ZUpzb247XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgIHJldHVybiBlcnI7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgIHZhciByZWZCYXNlID0gcmVmUGFydHNbMF07XG4gICAgICAgICAgICAgIHZhciByT3B0aW9ucyA9IF8uY2xvbmVEZWVwKG9wdGlvbnMpO1xuICAgICAgICAgICAgICB2YXIgbmV3UGFyZW50UHRyID0gY29tYmluZVJlZnMocGFyZW50UHRyLCByZWZQdHIpO1xuXG4gICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgbGFzdCBwYXRoIHNlZ21lbnRcbiAgICAgICAgICAgICAgcmVmQmFzZSA9IHJlZkJhc2Uuc3Vic3RyaW5nKDAsIHJlZkJhc2UubGFzdEluZGV4T2YoJy8nKSArIDEpO1xuXG4gICAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgcmVjdXJzaXZlIGxvY2F0aW9uXG4gICAgICAgICAgICAgIHJPcHRpb25zLmxvY2F0aW9uID0gY29tcHV0ZVVybChvcHRpb25zLmxvY2F0aW9uLCByZWZCYXNlKTtcblxuICAgICAgICAgICAgICAvLyBSZWNvcmQgdGhlIHBhcmVudFxuICAgICAgICAgICAgICBwYXJlbnRzW3JlbW90ZUxvY2F0aW9uXSA9IHtcbiAgICAgICAgICAgICAgICByZWY6IHBhcmVudFB0clxuICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgIGlmIChfLmlzRXJyb3IocmVzcG9uc2UpKSB7XG4gICAgICAgICAgICAgICAgbWV0YWRhdGFbbmV3UGFyZW50UHRyXSA9IHtcbiAgICAgICAgICAgICAgICAgIGVycjogcmVzcG9uc2UsXG4gICAgICAgICAgICAgICAgICBtaXNzaW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcmVmOiBwdHJcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgcmVtb3RlIHJlZmVyZW5jZXNcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzb2x2ZVJlbW90ZVJlZnMocmVzcG9uc2UsIHJPcHRpb25zLCBuZXdQYXJlbnRQdHIsIHBhcmVudHMsIG1ldGFkYXRhKVxuICAgICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJNZXRhZGF0YSkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcGFyZW50c1tyZW1vdGVMb2NhdGlvbl07XG5cbiAgICAgICAgICAgICAgICAgICAgcmVwbGFjZVJlbW90ZVJlZihyZWZQdHIsIHB0ciwgcmVtb3RlTG9jYXRpb24sIGhhc2gsIHJNZXRhZGF0YS5yZXNvbHZlZCk7XG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBhIGNpcmN1bGFyIHJlZmVyZW5jZVxuICAgICAgICAgIHJlcGxhY2VSZW1vdGVSZWYocmVmUHRyLCBwdHIsIHJlbW90ZUxvY2F0aW9uLCBoYXNoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4ocmVzb2x2ZXIsIHJlc29sdmVyKTtcblxuICByZXR1cm4gYWxsVGFza3M7XG59XG5cbi8qKlxuICogVGFrZXMgYSBKU09OIGRvY3VtZW50LCByZXNvbHZlcyBhbGwgSlNPTiBSZWZlcmVuY2VzIGFuZCByZXR1cm5zIGEgZnVsbHkgcmVzb2x2ZWQgZXF1aXZhbGVudCBhbG9uZyB3aXRoIHJlZmVyZW5jZVxuICogcmVzb2x1dGlvbiBtZXRhZGF0YS5cbiAqXG4gKiAqKkltcG9ydGFudCBEZXRhaWxzKipcbiAqXG4gKiAqIFRoZSBpbnB1dCBhcmd1bWVudHMgYXJlIG5ldmVyIGFsdGVyZWRcbiAqICogV2hlbiB1c2luZyBwcm9taXNlcywgb25seSBvbmUgdmFsdWUgY2FuIGJlIHJlc29sdmVkIHNvIGl0IGlzIGFuIG9iamVjdCB3aG9zZSBrZXlzIGFuZCB2YWx1ZXMgYXJlIHRoZSBzYW1lIG5hbWUgYW5kXG4gKiAgIHZhbHVlIGFzIGFyZ3VtZW50cyAxIGFuZCAyIGZvciB7QGxpbmsgcmVzdWx0Q2FsbGJhY2t9XG4gKlxuICogQHBhcmFtIHtvYmplY3R9IGpzb24gLSBUaGUgSlNPTiAgZG9jdW1lbnQgaGF2aW5nIHplcm8gb3IgbW9yZSBKU09OIFJlZmVyZW5jZXNcbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBUaGUgb3B0aW9ucyAoQWxsIG9wdGlvbnMgYXJlIHBhc3NlZCBkb3duIHRvIHdoaXRsb2NramMvcGF0aC1sb2FkZXIpXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdGlvbnMuZGVwdGg9MV0gLSBUaGUgZGVwdGggdG8gcmVzb2x2ZSBjaXJjdWxhciByZWZlcmVuY2VzXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMubG9jYXRpb25dIC0gVGhlIGxvY2F0aW9uIHRvIHdoaWNoIHJlbGF0aXZlIHJlZmVyZW5jZXMgc2hvdWxkIGJlIHJlc29sdmVkXG4gKiBAcGFyYW0ge3ByZXBhcmVSZXF1ZXN0Q2FsbGJhY2t9IFtvcHRpb25zLnByZXBhcmVSZXF1ZXN0XSAtIFRoZSBjYWxsYmFjayB1c2VkIHRvIHByZXBhcmUgYW4gSFRUUCByZXF1ZXN0XG4gKiBAcGFyYW0ge3Byb2Nlc3NDb250ZW50Q2FsbGJhY2t9IFtvcHRpb25zLnByb2Nlc3NDb250ZW50XSAtIFRoZSBjYWxsYmFjayB1c2VkIHRvIHByb2Nlc3MgYSByZWZlcmVuY2UncyBjb250ZW50XG4gKiBAcGFyYW0ge3Jlc3VsdENhbGxiYWNrfSBbZG9uZV0gLSBUaGUgcmVzdWx0IGNhbGxiYWNrXG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gVGhlIHByb21pc2UuXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgY2FsbGJhY2tzXG4gKlxuICogSnNvblJlZnMucmVzb2x2ZVJlZnMoe1xuICogICBuYW1lOiAnanNvbi1yZWZzJyxcbiAqICAgb3duZXI6IHtcbiAqICAgICAkcmVmOiAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL2pzb24tcmVmcyMvb3duZXInXG4gKiAgIH1cbiAqIH0sIGZ1bmN0aW9uIChlcnIsIHJlc29sdmVkLCBtZXRhZGF0YSkge1xuICogICBpZiAoZXJyKSB0aHJvdyBlcnI7XG4gKlxuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXNvbHZlZCkpOyAvLyB7bmFtZTogJ2pzb24tcmVmcycsIG93bmVyOiB7IC4uLiB9fVxuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShtZXRhZGF0YSkpOyAvLyB7JyMvb3duZXInOiB7cmVmOiAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL2pzb24tcmVmcyMvb3duZXInfX1cbiAqIH0pO1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIHVzaW5nIHByb21pc2VzXG4gKlxuICogSnNvblJlZnMucmVzb2x2ZVJlZnMoe1xuICogICBuYW1lOiAnanNvbi1yZWZzJyxcbiAqICAgb3duZXI6IHtcbiAqICAgICAkcmVmOiAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL2pzb24tcmVmcyMvb3duZXInXG4gKiAgIH1cbiAqIH0pLnRoZW4oZnVuY3Rpb24gKHJlc3VsdHMpIHtcbiAqICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0cy5yZXNvbHZlZCkpOyAvLyB7bmFtZTogJ2pzb24tcmVmcycsIG93bmVyOiB7IC4uLiB9fVxuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLm1ldGFkYXRhKSk7IC8vIHsnIy9vd25lcic6IHtyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcid9fVxuICogfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgb3B0aW9ucy5wcmVwYXJlUmVxdWVzdCAodG8gYWRkIGF1dGhlbnRpY2F0aW9uIGNyZWRlbnRpYWxzKSBhbmQgb3B0aW9ucy5wcm9jZXNzQ29udGVudCAodG8gcHJvY2VzcyBZQU1MKVxuICpcbiAqIEpzb25SZWZzLnJlc29sdmVSZWZzKHtcbiAqICAgbmFtZTogJ2pzb24tcmVmcycsXG4gKiAgIG93bmVyOiB7XG4gKiAgICAgJHJlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ1xuICogICB9XG4gKiB9LCB7XG4gKiAgIHByZXBhcmVSZXF1ZXN0OiBmdW5jdGlvbiAocmVxKSB7XG4gKiAgICAgLy8gQWRkIHRoZSAnQmFzaWMgQXV0aGVudGljYXRpb24nIGNyZWRlbnRpYWxzXG4gKiAgICAgcmVxLmF1dGgoJ3doaXRsb2NramMnLCAnTVlfR0lUSFVCX1BBU1NXT1JEJyk7XG4gKlxuICogICAgIC8vIEFkZCB0aGUgJ1gtQVBJLUtleScgaGVhZGVyIGZvciBhbiBBUEkgS2V5IGJhc2VkIGF1dGhlbnRpY2F0aW9uXG4gKiAgICAgLy8gcmVxLnNldCgnWC1BUEktS2V5JywgJ01ZX0FQSV9LRVknKTtcbiAqICAgfSxcbiAqICAgcHJvY2Vzc0NvbnRlbnQ6IGZ1bmN0aW9uIChjb250ZW50KSB7XG4gKiAgICAgcmV0dXJuIFlBTUwucGFyc2UoY29udGVudCk7XG4gKiAgIH1cbiAqIH0pLnRoZW4oZnVuY3Rpb24gKHJlc3VsdHMpIHtcbiAqICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0cy5yZXNvbHZlZCkpOyAvLyB7bmFtZTogJ2pzb24tcmVmcycsIG93bmVyOiB7IC4uLiB9fVxuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLm1ldGFkYXRhKSk7IC8vIHsnIy9vd25lcic6IHtyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcid9fVxuICogfSk7XG4gKi9cbm1vZHVsZS5leHBvcnRzLnJlc29sdmVSZWZzID0gZnVuY3Rpb24gcmVzb2x2ZVJlZnMgKGpzb24sIG9wdGlvbnMsIGRvbmUpIHtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpIHtcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKG9wdGlvbnMpKSB7XG4gICAgICBkb25lID0gb3B0aW9ucztcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9XG4gIH1cblxuICBpZiAoXy5pc1VuZGVmaW5lZChvcHRpb25zKSkge1xuICAgIG9wdGlvbnMgPSB7fTtcbiAgfVxuXG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgaWYgKF8uaXNVbmRlZmluZWQoanNvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignanNvbiBpcyByZXF1aXJlZCcpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNQbGFpbk9iamVjdChqc29uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1BsYWluT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMgbXVzdCBiZSBhbiBvYmplY3QnKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKGRvbmUpICYmICFfLmlzRnVuY3Rpb24oZG9uZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignZG9uZSBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSB0aGUgb3B0aW9ucyAoVGhpcyBvcHRpb24gZG9lcyBub3QgYXBwbHkgdG8gKVxuICAgIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLnByb2Nlc3NDb250ZW50KSAmJiAhXy5pc0Z1bmN0aW9uKG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMucHJvY2Vzc0NvbnRlbnQgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLnByZXBhcmVSZXF1ZXN0KSAmJiAhXy5pc0Z1bmN0aW9uKG9wdGlvbnMucHJlcGFyZVJlcXVlc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMucHJlcGFyZVJlcXVlc3QgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmxvY2F0aW9uKSAmJiAhXy5pc1N0cmluZyhvcHRpb25zLmxvY2F0aW9uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zLmxvY2F0aW9uIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZGVwdGgpICYmICFfLmlzTnVtYmVyKG9wdGlvbnMuZGVwdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMuZGVwdGggbXVzdCBiZSBhIG51bWJlcicpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5kZXB0aCkgJiYgb3B0aW9ucy5kZXB0aCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5kZXB0aCBtdXN0IGJlIGdyZWF0ZXIgb3IgZXF1YWwgdG8gemVybycpO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gQ2xvbmUgdGhlIGlucHV0cyBzbyB3ZSBkbyBub3QgYWx0ZXIgdGhlbVxuICBqc29uID0gdHJhdmVyc2UoanNvbikuY2xvbmUoKTtcbiAgb3B0aW9ucyA9IHRyYXZlcnNlKG9wdGlvbnMpLmNsb25lKCk7XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgIC50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiByZXNvbHZlUmVtb3RlUmVmcyhqc29uLCBvcHRpb25zLCAnIycsIHt9LCB7fSk7XG4gICAgfSlcbiAgICAudGhlbihmdW5jdGlvbiAobWV0YWRhdGEpIHtcbiAgICAgIHJldHVybiByZWFsUmVzb2x2ZVJlZnMobWV0YWRhdGEucmVzb2x2ZWQsIG9wdGlvbnMsIG1ldGFkYXRhLm1ldGFkYXRhKTtcbiAgICB9KTtcblxuICAvLyBVc2UgdGhlIGNhbGxiYWNrIGlmIHByb3ZpZGVkIGFuZCBpdCBpcyBhIGZ1bmN0aW9uXG4gIGlmICghXy5pc1VuZGVmaW5lZChkb25lKSAmJiBfLmlzRnVuY3Rpb24oZG9uZSkpIHtcbiAgICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgICAudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICAgICAgICBkb25lKHVuZGVmaW5lZCwgcmVzdWx0cy5yZXNvbHZlZCwgcmVzdWx0cy5tZXRhZGF0YSk7XG4gICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGRvbmUoZXJyKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGFsbFRhc2tzO1xufTtcbiIsIi8qXG4gKiBUaGUgTUlUIExpY2Vuc2UgKE1JVClcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTQgSmVyZW15IFdoaXRsb2NrXG4gKlxuICogUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuICogb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuICogaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuICogdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuICogY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4gKiBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4gKiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4gKiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuICogQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuICogTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbiAqIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbiAqIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbi8vIFRoaXMgaXMgYSBzaW1wbGUgd3JhcHBlciBmb3IgTG9kYXNoIGZ1bmN0aW9ucyBidXQgdXNpbmcgc2ltcGxlIEVTNSBhbmQgZXhpc3RpbmcgcmVxdWlyZWQgZGVwZW5kZW5jaWVzXG4vLyAoY2xvbmVEZWVwIHVzZXMgdHJhdmVyc2UgZm9yIGV4YW1wbGUpLiAgVGhlIHJlYXNvbiBmb3IgdGhpcyB3YXMgYSBtdWNoIHNtYWxsZXIgZmlsZSBzaXplLiAgQWxsIGV4cG9ydGVkIGZ1bmN0aW9uc1xuLy8gbWF0Y2ggbWFwIHRvIGEgbG9kYXNoIGVxdWl2YWxlbnQuXG5cbnZhciB0cmF2ZXJzZSA9ICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93Wyd0cmF2ZXJzZSddIDogdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbFsndHJhdmVyc2UnXSA6IG51bGwpO1xuXG5mdW5jdGlvbiBpc1R5cGUgKG9iaiwgdHlwZSkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0ICcgKyB0eXBlICsgJ10nO1xufVxuXG5tb2R1bGUuZXhwb3J0cy5jbG9uZURlZXAgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiB0cmF2ZXJzZShvYmopLmNsb25lKCk7XG59O1xuXG52YXIgaXNBcnJheSA9IG1vZHVsZS5leHBvcnRzLmlzQXJyYXkgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnQXJyYXknKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzRXJyb3IgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnRXJyb3InKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzRnVuY3Rpb24gPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnRnVuY3Rpb24nKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzTnVtYmVyID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ051bWJlcicpO1xufTtcblxudmFyIGlzUGxhaW5PYmplY3QgPSBtb2R1bGUuZXhwb3J0cy5pc1BsYWluT2JqZWN0ID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ09iamVjdCcpO1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNTdHJpbmcgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBpc1R5cGUob2JqLCAnU3RyaW5nJyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc1VuZGVmaW5lZCA9IGZ1bmN0aW9uIChvYmopIHtcbiAgLy8gQ29tbWVudGVkIG91dCBkdWUgdG8gUGhhbnRvbUpTIGJ1ZyAoaHR0cHM6Ly9naXRodWIuY29tL2FyaXlhL3BoYW50b21qcy9pc3N1ZXMvMTE3MjIpXG4gIC8vIHJldHVybiBpc1R5cGUob2JqLCAnVW5kZWZpbmVkJyk7XG4gIHJldHVybiB0eXBlb2Ygb2JqID09PSAndW5kZWZpbmVkJztcbn07XG5cbm1vZHVsZS5leHBvcnRzLmVhY2ggPSBmdW5jdGlvbiAoc291cmNlLCBoYW5kbGVyKSB7XG4gIGlmIChpc0FycmF5KHNvdXJjZSkpIHtcbiAgICBzb3VyY2UuZm9yRWFjaChoYW5kbGVyKTtcbiAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KHNvdXJjZSkpIHtcbiAgICBPYmplY3Qua2V5cyhzb3VyY2UpLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgaGFuZGxlcihzb3VyY2Vba2V5XSwga2V5KTtcbiAgICB9KTtcbiAgfVxufTtcbiIsIi8qISBOYXRpdmUgUHJvbWlzZSBPbmx5XG4gICAgdjAuOC4wLWEgKGMpIEt5bGUgU2ltcHNvblxuICAgIE1JVCBMaWNlbnNlOiBodHRwOi8vZ2V0aWZ5Lm1pdC1saWNlbnNlLm9yZ1xuKi9cbiFmdW5jdGlvbih0LG4sZSl7blt0XT1uW3RdfHxlKCksXCJ1bmRlZmluZWRcIiE9dHlwZW9mIG1vZHVsZSYmbW9kdWxlLmV4cG9ydHM/bW9kdWxlLmV4cG9ydHM9blt0XTpcImZ1bmN0aW9uXCI9PXR5cGVvZiBkZWZpbmUmJmRlZmluZS5hbWQmJmRlZmluZShmdW5jdGlvbigpe3JldHVybiBuW3RdfSl9KFwiUHJvbWlzZVwiLFwidW5kZWZpbmVkXCIhPXR5cGVvZiBnbG9iYWw/Z2xvYmFsOnRoaXMsZnVuY3Rpb24oKXtcInVzZSBzdHJpY3RcIjtmdW5jdGlvbiB0KHQsbil7bC5hZGQodCxuKSxofHwoaD15KGwuZHJhaW4pKX1mdW5jdGlvbiBuKHQpe3ZhciBuLGU9dHlwZW9mIHQ7cmV0dXJuIG51bGw9PXR8fFwib2JqZWN0XCIhPWUmJlwiZnVuY3Rpb25cIiE9ZXx8KG49dC50aGVuKSxcImZ1bmN0aW9uXCI9PXR5cGVvZiBuP246ITF9ZnVuY3Rpb24gZSgpe2Zvcih2YXIgdD0wO3Q8dGhpcy5jaGFpbi5sZW5ndGg7dCsrKW8odGhpcywxPT09dGhpcy5zdGF0ZT90aGlzLmNoYWluW3RdLnN1Y2Nlc3M6dGhpcy5jaGFpblt0XS5mYWlsdXJlLHRoaXMuY2hhaW5bdF0pO3RoaXMuY2hhaW4ubGVuZ3RoPTB9ZnVuY3Rpb24gbyh0LGUsbyl7dmFyIHIsaTt0cnl7ZT09PSExP28ucmVqZWN0KHQubXNnKToocj1lPT09ITA/dC5tc2c6ZS5jYWxsKHZvaWQgMCx0Lm1zZykscj09PW8ucHJvbWlzZT9vLnJlamVjdChUeXBlRXJyb3IoXCJQcm9taXNlLWNoYWluIGN5Y2xlXCIpKTooaT1uKHIpKT9pLmNhbGwocixvLnJlc29sdmUsby5yZWplY3QpOm8ucmVzb2x2ZShyKSl9Y2F0Y2goYyl7by5yZWplY3QoYyl9fWZ1bmN0aW9uIHIobyl7dmFyIGMsdT10aGlzO2lmKCF1LnRyaWdnZXJlZCl7dS50cmlnZ2VyZWQ9ITAsdS5kZWYmJih1PXUuZGVmKTt0cnl7KGM9bihvKSk/dChmdW5jdGlvbigpe3ZhciB0PW5ldyBmKHUpO3RyeXtjLmNhbGwobyxmdW5jdGlvbigpe3IuYXBwbHkodCxhcmd1bWVudHMpfSxmdW5jdGlvbigpe2kuYXBwbHkodCxhcmd1bWVudHMpfSl9Y2F0Y2gobil7aS5jYWxsKHQsbil9fSk6KHUubXNnPW8sdS5zdGF0ZT0xLHUuY2hhaW4ubGVuZ3RoPjAmJnQoZSx1KSl9Y2F0Y2goYSl7aS5jYWxsKG5ldyBmKHUpLGEpfX19ZnVuY3Rpb24gaShuKXt2YXIgbz10aGlzO28udHJpZ2dlcmVkfHwoby50cmlnZ2VyZWQ9ITAsby5kZWYmJihvPW8uZGVmKSxvLm1zZz1uLG8uc3RhdGU9MixvLmNoYWluLmxlbmd0aD4wJiZ0KGUsbykpfWZ1bmN0aW9uIGModCxuLGUsbyl7Zm9yKHZhciByPTA7cjxuLmxlbmd0aDtyKyspIWZ1bmN0aW9uKHIpe3QucmVzb2x2ZShuW3JdKS50aGVuKGZ1bmN0aW9uKHQpe2Uocix0KX0sbyl9KHIpfWZ1bmN0aW9uIGYodCl7dGhpcy5kZWY9dCx0aGlzLnRyaWdnZXJlZD0hMX1mdW5jdGlvbiB1KHQpe3RoaXMucHJvbWlzZT10LHRoaXMuc3RhdGU9MCx0aGlzLnRyaWdnZXJlZD0hMSx0aGlzLmNoYWluPVtdLHRoaXMubXNnPXZvaWQgMH1mdW5jdGlvbiBhKG4pe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIG4pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7aWYoMCE9PXRoaXMuX19OUE9fXyl0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBwcm9taXNlXCIpO3RoaXMuX19OUE9fXz0xO3ZhciBvPW5ldyB1KHRoaXMpO3RoaXMudGhlbj1mdW5jdGlvbihuLHIpe3ZhciBpPXtzdWNjZXNzOlwiZnVuY3Rpb25cIj09dHlwZW9mIG4/bjohMCxmYWlsdXJlOlwiZnVuY3Rpb25cIj09dHlwZW9mIHI/cjohMX07cmV0dXJuIGkucHJvbWlzZT1uZXcgdGhpcy5jb25zdHJ1Y3RvcihmdW5jdGlvbih0LG4pe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIHR8fFwiZnVuY3Rpb25cIiE9dHlwZW9mIG4pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7aS5yZXNvbHZlPXQsaS5yZWplY3Q9bn0pLG8uY2hhaW4ucHVzaChpKSwwIT09by5zdGF0ZSYmdChlLG8pLGkucHJvbWlzZX0sdGhpc1tcImNhdGNoXCJdPWZ1bmN0aW9uKHQpe3JldHVybiB0aGlzLnRoZW4odm9pZCAwLHQpfTt0cnl7bi5jYWxsKHZvaWQgMCxmdW5jdGlvbih0KXtyLmNhbGwobyx0KX0sZnVuY3Rpb24odCl7aS5jYWxsKG8sdCl9KX1jYXRjaChjKXtpLmNhbGwobyxjKX19dmFyIHMsaCxsLHA9T2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyx5PVwidW5kZWZpbmVkXCIhPXR5cGVvZiBzZXRJbW1lZGlhdGU/ZnVuY3Rpb24odCl7cmV0dXJuIHNldEltbWVkaWF0ZSh0KX06c2V0VGltZW91dDt0cnl7T2JqZWN0LmRlZmluZVByb3BlcnR5KHt9LFwieFwiLHt9KSxzPWZ1bmN0aW9uKHQsbixlLG8pe3JldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkodCxuLHt2YWx1ZTplLHdyaXRhYmxlOiEwLGNvbmZpZ3VyYWJsZTpvIT09ITF9KX19Y2F0Y2goZCl7cz1mdW5jdGlvbih0LG4sZSl7cmV0dXJuIHRbbl09ZSx0fX1sPWZ1bmN0aW9uKCl7ZnVuY3Rpb24gdCh0LG4pe3RoaXMuZm49dCx0aGlzLnNlbGY9bix0aGlzLm5leHQ9dm9pZCAwfXZhciBuLGUsbztyZXR1cm57YWRkOmZ1bmN0aW9uKHIsaSl7bz1uZXcgdChyLGkpLGU/ZS5uZXh0PW86bj1vLGU9byxvPXZvaWQgMH0sZHJhaW46ZnVuY3Rpb24oKXt2YXIgdD1uO2ZvcihuPWU9aD12b2lkIDA7dDspdC5mbi5jYWxsKHQuc2VsZiksdD10Lm5leHR9fX0oKTt2YXIgZz1zKHt9LFwiY29uc3RydWN0b3JcIixhLCExKTtyZXR1cm4gYS5wcm90b3R5cGU9ZyxzKGcsXCJfX05QT19fXCIsMCwhMSkscyhhLFwicmVzb2x2ZVwiLGZ1bmN0aW9uKHQpe3ZhciBuPXRoaXM7cmV0dXJuIHQmJlwib2JqZWN0XCI9PXR5cGVvZiB0JiYxPT09dC5fX05QT19fP3Q6bmV3IG4oZnVuY3Rpb24obixlKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBufHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBlKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO24odCl9KX0pLHMoYSxcInJlamVjdFwiLGZ1bmN0aW9uKHQpe3JldHVybiBuZXcgdGhpcyhmdW5jdGlvbihuLGUpe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIG58fFwiZnVuY3Rpb25cIiE9dHlwZW9mIGUpdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7ZSh0KX0pfSkscyhhLFwiYWxsXCIsZnVuY3Rpb24odCl7dmFyIG49dGhpcztyZXR1cm5cIltvYmplY3QgQXJyYXldXCIhPXAuY2FsbCh0KT9uLnJlamVjdChUeXBlRXJyb3IoXCJOb3QgYW4gYXJyYXlcIikpOjA9PT10Lmxlbmd0aD9uLnJlc29sdmUoW10pOm5ldyBuKGZ1bmN0aW9uKGUsbyl7aWYoXCJmdW5jdGlvblwiIT10eXBlb2YgZXx8XCJmdW5jdGlvblwiIT10eXBlb2Ygbyl0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTt2YXIgcj10Lmxlbmd0aCxpPUFycmF5KHIpLGY9MDtjKG4sdCxmdW5jdGlvbih0LG4pe2lbdF09biwrK2Y9PT1yJiZlKGkpfSxvKX0pfSkscyhhLFwicmFjZVwiLGZ1bmN0aW9uKHQpe3ZhciBuPXRoaXM7cmV0dXJuXCJbb2JqZWN0IEFycmF5XVwiIT1wLmNhbGwodCk/bi5yZWplY3QoVHlwZUVycm9yKFwiTm90IGFuIGFycmF5XCIpKTpuZXcgbihmdW5jdGlvbihlLG8pe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIGV8fFwiZnVuY3Rpb25cIiE9dHlwZW9mIG8pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7YyhuLHQsZnVuY3Rpb24odCxuKXtlKG4pfSxvKX0pfSksYX0pO1xuIl19
