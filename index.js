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

var _ = {
  cloneDeep: require('lodash-compat/lang/cloneDeep'),
  each: require('lodash-compat/collection/each'),
  indexOf: require('lodash-compat/array/indexOf'),
  isArray: require('lodash-compat/lang/isArray'),
  isError: require('lodash-compat/lang/isError'),
  isFunction: require('lodash-compat/lang/isFunction'),
  isNumber: require('lodash-compat/lang/isNumber'),
  isPlainObject: require('lodash-compat/lang/isPlainObject'),
  isString: require('lodash-compat/lang/isString'),
  isUndefined: require('lodash-compat/lang/isUndefined'),
  keys: require('lodash-compat/object/keys'),
  lastIndexOf: require('lodash-compat/array/lastIndexOf'),
  map: require('lodash-compat/collection/map'),
  reduce: require('lodash-compat/collection/reduce'),
  size: require('lodash-compat/collection/size'),
  times: require('lodash-compat/utility/times')
};
var pathLoader = require('path-loader');
var traverse = require('traverse');

var remoteCache = {};
var supportedSchemes = ['file', 'http', 'https'];

function computeUrl (base, ref) {
  var isRelative = ref.charAt(0) !== '#' && ref.indexOf(':') === -1;
  var newLocation = (base || '').charAt(0) === '/' ? [''] : [];
  var refSegments = ref.split('#')[0].split('/');

  function segmentHandler (segment) {
    if (segment === '..') {
      newLocation.pop();
    } else if (segment !== '.' && segment !== '') {
      newLocation.push(segment);
    }
  }

  // Normalize the base
  _.each((base || '').split('#')[0].split('/'), segmentHandler);

  if (isRelative) {
    // Add reference segments
    _.each(refSegments, segmentHandler);
  } else {
    newLocation = refSegments;
  }

  return newLocation.join('/');
}

/**
 * Callback used by all json-refs functions.
 *
 * @param {error} [err] - The error if there is a problem
 * @param {*} [result] - The result of the function
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
 * @param {resultCallback} done - The result callback
 *
 * @throws Error if there is a problem making the request or the content is not JSON
 */
function getRemoteJson (url, options, done) {
  var realUrl = computeUrl(options.location, url);
  var json = remoteCache[realUrl];
  var allTasks;

  if (!_.isUndefined(json)) {
    done(undefined, json);
  } else {
    allTasks = pathLoader.load(realUrl, options);

    if (options.processContent) {
      allTasks = allTasks.then(function (content) {
        return options.processContent(content, realUrl);
      });
    } else {
      allTasks = allTasks.then(JSON.parse);
    }

    allTasks.then(function (nJson) {
      remoteCache[realUrl] = nJson;

      return nJson;
    })
    .then(function (nJson) {
      done(undefined, nJson);
    }, function (err) {
      done(err);
    });
  }
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
    ptr += '/' + _.map(path, function (part) {
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
  return ptr !== '' && _.indexOf(['#'], ptr.charAt(0)) === -1;
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
    if (_.indexOf(rootPaths, ptr) === -1 && ptr.charAt(0) === '#') {
      path = _.reduce(ptr.substring(ptr.indexOf('/')).split('/'), function (parts, part) {
        if (part !== '') {
          parts.push(part.replace(/~0/g, '~').replace(/~1/g, '/'));
        }

        return parts;
      }, []);
    }
  }

  return path;
};

/**
 * Takes a JSON document, resolves all JSON References and returns a fully resolved equivalent.
 *
 * If the document has no JSON References, the passed in document is returned untouched.  If there are references to be
 * resolved, the returned document is cloned and returned fully resolved.  The original document is untouched.
 *
 * @param {object} json - The JSON  document having zero or more JSON References
 * @param {object} [options] - The options (All options are passed down to whitlockjc/path-loader)
 * @param {number} [options.depth] - The depth to resolve circular references
 * @param {string} [options.location] - The location to which relative references should be resolved
 * @param {processContentCallback} [options.processContent] - The callback used to process a reference's content
 * @param {resultCallback} [done] - The result callback
 *
 * @throws Error if the arguments are missing or invalid
 */
module.exports.resolveRefs = function resolveRefs (json, options, done) {
  if (arguments.length < 3) {
    done = arguments[1];
    options = {};
  } else if (_.isUndefined(options)) {
    options = {};
  }

  if (_.isUndefined(json)) {
    throw new Error('json is required');
  } else if (!_.isPlainObject(json)) {
    throw new Error('json must be an object');
  } else if (!_.isPlainObject(options)) {
    throw new Error('options must be an object');
  } else if (_.isUndefined(done)) {
    throw new Error('done is required');
  } else if (!_.isUndefined(done) && !_.isFunction(done)) {
    throw new Error('done must be a function');
  }

  // Validate the options (This option does not apply to )
  if (!_.isUndefined(options.processContent) && !_.isFunction(options.processContent)) {
    throw new Error('options.processContent must be a function');
  } else if (!_.isUndefined(options.location) && !_.isString(options.location)) {
    throw new Error('options.location must be a string');
  } else if (!_.isUndefined(options.depth) && !_.isNumber(options.depth)) {
    throw new Error('options.depth must be a number');
  } else if (!_.isUndefined(options.depth) && options.depth < 0) {
    throw new Error('options.depth must be greater or equal to zero');
  }

  var depth = _.isUndefined(options.depth) ? 1 : options.depth;
  var remoteRefs = {};
  var refs = findRefs(json);
  var metadata = {};
  var allTasks;
  var cJsonT;

  function removeCircular (jsonT) {
    var circularPtrs = [];
    var scrubbed = jsonT.map(function () {
      var ptr = pathToPointer(this.path);

      if (this.circular) {
        circularPtrs.push(ptr);

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

      _.times(depth, function () {
        depthPath.push.apply(depthPath, path);

        traverse(scrubbed).set(depthPath, _.cloneDeep(value));
      });
    });

    return scrubbed;
  }

  function replaceReference (to, from, ref, refPtr) {
    var isError = _.isError(from);
    var missing = false;
    var refMetadata = {
      ref: ref
    };
    var parentPath;
    var refPath;
    var value;

    if (isError) {
      missing = true;
      value = undefined;

      refMetadata.err = from;
    } else {
      ref = ref.indexOf('#') === -1 ?
        '#' :
        ref.substring(ref.indexOf('#'));
      missing = !from.has(pathFromPointer(ref));
      value = from.get(pathFromPointer(ref));
    }

    refPath = pathFromPointer(refPtr);
    parentPath = refPath.slice(0, refPath.length - 1);

    if (!missing) {
      if (parentPath.length === 0) {
        to.value = value;
      } else {
        to.set(parentPath, value);
      }

      refMetadata.value = value;
    }

    metadata[refPtr] = refMetadata;
  }

  if (Object.keys(refs).length > 0) {
    cJsonT = traverse(_.cloneDeep(json)); // Clone the input JSON to avoid altering it

    _.each(refs, function (ref, refPtr) {
      if (isRemotePointer(ref)) {
        remoteRefs[refPtr] = ref;
      } else {
        replaceReference(cJsonT, cJsonT, ref, refPtr);
      }
    });

    if (_.size(remoteRefs) > 0) {
      allTasks = Promise.resolve();

      _.each(remoteRefs, function (ref, refPtr) {
        var scheme = _.indexOf(ref, ':') === -1 ? undefined : ref.split(':')[0];
        var nextStep;

        // Do not process references to unsupported resources
        if (_.indexOf(supportedSchemes, scheme) === -1 && !_.isUndefined(scheme)) {
          nextStep = Promise.resolve();
        } else {
          nextStep = new Promise(function (resolve, reject) {
            getRemoteJson(ref, options, function (err, remoteJson) {
              var rOptions = _.cloneDeep(options);
              var refBase = ref.split('#')[0];

              // Remove the last path segment
              refBase = refBase.substring(0, _.lastIndexOf(refBase, '/') + 1);

              rOptions.location = computeUrl(options.location, refBase);

              if (err) {
                replaceReference(cJsonT, err, ref, refPtr);

                resolve();
              } else {
                resolveRefs(remoteJson, rOptions, function (err2, resolvedJson) {
                  if (err2) {
                    reject(err2);
                  } else {
                    replaceReference(cJsonT, traverse(resolvedJson), ref, refPtr);

                    resolve();
                  }
                });
              }
            });
          });
        }

        allTasks = allTasks.then(function () {
          return nextStep;
        });
      });

      allTasks
        .then(function () {
          done(undefined, removeCircular(cJsonT), metadata);
        }, function (err) {
          done(err);
        });
    } else {
      done(undefined, removeCircular(cJsonT), metadata);
    }
  } else {
    done(undefined, json, metadata);
  }
};
