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
    } else {
      // Update local references to be relative to the root document
      jsonT.set(pathFromPointer(refPtr), combineRefs(parentPtr, ptr));
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
var defaultLoader = typeof window === 'undefined' ? supportedLoaders.file : supportedLoaders.http;

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
 * // Example using options.processContent to load a YAML file
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

var root = 'undefined' == typeof window
  ? (this || self)
  : window;

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
  this.status = status;
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

    self.callback(err || new_err, res);
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
    var serialize = request.serialize[this.getHeader('Content-Type')];
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi91dGlscy5qcyIsIm5vZGVfbW9kdWxlcy9uYXRpdmUtcHJvbWlzZS1vbmx5L25wby5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9saWIvbG9hZGVycy9maWxlLWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcGF0aC1sb2FkZXIvbGliL2xvYWRlcnMvaHR0cC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9ub2RlX21vZHVsZXMvc3VwZXJhZ2VudC9saWIvY2xpZW50LmpzIiwibm9kZV9tb2R1bGVzL3BhdGgtbG9hZGVyL25vZGVfbW9kdWxlcy9zdXBlcmFnZW50L25vZGVfbW9kdWxlcy9jb21wb25lbnQtZW1pdHRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wYXRoLWxvYWRlci9ub2RlX21vZHVsZXMvc3VwZXJhZ2VudC9ub2RlX21vZHVsZXMvcmVkdWNlLWNvbXBvbmVudC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy90cmF2ZXJzZS9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQy9FQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUxBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9FQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25tQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vLyBMb2FkIHByb21pc2VzIHBvbHlmaWxsIGlmIG5lY2Vzc2FyeVxuaWYgKHR5cGVvZiBQcm9taXNlID09PSAndW5kZWZpbmVkJykge1xuICByZXF1aXJlKCduYXRpdmUtcHJvbWlzZS1vbmx5Jyk7XG59XG5cbnZhciBfID0gcmVxdWlyZSgnLi9saWIvdXRpbHMnKTtcbnZhciBwYXRoTG9hZGVyID0gcmVxdWlyZSgncGF0aC1sb2FkZXInKTtcbnZhciB0cmF2ZXJzZSA9IHJlcXVpcmUoJ3RyYXZlcnNlJyk7XG5cbnZhciByZW1vdGVDYWNoZSA9IHt9O1xudmFyIHN1cHBvcnRlZFNjaGVtZXMgPSBbJ2ZpbGUnLCAnaHR0cCcsICdodHRwcyddO1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgYnkge0BsaW5rIHJlc29sdmVSZWZzfS5cbiAqXG4gKiBAcGFyYW0ge2Vycm9yfSBbZXJyXSAtIFRoZSBlcnJvciBpZiB0aGVyZSBpcyBhIHByb2JsZW1cbiAqIEBwYXJhbSB7b2JqZWN0fSBbcmVzb2x2ZWRdIC0gVGhlIHJlc29sdmVkIHJlc3VsdHNcbiAqIEBwYXJhbSB7b2JqZWN0fSBbbWV0YWRhdGFdIC0gVGhlIHJlZmVyZW5jZSByZXNvbHV0aW9uIG1ldGFkYXRhLiAgKihUaGUga2V5IGEgSlNPTiBQb2ludGVyIHRvIGEgcGF0aCBpbiB0aGUgcmVzb2x2ZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQgd2hlcmUgYSBKU09OIFJlZmVyZW5jZSB3YXMgZGVyZWZlcmVuY2VkLiAgVGhlIHZhbHVlIGlzIGFsc28gYW4gb2JqZWN0LiAgRXZlcnlcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YWRhdGEgZW50cnkgaGFzIGEgYHJlZmAgcHJvcGVydHkgdG8gdGVsbCB5b3Ugd2hlcmUgdGhlIGRlcmVmZXJlbmNlZCB2YWx1ZSBjYW1lIGZyb20uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIElmIHRoZXJlIGlzIGFuIGBlcnJgIHByb3BlcnR5LCBpdCBpcyB0aGUgYEVycm9yYCBvYmplY3QgZW5jb3VudGVyZWQgcmV0cmlldmluZyB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmZXJlbmNlZCB2YWx1ZS4gIElmIHRoZXJlIGlzIGEgYG1pc3NpbmdgIHByb3BlcnR5LCBpdCBtZWFucyB0aGUgcmVmZXJlbmNlZCB2YWx1ZSBjb3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBub3QgYmUgcmVzb2x2ZWQuKSpcbiAqXG4gKiBAY2FsbGJhY2sgcmVzdWx0Q2FsbGJhY2tcbiAqL1xuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgdG8gcHJvdmlkZSBhY2Nlc3MgdG8gYWx0ZXJpbmcgYSByZW1vdGUgcmVxdWVzdCBwcmlvciB0byB0aGUgcmVxdWVzdCBiZWluZyBtYWRlLlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSByZXEgLSBUaGUgU3VwZXJhZ2VudCByZXF1ZXN0IG9iamVjdFxuICogQHBhcmFtIHtzdHJpbmd9IHJlZiAtIFRoZSByZWZlcmVuY2UgYmVpbmcgcmVzb2x2ZWQgKFdoZW4gYXBwbGljYWJsZSlcbiAqXG4gKiBAY2FsbGJhY2sgcHJlcGFyZVJlcXVlc3RDYWxsYmFja1xuICovXG5cbi8qKlxuICogQ2FsbGJhY2sgdXNlZCB0byBwcm9jZXNzIHRoZSBjb250ZW50IG9mIGEgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gVGhlIGNvbnRlbnQgbG9hZGVkIGZyb20gdGhlIGZpbGUvVVJMXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVmIC0gVGhlIHJlZmVyZW5jZSBzdHJpbmcgKFdoZW4gYXBwbGljYWJsZSlcbiAqIEBwYXJhbSB7b2JqZWN0fSBbcmVzXSAtIFRoZSBTdXBlcmFnZW50IHJlc3BvbnNlIG9iamVjdCAoRm9yIHJlbW90ZSBVUkwgcmVxdWVzdHMgb25seSlcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBUaGUgSmF2YVNjcmlwdCBvYmplY3QgcmVwcmVzZW50YXRpb24gb2YgdGhlIHJlZmVyZW5jZVxuICpcbiAqIEBjYWxsYmFjayBwcm9jZXNzQ29udGVudENhbGxiYWNrXG4gKi9cblxuLyogSW50ZXJuYWwgRnVuY3Rpb25zICovXG5cbi8qKlxuICogUmV0cmlldmVzIHRoZSBjb250ZW50IGF0IHRoZSBVUkwgYW5kIHJldHVybnMgaXRzIEpTT04gY29udGVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVGhlIFVSTCB0byByZXRyaWV2ZVxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBwYXNzZWQgdG8gcmVzb2x2ZVJlZnNcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZXJlIGlzIGEgcHJvYmxlbSBtYWtpbmcgdGhlIHJlcXVlc3Qgb3IgdGhlIGNvbnRlbnQgaXMgbm90IEpTT05cbiAqXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gVGhlIHByb21pc2VcbiAqL1xuZnVuY3Rpb24gZ2V0UmVtb3RlSnNvbiAodXJsLCBvcHRpb25zKSB7XG4gIHZhciBqc29uID0gcmVtb3RlQ2FjaGVbdXJsXTtcbiAgdmFyIGFsbFRhc2tzID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHZhciBzY2hlbWUgPSB1cmwuaW5kZXhPZignOicpID09PSAtMSA/IHVuZGVmaW5lZCA6IHVybC5zcGxpdCgnOicpWzBdO1xuXG4gIGlmICghXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4ganNvbjtcbiAgICB9KTtcbiAgfSBlbHNlIGlmIChzdXBwb3J0ZWRTY2hlbWVzLmluZGV4T2Yoc2NoZW1lKSA9PT0gLTEgJiYgIV8uaXNVbmRlZmluZWQoc2NoZW1lKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IEVycm9yKCdVbnN1cHBvcnRlZCByZW1vdGUgcmVmZXJlbmNlIHNjaGVtZTogJyArIHNjaGVtZSkpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGFsbFRhc2tzID0gcGF0aExvYWRlci5sb2FkKHVybCwgb3B0aW9ucyk7XG5cbiAgICBpZiAob3B0aW9ucy5wcm9jZXNzQ29udGVudCkge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uIChjb250ZW50KSB7XG4gICAgICAgIHJldHVybiBvcHRpb25zLnByb2Nlc3NDb250ZW50KGNvbnRlbnQsIHVybCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKEpTT04ucGFyc2UpO1xuICAgIH1cblxuICAgIGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKG5Kc29uKSB7XG4gICAgICByZW1vdGVDYWNoZVt1cmxdID0gbkpzb247XG5cbiAgICAgIHJldHVybiBuSnNvbjtcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyogRXhwb3J0ZWQgRnVuY3Rpb25zICovXG5cbi8qKlxuICogQ2xlYXJzIHRoZSBpbnRlcm5hbCBjYWNoZSBvZiB1cmwgLT4gSmF2YVNjcmlwdCBvYmplY3QgbWFwcGluZ3MgYmFzZWQgb24gcHJldmlvdXNseSByZXNvbHZlZCByZWZlcmVuY2VzLlxuICovXG5tb2R1bGUuZXhwb3J0cy5jbGVhckNhY2hlID0gZnVuY3Rpb24gY2xlYXJDYWNoZSAoKSB7XG4gIHJlbW90ZUNhY2hlID0ge307XG59O1xuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIG9iamVjdCByZXByZXNlbnRzIGEgSlNPTiBSZWZlcmVuY2UuXG4gKlxuICogQHBhcmFtIHtvYmplY3R8c3RyaW5nfSBbb2JqXSAtIFRoZSBvYmplY3QgdG8gY2hlY2tcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdHJ1ZSBpZiB0aGUgYXJndW1lbnQgaXMgYW4gb2JqZWN0IGFuZCBpdHMgJHJlZiBwcm9wZXJ0eSBpcyBhIHN0cmluZyBhbmQgZmFsc2Ugb3RoZXJ3aXNlXG4gKi9cbnZhciBpc0pzb25SZWZlcmVuY2UgPSBtb2R1bGUuZXhwb3J0cy5pc0pzb25SZWZlcmVuY2UgPSBmdW5jdGlvbiBpc0pzb25SZWZlcmVuY2UgKG9iaikge1xuICAvLyBUT0RPOiBBZGQgY2hlY2sgdGhhdCB0aGUgdmFsdWUgaXMgYSB2YWxpZCBKU09OIFBvaW50ZXJcbiAgcmV0dXJuIF8uaXNQbGFpbk9iamVjdChvYmopICYmIF8uaXNTdHJpbmcob2JqLiRyZWYpO1xufTtcblxuLyoqXG4gKiBUYWtlcyBhbiBhcnJheSBvZiBwYXRoIHNlZ21lbnRzIGFuZCBjcmVhdGVzIGEgSlNPTiBQb2ludGVyIGZyb20gaXQuXG4gKlxuICogQHNlZSB7QGxpbmsgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNjkwMX1cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gVGhlIHBhdGggc2VnbWVudHNcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBBIEpTT04gUG9pbnRlciBiYXNlZCBvbiB0aGUgcGF0aCBzZWdtZW50c1xuICpcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdGhlIGFyZ3VtZW50cyBhcmUgbWlzc2luZyBvciBpbnZhbGlkXG4gKi9cbnZhciBwYXRoVG9Qb2ludGVyID0gbW9kdWxlLmV4cG9ydHMucGF0aFRvUG9pbnRlciA9IGZ1bmN0aW9uIHBhdGhUb1BvaW50ZXIgKHBhdGgpIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQocGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3BhdGggaXMgcmVxdWlyZWQnKTtcbiAgfSBlbHNlIGlmICghXy5pc0FycmF5KHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwYXRoIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgfVxuXG4gIHZhciBwdHIgPSAnIyc7XG5cbiAgaWYgKHBhdGgubGVuZ3RoID4gMCkge1xuICAgIHB0ciArPSAnLycgKyBwYXRoLm1hcChmdW5jdGlvbiAocGFydCkge1xuICAgICAgcmV0dXJuIHBhcnQucmVwbGFjZSgvfi9nLCAnfjAnKS5yZXBsYWNlKC9cXC8vZywgJ34xJyk7XG4gICAgfSkuam9pbignLycpO1xuICB9XG5cbiAgcmV0dXJuIHB0cjtcbn07XG5cbi8qKlxuICogRmluZCBhbGwgSlNPTiBSZWZlcmVuY2VzIGluIHRoZSBkb2N1bWVudC5cbiAqXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1wYnJ5YW4tenlwLWpzb24tcmVmLTAzI3NlY3Rpb24tM31cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0ganNvbiAtIFRoZSBKU09OIGRvY3VtZW50IHRvIGZpbmQgcmVmZXJlbmNlcyBpblxuICpcbiAqIEByZXR1cm5zIHtvYmplY3R9IEFuIG9iamVjdCB3aG9zZSBrZXlzIGFyZSBKU09OIFBvaW50ZXJzIHRvIHRoZSAnJHJlZicgbm9kZSBvZiB0aGUgSlNPTiBSZWZlcmVuY2VcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICovXG52YXIgZmluZFJlZnMgPSBtb2R1bGUuZXhwb3J0cy5maW5kUmVmcyA9IGZ1bmN0aW9uIGZpbmRSZWZzIChqc29uKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKGpzb24pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIGlzIHJlcXVpcmVkJyk7XG4gIH0gZWxzZSBpZiAoIV8uaXNQbGFpbk9iamVjdChqc29uKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignanNvbiBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICB9XG5cbiAgcmV0dXJuIHRyYXZlcnNlKGpzb24pLnJlZHVjZShmdW5jdGlvbiAoYWNjKSB7XG4gICAgdmFyIHZhbCA9IHRoaXMubm9kZTtcblxuICAgIGlmICh0aGlzLmtleSA9PT0gJyRyZWYnICYmIGlzSnNvblJlZmVyZW5jZSh0aGlzLnBhcmVudC5ub2RlKSkge1xuICAgICAgYWNjW3BhdGhUb1BvaW50ZXIodGhpcy5wYXRoKV0gPSB2YWw7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjYztcbiAgfSwge30pO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSBKU09OIFBvaW50ZXIgaXMgYSByZW1vdGUgcmVmZXJlbmNlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgdGhlIEpTT04gUG9pbnRlciBpcyByZW1vdGUgb3IgZmFsc2UgaWYgbm90XG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIGlzUmVtb3RlUG9pbnRlciA9IG1vZHVsZS5leHBvcnRzLmlzUmVtb3RlUG9pbnRlciA9IGZ1bmN0aW9uIGlzUmVtb3RlUG9pbnRlciAocHRyKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzU3RyaW5nKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gIH1cblxuICAvLyBXZSB0cmVhdCBhbnl0aGluZyBvdGhlciB0aGFuIGxvY2FsLCB2YWxpZCBKU09OIFBvaW50ZXIgdmFsdWVzIGFzIHJlbW90ZVxuICByZXR1cm4gcHRyICE9PSAnJyAmJiBwdHIuY2hhckF0KDApICE9PSAnIyc7XG59O1xuXG4vKipcbiAqIFRha2VzIGEgSlNPTiBSZWZlcmVuY2UgYW5kIHJldHVybnMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50cy5cbiAqXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2OTAxfVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwdHIgLSBUaGUgSlNPTiBQb2ludGVyIGZvciB0aGUgSlNPTiBSZWZlcmVuY2VcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IEFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMgb3IgdGhlIHBhc3NlZCBpbiBzdHJpbmcgaWYgaXQgaXMgYSByZW1vdGUgcmVmZXJlbmNlXG4gKlxuICogQHRocm93cyBFcnJvciBpZiB0aGUgYXJndW1lbnRzIGFyZSBtaXNzaW5nIG9yIGludmFsaWRcbiAqL1xudmFyIHBhdGhGcm9tUG9pbnRlciA9IG1vZHVsZS5leHBvcnRzLnBhdGhGcm9tUG9pbnRlciA9IGZ1bmN0aW9uIHBhdGhGcm9tUG9pbnRlciAocHRyKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBpcyByZXF1aXJlZCcpO1xuICB9IGVsc2UgaWYgKCFfLmlzU3RyaW5nKHB0cikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B0ciBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gIH1cblxuICB2YXIgcGF0aCA9IFtdO1xuICB2YXIgcm9vdFBhdGhzID0gWycnLCAnIycsICcjLyddO1xuXG4gIGlmIChpc1JlbW90ZVBvaW50ZXIocHRyKSkge1xuICAgIHBhdGggPSBwdHI7XG4gIH0gZWxzZSB7XG4gICAgaWYgKHJvb3RQYXRocy5pbmRleE9mKHB0cikgPT09IC0xICYmIHB0ci5jaGFyQXQoMCkgPT09ICcjJykge1xuICAgICAgcGF0aCA9IHB0ci5zdWJzdHJpbmcocHRyLmluZGV4T2YoJy8nKSkuc3BsaXQoJy8nKS5yZWR1Y2UoZnVuY3Rpb24gKHBhcnRzLCBwYXJ0KSB7XG4gICAgICAgIGlmIChwYXJ0ICE9PSAnJykge1xuICAgICAgICAgIHBhcnRzLnB1c2gocGFydC5yZXBsYWNlKC9+MC9nLCAnficpLnJlcGxhY2UoL34xL2csICcvJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHBhcnRzO1xuICAgICAgfSwgW10pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXRoO1xufTtcblxuZnVuY3Rpb24gY29tYmluZVJlZnMgKGJhc2UsIHJlZikge1xuICB2YXIgYmFzZVBhdGggPSBwYXRoRnJvbVBvaW50ZXIoYmFzZSk7XG5cbiAgaWYgKGlzUmVtb3RlUG9pbnRlcihyZWYpKSB7XG4gICAgaWYgKHJlZi5pbmRleE9mKCcjJykgPT09IC0xKSB7XG4gICAgICByZWYgPSAnIyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlZiA9IHJlZi5zdWJzdHJpbmcocmVmLmluZGV4T2YoJyMnKSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHBhdGhUb1BvaW50ZXIoYmFzZVBhdGguY29uY2F0KHBhdGhGcm9tUG9pbnRlcihyZWYpKSkucmVwbGFjZSgvXFwvXFwkcmVmL2csICcnKTtcbn1cblxuZnVuY3Rpb24gY29tcHV0ZVVybCAoYmFzZSwgcmVmKSB7XG4gIHZhciBpc1JlbGF0aXZlID0gcmVmLmNoYXJBdCgwKSAhPT0gJyMnICYmIHJlZi5pbmRleE9mKCc6JykgPT09IC0xO1xuICB2YXIgbmV3TG9jYXRpb24gPSBbXTtcbiAgdmFyIHJlZlNlZ21lbnRzID0gKHJlZi5pbmRleE9mKCcjJykgPiAtMSA/IHJlZi5zcGxpdCgnIycpWzBdIDogcmVmKS5zcGxpdCgnLycpO1xuXG4gIGZ1bmN0aW9uIHNlZ21lbnRIYW5kbGVyIChzZWdtZW50KSB7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcuLicpIHtcbiAgICAgIG5ld0xvY2F0aW9uLnBvcCgpO1xuICAgIH0gZWxzZSBpZiAoc2VnbWVudCAhPT0gJy4nKSB7XG4gICAgICBuZXdMb2NhdGlvbi5wdXNoKHNlZ21lbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaFxuICBpZiAoYmFzZSAmJiBiYXNlLmxlbmd0aCA+IDEgJiYgYmFzZVtiYXNlLmxlbmd0aCAtIDFdID09PSAnLycpIHtcbiAgICBiYXNlID0gYmFzZS5zdWJzdHJpbmcoMCwgYmFzZS5sZW5ndGggLSAxKTtcbiAgfVxuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgYmFzZSAod2hlbiBhdmFpbGFibGUpXG4gIGlmIChiYXNlKSB7XG4gICAgYmFzZS5zcGxpdCgnIycpWzBdLnNwbGl0KCcvJykuZm9yRWFjaChzZWdtZW50SGFuZGxlcik7XG4gIH1cblxuICBpZiAoaXNSZWxhdGl2ZSkge1xuICAgIC8vIEFkZCByZWZlcmVuY2Ugc2VnbWVudHNcbiAgICByZWZTZWdtZW50cy5mb3JFYWNoKHNlZ21lbnRIYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBuZXdMb2NhdGlvbiA9IHJlZlNlZ21lbnRzO1xuICB9XG5cbiAgcmV0dXJuIG5ld0xvY2F0aW9uLmpvaW4oJy8nKTtcbn1cblxuZnVuY3Rpb24gcmVhbFJlc29sdmVSZWZzIChqc29uLCBvcHRpb25zLCBtZXRhZGF0YSkge1xuICB2YXIgZGVwdGggPSBfLmlzVW5kZWZpbmVkKG9wdGlvbnMuZGVwdGgpID8gMSA6IG9wdGlvbnMuZGVwdGg7XG4gIHZhciBqc29uVCA9IHRyYXZlcnNlKGpzb24pO1xuXG4gIGZ1bmN0aW9uIGZpbmRQYXJlbnRSZWZlcmVuY2UgKHBhdGgpIHtcbiAgICB2YXIgcFBhdGggPSBwYXRoLnNsaWNlKDAsIHBhdGgubGFzdEluZGV4T2YoJ2FsbE9mJykpO1xuICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3BhdGhUb1BvaW50ZXIocFBhdGgpXTtcblxuICAgIGlmICghXy5pc1VuZGVmaW5lZChyZWZNZXRhZGF0YSkpIHtcbiAgICAgIHJldHVybiBwYXRoVG9Qb2ludGVyKHBQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHBQYXRoLmluZGV4T2YoJ2FsbE9mJykgPiAtMSkge1xuICAgICAgICByZXR1cm4gZmluZFBhcmVudFJlZmVyZW5jZShwUGF0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZpeENpcmN1bGFycyAockpzb25UKSB7XG4gICAgdmFyIGNpcmN1bGFyUHRycyA9IFtdO1xuICAgIHZhciBzY3J1YmJlZCA9IHJKc29uVC5tYXAoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIHB0ciA9IHBhdGhUb1BvaW50ZXIodGhpcy5wYXRoKTtcbiAgICAgIHZhciByZWZNZXRhZGF0YSA9IG1ldGFkYXRhW3B0cl07XG4gICAgICB2YXIgcFB0cjtcblxuICAgICAgaWYgKHRoaXMuY2lyY3VsYXIpIHtcbiAgICAgICAgY2lyY3VsYXJQdHJzLnB1c2gocHRyKTtcblxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChyZWZNZXRhZGF0YSkpIHtcbiAgICAgICAgICAvLyBUaGlzIG11c3QgYmUgY2lyY3VsYXIgY29tcG9zaXRpb24vaW5oZXJpdGFuY2VcbiAgICAgICAgICBwUHRyID0gZmluZFBhcmVudFJlZmVyZW5jZSh0aGlzLnBhdGgpO1xuICAgICAgICAgIHJlZk1ldGFkYXRhID0gbWV0YWRhdGFbcFB0cl07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWZlcmVuY2UgbWV0YWRhdGEgY2FuIGJlIHVuZGVmaW5lZCBmb3IgcmVmZXJlbmNlcyB0byBzY2hlbWFzIHRoYXQgaGF2ZSBjaXJjdWxhciBjb21wb3NpdGlvbi9pbmhlcml0YW5jZSBhbmRcbiAgICAgICAgLy8gYXJlIHNhZmVseSBpZ25vcmVhYmxlLlxuICAgICAgICBpZiAoIV8uaXNVbmRlZmluZWQocmVmTWV0YWRhdGEpKSB7XG4gICAgICAgICAgcmVmTWV0YWRhdGEuY2lyY3VsYXIgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGUoe30pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudXBkYXRlKHRyYXZlcnNlKHRoaXMubm9kZSkubWFwKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmNpcmN1bGFyKSB7XG4gICAgICAgICAgICAgIHRoaXMucGFyZW50LnVwZGF0ZSh7fSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBSZXBsYWNlIHNjcnViYmVkIGNpcmN1bGFycyBiYXNlZCBvbiBkZXB0aFxuICAgIF8uZWFjaChjaXJjdWxhclB0cnMsIGZ1bmN0aW9uIChwdHIpIHtcbiAgICAgIHZhciBkZXB0aFBhdGggPSBbXTtcbiAgICAgIHZhciBwYXRoID0gcGF0aEZyb21Qb2ludGVyKHB0cik7XG4gICAgICB2YXIgdmFsdWUgPSB0cmF2ZXJzZShzY3J1YmJlZCkuZ2V0KHBhdGgpO1xuICAgICAgdmFyIGk7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBkZXB0aDsgaSsrKSB7XG4gICAgICAgIGRlcHRoUGF0aC5wdXNoLmFwcGx5KGRlcHRoUGF0aCwgcGF0aCk7XG5cbiAgICAgICAgdHJhdmVyc2Uoc2NydWJiZWQpLnNldChkZXB0aFBhdGgsIF8uY2xvbmVEZWVwKHZhbHVlKSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gc2NydWJiZWQ7XG4gIH1cblxuICBmdW5jdGlvbiByZXBsYWNlUmVmZXJlbmNlIChyZWYsIHJlZlB0cikge1xuICAgIHZhciByZWZNZXRhZGF0YUtleSA9IGNvbWJpbmVSZWZzKHJlZlB0ciwgJyMnKTtcbiAgICB2YXIgbG9jYWxSZWYgPSByZWYgPSByZWYuaW5kZXhPZignIycpID09PSAtMSA/XG4gICAgICAgICAgJyMnIDpcbiAgICAgICAgICByZWYuc3Vic3RyaW5nKHJlZi5pbmRleE9mKCcjJykpO1xuICAgIHZhciBsb2NhbFBhdGggPSBwYXRoRnJvbVBvaW50ZXIobG9jYWxSZWYpO1xuICAgIHZhciBtaXNzaW5nID0gIWpzb25ULmhhcyhsb2NhbFBhdGgpO1xuICAgIHZhciB2YWx1ZSA9IGpzb25ULmdldChsb2NhbFBhdGgpO1xuICAgIHZhciByZWZQdHJQYXRoID0gcGF0aEZyb21Qb2ludGVyKHJlZlB0cik7XG4gICAgdmFyIHBhcmVudFBhdGggPSByZWZQdHJQYXRoLnNsaWNlKDAsIHJlZlB0clBhdGgubGVuZ3RoIC0gMSk7XG4gICAgdmFyIHJlZk1ldGFkYXRhID0gbWV0YWRhdGFbcmVmTWV0YWRhdGFLZXldIHx8IHtcbiAgICAgIHJlZjogcmVmXG4gICAgfTtcblxuICAgIGlmICghbWlzc2luZykge1xuICAgICAgaWYgKHBhcmVudFBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIFNlbGYgcmVmZXJlbmNlcyBhcmUgc3BlY2lhbFxuICAgICAgICBpZiAoanNvblQudmFsdWUgPT09IHZhbHVlKSB7XG4gICAgICAgICAgdmFsdWUgPSB7fTtcblxuICAgICAgICAgIHJlZk1ldGFkYXRhLmNpcmN1bGFyID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpzb25ULnZhbHVlID0gdmFsdWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoanNvblQuZ2V0KHBhcmVudFBhdGgpID09PSB2YWx1ZSkge1xuICAgICAgICAgIHZhbHVlID0ge307XG5cbiAgICAgICAgICByZWZNZXRhZGF0YS5jaXJjdWxhciA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBqc29uVC5zZXQocGFyZW50UGF0aCwgdmFsdWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZWZNZXRhZGF0YS5taXNzaW5nID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBtZXRhZGF0YVtyZWZNZXRhZGF0YUtleV0gPSByZWZNZXRhZGF0YTtcbiAgfVxuXG4gIC8vIEFsbCByZWZlcmVuY2VzIGF0IHRoaXMgcG9pbnQgc2hvdWxkIGJlIGxvY2FsIGV4Y2VwdCBtaXNzaW5nL2ludmFsaWQgcmVmZXJlbmNlc1xuICBfLmVhY2goZmluZFJlZnMoanNvbiksIGZ1bmN0aW9uIChyZWYsIHJlZlB0cikge1xuICAgIGlmICghaXNSZW1vdGVQb2ludGVyKHJlZikpIHtcbiAgICAgIHJlcGxhY2VSZWZlcmVuY2UocmVmLCByZWZQdHIpO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gUmVtb3ZlIGZ1bGwgbG9jYXRpb25zIGZyb20gcmVmZXJlbmNlIG1ldGFkYXRhXG4gIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmxvY2F0aW9uKSkge1xuICAgIF8uZWFjaChtZXRhZGF0YSwgZnVuY3Rpb24gKHJlZk1ldGFkYXRhKSB7XG4gICAgICB2YXIgbm9ybWFsaXplZFB0ciA9IHJlZk1ldGFkYXRhLnJlZjtcblxuICAgICAgLy8gUmVtb3ZlIHRoZSBiYXNlXG4gICAgICBub3JtYWxpemVkUHRyID0gbm9ybWFsaXplZFB0ci5yZXBsYWNlKG9wdGlvbnMubG9jYXRpb24sICcnKTtcblxuICAgICAgLy8gUmVtb3ZlIHRoZSAvIHByZWZpeFxuICAgICAgaWYgKG5vcm1hbGl6ZWRQdHIuY2hhckF0KDApID09PSAnLycpIHtcbiAgICAgICAgbm9ybWFsaXplZFB0ciA9IG5vcm1hbGl6ZWRQdHIuc3Vic3RyaW5nKDEpO1xuICAgICAgfVxuXG4gICAgICByZWZNZXRhZGF0YS5yZWYgPSBub3JtYWxpemVkUHRyO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRml4IGNpcmN1bGFyc1xuICByZXR1cm4ge1xuICAgIG1ldGFkYXRhOiBtZXRhZGF0YSxcbiAgICByZXNvbHZlZDogZml4Q2lyY3VsYXJzKGpzb25UKVxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlUmVtb3RlUmVmcyAoanNvbiwgb3B0aW9ucywgcGFyZW50UHRyLCBwYXJlbnRzLCBtZXRhZGF0YSkge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgdmFyIGpzb25UID0gdHJhdmVyc2UoanNvbik7XG5cbiAgZnVuY3Rpb24gcmVwbGFjZVJlbW90ZVJlZiAocmVmUHRyLCBwdHIsIHJlbW90ZUxvY2F0aW9uLCByZW1vdGVQdHIsIHJlc29sdmVkKSB7XG4gICAgdmFyIG5vcm1hbGl6ZWRQdHIgPSByZW1vdGVMb2NhdGlvbiArIChyZW1vdGVQdHIgPT09ICcjJyA/ICcnIDogcmVtb3RlUHRyKTtcbiAgICB2YXIgcmVmTWV0YWRhdGFLZXkgPSBjb21iaW5lUmVmcyhwYXJlbnRQdHIsIHJlZlB0cik7XG4gICAgdmFyIHJlZk1ldGFkYXRhID0gbWV0YWRhdGFbcmVmTWV0YWRhdGFLZXldIHx8IHt9O1xuICAgIHZhciByZWZQYXRoID0gcGF0aEZyb21Qb2ludGVyKHJlZlB0cik7XG4gICAgdmFyIHZhbHVlO1xuXG4gICAgaWYgKF8uaXNVbmRlZmluZWQocmVzb2x2ZWQpKSB7XG4gICAgICByZWZNZXRhZGF0YS5jaXJjdWxhciA9IHRydWU7XG5cbiAgICAgIC8vIFVzZSB0aGUgcGFyZW50IHJlZmVyZW5jZSBsb29jYXRpb25cbiAgICAgIHZhbHVlID0gcGFyZW50c1tyZW1vdGVMb2NhdGlvbl0ucmVmO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBHZXQgdGhlIHJlbW90ZSB2YWx1ZVxuICAgICAgdmFsdWUgPSB0cmF2ZXJzZShyZXNvbHZlZCkuZ2V0KHBhdGhGcm9tUG9pbnRlcihyZW1vdGVQdHIpKTtcblxuICAgICAgLy8gSWYgdGhlIHJlbW90ZSB2YWx1ZSBpcyBpdHNlbGYgYSByZWZlcmVuY2UsIHVwZGF0ZSB0aGUgcmVmZXJlbmNlIHRvIGJlIHJlcGxhY2VkIHdpdGggaXRzIHJlZmVyZW5jZSB2YWx1ZS5cbiAgICAgIC8vIE90aGVyd2lzZSwgcmVwbGFjZSB0aGUgcmVtb3RlIHJlZmVyZW5jZS5cbiAgICAgIGlmICh2YWx1ZS4kcmVmKSB7XG4gICAgICAgIHZhbHVlID0gdmFsdWUuJHJlZjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlZlBhdGgucG9wKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ29sbGFwc2Ugc2VsZiByZWZlcmVuY2VzXG4gICAgaWYgKHJlZlBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgICBqc29uVC52YWx1ZSA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBqc29uVC5zZXQocmVmUGF0aCwgdmFsdWUpO1xuICAgIH1cblxuICAgIHJlZk1ldGFkYXRhLnJlZiA9IG5vcm1hbGl6ZWRQdHI7XG5cbiAgICBtZXRhZGF0YVtyZWZNZXRhZGF0YUtleV0gPSByZWZNZXRhZGF0YTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlc29sdmVyICgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbWV0YWRhdGE6IG1ldGFkYXRhLFxuICAgICAgcmVzb2x2ZWQ6IGpzb25ULnZhbHVlXG4gICAgfTtcbiAgfVxuXG4gIF8uZWFjaChmaW5kUmVmcyhqc29uKSwgZnVuY3Rpb24gKHB0ciwgcmVmUHRyKSB7XG4gICAgaWYgKGlzUmVtb3RlUG9pbnRlcihwdHIpKSB7XG4gICAgICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcmVtb3RlTG9jYXRpb24gPSBjb21wdXRlVXJsKG9wdGlvbnMubG9jYXRpb24sIHB0cik7XG4gICAgICAgIHZhciByZWZQYXJ0cyA9IHB0ci5zcGxpdCgnIycpO1xuICAgICAgICB2YXIgaGFzaCA9ICcjJyArIChyZWZQYXJ0c1sxXSB8fCAnJyk7XG5cbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQocGFyZW50c1tyZW1vdGVMb2NhdGlvbl0pKSB7XG4gICAgICAgICAgcmV0dXJuIGdldFJlbW90ZUpzb24ocmVtb3RlTG9jYXRpb24sIG9wdGlvbnMpXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocmVtb3RlSnNvbikge1xuICAgICAgICAgICAgICByZXR1cm4gcmVtb3RlSnNvbjtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGVycjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgdmFyIHJlZkJhc2UgPSByZWZQYXJ0c1swXTtcbiAgICAgICAgICAgICAgdmFyIHJPcHRpb25zID0gXy5jbG9uZURlZXAob3B0aW9ucyk7XG4gICAgICAgICAgICAgIHZhciBuZXdQYXJlbnRQdHIgPSBjb21iaW5lUmVmcyhwYXJlbnRQdHIsIHJlZlB0cik7XG5cbiAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBsYXN0IHBhdGggc2VnbWVudFxuICAgICAgICAgICAgICByZWZCYXNlID0gcmVmQmFzZS5zdWJzdHJpbmcoMCwgcmVmQmFzZS5sYXN0SW5kZXhPZignLycpICsgMSk7XG5cbiAgICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSByZWN1cnNpdmUgbG9jYXRpb25cbiAgICAgICAgICAgICAgck9wdGlvbnMubG9jYXRpb24gPSBjb21wdXRlVXJsKG9wdGlvbnMubG9jYXRpb24sIHJlZkJhc2UpO1xuXG4gICAgICAgICAgICAgIC8vIFJlY29yZCB0aGUgcGFyZW50XG4gICAgICAgICAgICAgIHBhcmVudHNbcmVtb3RlTG9jYXRpb25dID0ge1xuICAgICAgICAgICAgICAgIHJlZjogcGFyZW50UHRyXG4gICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgaWYgKF8uaXNFcnJvcihyZXNwb25zZSkpIHtcbiAgICAgICAgICAgICAgICBtZXRhZGF0YVtuZXdQYXJlbnRQdHJdID0ge1xuICAgICAgICAgICAgICAgICAgZXJyOiByZXNwb25zZSxcbiAgICAgICAgICAgICAgICAgIG1pc3Npbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgICByZWY6IHB0clxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZSByZW1vdGUgcmVmZXJlbmNlc1xuICAgICAgICAgICAgICAgIHJldHVybiByZXNvbHZlUmVtb3RlUmVmcyhyZXNwb25zZSwgck9wdGlvbnMsIG5ld1BhcmVudFB0ciwgcGFyZW50cywgbWV0YWRhdGEpXG4gICAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAock1ldGFkYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwYXJlbnRzW3JlbW90ZUxvY2F0aW9uXTtcblxuICAgICAgICAgICAgICAgICAgICByZXBsYWNlUmVtb3RlUmVmKHJlZlB0ciwgcHRyLCByZW1vdGVMb2NhdGlvbiwgaGFzaCwgck1ldGFkYXRhLnJlc29sdmVkKTtcbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBUaGlzIGlzIGEgY2lyY3VsYXIgcmVmZXJlbmNlXG4gICAgICAgICAgcmVwbGFjZVJlbW90ZVJlZihyZWZQdHIsIHB0ciwgcmVtb3RlTG9jYXRpb24sIGhhc2gpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVXBkYXRlIGxvY2FsIHJlZmVyZW5jZXMgdG8gYmUgcmVsYXRpdmUgdG8gdGhlIHJvb3QgZG9jdW1lbnRcbiAgICAgIGpzb25ULnNldChwYXRoRnJvbVBvaW50ZXIocmVmUHRyKSwgY29tYmluZVJlZnMocGFyZW50UHRyLCBwdHIpKTtcbiAgICB9XG4gIH0pO1xuXG4gIGFsbFRhc2tzID0gYWxsVGFza3MudGhlbihyZXNvbHZlciwgcmVzb2x2ZXIpO1xuXG4gIHJldHVybiBhbGxUYXNrcztcbn1cblxuLyoqXG4gKiBUYWtlcyBhIEpTT04gZG9jdW1lbnQsIHJlc29sdmVzIGFsbCBKU09OIFJlZmVyZW5jZXMgYW5kIHJldHVybnMgYSBmdWxseSByZXNvbHZlZCBlcXVpdmFsZW50IGFsb25nIHdpdGggcmVmZXJlbmNlXG4gKiByZXNvbHV0aW9uIG1ldGFkYXRhLlxuICpcbiAqICoqSW1wb3J0YW50IERldGFpbHMqKlxuICpcbiAqICogVGhlIGlucHV0IGFyZ3VtZW50cyBhcmUgbmV2ZXIgYWx0ZXJlZFxuICogKiBXaGVuIHVzaW5nIHByb21pc2VzLCBvbmx5IG9uZSB2YWx1ZSBjYW4gYmUgcmVzb2x2ZWQgc28gaXQgaXMgYW4gb2JqZWN0IHdob3NlIGtleXMgYW5kIHZhbHVlcyBhcmUgdGhlIHNhbWUgbmFtZSBhbmRcbiAqICAgdmFsdWUgYXMgYXJndW1lbnRzIDEgYW5kIDIgZm9yIHtAbGluayByZXN1bHRDYWxsYmFja31cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0ganNvbiAtIFRoZSBKU09OICBkb2N1bWVudCBoYXZpbmcgemVybyBvciBtb3JlIEpTT04gUmVmZXJlbmNlc1xuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFRoZSBvcHRpb25zIChBbGwgb3B0aW9ucyBhcmUgcGFzc2VkIGRvd24gdG8gd2hpdGxvY2tqYy9wYXRoLWxvYWRlcilcbiAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0aW9ucy5kZXB0aD0xXSAtIFRoZSBkZXB0aCB0byByZXNvbHZlIGNpcmN1bGFyIHJlZmVyZW5jZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5sb2NhdGlvbl0gLSBUaGUgbG9jYXRpb24gdG8gd2hpY2ggcmVsYXRpdmUgcmVmZXJlbmNlcyBzaG91bGQgYmUgcmVzb2x2ZWRcbiAqIEBwYXJhbSB7cHJlcGFyZVJlcXVlc3RDYWxsYmFja30gW29wdGlvbnMucHJlcGFyZVJlcXVlc3RdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJlcGFyZSBhbiBIVFRQIHJlcXVlc3RcbiAqIEBwYXJhbSB7cHJvY2Vzc0NvbnRlbnRDYWxsYmFja30gW29wdGlvbnMucHJvY2Vzc0NvbnRlbnRdIC0gVGhlIGNhbGxiYWNrIHVzZWQgdG8gcHJvY2VzcyBhIHJlZmVyZW5jZSdzIGNvbnRlbnRcbiAqIEBwYXJhbSB7cmVzdWx0Q2FsbGJhY2t9IFtkb25lXSAtIFRoZSByZXN1bHQgY2FsbGJhY2tcbiAqXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBhcmd1bWVudHMgYXJlIG1pc3Npbmcgb3IgaW52YWxpZFxuICpcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBUaGUgcHJvbWlzZS5cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBjYWxsYmFja3NcbiAqXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyh7XG4gKiAgIG5hbWU6ICdqc29uLXJlZnMnLFxuICogICBvd25lcjoge1xuICogICAgICRyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcidcbiAqICAgfVxuICogfSwgZnVuY3Rpb24gKGVyciwgcmVzb2x2ZWQsIG1ldGFkYXRhKSB7XG4gKiAgIGlmIChlcnIpIHRocm93IGVycjtcbiAqXG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KG1ldGFkYXRhKSk7IC8vIHsnIy9vd25lcic6IHtyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcid9fVxuICogfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEV4YW1wbGUgdXNpbmcgcHJvbWlzZXNcbiAqXG4gKiBKc29uUmVmcy5yZXNvbHZlUmVmcyh7XG4gKiAgIG5hbWU6ICdqc29uLXJlZnMnLFxuICogICBvd25lcjoge1xuICogICAgICRyZWY6ICdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvanNvbi1yZWZzIy9vd25lcidcbiAqICAgfVxuICogfSkudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLnJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdHMubWV0YWRhdGEpKTsgLy8geycjL293bmVyJzoge3JlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ319XG4gKiB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBvcHRpb25zLnByZXBhcmVSZXF1ZXN0ICh0byBhZGQgYXV0aGVudGljYXRpb24gY3JlZGVudGlhbHMpIGFuZCBvcHRpb25zLnByb2Nlc3NDb250ZW50ICh0byBwcm9jZXNzIFlBTUwpXG4gKlxuICogSnNvblJlZnMucmVzb2x2ZVJlZnMoe1xuICogICBuYW1lOiAnanNvbi1yZWZzJyxcbiAqICAgb3duZXI6IHtcbiAqICAgICAkcmVmOiAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy93aGl0bG9ja2pjL2pzb24tcmVmcyMvb3duZXInXG4gKiAgIH1cbiAqIH0sIHtcbiAqICAgcHJlcGFyZVJlcXVlc3Q6IGZ1bmN0aW9uIChyZXEpIHtcbiAqICAgICAvLyBBZGQgdGhlICdCYXNpYyBBdXRoZW50aWNhdGlvbicgY3JlZGVudGlhbHNcbiAqICAgICByZXEuYXV0aCgnd2hpdGxvY2tqYycsICdNWV9HSVRIVUJfUEFTU1dPUkQnKTtcbiAqXG4gKiAgICAgLy8gQWRkIHRoZSAnWC1BUEktS2V5JyBoZWFkZXIgZm9yIGFuIEFQSSBLZXkgYmFzZWQgYXV0aGVudGljYXRpb25cbiAqICAgICAvLyByZXEuc2V0KCdYLUFQSS1LZXknLCAnTVlfQVBJX0tFWScpO1xuICogICB9LFxuICogICBwcm9jZXNzQ29udGVudDogZnVuY3Rpb24gKGNvbnRlbnQpIHtcbiAqICAgICByZXR1cm4gWUFNTC5wYXJzZShjb250ZW50KTtcbiAqICAgfVxuICogfSkudGhlbihmdW5jdGlvbiAocmVzdWx0cykge1xuICogICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHRzLnJlc29sdmVkKSk7IC8vIHtuYW1lOiAnanNvbi1yZWZzJywgb3duZXI6IHsgLi4uIH19XG4gKiAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdHMubWV0YWRhdGEpKTsgLy8geycjL293bmVyJzoge3JlZjogJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3Mvd2hpdGxvY2tqYy9qc29uLXJlZnMjL293bmVyJ319XG4gKiB9KTtcbiAqL1xubW9kdWxlLmV4cG9ydHMucmVzb2x2ZVJlZnMgPSBmdW5jdGlvbiByZXNvbHZlUmVmcyAoanNvbiwgb3B0aW9ucywgZG9uZSkge1xuICB2YXIgYWxsVGFza3MgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMikge1xuICAgIGlmIChfLmlzRnVuY3Rpb24ob3B0aW9ucykpIHtcbiAgICAgIGRvbmUgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIGlmIChfLmlzVW5kZWZpbmVkKG9wdGlvbnMpKSB7XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9XG5cbiAgYWxsVGFza3MgPSBhbGxUYXNrcy50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChqc29uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdqc29uIGlzIHJlcXVpcmVkJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1BsYWluT2JqZWN0KGpzb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2pzb24gbXVzdCBiZSBhbiBvYmplY3QnKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzUGxhaW5PYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucyBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQoZG9uZSkgJiYgIV8uaXNGdW5jdGlvbihkb25lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdkb25lIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHRoZSBvcHRpb25zIChUaGlzIG9wdGlvbiBkb2VzIG5vdCBhcHBseSB0byApXG4gICAgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucHJvY2Vzc0NvbnRlbnQpICYmICFfLmlzRnVuY3Rpb24ob3B0aW9ucy5wcm9jZXNzQ29udGVudCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5wcm9jZXNzQ29udGVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMucHJlcGFyZVJlcXVlc3QpICYmICFfLmlzRnVuY3Rpb24ob3B0aW9ucy5wcmVwYXJlUmVxdWVzdCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5wcmVwYXJlUmVxdWVzdCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICB9IGVsc2UgaWYgKCFfLmlzVW5kZWZpbmVkKG9wdGlvbnMubG9jYXRpb24pICYmICFfLmlzU3RyaW5nKG9wdGlvbnMubG9jYXRpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ29wdGlvbnMubG9jYXRpb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH0gZWxzZSBpZiAoIV8uaXNVbmRlZmluZWQob3B0aW9ucy5kZXB0aCkgJiYgIV8uaXNOdW1iZXIob3B0aW9ucy5kZXB0aCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb3B0aW9ucy5kZXB0aCBtdXN0IGJlIGEgbnVtYmVyJyk7XG4gICAgfSBlbHNlIGlmICghXy5pc1VuZGVmaW5lZChvcHRpb25zLmRlcHRoKSAmJiBvcHRpb25zLmRlcHRoIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcHRpb25zLmRlcHRoIG11c3QgYmUgZ3JlYXRlciBvciBlcXVhbCB0byB6ZXJvJyk7XG4gICAgfVxuICB9KTtcblxuICAvLyBDbG9uZSB0aGUgaW5wdXRzIHNvIHdlIGRvIG5vdCBhbHRlciB0aGVtXG4gIGpzb24gPSB0cmF2ZXJzZShqc29uKS5jbG9uZSgpO1xuICBvcHRpb25zID0gdHJhdmVyc2Uob3B0aW9ucykuY2xvbmUoKTtcblxuICBhbGxUYXNrcyA9IGFsbFRhc2tzXG4gICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHJlc29sdmVSZW1vdGVSZWZzKGpzb24sIG9wdGlvbnMsICcjJywge30sIHt9KTtcbiAgICB9KVxuICAgIC50aGVuKGZ1bmN0aW9uIChtZXRhZGF0YSkge1xuICAgICAgcmV0dXJuIHJlYWxSZXNvbHZlUmVmcyhtZXRhZGF0YS5yZXNvbHZlZCwgb3B0aW9ucywgbWV0YWRhdGEubWV0YWRhdGEpO1xuICAgIH0pO1xuXG4gIC8vIFVzZSB0aGUgY2FsbGJhY2sgaWYgcHJvdmlkZWQgYW5kIGl0IGlzIGEgZnVuY3Rpb25cbiAgaWYgKCFfLmlzVW5kZWZpbmVkKGRvbmUpICYmIF8uaXNGdW5jdGlvbihkb25lKSkge1xuICAgIGFsbFRhc2tzID0gYWxsVGFza3NcbiAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXN1bHRzKSB7XG4gICAgICAgIGRvbmUodW5kZWZpbmVkLCByZXN1bHRzLnJlc29sdmVkLCByZXN1bHRzLm1ldGFkYXRhKTtcbiAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgZG9uZShlcnIpO1xuICAgICAgfSk7XG4gIH1cblxuICByZXR1cm4gYWxsVGFza3M7XG59O1xuIiwiLypcbiAqIFRoZSBNSVQgTGljZW5zZSAoTUlUKVxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNCBKZXJlbXkgV2hpdGxvY2tcbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4gKiBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4gKiBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4gKiB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4gKiBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbiAqIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4gKlxuICogVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbiAqIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuICpcbiAqIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbiAqIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuICogRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4gKiBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4gKiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuICogT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuICogVEhFIFNPRlRXQVJFLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuLy8gVGhpcyBpcyBhIHNpbXBsZSB3cmFwcGVyIGZvciBMb2Rhc2ggZnVuY3Rpb25zIGJ1dCB1c2luZyBzaW1wbGUgRVM1IGFuZCBleGlzdGluZyByZXF1aXJlZCBkZXBlbmRlbmNpZXNcbi8vIChjbG9uZURlZXAgdXNlcyB0cmF2ZXJzZSBmb3IgZXhhbXBsZSkuICBUaGUgcmVhc29uIGZvciB0aGlzIHdhcyBhIG11Y2ggc21hbGxlciBmaWxlIHNpemUuICBBbGwgZXhwb3J0ZWQgZnVuY3Rpb25zXG4vLyBtYXRjaCBtYXAgdG8gYSBsb2Rhc2ggZXF1aXZhbGVudC5cblxudmFyIHRyYXZlcnNlID0gcmVxdWlyZSgndHJhdmVyc2UnKTtcblxuZnVuY3Rpb24gaXNUeXBlIChvYmosIHR5cGUpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCAnICsgdHlwZSArICddJztcbn1cblxubW9kdWxlLmV4cG9ydHMuY2xvbmVEZWVwID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gdHJhdmVyc2Uob2JqKS5jbG9uZSgpO1xufTtcblxudmFyIGlzQXJyYXkgPSBtb2R1bGUuZXhwb3J0cy5pc0FycmF5ID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0FycmF5Jyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc0Vycm9yID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0Vycm9yJyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc0Z1bmN0aW9uID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ0Z1bmN0aW9uJyk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc051bWJlciA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdOdW1iZXInKTtcbn07XG5cbnZhciBpc1BsYWluT2JqZWN0ID0gbW9kdWxlLmV4cG9ydHMuaXNQbGFpbk9iamVjdCA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGlzVHlwZShvYmosICdPYmplY3QnKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzU3RyaW5nID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gaXNUeXBlKG9iaiwgJ1N0cmluZycpO1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNVbmRlZmluZWQgPSBmdW5jdGlvbiAob2JqKSB7XG4gIC8vIENvbW1lbnRlZCBvdXQgZHVlIHRvIFBoYW50b21KUyBidWcgKGh0dHBzOi8vZ2l0aHViLmNvbS9hcml5YS9waGFudG9tanMvaXNzdWVzLzExNzIyKVxuICAvLyByZXR1cm4gaXNUeXBlKG9iaiwgJ1VuZGVmaW5lZCcpO1xuICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCc7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5lYWNoID0gZnVuY3Rpb24gKHNvdXJjZSwgaGFuZGxlcikge1xuICBpZiAoaXNBcnJheShzb3VyY2UpKSB7XG4gICAgc291cmNlLmZvckVhY2goaGFuZGxlcik7XG4gIH0gZWxzZSBpZiAoaXNQbGFpbk9iamVjdChzb3VyY2UpKSB7XG4gICAgT2JqZWN0LmtleXMoc291cmNlKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGhhbmRsZXIoc291cmNlW2tleV0sIGtleSk7XG4gICAgfSk7XG4gIH1cbn07XG4iLCIvKiEgTmF0aXZlIFByb21pc2UgT25seVxuICAgIHYwLjguMC1hIChjKSBLeWxlIFNpbXBzb25cbiAgICBNSVQgTGljZW5zZTogaHR0cDovL2dldGlmeS5taXQtbGljZW5zZS5vcmdcbiovXG4hZnVuY3Rpb24odCxuLGUpe25bdF09blt0XXx8ZSgpLFwidW5kZWZpbmVkXCIhPXR5cGVvZiBtb2R1bGUmJm1vZHVsZS5leHBvcnRzP21vZHVsZS5leHBvcnRzPW5bdF06XCJmdW5jdGlvblwiPT10eXBlb2YgZGVmaW5lJiZkZWZpbmUuYW1kJiZkZWZpbmUoZnVuY3Rpb24oKXtyZXR1cm4gblt0XX0pfShcIlByb21pc2VcIixcInVuZGVmaW5lZFwiIT10eXBlb2YgZ2xvYmFsP2dsb2JhbDp0aGlzLGZ1bmN0aW9uKCl7XCJ1c2Ugc3RyaWN0XCI7ZnVuY3Rpb24gdCh0LG4pe2wuYWRkKHQsbiksaHx8KGg9eShsLmRyYWluKSl9ZnVuY3Rpb24gbih0KXt2YXIgbixlPXR5cGVvZiB0O3JldHVybiBudWxsPT10fHxcIm9iamVjdFwiIT1lJiZcImZ1bmN0aW9uXCIhPWV8fChuPXQudGhlbiksXCJmdW5jdGlvblwiPT10eXBlb2Ygbj9uOiExfWZ1bmN0aW9uIGUoKXtmb3IodmFyIHQ9MDt0PHRoaXMuY2hhaW4ubGVuZ3RoO3QrKylvKHRoaXMsMT09PXRoaXMuc3RhdGU/dGhpcy5jaGFpblt0XS5zdWNjZXNzOnRoaXMuY2hhaW5bdF0uZmFpbHVyZSx0aGlzLmNoYWluW3RdKTt0aGlzLmNoYWluLmxlbmd0aD0wfWZ1bmN0aW9uIG8odCxlLG8pe3ZhciByLGk7dHJ5e2U9PT0hMT9vLnJlamVjdCh0Lm1zZyk6KHI9ZT09PSEwP3QubXNnOmUuY2FsbCh2b2lkIDAsdC5tc2cpLHI9PT1vLnByb21pc2U/by5yZWplY3QoVHlwZUVycm9yKFwiUHJvbWlzZS1jaGFpbiBjeWNsZVwiKSk6KGk9bihyKSk/aS5jYWxsKHIsby5yZXNvbHZlLG8ucmVqZWN0KTpvLnJlc29sdmUocikpfWNhdGNoKGMpe28ucmVqZWN0KGMpfX1mdW5jdGlvbiByKG8pe3ZhciBjLHU9dGhpcztpZighdS50cmlnZ2VyZWQpe3UudHJpZ2dlcmVkPSEwLHUuZGVmJiYodT11LmRlZik7dHJ5eyhjPW4obykpP3QoZnVuY3Rpb24oKXt2YXIgdD1uZXcgZih1KTt0cnl7Yy5jYWxsKG8sZnVuY3Rpb24oKXtyLmFwcGx5KHQsYXJndW1lbnRzKX0sZnVuY3Rpb24oKXtpLmFwcGx5KHQsYXJndW1lbnRzKX0pfWNhdGNoKG4pe2kuY2FsbCh0LG4pfX0pOih1Lm1zZz1vLHUuc3RhdGU9MSx1LmNoYWluLmxlbmd0aD4wJiZ0KGUsdSkpfWNhdGNoKGEpe2kuY2FsbChuZXcgZih1KSxhKX19fWZ1bmN0aW9uIGkobil7dmFyIG89dGhpcztvLnRyaWdnZXJlZHx8KG8udHJpZ2dlcmVkPSEwLG8uZGVmJiYobz1vLmRlZiksby5tc2c9bixvLnN0YXRlPTIsby5jaGFpbi5sZW5ndGg+MCYmdChlLG8pKX1mdW5jdGlvbiBjKHQsbixlLG8pe2Zvcih2YXIgcj0wO3I8bi5sZW5ndGg7cisrKSFmdW5jdGlvbihyKXt0LnJlc29sdmUobltyXSkudGhlbihmdW5jdGlvbih0KXtlKHIsdCl9LG8pfShyKX1mdW5jdGlvbiBmKHQpe3RoaXMuZGVmPXQsdGhpcy50cmlnZ2VyZWQ9ITF9ZnVuY3Rpb24gdSh0KXt0aGlzLnByb21pc2U9dCx0aGlzLnN0YXRlPTAsdGhpcy50cmlnZ2VyZWQ9ITEsdGhpcy5jaGFpbj1bXSx0aGlzLm1zZz12b2lkIDB9ZnVuY3Rpb24gYShuKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBuKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2lmKDAhPT10aGlzLl9fTlBPX18pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgcHJvbWlzZVwiKTt0aGlzLl9fTlBPX189MTt2YXIgbz1uZXcgdSh0aGlzKTt0aGlzLnRoZW49ZnVuY3Rpb24obixyKXt2YXIgaT17c3VjY2VzczpcImZ1bmN0aW9uXCI9PXR5cGVvZiBuP246ITAsZmFpbHVyZTpcImZ1bmN0aW9uXCI9PXR5cGVvZiByP3I6ITF9O3JldHVybiBpLnByb21pc2U9bmV3IHRoaXMuY29uc3RydWN0b3IoZnVuY3Rpb24odCxuKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiB0fHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBuKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2kucmVzb2x2ZT10LGkucmVqZWN0PW59KSxvLmNoYWluLnB1c2goaSksMCE9PW8uc3RhdGUmJnQoZSxvKSxpLnByb21pc2V9LHRoaXNbXCJjYXRjaFwiXT1mdW5jdGlvbih0KXtyZXR1cm4gdGhpcy50aGVuKHZvaWQgMCx0KX07dHJ5e24uY2FsbCh2b2lkIDAsZnVuY3Rpb24odCl7ci5jYWxsKG8sdCl9LGZ1bmN0aW9uKHQpe2kuY2FsbChvLHQpfSl9Y2F0Y2goYyl7aS5jYWxsKG8sYyl9fXZhciBzLGgsbCxwPU9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcseT1cInVuZGVmaW5lZFwiIT10eXBlb2Ygc2V0SW1tZWRpYXRlP2Z1bmN0aW9uKHQpe3JldHVybiBzZXRJbW1lZGlhdGUodCl9OnNldFRpbWVvdXQ7dHJ5e09iamVjdC5kZWZpbmVQcm9wZXJ0eSh7fSxcInhcIix7fSkscz1mdW5jdGlvbih0LG4sZSxvKXtyZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KHQsbix7dmFsdWU6ZSx3cml0YWJsZTohMCxjb25maWd1cmFibGU6byE9PSExfSl9fWNhdGNoKGQpe3M9ZnVuY3Rpb24odCxuLGUpe3JldHVybiB0W25dPWUsdH19bD1mdW5jdGlvbigpe2Z1bmN0aW9uIHQodCxuKXt0aGlzLmZuPXQsdGhpcy5zZWxmPW4sdGhpcy5uZXh0PXZvaWQgMH12YXIgbixlLG87cmV0dXJue2FkZDpmdW5jdGlvbihyLGkpe289bmV3IHQocixpKSxlP2UubmV4dD1vOm49byxlPW8sbz12b2lkIDB9LGRyYWluOmZ1bmN0aW9uKCl7dmFyIHQ9bjtmb3Iobj1lPWg9dm9pZCAwO3Q7KXQuZm4uY2FsbCh0LnNlbGYpLHQ9dC5uZXh0fX19KCk7dmFyIGc9cyh7fSxcImNvbnN0cnVjdG9yXCIsYSwhMSk7cmV0dXJuIGEucHJvdG90eXBlPWcscyhnLFwiX19OUE9fX1wiLDAsITEpLHMoYSxcInJlc29sdmVcIixmdW5jdGlvbih0KXt2YXIgbj10aGlzO3JldHVybiB0JiZcIm9iamVjdFwiPT10eXBlb2YgdCYmMT09PXQuX19OUE9fXz90Om5ldyBuKGZ1bmN0aW9uKG4sZSl7aWYoXCJmdW5jdGlvblwiIT10eXBlb2Ygbnx8XCJmdW5jdGlvblwiIT10eXBlb2YgZSl0aHJvdyBUeXBlRXJyb3IoXCJOb3QgYSBmdW5jdGlvblwiKTtuKHQpfSl9KSxzKGEsXCJyZWplY3RcIixmdW5jdGlvbih0KXtyZXR1cm4gbmV3IHRoaXMoZnVuY3Rpb24obixlKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBufHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBlKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2UodCl9KX0pLHMoYSxcImFsbFwiLGZ1bmN0aW9uKHQpe3ZhciBuPXRoaXM7cmV0dXJuXCJbb2JqZWN0IEFycmF5XVwiIT1wLmNhbGwodCk/bi5yZWplY3QoVHlwZUVycm9yKFwiTm90IGFuIGFycmF5XCIpKTowPT09dC5sZW5ndGg/bi5yZXNvbHZlKFtdKTpuZXcgbihmdW5jdGlvbihlLG8pe2lmKFwiZnVuY3Rpb25cIiE9dHlwZW9mIGV8fFwiZnVuY3Rpb25cIiE9dHlwZW9mIG8pdGhyb3cgVHlwZUVycm9yKFwiTm90IGEgZnVuY3Rpb25cIik7dmFyIHI9dC5sZW5ndGgsaT1BcnJheShyKSxmPTA7YyhuLHQsZnVuY3Rpb24odCxuKXtpW3RdPW4sKytmPT09ciYmZShpKX0sbyl9KX0pLHMoYSxcInJhY2VcIixmdW5jdGlvbih0KXt2YXIgbj10aGlzO3JldHVyblwiW29iamVjdCBBcnJheV1cIiE9cC5jYWxsKHQpP24ucmVqZWN0KFR5cGVFcnJvcihcIk5vdCBhbiBhcnJheVwiKSk6bmV3IG4oZnVuY3Rpb24oZSxvKXtpZihcImZ1bmN0aW9uXCIhPXR5cGVvZiBlfHxcImZ1bmN0aW9uXCIhPXR5cGVvZiBvKXRocm93IFR5cGVFcnJvcihcIk5vdCBhIGZ1bmN0aW9uXCIpO2Mobix0LGZ1bmN0aW9uKHQsbil7ZShuKX0sbyl9KX0pLGF9KTtcbiIsIi8qXG4gKiBUaGUgTUlUIExpY2Vuc2UgKE1JVClcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTUgSmVyZW15IFdoaXRsb2NrXG4gKlxuICogUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuICogb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuICogaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuICogdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuICogY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4gKiBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4gKiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4gKiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuICogQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuICogTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbiAqIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbiAqIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBzdXBwb3J0ZWRMb2FkZXJzID0ge1xuICBmaWxlOiByZXF1aXJlKCcuL2xpYi9sb2FkZXJzL2ZpbGUnKSxcbiAgaHR0cDogcmVxdWlyZSgnLi9saWIvbG9hZGVycy9odHRwJyksXG4gIGh0dHBzOiByZXF1aXJlKCcuL2xpYi9sb2FkZXJzL2h0dHAnKVxufTtcbnZhciBkZWZhdWx0TG9hZGVyID0gdHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcgPyBzdXBwb3J0ZWRMb2FkZXJzLmZpbGUgOiBzdXBwb3J0ZWRMb2FkZXJzLmh0dHA7XG5cbi8vIExvYWQgcHJvbWlzZXMgcG9seWZpbGwgaWYgbmVjZXNzYXJ5XG5pZiAodHlwZW9mIFByb21pc2UgPT09ICd1bmRlZmluZWQnKSB7XG4gIHJlcXVpcmUoJ25hdGl2ZS1wcm9taXNlLW9ubHknKTtcbn1cblxuLyoqXG4gKiBFcnJvci1maXJzdCBjYWxsYmFjay5cbiAqXG4gKiBAcGFyYW0ge2Vycm9yfSBbZXJyXSAtIFRoZSBlcnJvciBpZiB0aGVyZSBpcyBhIHByb2JsZW1cbiAqIEBwYXJhbSB7c3RyaW5nfSBbcmVzdWx0XSAtIFRoZSByZXN1bHQgb2YgdGhlIGZ1bmN0aW9uXG4gKlxuICogQGNhbGxiYWNrIHJlc3VsdENhbGxiYWNrXG4gKi9cblxuLyoqXG4gKiBDYWxsYmFjayB1c2VkIHRvIHByb3ZpZGUgYWNjZXNzIHRvIGFsdGVyaW5nIGEgcmVtb3RlIHJlcXVlc3QgcHJpb3IgdG8gdGhlIHJlcXVlc3QgYmVpbmcgbWFkZS5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gcmVxIC0gVGhlIFN1cGVyYWdlbnQgcmVxdWVzdCBvYmplY3RcbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhdGlvbiAtIFRoZSBsb2NhdGlvbiBiZWluZyByZXRyaWV2ZWRcbiAqXG4gKiBAY2FsbGJhY2sgcHJlcGFyZVJlcXVlc3RDYWxsYmFja1xuICovXG5cbi8qKlxuICogUmV0dXJucyB0aGUgbG9hZGVyIGZvciB0aGUgZ2l2ZW4gbG9jYXRpb24uXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2F0aW9uIC0gVGhlIGxvY2F0aW9uIHRvIGxvYWRcbiAqXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBUaGUgbG9hZGVyIHRvIHVzZVxuICovXG5mdW5jdGlvbiBnZXRMb2FkZXIgKGxvY2F0aW9uKSB7XG4gIHJldHVybiBzdXBwb3J0ZWRMb2FkZXJzW2xvY2F0aW9uLnNwbGl0KCc6JylbMF1dIHx8IGRlZmF1bHRMb2FkZXI7XG59XG5cbi8qKlxuICogTG9hZHMgYSBkb2N1bWVudCBhdCB0aGUgcHJvdmlkZWQgbG9jYXRpb24gYW5kIHJldHVybnMgYSBKYXZhU2NyaXB0IG9iamVjdCByZXByZXNlbnRhdGlvbi5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gbG9jYXRpb24gLSBUaGUgbG9jYXRpb24gdG8gdGhlIGRvY3VtZW50XG4gKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gVGhlIG9wdGlvbnNcbiAqIEBwYXJhbSB7cmVzdWx0Q2FsbGJhY2t9IGRvbmUgLSBUaGUgcmVzdWx0IGNhbGxiYWNrXG4gKlxuICogQHJldHVybnMge1Byb21pc2V9IEFsd2F5cyByZXR1cm5zIGEgcHJvbWlzZSBldmVuIGlmIHRoZXJlIGlzIGEgY2FsbGJhY2sgcHJvdmlkZWRcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBjYWxsYmFja3NcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCcuL3BhY2thZ2UuanNvbicsIGZ1bmN0aW9uIChlcnIsIGRvY3VtZW50KSB7XG4gKiAgICAgaWYgKGVycikge1xuICogICAgICAgY29uc29sZS5lcnJvcihlcnIuc3RhY2spO1xuICogICAgIH0gZWxzZSB7XG4gKiAgICAgICB0cnkge1xuICogICAgICAgICBkb2N1bWVudCA9IEpTT04ucGFyc2UoZG9jdW1lbnQpXG4gKiAgICAgICAgIGNvbnNvbGUubG9nKGRvY3VtZW50Lm5hbWUgKyAnICgnICsgZG9jdW1lbnQudmVyc2lvbiArICcpOiAnICsgZG9jdW1lbnQuZGVzY3JpcHRpb24pO1xuICogICAgICAgfSBjYXRjaCAoZXJyMikge1xuICogICAgICAgICBjYWxsYmFjayhlcnIyKTtcbiAqICAgICAgIH1cbiAqICAgICB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBQcm9taXNlc1xuICpcbiAqIFBhdGhMb2FkZXJcbiAqICAgLmxvYWQoJy4vcGFja2FnZS5qc29uJylcbiAqICAgLnRoZW4oSlNPTi5wYXJzZSlcbiAqICAgLnRoZW4oZnVuY3Rpb24gKGRvY3VtZW50KSB7XG4gKiAgICAgY29uc29sZS5sb2coZG9jdW1lbnQubmFtZSArICcgKCcgKyBkb2N1bWVudC52ZXJzaW9uICsgJyk6ICcgKyBkb2N1bWVudC5kZXNjcmlwdGlvbik7XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeGFtcGxlIHVzaW5nIG9wdGlvbnMucHJlcGFyZVJlcXVlc3QgdG8gcHJvdmlkZSBhdXRoZW50aWNhdGlvbiBkZXRhaWxzIGZvciBhIHJlbW90ZWx5IHNlY3VyZSBVUkxcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCdodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL3doaXRsb2NramMvcGF0aC1sb2FkZXInLCB7XG4gKiAgICAgcHJlcGFyZVJlcXVlc3Q6IGZ1bmN0aW9uIChyZXEpIHtcbiAqICAgICAgIHJlcS5hdXRoKCdteS11c2VybmFtZScsICdteS1wYXNzd29yZCcpXG4gKiAgICAgfVxuICogICB9KVxuICogICAudGhlbihKU09OLnBhcnNlKVxuICogICAudGhlbihmdW5jdGlvbiAoZG9jdW1lbnQpIHtcbiAqICAgICBjb25zb2xlLmxvZyhkb2N1bWVudC5mdWxsX25hbWUgKyAnOiAnICsgZG9jdW1lbnQuZGVzY3JpcHRpb24pO1xuICogICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gKiAgICAgY29uc29sZS5lcnJvcihlcnIuc3RhY2spO1xuICogICB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRXhhbXBsZSB1c2luZyBvcHRpb25zLnByb2Nlc3NDb250ZW50IHRvIGxvYWQgYSBZQU1MIGZpbGVcbiAqXG4gKiBQYXRoTG9hZGVyXG4gKiAgIC5sb2FkKCcvVXNlcnMvbm90LXlvdS9wcm9qZWN0cy9wYXRoLWxvYWRlci8udHJhdmlzLnltbCcpXG4gKiAgIC50aGVuKFlBTUwuc2FmZUxvYWQpXG4gKiAgIC50aGVuKGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICogICAgIGNvbnNvbGUubG9nKCdwYXRoLWxvYWRlciB1c2VzIHRoZScsIGRvY3VtZW50Lmxhbmd1YWdlLCAnbGFuZ3VhZ2UuJyk7XG4gKiAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAqICAgICBjb25zb2xlLmVycm9yKGVyci5zdGFjayk7XG4gKiAgIH0pO1xuICovXG5tb2R1bGUuZXhwb3J0cy5sb2FkID0gZnVuY3Rpb24gKGxvY2F0aW9uLCBvcHRpb25zLCBkb25lKSB7XG4gIHZhciBhbGxUYXNrcyA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAyICYmIHR5cGVvZiBvcHRpb25zID09PSAnZnVuY3Rpb24nKSB7XG4gICAgZG9uZSA9IG9wdGlvbnM7XG4gICAgb3B0aW9ucyA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGFyZ3VtZW50c1xuICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgIGlmICh0eXBlb2YgbG9jYXRpb24gPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsb2NhdGlvbiBpcyByZXF1aXJlZCcpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGxvY2F0aW9uICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbG9jYXRpb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3B0aW9ucyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucyAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkb25lICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgZG9uZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgfVxuICB9KTtcblxuICAvLyBMb2FkIHRoZSBkb2N1bWVudCBmcm9tIHRoZSBwcm92aWRlZCBsb2NhdGlvbiBhbmQgcHJvY2VzcyBpdFxuICBhbGxUYXNrcyA9IGFsbFRhc2tzLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICB2YXIgbG9hZGVyID0gZ2V0TG9hZGVyKGxvY2F0aW9uKTtcblxuICAgICAgbG9hZGVyLmxvYWQobG9jYXRpb24sIG9wdGlvbnMsIGZ1bmN0aW9uIChlcnIsIGRvY3VtZW50KSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlKGRvY3VtZW50KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIFVzZSB0aGUgY2FsbGJhY2sgaWYgcHJvdmlkZWQgYW5kIGl0IGlzIGEgZnVuY3Rpb25cbiAgaWYgKHR5cGVvZiBkb25lID09PSAnZnVuY3Rpb24nKSB7XG4gICAgYWxsVGFza3MgPSBhbGxUYXNrc1xuICAgICAgLnRoZW4oZnVuY3Rpb24gKGRvY3VtZW50KSB7XG4gICAgICAgIGRvbmUodW5kZWZpbmVkLCBkb2N1bWVudCk7XG4gICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGRvbmUoZXJyKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGFsbFRhc2tzO1xufTtcbiIsIi8qXG4gKiBUaGUgTUlUIExpY2Vuc2UgKE1JVClcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTUgSmVyZW15IFdoaXRsb2NrXG4gKlxuICogUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuICogb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuICogaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuICogdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuICogY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4gKiBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4gKiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4gKiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbiAqIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuICogQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuICogTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbiAqIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cbiAqIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogTG9hZHMgYSBmaWxlIGZyb20gdGhlIGZpbGVzeXN0ZW0uXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2F0aW9uIC0gVGhlIGZpbGVzeXN0ZW0gbG9jYXRpb24gKElmIHJlbGF0aXZlLCBsb2NhdGlvbiBpcyByZWxhdGl2ZSB0byBwcm9jZXNzLmN3ZCgpKS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gVGhlIGxvYWRlciBvcHRpb25zIChVbnVzZWQpXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAtIFRoZSBlcnJvci1maXJzdCBjYWxsYmFja1xuICovXG5tb2R1bGUuZXhwb3J0cy5sb2FkID0gZnVuY3Rpb24gKGxvY2F0aW9uLCBvcHRpb25zLCBjYWxsYmFjaykge1xuICBjYWxsYmFjayhuZXcgVHlwZUVycm9yKCdUaGUgXFwnZmlsZVxcJyBzY2hlbWUgaXMgbm90IHN1cHBvcnRlZCBpbiB0aGUgYnJvd3NlcicpKTtcbn07XG4iLCIvKmVzbGludC1lbnYgbm9kZSwgYnJvd3NlciAqL1xuXG4vKlxuICogVGhlIE1JVCBMaWNlbnNlIChNSVQpXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE1IEplcmVteSBXaGl0bG9ja1xuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbiAqIG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbiAqIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbiAqIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbiAqIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuICogZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG4gKiBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG4gKiBUSEUgU09GVFdBUkUuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgcmVxdWVzdCA9IHJlcXVpcmUoJ3N1cGVyYWdlbnQnKTtcblxudmFyIHN1cHBvcnRlZEh0dHBNZXRob2RzID0gWydkZWxldGUnLCAnZ2V0JywgJ2hlYWQnLCAncGF0Y2gnLCAncG9zdCcsICdwdXQnXTtcblxuLyoqXG4gKiBMb2FkcyBhIGZpbGUgZnJvbSBhbiBodHRwIG9yIGh0dHBzIFVSTC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYXRpb24gLSBUaGUgZG9jdW1lbnQgVVJMIChJZiByZWxhdGl2ZSwgbG9jYXRpb24gaXMgcmVsYXRpdmUgdG8gd2luZG93LmxvY2F0aW9uKS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gVGhlIGxvYWRlciBvcHRpb25zXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMubWV0aG9kPWdldF0gLSBUaGUgSFRUUCBtZXRob2QgdG8gdXNlIGZvciB0aGUgcmVxdWVzdFxuICogQHBhcmFtIHtwcmVwYXJlUmVxdWVzdENhbGxiYWNrfSBbb3B0aW9ucy5wcmVwYXJlUmVxdWVzdF0gLSBUaGUgY2FsbGJhY2sgdXNlZCB0byBwcmVwYXJlIGEgcmVxdWVzdFxuICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgLSBUaGUgZXJyb3ItZmlyc3QgY2FsbGJhY2tcbiAqL1xubW9kdWxlLmV4cG9ydHMubG9hZCA9IGZ1bmN0aW9uIChsb2NhdGlvbiwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHJlYWxVcmwgPSBsb2NhdGlvbi5zcGxpdCgnIycpWzBdO1xuICB2YXIgcmVhbE1ldGhvZCA9IG9wdGlvbnMubWV0aG9kID8gb3B0aW9ucy5tZXRob2QudG9Mb3dlckNhc2UoKSA6ICdnZXQnO1xuICB2YXIgZXJyO1xuICB2YXIgcmVhbFJlcXVlc3Q7XG5cbiAgaWYgKHR5cGVvZiBvcHRpb25zLnByZXBhcmVSZXF1ZXN0ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygb3B0aW9ucy5wcmVwYXJlUmVxdWVzdCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIGVyciA9IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMucHJlcGFyZVJlcXVlc3QgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH0gZWxzZSBpZiAodHlwZW9mIG9wdGlvbnMubWV0aG9kICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5tZXRob2QgIT09ICdzdHJpbmcnKSB7XG4gICAgICBlcnIgPSBuZXcgVHlwZUVycm9yKCdvcHRpb25zLm1ldGhvZCBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgfSBlbHNlIGlmIChzdXBwb3J0ZWRIdHRwTWV0aG9kcy5pbmRleE9mKG9wdGlvbnMubWV0aG9kKSA9PT0gLTEpIHtcbiAgICAgIGVyciA9IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMubWV0aG9kIG11c3QgYmUgb25lIG9mIHRoZSBmb2xsb3dpbmc6ICcgK1xuICAgICAgICBzdXBwb3J0ZWRIdHRwTWV0aG9kcy5zbGljZSgwLCBzdXBwb3J0ZWRIdHRwTWV0aG9kcy5sZW5ndGggLSAxKS5qb2luKCcsICcpICsgJyBvciAnICtcbiAgICAgICAgc3VwcG9ydGVkSHR0cE1ldGhvZHNbc3VwcG9ydGVkSHR0cE1ldGhvZHMubGVuZ3RoIC0gMV0pO1xuICAgIH1cbiAgfVxuXG4gIGlmICghZXJyKSB7XG4gICAgcmVhbFJlcXVlc3QgPSByZXF1ZXN0W3JlYWxNZXRob2QgPT09ICdkZWxldGUnID8gJ2RlbCcgOiByZWFsTWV0aG9kXShyZWFsVXJsKTtcblxuICAgIGlmIChvcHRpb25zLnByZXBhcmVSZXF1ZXN0KSB7XG4gICAgICBvcHRpb25zLnByZXBhcmVSZXF1ZXN0KHJlYWxSZXF1ZXN0KTtcbiAgICB9XG5cbiAgICAvLyBidWZmZXIoKSBpcyBvbmx5IGF2YWlsYWJsZSBpbiBOb2RlLmpzXG4gICAgaWYgKHR5cGVvZiByZWFsUmVxdWVzdC5idWZmZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJlYWxSZXF1ZXN0LmJ1ZmZlcih0cnVlKTtcbiAgICB9XG5cbiAgICByZWFsUmVxdWVzdFxuICAgICAgLmVuZChmdW5jdGlvbiAoZXJyMiwgcmVzKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycjIsIHJlcyA/IHJlcy50ZXh0IDogcmVzKTtcbiAgICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGNhbGxiYWNrKGVycik7XG4gIH1cbn07XG4iLCIvKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIEVtaXR0ZXIgPSByZXF1aXJlKCdlbWl0dGVyJyk7XG52YXIgcmVkdWNlID0gcmVxdWlyZSgncmVkdWNlJyk7XG5cbi8qKlxuICogUm9vdCByZWZlcmVuY2UgZm9yIGlmcmFtZXMuXG4gKi9cblxudmFyIHJvb3QgPSAndW5kZWZpbmVkJyA9PSB0eXBlb2Ygd2luZG93XG4gID8gKHRoaXMgfHwgc2VsZilcbiAgOiB3aW5kb3c7XG5cbi8qKlxuICogTm9vcC5cbiAqL1xuXG5mdW5jdGlvbiBub29wKCl7fTtcblxuLyoqXG4gKiBDaGVjayBpZiBgb2JqYCBpcyBhIGhvc3Qgb2JqZWN0LFxuICogd2UgZG9uJ3Qgd2FudCB0byBzZXJpYWxpemUgdGhlc2UgOilcbiAqXG4gKiBUT0RPOiBmdXR1cmUgcHJvb2YsIG1vdmUgdG8gY29tcG9lbnQgbGFuZFxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBpc0hvc3Qob2JqKSB7XG4gIHZhciBzdHIgPSB7fS50b1N0cmluZy5jYWxsKG9iaik7XG5cbiAgc3dpdGNoIChzdHIpIHtcbiAgICBjYXNlICdbb2JqZWN0IEZpbGVdJzpcbiAgICBjYXNlICdbb2JqZWN0IEJsb2JdJzpcbiAgICBjYXNlICdbb2JqZWN0IEZvcm1EYXRhXSc6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogRGV0ZXJtaW5lIFhIUi5cbiAqL1xuXG5yZXF1ZXN0LmdldFhIUiA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHJvb3QuWE1MSHR0cFJlcXVlc3RcbiAgICAgICYmICghcm9vdC5sb2NhdGlvbiB8fCAnZmlsZTonICE9IHJvb3QubG9jYXRpb24ucHJvdG9jb2xcbiAgICAgICAgICB8fCAhcm9vdC5BY3RpdmVYT2JqZWN0KSkge1xuICAgIHJldHVybiBuZXcgWE1MSHR0cFJlcXVlc3Q7XG4gIH0gZWxzZSB7XG4gICAgdHJ5IHsgcmV0dXJuIG5ldyBBY3RpdmVYT2JqZWN0KCdNaWNyb3NvZnQuWE1MSFRUUCcpOyB9IGNhdGNoKGUpIHt9XG4gICAgdHJ5IHsgcmV0dXJuIG5ldyBBY3RpdmVYT2JqZWN0KCdNc3htbDIuWE1MSFRUUC42LjAnKTsgfSBjYXRjaChlKSB7fVxuICAgIHRyeSB7IHJldHVybiBuZXcgQWN0aXZlWE9iamVjdCgnTXN4bWwyLlhNTEhUVFAuMy4wJyk7IH0gY2F0Y2goZSkge31cbiAgICB0cnkgeyByZXR1cm4gbmV3IEFjdGl2ZVhPYmplY3QoJ01zeG1sMi5YTUxIVFRQJyk7IH0gY2F0Y2goZSkge31cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG4vKipcbiAqIFJlbW92ZXMgbGVhZGluZyBhbmQgdHJhaWxpbmcgd2hpdGVzcGFjZSwgYWRkZWQgdG8gc3VwcG9ydCBJRS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxudmFyIHRyaW0gPSAnJy50cmltXG4gID8gZnVuY3Rpb24ocykgeyByZXR1cm4gcy50cmltKCk7IH1cbiAgOiBmdW5jdGlvbihzKSB7IHJldHVybiBzLnJlcGxhY2UoLyheXFxzKnxcXHMqJCkvZywgJycpOyB9O1xuXG4vKipcbiAqIENoZWNrIGlmIGBvYmpgIGlzIGFuIG9iamVjdC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaXNPYmplY3Qob2JqKSB7XG4gIHJldHVybiBvYmogPT09IE9iamVjdChvYmopO1xufVxuXG4vKipcbiAqIFNlcmlhbGl6ZSB0aGUgZ2l2ZW4gYG9iamAuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2VyaWFsaXplKG9iaikge1xuICBpZiAoIWlzT2JqZWN0KG9iaikpIHJldHVybiBvYmo7XG4gIHZhciBwYWlycyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgaWYgKG51bGwgIT0gb2JqW2tleV0pIHtcbiAgICAgIHBhaXJzLnB1c2goZW5jb2RlVVJJQ29tcG9uZW50KGtleSlcbiAgICAgICAgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQob2JqW2tleV0pKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBhaXJzLmpvaW4oJyYnKTtcbn1cblxuLyoqXG4gKiBFeHBvc2Ugc2VyaWFsaXphdGlvbiBtZXRob2QuXG4gKi9cblxuIHJlcXVlc3Quc2VyaWFsaXplT2JqZWN0ID0gc2VyaWFsaXplO1xuXG4gLyoqXG4gICogUGFyc2UgdGhlIGdpdmVuIHgtd3d3LWZvcm0tdXJsZW5jb2RlZCBgc3RyYC5cbiAgKlxuICAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAgKiBAcmV0dXJuIHtPYmplY3R9XG4gICogQGFwaSBwcml2YXRlXG4gICovXG5cbmZ1bmN0aW9uIHBhcnNlU3RyaW5nKHN0cikge1xuICB2YXIgb2JqID0ge307XG4gIHZhciBwYWlycyA9IHN0ci5zcGxpdCgnJicpO1xuICB2YXIgcGFydHM7XG4gIHZhciBwYWlyO1xuXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBwYWlycy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xuICAgIHBhaXIgPSBwYWlyc1tpXTtcbiAgICBwYXJ0cyA9IHBhaXIuc3BsaXQoJz0nKTtcbiAgICBvYmpbZGVjb2RlVVJJQ29tcG9uZW50KHBhcnRzWzBdKV0gPSBkZWNvZGVVUklDb21wb25lbnQocGFydHNbMV0pO1xuICB9XG5cbiAgcmV0dXJuIG9iajtcbn1cblxuLyoqXG4gKiBFeHBvc2UgcGFyc2VyLlxuICovXG5cbnJlcXVlc3QucGFyc2VTdHJpbmcgPSBwYXJzZVN0cmluZztcblxuLyoqXG4gKiBEZWZhdWx0IE1JTUUgdHlwZSBtYXAuXG4gKlxuICogICAgIHN1cGVyYWdlbnQudHlwZXMueG1sID0gJ2FwcGxpY2F0aW9uL3htbCc7XG4gKlxuICovXG5cbnJlcXVlc3QudHlwZXMgPSB7XG4gIGh0bWw6ICd0ZXh0L2h0bWwnLFxuICBqc29uOiAnYXBwbGljYXRpb24vanNvbicsXG4gIHhtbDogJ2FwcGxpY2F0aW9uL3htbCcsXG4gIHVybGVuY29kZWQ6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnLFxuICAnZm9ybSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnLFxuICAnZm9ybS1kYXRhJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCdcbn07XG5cbi8qKlxuICogRGVmYXVsdCBzZXJpYWxpemF0aW9uIG1hcC5cbiAqXG4gKiAgICAgc3VwZXJhZ2VudC5zZXJpYWxpemVbJ2FwcGxpY2F0aW9uL3htbCddID0gZnVuY3Rpb24ob2JqKXtcbiAqICAgICAgIHJldHVybiAnZ2VuZXJhdGVkIHhtbCBoZXJlJztcbiAqICAgICB9O1xuICpcbiAqL1xuXG4gcmVxdWVzdC5zZXJpYWxpemUgPSB7XG4gICAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJzogc2VyaWFsaXplLFxuICAgJ2FwcGxpY2F0aW9uL2pzb24nOiBKU09OLnN0cmluZ2lmeVxuIH07XG5cbiAvKipcbiAgKiBEZWZhdWx0IHBhcnNlcnMuXG4gICpcbiAgKiAgICAgc3VwZXJhZ2VudC5wYXJzZVsnYXBwbGljYXRpb24veG1sJ10gPSBmdW5jdGlvbihzdHIpe1xuICAqICAgICAgIHJldHVybiB7IG9iamVjdCBwYXJzZWQgZnJvbSBzdHIgfTtcbiAgKiAgICAgfTtcbiAgKlxuICAqL1xuXG5yZXF1ZXN0LnBhcnNlID0ge1xuICAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJzogcGFyc2VTdHJpbmcsXG4gICdhcHBsaWNhdGlvbi9qc29uJzogSlNPTi5wYXJzZVxufTtcblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gaGVhZGVyIGBzdHJgIGludG9cbiAqIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBtYXBwZWQgZmllbGRzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcnNlSGVhZGVyKHN0cikge1xuICB2YXIgbGluZXMgPSBzdHIuc3BsaXQoL1xccj9cXG4vKTtcbiAgdmFyIGZpZWxkcyA9IHt9O1xuICB2YXIgaW5kZXg7XG4gIHZhciBsaW5lO1xuICB2YXIgZmllbGQ7XG4gIHZhciB2YWw7XG5cbiAgbGluZXMucG9wKCk7IC8vIHRyYWlsaW5nIENSTEZcblxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gbGluZXMubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgaW5kZXggPSBsaW5lLmluZGV4T2YoJzonKTtcbiAgICBmaWVsZCA9IGxpbmUuc2xpY2UoMCwgaW5kZXgpLnRvTG93ZXJDYXNlKCk7XG4gICAgdmFsID0gdHJpbShsaW5lLnNsaWNlKGluZGV4ICsgMSkpO1xuICAgIGZpZWxkc1tmaWVsZF0gPSB2YWw7XG4gIH1cblxuICByZXR1cm4gZmllbGRzO1xufVxuXG4vKipcbiAqIFJldHVybiB0aGUgbWltZSB0eXBlIGZvciB0aGUgZ2l2ZW4gYHN0cmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gdHlwZShzdHIpe1xuICByZXR1cm4gc3RyLnNwbGl0KC8gKjsgKi8pLnNoaWZ0KCk7XG59O1xuXG4vKipcbiAqIFJldHVybiBoZWFkZXIgZmllbGQgcGFyYW1ldGVycy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJhbXMoc3RyKXtcbiAgcmV0dXJuIHJlZHVjZShzdHIuc3BsaXQoLyAqOyAqLyksIGZ1bmN0aW9uKG9iaiwgc3RyKXtcbiAgICB2YXIgcGFydHMgPSBzdHIuc3BsaXQoLyAqPSAqLylcbiAgICAgICwga2V5ID0gcGFydHMuc2hpZnQoKVxuICAgICAgLCB2YWwgPSBwYXJ0cy5zaGlmdCgpO1xuXG4gICAgaWYgKGtleSAmJiB2YWwpIG9ialtrZXldID0gdmFsO1xuICAgIHJldHVybiBvYmo7XG4gIH0sIHt9KTtcbn07XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVzcG9uc2VgIHdpdGggdGhlIGdpdmVuIGB4aHJgLlxuICpcbiAqICAtIHNldCBmbGFncyAoLm9rLCAuZXJyb3IsIGV0YylcbiAqICAtIHBhcnNlIGhlYWRlclxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICBBbGlhc2luZyBgc3VwZXJhZ2VudGAgYXMgYHJlcXVlc3RgIGlzIG5pY2U6XG4gKlxuICogICAgICByZXF1ZXN0ID0gc3VwZXJhZ2VudDtcbiAqXG4gKiAgV2UgY2FuIHVzZSB0aGUgcHJvbWlzZS1saWtlIEFQSSwgb3IgcGFzcyBjYWxsYmFja3M6XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnLycpLmVuZChmdW5jdGlvbihyZXMpe30pO1xuICogICAgICByZXF1ZXN0LmdldCgnLycsIGZ1bmN0aW9uKHJlcyl7fSk7XG4gKlxuICogIFNlbmRpbmcgZGF0YSBjYW4gYmUgY2hhaW5lZDpcbiAqXG4gKiAgICAgIHJlcXVlc3RcbiAqICAgICAgICAucG9zdCgnL3VzZXInKVxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiAgT3IgcGFzc2VkIHRvIGAuc2VuZCgpYDpcbiAqXG4gKiAgICAgIHJlcXVlc3RcbiAqICAgICAgICAucG9zdCgnL3VzZXInKVxuICogICAgICAgIC5zZW5kKHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqICBPciBwYXNzZWQgdG8gYC5wb3N0KClgOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicsIHsgbmFtZTogJ3RqJyB9KVxuICogICAgICAgIC5lbmQoZnVuY3Rpb24ocmVzKXt9KTtcbiAqXG4gKiBPciBmdXJ0aGVyIHJlZHVjZWQgdG8gYSBzaW5nbGUgY2FsbCBmb3Igc2ltcGxlIGNhc2VzOlxuICpcbiAqICAgICAgcmVxdWVzdFxuICogICAgICAgIC5wb3N0KCcvdXNlcicsIHsgbmFtZTogJ3RqJyB9LCBmdW5jdGlvbihyZXMpe30pO1xuICpcbiAqIEBwYXJhbSB7WE1MSFRUUFJlcXVlc3R9IHhoclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIFJlc3BvbnNlKHJlcSwgb3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgdGhpcy5yZXEgPSByZXE7XG4gIHRoaXMueGhyID0gdGhpcy5yZXEueGhyO1xuICAvLyByZXNwb25zZVRleHQgaXMgYWNjZXNzaWJsZSBvbmx5IGlmIHJlc3BvbnNlVHlwZSBpcyAnJyBvciAndGV4dCcgYW5kIG9uIG9sZGVyIGJyb3dzZXJzXG4gIHRoaXMudGV4dCA9ICgodGhpcy5yZXEubWV0aG9kICE9J0hFQUQnICYmICh0aGlzLnhoci5yZXNwb25zZVR5cGUgPT09ICcnIHx8IHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3RleHQnKSkgfHwgdHlwZW9mIHRoaXMueGhyLnJlc3BvbnNlVHlwZSA9PT0gJ3VuZGVmaW5lZCcpXG4gICAgID8gdGhpcy54aHIucmVzcG9uc2VUZXh0XG4gICAgIDogbnVsbDtcbiAgdGhpcy5zdGF0dXNUZXh0ID0gdGhpcy5yZXEueGhyLnN0YXR1c1RleHQ7XG4gIHRoaXMuc2V0U3RhdHVzUHJvcGVydGllcyh0aGlzLnhoci5zdGF0dXMpO1xuICB0aGlzLmhlYWRlciA9IHRoaXMuaGVhZGVycyA9IHBhcnNlSGVhZGVyKHRoaXMueGhyLmdldEFsbFJlc3BvbnNlSGVhZGVycygpKTtcbiAgLy8gZ2V0QWxsUmVzcG9uc2VIZWFkZXJzIHNvbWV0aW1lcyBmYWxzZWx5IHJldHVybnMgXCJcIiBmb3IgQ09SUyByZXF1ZXN0cywgYnV0XG4gIC8vIGdldFJlc3BvbnNlSGVhZGVyIHN0aWxsIHdvcmtzLiBzbyB3ZSBnZXQgY29udGVudC10eXBlIGV2ZW4gaWYgZ2V0dGluZ1xuICAvLyBvdGhlciBoZWFkZXJzIGZhaWxzLlxuICB0aGlzLmhlYWRlclsnY29udGVudC10eXBlJ10gPSB0aGlzLnhoci5nZXRSZXNwb25zZUhlYWRlcignY29udGVudC10eXBlJyk7XG4gIHRoaXMuc2V0SGVhZGVyUHJvcGVydGllcyh0aGlzLmhlYWRlcik7XG4gIHRoaXMuYm9keSA9IHRoaXMucmVxLm1ldGhvZCAhPSAnSEVBRCdcbiAgICA/IHRoaXMucGFyc2VCb2R5KHRoaXMudGV4dCA/IHRoaXMudGV4dCA6IHRoaXMueGhyLnJlc3BvbnNlKVxuICAgIDogbnVsbDtcbn1cblxuLyoqXG4gKiBHZXQgY2FzZS1pbnNlbnNpdGl2ZSBgZmllbGRgIHZhbHVlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXNwb25zZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oZmllbGQpe1xuICByZXR1cm4gdGhpcy5oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV07XG59O1xuXG4vKipcbiAqIFNldCBoZWFkZXIgcmVsYXRlZCBwcm9wZXJ0aWVzOlxuICpcbiAqICAgLSBgLnR5cGVgIHRoZSBjb250ZW50IHR5cGUgd2l0aG91dCBwYXJhbXNcbiAqXG4gKiBBIHJlc3BvbnNlIG9mIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04XCJcbiAqIHdpbGwgcHJvdmlkZSB5b3Ugd2l0aCBhIGAudHlwZWAgb2YgXCJ0ZXh0L3BsYWluXCIuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGhlYWRlclxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnNldEhlYWRlclByb3BlcnRpZXMgPSBmdW5jdGlvbihoZWFkZXIpe1xuICAvLyBjb250ZW50LXR5cGVcbiAgdmFyIGN0ID0gdGhpcy5oZWFkZXJbJ2NvbnRlbnQtdHlwZSddIHx8ICcnO1xuICB0aGlzLnR5cGUgPSB0eXBlKGN0KTtcblxuICAvLyBwYXJhbXNcbiAgdmFyIG9iaiA9IHBhcmFtcyhjdCk7XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHRoaXNba2V5XSA9IG9ialtrZXldO1xufTtcblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gYm9keSBgc3RyYC5cbiAqXG4gKiBVc2VkIGZvciBhdXRvLXBhcnNpbmcgb2YgYm9kaWVzLiBQYXJzZXJzXG4gKiBhcmUgZGVmaW5lZCBvbiB0aGUgYHN1cGVyYWdlbnQucGFyc2VgIG9iamVjdC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtNaXhlZH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlc3BvbnNlLnByb3RvdHlwZS5wYXJzZUJvZHkgPSBmdW5jdGlvbihzdHIpe1xuICB2YXIgcGFyc2UgPSByZXF1ZXN0LnBhcnNlW3RoaXMudHlwZV07XG4gIHJldHVybiBwYXJzZSAmJiBzdHIgJiYgKHN0ci5sZW5ndGggfHwgc3RyIGluc3RhbmNlb2YgT2JqZWN0KVxuICAgID8gcGFyc2Uoc3RyKVxuICAgIDogbnVsbDtcbn07XG5cbi8qKlxuICogU2V0IGZsYWdzIHN1Y2ggYXMgYC5va2AgYmFzZWQgb24gYHN0YXR1c2AuXG4gKlxuICogRm9yIGV4YW1wbGUgYSAyeHggcmVzcG9uc2Ugd2lsbCBnaXZlIHlvdSBhIGAub2tgIG9mIF9fdHJ1ZV9fXG4gKiB3aGVyZWFzIDV4eCB3aWxsIGJlIF9fZmFsc2VfXyBhbmQgYC5lcnJvcmAgd2lsbCBiZSBfX3RydWVfXy4gVGhlXG4gKiBgLmNsaWVudEVycm9yYCBhbmQgYC5zZXJ2ZXJFcnJvcmAgYXJlIGFsc28gYXZhaWxhYmxlIHRvIGJlIG1vcmVcbiAqIHNwZWNpZmljLCBhbmQgYC5zdGF0dXNUeXBlYCBpcyB0aGUgY2xhc3Mgb2YgZXJyb3IgcmFuZ2luZyBmcm9tIDEuLjVcbiAqIHNvbWV0aW1lcyB1c2VmdWwgZm9yIG1hcHBpbmcgcmVzcG9uZCBjb2xvcnMgZXRjLlxuICpcbiAqIFwic3VnYXJcIiBwcm9wZXJ0aWVzIGFyZSBhbHNvIGRlZmluZWQgZm9yIGNvbW1vbiBjYXNlcy4gQ3VycmVudGx5IHByb3ZpZGluZzpcbiAqXG4gKiAgIC0gLm5vQ29udGVudFxuICogICAtIC5iYWRSZXF1ZXN0XG4gKiAgIC0gLnVuYXV0aG9yaXplZFxuICogICAtIC5ub3RBY2NlcHRhYmxlXG4gKiAgIC0gLm5vdEZvdW5kXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IHN0YXR1c1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnNldFN0YXR1c1Byb3BlcnRpZXMgPSBmdW5jdGlvbihzdGF0dXMpe1xuICAvLyBoYW5kbGUgSUU5IGJ1ZzogaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMDA0Njk3Mi9tc2llLXJldHVybnMtc3RhdHVzLWNvZGUtb2YtMTIyMy1mb3ItYWpheC1yZXF1ZXN0XG4gIGlmIChzdGF0dXMgPT09IDEyMjMpIHtcbiAgICBzdGF0dXMgPSAyMDQ7XG4gIH1cblxuICB2YXIgdHlwZSA9IHN0YXR1cyAvIDEwMCB8IDA7XG5cbiAgLy8gc3RhdHVzIC8gY2xhc3NcbiAgdGhpcy5zdGF0dXMgPSBzdGF0dXM7XG4gIHRoaXMuc3RhdHVzVHlwZSA9IHR5cGU7XG5cbiAgLy8gYmFzaWNzXG4gIHRoaXMuaW5mbyA9IDEgPT0gdHlwZTtcbiAgdGhpcy5vayA9IDIgPT0gdHlwZTtcbiAgdGhpcy5jbGllbnRFcnJvciA9IDQgPT0gdHlwZTtcbiAgdGhpcy5zZXJ2ZXJFcnJvciA9IDUgPT0gdHlwZTtcbiAgdGhpcy5lcnJvciA9ICg0ID09IHR5cGUgfHwgNSA9PSB0eXBlKVxuICAgID8gdGhpcy50b0Vycm9yKClcbiAgICA6IGZhbHNlO1xuXG4gIC8vIHN1Z2FyXG4gIHRoaXMuYWNjZXB0ZWQgPSAyMDIgPT0gc3RhdHVzO1xuICB0aGlzLm5vQ29udGVudCA9IDIwNCA9PSBzdGF0dXM7XG4gIHRoaXMuYmFkUmVxdWVzdCA9IDQwMCA9PSBzdGF0dXM7XG4gIHRoaXMudW5hdXRob3JpemVkID0gNDAxID09IHN0YXR1cztcbiAgdGhpcy5ub3RBY2NlcHRhYmxlID0gNDA2ID09IHN0YXR1cztcbiAgdGhpcy5ub3RGb3VuZCA9IDQwNCA9PSBzdGF0dXM7XG4gIHRoaXMuZm9yYmlkZGVuID0gNDAzID09IHN0YXR1cztcbn07XG5cbi8qKlxuICogUmV0dXJuIGFuIGBFcnJvcmAgcmVwcmVzZW50YXRpdmUgb2YgdGhpcyByZXNwb25zZS5cbiAqXG4gKiBAcmV0dXJuIHtFcnJvcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVzcG9uc2UucHJvdG90eXBlLnRvRXJyb3IgPSBmdW5jdGlvbigpe1xuICB2YXIgcmVxID0gdGhpcy5yZXE7XG4gIHZhciBtZXRob2QgPSByZXEubWV0aG9kO1xuICB2YXIgdXJsID0gcmVxLnVybDtcblxuICB2YXIgbXNnID0gJ2Nhbm5vdCAnICsgbWV0aG9kICsgJyAnICsgdXJsICsgJyAoJyArIHRoaXMuc3RhdHVzICsgJyknO1xuICB2YXIgZXJyID0gbmV3IEVycm9yKG1zZyk7XG4gIGVyci5zdGF0dXMgPSB0aGlzLnN0YXR1cztcbiAgZXJyLm1ldGhvZCA9IG1ldGhvZDtcbiAgZXJyLnVybCA9IHVybDtcblxuICByZXR1cm4gZXJyO1xufTtcblxuLyoqXG4gKiBFeHBvc2UgYFJlc3BvbnNlYC5cbiAqL1xuXG5yZXF1ZXN0LlJlc3BvbnNlID0gUmVzcG9uc2U7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgUmVxdWVzdGAgd2l0aCB0aGUgZ2l2ZW4gYG1ldGhvZGAgYW5kIGB1cmxgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2RcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gUmVxdWVzdChtZXRob2QsIHVybCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIEVtaXR0ZXIuY2FsbCh0aGlzKTtcbiAgdGhpcy5fcXVlcnkgPSB0aGlzLl9xdWVyeSB8fCBbXTtcbiAgdGhpcy5tZXRob2QgPSBtZXRob2Q7XG4gIHRoaXMudXJsID0gdXJsO1xuICB0aGlzLmhlYWRlciA9IHt9O1xuICB0aGlzLl9oZWFkZXIgPSB7fTtcbiAgdGhpcy5vbignZW5kJywgZnVuY3Rpb24oKXtcbiAgICB2YXIgZXJyID0gbnVsbDtcbiAgICB2YXIgcmVzID0gbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICByZXMgPSBuZXcgUmVzcG9uc2Uoc2VsZik7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICBlcnIgPSBuZXcgRXJyb3IoJ1BhcnNlciBpcyB1bmFibGUgdG8gcGFyc2UgdGhlIHJlc3BvbnNlJyk7XG4gICAgICBlcnIucGFyc2UgPSB0cnVlO1xuICAgICAgZXJyLm9yaWdpbmFsID0gZTtcbiAgICAgIHJldHVybiBzZWxmLmNhbGxiYWNrKGVycik7XG4gICAgfVxuXG4gICAgc2VsZi5lbWl0KCdyZXNwb25zZScsIHJlcyk7XG5cbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gc2VsZi5jYWxsYmFjayhlcnIsIHJlcyk7XG4gICAgfVxuXG4gICAgaWYgKHJlcy5zdGF0dXMgPj0gMjAwICYmIHJlcy5zdGF0dXMgPCAzMDApIHtcbiAgICAgIHJldHVybiBzZWxmLmNhbGxiYWNrKGVyciwgcmVzKTtcbiAgICB9XG5cbiAgICB2YXIgbmV3X2VyciA9IG5ldyBFcnJvcihyZXMuc3RhdHVzVGV4dCB8fCAnVW5zdWNjZXNzZnVsIEhUVFAgcmVzcG9uc2UnKTtcbiAgICBuZXdfZXJyLm9yaWdpbmFsID0gZXJyO1xuICAgIG5ld19lcnIucmVzcG9uc2UgPSByZXM7XG4gICAgbmV3X2Vyci5zdGF0dXMgPSByZXMuc3RhdHVzO1xuXG4gICAgc2VsZi5jYWxsYmFjayhlcnIgfHwgbmV3X2VyciwgcmVzKTtcbiAgfSk7XG59XG5cbi8qKlxuICogTWl4aW4gYEVtaXR0ZXJgLlxuICovXG5cbkVtaXR0ZXIoUmVxdWVzdC5wcm90b3R5cGUpO1xuXG4vKipcbiAqIEFsbG93IGZvciBleHRlbnNpb25cbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihmbikge1xuICBmbih0aGlzKTtcbiAgcmV0dXJuIHRoaXM7XG59XG5cbi8qKlxuICogU2V0IHRpbWVvdXQgdG8gYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS50aW1lb3V0ID0gZnVuY3Rpb24obXMpe1xuICB0aGlzLl90aW1lb3V0ID0gbXM7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBDbGVhciBwcmV2aW91cyB0aW1lb3V0LlxuICpcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5jbGVhclRpbWVvdXQgPSBmdW5jdGlvbigpe1xuICB0aGlzLl90aW1lb3V0ID0gMDtcbiAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpbWVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFib3J0IHRoZSByZXF1ZXN0LCBhbmQgY2xlYXIgcG90ZW50aWFsIHRpbWVvdXQuXG4gKlxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYWJvcnQgPSBmdW5jdGlvbigpe1xuICBpZiAodGhpcy5hYm9ydGVkKSByZXR1cm47XG4gIHRoaXMuYWJvcnRlZCA9IHRydWU7XG4gIHRoaXMueGhyLmFib3J0KCk7XG4gIHRoaXMuY2xlYXJUaW1lb3V0KCk7XG4gIHRoaXMuZW1pdCgnYWJvcnQnKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldCBoZWFkZXIgYGZpZWxkYCB0byBgdmFsYCwgb3IgbXVsdGlwbGUgZmllbGRzIHdpdGggb25lIG9iamVjdC5cbiAqXG4gKiBFeGFtcGxlczpcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC5zZXQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJylcbiAqICAgICAgICAuc2V0KCdYLUFQSS1LZXknLCAnZm9vYmFyJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiAgICAgIHJlcS5nZXQoJy8nKVxuICogICAgICAgIC5zZXQoeyBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJywgJ1gtQVBJLUtleSc6ICdmb29iYXInIH0pXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBmaWVsZFxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGZpZWxkLCB2YWwpe1xuICBpZiAoaXNPYmplY3QoZmllbGQpKSB7XG4gICAgZm9yICh2YXIga2V5IGluIGZpZWxkKSB7XG4gICAgICB0aGlzLnNldChrZXksIGZpZWxkW2tleV0pO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICB0aGlzLl9oZWFkZXJbZmllbGQudG9Mb3dlckNhc2UoKV0gPSB2YWw7XG4gIHRoaXMuaGVhZGVyW2ZpZWxkXSA9IHZhbDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBoZWFkZXIgYGZpZWxkYC5cbiAqXG4gKiBFeGFtcGxlOlxuICpcbiAqICAgICAgcmVxLmdldCgnLycpXG4gKiAgICAgICAgLnVuc2V0KCdVc2VyLUFnZW50JylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS51bnNldCA9IGZ1bmN0aW9uKGZpZWxkKXtcbiAgZGVsZXRlIHRoaXMuX2hlYWRlcltmaWVsZC50b0xvd2VyQ2FzZSgpXTtcbiAgZGVsZXRlIHRoaXMuaGVhZGVyW2ZpZWxkXTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEdldCBjYXNlLWluc2Vuc2l0aXZlIGhlYWRlciBgZmllbGRgIHZhbHVlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWVsZFxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuZ2V0SGVhZGVyID0gZnVuY3Rpb24oZmllbGQpe1xuICByZXR1cm4gdGhpcy5faGVhZGVyW2ZpZWxkLnRvTG93ZXJDYXNlKCldO1xufTtcblxuLyoqXG4gKiBTZXQgQ29udGVudC1UeXBlIHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICBzdXBlcmFnZW50LnR5cGVzLnhtbCA9ICdhcHBsaWNhdGlvbi94bWwnO1xuICpcbiAqICAgICAgcmVxdWVzdC5wb3N0KCcvJylcbiAqICAgICAgICAudHlwZSgneG1sJylcbiAqICAgICAgICAuc2VuZCh4bWxzdHJpbmcpXG4gKiAgICAgICAgLmVuZChjYWxsYmFjayk7XG4gKlxuICogICAgICByZXF1ZXN0LnBvc3QoJy8nKVxuICogICAgICAgIC50eXBlKCdhcHBsaWNhdGlvbi94bWwnKVxuICogICAgICAgIC5zZW5kKHhtbHN0cmluZylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZVxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbih0eXBlKXtcbiAgdGhpcy5zZXQoJ0NvbnRlbnQtVHlwZScsIHJlcXVlc3QudHlwZXNbdHlwZV0gfHwgdHlwZSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgQWNjZXB0IHRvIGB0eXBlYCwgbWFwcGluZyB2YWx1ZXMgZnJvbSBgcmVxdWVzdC50eXBlc2AuXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICBzdXBlcmFnZW50LnR5cGVzLmpzb24gPSAnYXBwbGljYXRpb24vanNvbic7XG4gKlxuICogICAgICByZXF1ZXN0LmdldCgnL2FnZW50JylcbiAqICAgICAgICAuYWNjZXB0KCdqc29uJylcbiAqICAgICAgICAuZW5kKGNhbGxiYWNrKTtcbiAqXG4gKiAgICAgIHJlcXVlc3QuZ2V0KCcvYWdlbnQnKVxuICogICAgICAgIC5hY2NlcHQoJ2FwcGxpY2F0aW9uL2pzb24nKVxuICogICAgICAgIC5lbmQoY2FsbGJhY2spO1xuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBhY2NlcHRcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5hY2NlcHQgPSBmdW5jdGlvbih0eXBlKXtcbiAgdGhpcy5zZXQoJ0FjY2VwdCcsIHJlcXVlc3QudHlwZXNbdHlwZV0gfHwgdHlwZSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXQgQXV0aG9yaXphdGlvbiBmaWVsZCB2YWx1ZSB3aXRoIGB1c2VyYCBhbmQgYHBhc3NgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1c2VyXG4gKiBAcGFyYW0ge1N0cmluZ30gcGFzc1xuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmF1dGggPSBmdW5jdGlvbih1c2VyLCBwYXNzKXtcbiAgdmFyIHN0ciA9IGJ0b2EodXNlciArICc6JyArIHBhc3MpO1xuICB0aGlzLnNldCgnQXV0aG9yaXphdGlvbicsICdCYXNpYyAnICsgc3RyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiogQWRkIHF1ZXJ5LXN0cmluZyBgdmFsYC5cbipcbiogRXhhbXBsZXM6XG4qXG4qICAgcmVxdWVzdC5nZXQoJy9zaG9lcycpXG4qICAgICAucXVlcnkoJ3NpemU9MTAnKVxuKiAgICAgLnF1ZXJ5KHsgY29sb3I6ICdibHVlJyB9KVxuKlxuKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IHZhbFxuKiBAcmV0dXJuIHtSZXF1ZXN0fSBmb3IgY2hhaW5pbmdcbiogQGFwaSBwdWJsaWNcbiovXG5cblJlcXVlc3QucHJvdG90eXBlLnF1ZXJ5ID0gZnVuY3Rpb24odmFsKXtcbiAgaWYgKCdzdHJpbmcnICE9IHR5cGVvZiB2YWwpIHZhbCA9IHNlcmlhbGl6ZSh2YWwpO1xuICBpZiAodmFsKSB0aGlzLl9xdWVyeS5wdXNoKHZhbCk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBXcml0ZSB0aGUgZmllbGQgYG5hbWVgIGFuZCBgdmFsYCBmb3IgXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCJcbiAqIHJlcXVlc3QgYm9kaWVzLlxuICpcbiAqIGBgYCBqc1xuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcbiAqICAgLmZpZWxkKCdmb28nLCAnYmFyJylcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICogQHBhcmFtIHtTdHJpbmd8QmxvYnxGaWxlfSB2YWxcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5maWVsZCA9IGZ1bmN0aW9uKG5hbWUsIHZhbCl7XG4gIGlmICghdGhpcy5fZm9ybURhdGEpIHRoaXMuX2Zvcm1EYXRhID0gbmV3IHJvb3QuRm9ybURhdGEoKTtcbiAgdGhpcy5fZm9ybURhdGEuYXBwZW5kKG5hbWUsIHZhbCk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBRdWV1ZSB0aGUgZ2l2ZW4gYGZpbGVgIGFzIGFuIGF0dGFjaG1lbnQgdG8gdGhlIHNwZWNpZmllZCBgZmllbGRgLFxuICogd2l0aCBvcHRpb25hbCBgZmlsZW5hbWVgLlxuICpcbiAqIGBgYCBqc1xuICogcmVxdWVzdC5wb3N0KCcvdXBsb2FkJylcbiAqICAgLmF0dGFjaChuZXcgQmxvYihbJzxhIGlkPVwiYVwiPjxiIGlkPVwiYlwiPmhleSE8L2I+PC9hPiddLCB7IHR5cGU6IFwidGV4dC9odG1sXCJ9KSlcbiAqICAgLmVuZChjYWxsYmFjayk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZmllbGRcbiAqIEBwYXJhbSB7QmxvYnxGaWxlfSBmaWxlXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlsZW5hbWVcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihmaWVsZCwgZmlsZSwgZmlsZW5hbWUpe1xuICBpZiAoIXRoaXMuX2Zvcm1EYXRhKSB0aGlzLl9mb3JtRGF0YSA9IG5ldyByb290LkZvcm1EYXRhKCk7XG4gIHRoaXMuX2Zvcm1EYXRhLmFwcGVuZChmaWVsZCwgZmlsZSwgZmlsZW5hbWUpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2VuZCBgZGF0YWAsIGRlZmF1bHRpbmcgdGhlIGAudHlwZSgpYCB0byBcImpzb25cIiB3aGVuXG4gKiBhbiBvYmplY3QgaXMgZ2l2ZW4uXG4gKlxuICogRXhhbXBsZXM6XG4gKlxuICogICAgICAgLy8gcXVlcnlzdHJpbmdcbiAqICAgICAgIHJlcXVlc3QuZ2V0KCcvc2VhcmNoJylcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBtdWx0aXBsZSBkYXRhIFwid3JpdGVzXCJcbiAqICAgICAgIHJlcXVlc3QuZ2V0KCcvc2VhcmNoJylcbiAqICAgICAgICAgLnNlbmQoeyBzZWFyY2g6ICdxdWVyeScgfSlcbiAqICAgICAgICAgLnNlbmQoeyByYW5nZTogJzEuLjUnIH0pXG4gKiAgICAgICAgIC5zZW5kKHsgb3JkZXI6ICdkZXNjJyB9KVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIG1hbnVhbCBqc29uXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnR5cGUoJ2pzb24nKVxuICogICAgICAgICAuc2VuZCgne1wibmFtZVwiOlwidGpcIn0pXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogICAgICAgLy8gYXV0byBqc29uXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnNlbmQoeyBuYW1lOiAndGonIH0pXG4gKiAgICAgICAgIC5lbmQoY2FsbGJhY2spXG4gKlxuICogICAgICAgLy8gbWFudWFsIHgtd3d3LWZvcm0tdXJsZW5jb2RlZFxuICogICAgICAgcmVxdWVzdC5wb3N0KCcvdXNlcicpXG4gKiAgICAgICAgIC50eXBlKCdmb3JtJylcbiAqICAgICAgICAgLnNlbmQoJ25hbWU9dGonKVxuICogICAgICAgICAuZW5kKGNhbGxiYWNrKVxuICpcbiAqICAgICAgIC8vIGF1dG8geC13d3ctZm9ybS11cmxlbmNvZGVkXG4gKiAgICAgICByZXF1ZXN0LnBvc3QoJy91c2VyJylcbiAqICAgICAgICAgLnR5cGUoJ2Zvcm0nKVxuICogICAgICAgICAuc2VuZCh7IG5hbWU6ICd0aicgfSlcbiAqICAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiAgICAgICAvLyBkZWZhdWx0cyB0byB4LXd3dy1mb3JtLXVybGVuY29kZWRcbiAgKiAgICAgIHJlcXVlc3QucG9zdCgnL3VzZXInKVxuICAqICAgICAgICAuc2VuZCgnbmFtZT10b2JpJylcbiAgKiAgICAgICAgLnNlbmQoJ3NwZWNpZXM9ZmVycmV0JylcbiAgKiAgICAgICAgLmVuZChjYWxsYmFjaylcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IGRhdGFcbiAqIEByZXR1cm4ge1JlcXVlc3R9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24oZGF0YSl7XG4gIHZhciBvYmogPSBpc09iamVjdChkYXRhKTtcbiAgdmFyIHR5cGUgPSB0aGlzLmdldEhlYWRlcignQ29udGVudC1UeXBlJyk7XG5cbiAgLy8gbWVyZ2VcbiAgaWYgKG9iaiAmJiBpc09iamVjdCh0aGlzLl9kYXRhKSkge1xuICAgIGZvciAodmFyIGtleSBpbiBkYXRhKSB7XG4gICAgICB0aGlzLl9kYXRhW2tleV0gPSBkYXRhW2tleV07XG4gICAgfVxuICB9IGVsc2UgaWYgKCdzdHJpbmcnID09IHR5cGVvZiBkYXRhKSB7XG4gICAgaWYgKCF0eXBlKSB0aGlzLnR5cGUoJ2Zvcm0nKTtcbiAgICB0eXBlID0gdGhpcy5nZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScpO1xuICAgIGlmICgnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyA9PSB0eXBlKSB7XG4gICAgICB0aGlzLl9kYXRhID0gdGhpcy5fZGF0YVxuICAgICAgICA/IHRoaXMuX2RhdGEgKyAnJicgKyBkYXRhXG4gICAgICAgIDogZGF0YTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZGF0YSA9ICh0aGlzLl9kYXRhIHx8ICcnKSArIGRhdGE7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRoaXMuX2RhdGEgPSBkYXRhO1xuICB9XG5cbiAgaWYgKCFvYmogfHwgaXNIb3N0KGRhdGEpKSByZXR1cm4gdGhpcztcbiAgaWYgKCF0eXBlKSB0aGlzLnR5cGUoJ2pzb24nKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEludm9rZSB0aGUgY2FsbGJhY2sgd2l0aCBgZXJyYCBhbmQgYHJlc2BcbiAqIGFuZCBoYW5kbGUgYXJpdHkgY2hlY2suXG4gKlxuICogQHBhcmFtIHtFcnJvcn0gZXJyXG4gKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmNhbGxiYWNrID0gZnVuY3Rpb24oZXJyLCByZXMpe1xuICB2YXIgZm4gPSB0aGlzLl9jYWxsYmFjaztcbiAgdGhpcy5jbGVhclRpbWVvdXQoKTtcbiAgZm4oZXJyLCByZXMpO1xufTtcblxuLyoqXG4gKiBJbnZva2UgY2FsbGJhY2sgd2l0aCB4LWRvbWFpbiBlcnJvci5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5jcm9zc0RvbWFpbkVycm9yID0gZnVuY3Rpb24oKXtcbiAgdmFyIGVyciA9IG5ldyBFcnJvcignT3JpZ2luIGlzIG5vdCBhbGxvd2VkIGJ5IEFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicpO1xuICBlcnIuY3Jvc3NEb21haW4gPSB0cnVlO1xuICB0aGlzLmNhbGxiYWNrKGVycik7XG59O1xuXG4vKipcbiAqIEludm9rZSBjYWxsYmFjayB3aXRoIHRpbWVvdXQgZXJyb3IuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUudGltZW91dEVycm9yID0gZnVuY3Rpb24oKXtcbiAgdmFyIHRpbWVvdXQgPSB0aGlzLl90aW1lb3V0O1xuICB2YXIgZXJyID0gbmV3IEVycm9yKCd0aW1lb3V0IG9mICcgKyB0aW1lb3V0ICsgJ21zIGV4Y2VlZGVkJyk7XG4gIGVyci50aW1lb3V0ID0gdGltZW91dDtcbiAgdGhpcy5jYWxsYmFjayhlcnIpO1xufTtcblxuLyoqXG4gKiBFbmFibGUgdHJhbnNtaXNzaW9uIG9mIGNvb2tpZXMgd2l0aCB4LWRvbWFpbiByZXF1ZXN0cy5cbiAqXG4gKiBOb3RlIHRoYXQgZm9yIHRoaXMgdG8gd29yayB0aGUgb3JpZ2luIG11c3Qgbm90IGJlXG4gKiB1c2luZyBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiIHdpdGggYSB3aWxkY2FyZCxcbiAqIGFuZCBhbHNvIG11c3Qgc2V0IFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHNcIlxuICogdG8gXCJ0cnVlXCIuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS53aXRoQ3JlZGVudGlhbHMgPSBmdW5jdGlvbigpe1xuICB0aGlzLl93aXRoQ3JlZGVudGlhbHMgPSB0cnVlO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogSW5pdGlhdGUgcmVxdWVzdCwgaW52b2tpbmcgY2FsbGJhY2sgYGZuKHJlcylgXG4gKiB3aXRoIGFuIGluc3RhbmNlb2YgYFJlc3BvbnNlYC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH0gZm9yIGNoYWluaW5nXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmVuZCA9IGZ1bmN0aW9uKGZuKXtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgeGhyID0gdGhpcy54aHIgPSByZXF1ZXN0LmdldFhIUigpO1xuICB2YXIgcXVlcnkgPSB0aGlzLl9xdWVyeS5qb2luKCcmJyk7XG4gIHZhciB0aW1lb3V0ID0gdGhpcy5fdGltZW91dDtcbiAgdmFyIGRhdGEgPSB0aGlzLl9mb3JtRGF0YSB8fCB0aGlzLl9kYXRhO1xuXG4gIC8vIHN0b3JlIGNhbGxiYWNrXG4gIHRoaXMuX2NhbGxiYWNrID0gZm4gfHwgbm9vcDtcblxuICAvLyBzdGF0ZSBjaGFuZ2VcbiAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uKCl7XG4gICAgaWYgKDQgIT0geGhyLnJlYWR5U3RhdGUpIHJldHVybjtcblxuICAgIC8vIEluIElFOSwgcmVhZHMgdG8gYW55IHByb3BlcnR5IChlLmcuIHN0YXR1cykgb2ZmIG9mIGFuIGFib3J0ZWQgWEhSIHdpbGxcbiAgICAvLyByZXN1bHQgaW4gdGhlIGVycm9yIFwiQ291bGQgbm90IGNvbXBsZXRlIHRoZSBvcGVyYXRpb24gZHVlIHRvIGVycm9yIGMwMGMwMjNmXCJcbiAgICB2YXIgc3RhdHVzO1xuICAgIHRyeSB7IHN0YXR1cyA9IHhoci5zdGF0dXMgfSBjYXRjaChlKSB7IHN0YXR1cyA9IDA7IH1cblxuICAgIGlmICgwID09IHN0YXR1cykge1xuICAgICAgaWYgKHNlbGYudGltZWRvdXQpIHJldHVybiBzZWxmLnRpbWVvdXRFcnJvcigpO1xuICAgICAgaWYgKHNlbGYuYWJvcnRlZCkgcmV0dXJuO1xuICAgICAgcmV0dXJuIHNlbGYuY3Jvc3NEb21haW5FcnJvcigpO1xuICAgIH1cbiAgICBzZWxmLmVtaXQoJ2VuZCcpO1xuICB9O1xuXG4gIC8vIHByb2dyZXNzXG4gIHZhciBoYW5kbGVQcm9ncmVzcyA9IGZ1bmN0aW9uKGUpe1xuICAgIGlmIChlLnRvdGFsID4gMCkge1xuICAgICAgZS5wZXJjZW50ID0gZS5sb2FkZWQgLyBlLnRvdGFsICogMTAwO1xuICAgIH1cbiAgICBzZWxmLmVtaXQoJ3Byb2dyZXNzJywgZSk7XG4gIH07XG4gIGlmICh0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xuICAgIHhoci5vbnByb2dyZXNzID0gaGFuZGxlUHJvZ3Jlc3M7XG4gIH1cbiAgdHJ5IHtcbiAgICBpZiAoeGhyLnVwbG9hZCAmJiB0aGlzLmhhc0xpc3RlbmVycygncHJvZ3Jlc3MnKSkge1xuICAgICAgeGhyLnVwbG9hZC5vbnByb2dyZXNzID0gaGFuZGxlUHJvZ3Jlc3M7XG4gICAgfVxuICB9IGNhdGNoKGUpIHtcbiAgICAvLyBBY2Nlc3NpbmcgeGhyLnVwbG9hZCBmYWlscyBpbiBJRSBmcm9tIGEgd2ViIHdvcmtlciwgc28ganVzdCBwcmV0ZW5kIGl0IGRvZXNuJ3QgZXhpc3QuXG4gICAgLy8gUmVwb3J0ZWQgaGVyZTpcbiAgICAvLyBodHRwczovL2Nvbm5lY3QubWljcm9zb2Z0LmNvbS9JRS9mZWVkYmFjay9kZXRhaWxzLzgzNzI0NS94bWxodHRwcmVxdWVzdC11cGxvYWQtdGhyb3dzLWludmFsaWQtYXJndW1lbnQtd2hlbi11c2VkLWZyb20td2ViLXdvcmtlci1jb250ZXh0XG4gIH1cblxuICAvLyB0aW1lb3V0XG4gIGlmICh0aW1lb3V0ICYmICF0aGlzLl90aW1lcikge1xuICAgIHRoaXMuX3RpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgc2VsZi50aW1lZG91dCA9IHRydWU7XG4gICAgICBzZWxmLmFib3J0KCk7XG4gICAgfSwgdGltZW91dCk7XG4gIH1cblxuICAvLyBxdWVyeXN0cmluZ1xuICBpZiAocXVlcnkpIHtcbiAgICBxdWVyeSA9IHJlcXVlc3Quc2VyaWFsaXplT2JqZWN0KHF1ZXJ5KTtcbiAgICB0aGlzLnVybCArPSB+dGhpcy51cmwuaW5kZXhPZignPycpXG4gICAgICA/ICcmJyArIHF1ZXJ5XG4gICAgICA6ICc/JyArIHF1ZXJ5O1xuICB9XG5cbiAgLy8gaW5pdGlhdGUgcmVxdWVzdFxuICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmwsIHRydWUpO1xuXG4gIC8vIENPUlNcbiAgaWYgKHRoaXMuX3dpdGhDcmVkZW50aWFscykgeGhyLndpdGhDcmVkZW50aWFscyA9IHRydWU7XG5cbiAgLy8gYm9keVxuICBpZiAoJ0dFVCcgIT0gdGhpcy5tZXRob2QgJiYgJ0hFQUQnICE9IHRoaXMubWV0aG9kICYmICdzdHJpbmcnICE9IHR5cGVvZiBkYXRhICYmICFpc0hvc3QoZGF0YSkpIHtcbiAgICAvLyBzZXJpYWxpemUgc3R1ZmZcbiAgICB2YXIgc2VyaWFsaXplID0gcmVxdWVzdC5zZXJpYWxpemVbdGhpcy5nZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScpXTtcbiAgICBpZiAoc2VyaWFsaXplKSBkYXRhID0gc2VyaWFsaXplKGRhdGEpO1xuICB9XG5cbiAgLy8gc2V0IGhlYWRlciBmaWVsZHNcbiAgZm9yICh2YXIgZmllbGQgaW4gdGhpcy5oZWFkZXIpIHtcbiAgICBpZiAobnVsbCA9PSB0aGlzLmhlYWRlcltmaWVsZF0pIGNvbnRpbnVlO1xuICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGZpZWxkLCB0aGlzLmhlYWRlcltmaWVsZF0pO1xuICB9XG5cbiAgLy8gc2VuZCBzdHVmZlxuICB0aGlzLmVtaXQoJ3JlcXVlc3QnLCB0aGlzKTtcbiAgeGhyLnNlbmQoZGF0YSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBFeHBvc2UgYFJlcXVlc3RgLlxuICovXG5cbnJlcXVlc3QuUmVxdWVzdCA9IFJlcXVlc3Q7XG5cbi8qKlxuICogSXNzdWUgYSByZXF1ZXN0OlxuICpcbiAqIEV4YW1wbGVzOlxuICpcbiAqICAgIHJlcXVlc3QoJ0dFVCcsICcvdXNlcnMnKS5lbmQoY2FsbGJhY2spXG4gKiAgICByZXF1ZXN0KCcvdXNlcnMnKS5lbmQoY2FsbGJhY2spXG4gKiAgICByZXF1ZXN0KCcvdXNlcnMnLCBjYWxsYmFjaylcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kXG4gKiBAcGFyYW0ge1N0cmluZ3xGdW5jdGlvbn0gdXJsIG9yIGNhbGxiYWNrXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiByZXF1ZXN0KG1ldGhvZCwgdXJsKSB7XG4gIC8vIGNhbGxiYWNrXG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiB1cmwpIHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3QoJ0dFVCcsIG1ldGhvZCkuZW5kKHVybCk7XG4gIH1cblxuICAvLyB1cmwgZmlyc3RcbiAgaWYgKDEgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdCgnR0VUJywgbWV0aG9kKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgUmVxdWVzdChtZXRob2QsIHVybCk7XG59XG5cbi8qKlxuICogR0VUIGB1cmxgIHdpdGggb3B0aW9uYWwgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR8RnVuY3Rpb259IGRhdGEgb3IgZm5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LmdldCA9IGZ1bmN0aW9uKHVybCwgZGF0YSwgZm4pe1xuICB2YXIgcmVxID0gcmVxdWVzdCgnR0VUJywgdXJsKTtcbiAgaWYgKCdmdW5jdGlvbicgPT0gdHlwZW9mIGRhdGEpIGZuID0gZGF0YSwgZGF0YSA9IG51bGw7XG4gIGlmIChkYXRhKSByZXEucXVlcnkoZGF0YSk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG4vKipcbiAqIEhFQUQgYHVybGAgd2l0aCBvcHRpb25hbCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZHxGdW5jdGlvbn0gZGF0YSBvciBmblxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QuaGVhZCA9IGZ1bmN0aW9uKHVybCwgZGF0YSwgZm4pe1xuICB2YXIgcmVxID0gcmVxdWVzdCgnSEVBRCcsIHVybCk7XG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiBkYXRhKSBmbiA9IGRhdGEsIGRhdGEgPSBudWxsO1xuICBpZiAoZGF0YSkgcmVxLnNlbmQoZGF0YSk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG4vKipcbiAqIERFTEVURSBgdXJsYCB3aXRoIG9wdGlvbmFsIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5kZWwgPSBmdW5jdGlvbih1cmwsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ0RFTEVURScsIHVybCk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG4vKipcbiAqIFBBVENIIGB1cmxgIHdpdGggb3B0aW9uYWwgYGRhdGFgIGFuZCBjYWxsYmFjayBgZm4ocmVzKWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtNaXhlZH0gZGF0YVxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge1JlcXVlc3R9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbnJlcXVlc3QucGF0Y2ggPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ1BBVENIJywgdXJsKTtcbiAgaWYgKCdmdW5jdGlvbicgPT0gdHlwZW9mIGRhdGEpIGZuID0gZGF0YSwgZGF0YSA9IG51bGw7XG4gIGlmIChkYXRhKSByZXEuc2VuZChkYXRhKTtcbiAgaWYgKGZuKSByZXEuZW5kKGZuKTtcbiAgcmV0dXJuIHJlcTtcbn07XG5cbi8qKlxuICogUE9TVCBgdXJsYCB3aXRoIG9wdGlvbmFsIGBkYXRhYCBhbmQgY2FsbGJhY2sgYGZuKHJlcylgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmxcbiAqIEBwYXJhbSB7TWl4ZWR9IGRhdGFcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtSZXF1ZXN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5yZXF1ZXN0LnBvc3QgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ1BPU1QnLCB1cmwpO1xuICBpZiAoJ2Z1bmN0aW9uJyA9PSB0eXBlb2YgZGF0YSkgZm4gPSBkYXRhLCBkYXRhID0gbnVsbDtcbiAgaWYgKGRhdGEpIHJlcS5zZW5kKGRhdGEpO1xuICBpZiAoZm4pIHJlcS5lbmQoZm4pO1xuICByZXR1cm4gcmVxO1xufTtcblxuLyoqXG4gKiBQVVQgYHVybGAgd2l0aCBvcHRpb25hbCBgZGF0YWAgYW5kIGNhbGxiYWNrIGBmbihyZXMpYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsXG4gKiBAcGFyYW0ge01peGVkfEZ1bmN0aW9ufSBkYXRhIG9yIGZuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7UmVxdWVzdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxucmVxdWVzdC5wdXQgPSBmdW5jdGlvbih1cmwsIGRhdGEsIGZuKXtcbiAgdmFyIHJlcSA9IHJlcXVlc3QoJ1BVVCcsIHVybCk7XG4gIGlmICgnZnVuY3Rpb24nID09IHR5cGVvZiBkYXRhKSBmbiA9IGRhdGEsIGRhdGEgPSBudWxsO1xuICBpZiAoZGF0YSkgcmVxLnNlbmQoZGF0YSk7XG4gIGlmIChmbikgcmVxLmVuZChmbik7XG4gIHJldHVybiByZXE7XG59O1xuXG4vKipcbiAqIEV4cG9zZSBgcmVxdWVzdGAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSByZXF1ZXN0O1xuIiwiXG4vKipcbiAqIEV4cG9zZSBgRW1pdHRlcmAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBFbWl0dGVyO1xuXG4vKipcbiAqIEluaXRpYWxpemUgYSBuZXcgYEVtaXR0ZXJgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gRW1pdHRlcihvYmopIHtcbiAgaWYgKG9iaikgcmV0dXJuIG1peGluKG9iaik7XG59O1xuXG4vKipcbiAqIE1peGluIHRoZSBlbWl0dGVyIHByb3BlcnRpZXMuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbWl4aW4ob2JqKSB7XG4gIGZvciAodmFyIGtleSBpbiBFbWl0dGVyLnByb3RvdHlwZSkge1xuICAgIG9ialtrZXldID0gRW1pdHRlci5wcm90b3R5cGVba2V5XTtcbiAgfVxuICByZXR1cm4gb2JqO1xufVxuXG4vKipcbiAqIExpc3RlbiBvbiB0aGUgZ2l2ZW4gYGV2ZW50YCB3aXRoIGBmbmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub24gPVxuRW1pdHRlci5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgKHRoaXMuX2NhbGxiYWNrc1tldmVudF0gPSB0aGlzLl9jYWxsYmFja3NbZXZlbnRdIHx8IFtdKVxuICAgIC5wdXNoKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFkZHMgYW4gYGV2ZW50YCBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgaW52b2tlZCBhIHNpbmdsZVxuICogdGltZSB0aGVuIGF1dG9tYXRpY2FsbHkgcmVtb3ZlZC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG5cbiAgZnVuY3Rpb24gb24oKSB7XG4gICAgc2VsZi5vZmYoZXZlbnQsIG9uKTtcbiAgICBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9XG5cbiAgb24uZm4gPSBmbjtcbiAgdGhpcy5vbihldmVudCwgb24pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUmVtb3ZlIHRoZSBnaXZlbiBjYWxsYmFjayBmb3IgYGV2ZW50YCBvciBhbGxcbiAqIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9mZiA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcblxuICAvLyBhbGxcbiAgaWYgKDAgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xuICAgIHRoaXMuX2NhbGxiYWNrcyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gc3BlY2lmaWMgZXZlbnRcbiAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1tldmVudF07XG4gIGlmICghY2FsbGJhY2tzKSByZXR1cm4gdGhpcztcblxuICAvLyByZW1vdmUgYWxsIGhhbmRsZXJzXG4gIGlmICgxID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzW2V2ZW50XTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHJlbW92ZSBzcGVjaWZpYyBoYW5kbGVyXG4gIHZhciBjYjtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBjYWxsYmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICBjYiA9IGNhbGxiYWNrc1tpXTtcbiAgICBpZiAoY2IgPT09IGZuIHx8IGNiLmZuID09PSBmbikge1xuICAgICAgY2FsbGJhY2tzLnNwbGljZShpLCAxKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogRW1pdCBgZXZlbnRgIHdpdGggdGhlIGdpdmVuIGFyZ3MuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge01peGVkfSAuLi5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuICB2YXIgYXJncyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICwgY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzW2V2ZW50XTtcblxuICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgY2FsbGJhY2tzID0gY2FsbGJhY2tzLnNsaWNlKDApO1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBjYWxsYmFja3MubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgIGNhbGxiYWNrc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUmV0dXJuIGFycmF5IG9mIGNhbGxiYWNrcyBmb3IgYGV2ZW50YC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEByZXR1cm4ge0FycmF5fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbihldmVudCl7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgcmV0dXJuIHRoaXMuX2NhbGxiYWNrc1tldmVudF0gfHwgW107XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIHRoaXMgZW1pdHRlciBoYXMgYGV2ZW50YCBoYW5kbGVycy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmhhc0xpc3RlbmVycyA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgcmV0dXJuICEhIHRoaXMubGlzdGVuZXJzKGV2ZW50KS5sZW5ndGg7XG59O1xuIiwiXG4vKipcbiAqIFJlZHVjZSBgYXJyYCB3aXRoIGBmbmAuXG4gKlxuICogQHBhcmFtIHtBcnJheX0gYXJyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHBhcmFtIHtNaXhlZH0gaW5pdGlhbFxuICpcbiAqIFRPRE86IGNvbWJhdGlibGUgZXJyb3IgaGFuZGxpbmc/XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihhcnIsIGZuLCBpbml0aWFsKXsgIFxuICB2YXIgaWR4ID0gMDtcbiAgdmFyIGxlbiA9IGFyci5sZW5ndGg7XG4gIHZhciBjdXJyID0gYXJndW1lbnRzLmxlbmd0aCA9PSAzXG4gICAgPyBpbml0aWFsXG4gICAgOiBhcnJbaWR4KytdO1xuXG4gIHdoaWxlIChpZHggPCBsZW4pIHtcbiAgICBjdXJyID0gZm4uY2FsbChudWxsLCBjdXJyLCBhcnJbaWR4XSwgKytpZHgsIGFycik7XG4gIH1cbiAgXG4gIHJldHVybiBjdXJyO1xufTsiLCJ2YXIgdHJhdmVyc2UgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcbiAgICByZXR1cm4gbmV3IFRyYXZlcnNlKG9iaik7XG59O1xuXG5mdW5jdGlvbiBUcmF2ZXJzZSAob2JqKSB7XG4gICAgdGhpcy52YWx1ZSA9IG9iajtcbn1cblxuVHJhdmVyc2UucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChwcykge1xuICAgIHZhciBub2RlID0gdGhpcy52YWx1ZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBzLmxlbmd0aDsgaSArKykge1xuICAgICAgICB2YXIga2V5ID0gcHNbaV07XG4gICAgICAgIGlmICghbm9kZSB8fCAhaGFzT3duUHJvcGVydHkuY2FsbChub2RlLCBrZXkpKSB7XG4gICAgICAgICAgICBub2RlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgbm9kZSA9IG5vZGVba2V5XTtcbiAgICB9XG4gICAgcmV0dXJuIG5vZGU7XG59O1xuXG5UcmF2ZXJzZS5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24gKHBzKSB7XG4gICAgdmFyIG5vZGUgPSB0aGlzLnZhbHVlO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHMubGVuZ3RoOyBpICsrKSB7XG4gICAgICAgIHZhciBrZXkgPSBwc1tpXTtcbiAgICAgICAgaWYgKCFub2RlIHx8ICFoYXNPd25Qcm9wZXJ0eS5jYWxsKG5vZGUsIGtleSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBub2RlID0gbm9kZVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAocHMsIHZhbHVlKSB7XG4gICAgdmFyIG5vZGUgPSB0aGlzLnZhbHVlO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHMubGVuZ3RoIC0gMTsgaSArKykge1xuICAgICAgICB2YXIga2V5ID0gcHNbaV07XG4gICAgICAgIGlmICghaGFzT3duUHJvcGVydHkuY2FsbChub2RlLCBrZXkpKSBub2RlW2tleV0gPSB7fTtcbiAgICAgICAgbm9kZSA9IG5vZGVba2V5XTtcbiAgICB9XG4gICAgbm9kZVtwc1tpXV0gPSB2YWx1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG59O1xuXG5UcmF2ZXJzZS5wcm90b3R5cGUubWFwID0gZnVuY3Rpb24gKGNiKSB7XG4gICAgcmV0dXJuIHdhbGsodGhpcy52YWx1ZSwgY2IsIHRydWUpO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLmZvckVhY2ggPSBmdW5jdGlvbiAoY2IpIHtcbiAgICB0aGlzLnZhbHVlID0gd2Fsayh0aGlzLnZhbHVlLCBjYiwgZmFsc2UpO1xuICAgIHJldHVybiB0aGlzLnZhbHVlO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLnJlZHVjZSA9IGZ1bmN0aW9uIChjYiwgaW5pdCkge1xuICAgIHZhciBza2lwID0gYXJndW1lbnRzLmxlbmd0aCA9PT0gMTtcbiAgICB2YXIgYWNjID0gc2tpcCA/IHRoaXMudmFsdWUgOiBpbml0O1xuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbiAoeCkge1xuICAgICAgICBpZiAoIXRoaXMuaXNSb290IHx8ICFza2lwKSB7XG4gICAgICAgICAgICBhY2MgPSBjYi5jYWxsKHRoaXMsIGFjYywgeCk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gYWNjO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLnBhdGhzID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBhY2MgPSBbXTtcbiAgICB0aGlzLmZvckVhY2goZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgYWNjLnB1c2godGhpcy5wYXRoKTsgXG4gICAgfSk7XG4gICAgcmV0dXJuIGFjYztcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5ub2RlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgYWNjID0gW107XG4gICAgdGhpcy5mb3JFYWNoKGZ1bmN0aW9uICh4KSB7XG4gICAgICAgIGFjYy5wdXNoKHRoaXMubm9kZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGFjYztcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcGFyZW50cyA9IFtdLCBub2RlcyA9IFtdO1xuICAgIFxuICAgIHJldHVybiAoZnVuY3Rpb24gY2xvbmUgKHNyYykge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChwYXJlbnRzW2ldID09PSBzcmMpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbm9kZXNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmICh0eXBlb2Ygc3JjID09PSAnb2JqZWN0JyAmJiBzcmMgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHZhciBkc3QgPSBjb3B5KHNyYyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHBhcmVudHMucHVzaChzcmMpO1xuICAgICAgICAgICAgbm9kZXMucHVzaChkc3QpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBmb3JFYWNoKG9iamVjdEtleXMoc3JjKSwgZnVuY3Rpb24gKGtleSkge1xuICAgICAgICAgICAgICAgIGRzdFtrZXldID0gY2xvbmUoc3JjW2tleV0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHBhcmVudHMucG9wKCk7XG4gICAgICAgICAgICBub2Rlcy5wb3AoKTtcbiAgICAgICAgICAgIHJldHVybiBkc3Q7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gc3JjO1xuICAgICAgICB9XG4gICAgfSkodGhpcy52YWx1ZSk7XG59O1xuXG5mdW5jdGlvbiB3YWxrIChyb290LCBjYiwgaW1tdXRhYmxlKSB7XG4gICAgdmFyIHBhdGggPSBbXTtcbiAgICB2YXIgcGFyZW50cyA9IFtdO1xuICAgIHZhciBhbGl2ZSA9IHRydWU7XG4gICAgXG4gICAgcmV0dXJuIChmdW5jdGlvbiB3YWxrZXIgKG5vZGVfKSB7XG4gICAgICAgIHZhciBub2RlID0gaW1tdXRhYmxlID8gY29weShub2RlXykgOiBub2RlXztcbiAgICAgICAgdmFyIG1vZGlmaWVycyA9IHt9O1xuICAgICAgICBcbiAgICAgICAgdmFyIGtlZXBHb2luZyA9IHRydWU7XG4gICAgICAgIFxuICAgICAgICB2YXIgc3RhdGUgPSB7XG4gICAgICAgICAgICBub2RlIDogbm9kZSxcbiAgICAgICAgICAgIG5vZGVfIDogbm9kZV8sXG4gICAgICAgICAgICBwYXRoIDogW10uY29uY2F0KHBhdGgpLFxuICAgICAgICAgICAgcGFyZW50IDogcGFyZW50c1twYXJlbnRzLmxlbmd0aCAtIDFdLFxuICAgICAgICAgICAgcGFyZW50cyA6IHBhcmVudHMsXG4gICAgICAgICAgICBrZXkgOiBwYXRoLnNsaWNlKC0xKVswXSxcbiAgICAgICAgICAgIGlzUm9vdCA6IHBhdGgubGVuZ3RoID09PSAwLFxuICAgICAgICAgICAgbGV2ZWwgOiBwYXRoLmxlbmd0aCxcbiAgICAgICAgICAgIGNpcmN1bGFyIDogbnVsbCxcbiAgICAgICAgICAgIHVwZGF0ZSA6IGZ1bmN0aW9uICh4LCBzdG9wSGVyZSkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUuaXNSb290KSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnBhcmVudC5ub2RlW3N0YXRlLmtleV0gPSB4O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzdGF0ZS5ub2RlID0geDtcbiAgICAgICAgICAgICAgICBpZiAoc3RvcEhlcmUpIGtlZXBHb2luZyA9IGZhbHNlO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdkZWxldGUnIDogZnVuY3Rpb24gKHN0b3BIZXJlKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHN0YXRlLnBhcmVudC5ub2RlW3N0YXRlLmtleV07XG4gICAgICAgICAgICAgICAgaWYgKHN0b3BIZXJlKSBrZWVwR29pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZW1vdmUgOiBmdW5jdGlvbiAoc3RvcEhlcmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShzdGF0ZS5wYXJlbnQubm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUucGFyZW50Lm5vZGUuc3BsaWNlKHN0YXRlLmtleSwgMSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgc3RhdGUucGFyZW50Lm5vZGVbc3RhdGUua2V5XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHN0b3BIZXJlKSBrZWVwR29pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBrZXlzIDogbnVsbCxcbiAgICAgICAgICAgIGJlZm9yZSA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5iZWZvcmUgPSBmIH0sXG4gICAgICAgICAgICBhZnRlciA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5hZnRlciA9IGYgfSxcbiAgICAgICAgICAgIHByZSA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5wcmUgPSBmIH0sXG4gICAgICAgICAgICBwb3N0IDogZnVuY3Rpb24gKGYpIHsgbW9kaWZpZXJzLnBvc3QgPSBmIH0sXG4gICAgICAgICAgICBzdG9wIDogZnVuY3Rpb24gKCkgeyBhbGl2ZSA9IGZhbHNlIH0sXG4gICAgICAgICAgICBibG9jayA6IGZ1bmN0aW9uICgpIHsga2VlcEdvaW5nID0gZmFsc2UgfVxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgaWYgKCFhbGl2ZSkgcmV0dXJuIHN0YXRlO1xuICAgICAgICBcbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlU3RhdGUoKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHN0YXRlLm5vZGUgPT09ICdvYmplY3QnICYmIHN0YXRlLm5vZGUgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLmtleXMgfHwgc3RhdGUubm9kZV8gIT09IHN0YXRlLm5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUua2V5cyA9IG9iamVjdEtleXMoc3RhdGUubm9kZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc3RhdGUuaXNMZWFmID0gc3RhdGUua2V5cy5sZW5ndGggPT0gMDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudHNbaV0ubm9kZV8gPT09IG5vZGVfKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5jaXJjdWxhciA9IHBhcmVudHNbaV07XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXRlLmlzTGVhZiA9IHRydWU7XG4gICAgICAgICAgICAgICAgc3RhdGUua2V5cyA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHN0YXRlLm5vdExlYWYgPSAhc3RhdGUuaXNMZWFmO1xuICAgICAgICAgICAgc3RhdGUubm90Um9vdCA9ICFzdGF0ZS5pc1Jvb3Q7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHVwZGF0ZVN0YXRlKCk7XG4gICAgICAgIFxuICAgICAgICAvLyB1c2UgcmV0dXJuIHZhbHVlcyB0byB1cGRhdGUgaWYgZGVmaW5lZFxuICAgICAgICB2YXIgcmV0ID0gY2IuY2FsbChzdGF0ZSwgc3RhdGUubm9kZSk7XG4gICAgICAgIGlmIChyZXQgIT09IHVuZGVmaW5lZCAmJiBzdGF0ZS51cGRhdGUpIHN0YXRlLnVwZGF0ZShyZXQpO1xuICAgICAgICBcbiAgICAgICAgaWYgKG1vZGlmaWVycy5iZWZvcmUpIG1vZGlmaWVycy5iZWZvcmUuY2FsbChzdGF0ZSwgc3RhdGUubm9kZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIWtlZXBHb2luZykgcmV0dXJuIHN0YXRlO1xuICAgICAgICBcbiAgICAgICAgaWYgKHR5cGVvZiBzdGF0ZS5ub2RlID09ICdvYmplY3QnXG4gICAgICAgICYmIHN0YXRlLm5vZGUgIT09IG51bGwgJiYgIXN0YXRlLmNpcmN1bGFyKSB7XG4gICAgICAgICAgICBwYXJlbnRzLnB1c2goc3RhdGUpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB1cGRhdGVTdGF0ZSgpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBmb3JFYWNoKHN0YXRlLmtleXMsIGZ1bmN0aW9uIChrZXksIGkpIHtcbiAgICAgICAgICAgICAgICBwYXRoLnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobW9kaWZpZXJzLnByZSkgbW9kaWZpZXJzLnByZS5jYWxsKHN0YXRlLCBzdGF0ZS5ub2RlW2tleV0sIGtleSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkID0gd2Fsa2VyKHN0YXRlLm5vZGVba2V5XSk7XG4gICAgICAgICAgICAgICAgaWYgKGltbXV0YWJsZSAmJiBoYXNPd25Qcm9wZXJ0eS5jYWxsKHN0YXRlLm5vZGUsIGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubm9kZVtrZXldID0gY2hpbGQubm9kZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY2hpbGQuaXNMYXN0ID0gaSA9PSBzdGF0ZS5rZXlzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICAgICAgY2hpbGQuaXNGaXJzdCA9IGkgPT0gMDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobW9kaWZpZXJzLnBvc3QpIG1vZGlmaWVycy5wb3N0LmNhbGwoc3RhdGUsIGNoaWxkKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBwYXRoLnBvcCgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwYXJlbnRzLnBvcCgpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAobW9kaWZpZXJzLmFmdGVyKSBtb2RpZmllcnMuYWZ0ZXIuY2FsbChzdGF0ZSwgc3RhdGUubm9kZSk7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgfSkocm9vdCkubm9kZTtcbn1cblxuZnVuY3Rpb24gY29weSAoc3JjKSB7XG4gICAgaWYgKHR5cGVvZiBzcmMgPT09ICdvYmplY3QnICYmIHNyYyAhPT0gbnVsbCkge1xuICAgICAgICB2YXIgZHN0O1xuICAgICAgICBcbiAgICAgICAgaWYgKGlzQXJyYXkoc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0gW107XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoaXNEYXRlKHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IG5ldyBEYXRlKHNyYy5nZXRUaW1lID8gc3JjLmdldFRpbWUoKSA6IHNyYyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoaXNSZWdFeHAoc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0gbmV3IFJlZ0V4cChzcmMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzRXJyb3Ioc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0geyBtZXNzYWdlOiBzcmMubWVzc2FnZSB9O1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzQm9vbGVhbihzcmMpKSB7XG4gICAgICAgICAgICBkc3QgPSBuZXcgQm9vbGVhbihzcmMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzTnVtYmVyKHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IG5ldyBOdW1iZXIoc3JjKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc1N0cmluZyhzcmMpKSB7XG4gICAgICAgICAgICBkc3QgPSBuZXcgU3RyaW5nKHNyYyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoT2JqZWN0LmNyZWF0ZSAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YpIHtcbiAgICAgICAgICAgIGRzdCA9IE9iamVjdC5jcmVhdGUoT2JqZWN0LmdldFByb3RvdHlwZU9mKHNyYykpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHNyYy5jb25zdHJ1Y3RvciA9PT0gT2JqZWN0KSB7XG4gICAgICAgICAgICBkc3QgPSB7fTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHZhciBwcm90byA9XG4gICAgICAgICAgICAgICAgKHNyYy5jb25zdHJ1Y3RvciAmJiBzcmMuY29uc3RydWN0b3IucHJvdG90eXBlKVxuICAgICAgICAgICAgICAgIHx8IHNyYy5fX3Byb3RvX19cbiAgICAgICAgICAgICAgICB8fCB7fVxuICAgICAgICAgICAgO1xuICAgICAgICAgICAgdmFyIFQgPSBmdW5jdGlvbiAoKSB7fTtcbiAgICAgICAgICAgIFQucHJvdG90eXBlID0gcHJvdG87XG4gICAgICAgICAgICBkc3QgPSBuZXcgVDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgZm9yRWFjaChvYmplY3RLZXlzKHNyYyksIGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgICAgIGRzdFtrZXldID0gc3JjW2tleV07XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gZHN0O1xuICAgIH1cbiAgICBlbHNlIHJldHVybiBzcmM7XG59XG5cbnZhciBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24ga2V5cyAob2JqKSB7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBvYmopIHJlcy5wdXNoKGtleSlcbiAgICByZXR1cm4gcmVzO1xufTtcblxuZnVuY3Rpb24gdG9TIChvYmopIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopIH1cbmZ1bmN0aW9uIGlzRGF0ZSAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgRGF0ZV0nIH1cbmZ1bmN0aW9uIGlzUmVnRXhwIChvYmopIHsgcmV0dXJuIHRvUyhvYmopID09PSAnW29iamVjdCBSZWdFeHBdJyB9XG5mdW5jdGlvbiBpc0Vycm9yIChvYmopIHsgcmV0dXJuIHRvUyhvYmopID09PSAnW29iamVjdCBFcnJvcl0nIH1cbmZ1bmN0aW9uIGlzQm9vbGVhbiAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgQm9vbGVhbl0nIH1cbmZ1bmN0aW9uIGlzTnVtYmVyIChvYmopIHsgcmV0dXJuIHRvUyhvYmopID09PSAnW29iamVjdCBOdW1iZXJdJyB9XG5mdW5jdGlvbiBpc1N0cmluZyAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgU3RyaW5nXScgfVxuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gaXNBcnJheSAoeHMpIHtcbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHhzKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5cbnZhciBmb3JFYWNoID0gZnVuY3Rpb24gKHhzLCBmbikge1xuICAgIGlmICh4cy5mb3JFYWNoKSByZXR1cm4geHMuZm9yRWFjaChmbilcbiAgICBlbHNlIGZvciAodmFyIGkgPSAwOyBpIDwgeHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZm4oeHNbaV0sIGksIHhzKTtcbiAgICB9XG59O1xuXG5mb3JFYWNoKG9iamVjdEtleXMoVHJhdmVyc2UucHJvdG90eXBlKSwgZnVuY3Rpb24gKGtleSkge1xuICAgIHRyYXZlcnNlW2tleV0gPSBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHZhciBhcmdzID0gW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgICB2YXIgdCA9IG5ldyBUcmF2ZXJzZShvYmopO1xuICAgICAgICByZXR1cm4gdFtrZXldLmFwcGx5KHQsIGFyZ3MpO1xuICAgIH07XG59KTtcblxudmFyIGhhc093blByb3BlcnR5ID0gT2JqZWN0Lmhhc093blByb3BlcnR5IHx8IGZ1bmN0aW9uIChvYmosIGtleSkge1xuICAgIHJldHVybiBrZXkgaW4gb2JqO1xufTtcbiJdfQ==
