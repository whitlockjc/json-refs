/**
 * This file contains all type definitions that are purely for documentation purposes.
 */

/**
 * The options used for various JsonRefs APIs.
 *
 * @typedef {object} JsonRefsOptions
 *
 * @property {string|string[]|function} [filter=function () {return true;}] - The filter to use when gathering JSON
 * References *(If this value is a single string or an array of strings, the value(s) are expected to be the `type(s)`
 * you are interested in collecting as described in {@link module:json-refs.getRefDetails}.  If it is a function, it is
 * expected that the function behaves like {@link module:json-refs.RefDetailsFilter}.)*
 * @property {boolean} [includeInvalid=false] - Whether or not to include invalid JSON Reference details *(This will
 * make it so that objects that are like JSON Reference objects, as in they are an `Object` and the have a `$ref`
 * property, but fail validation will be included.  This is very useful for when you want to know if you have invalid
 * JSON Reference definitions.  This will not mean that APIs will process invalid JSON References but the reasons as to
 * why the JSON References are invalid will be included in the returned metadata.)*
 * @property {object} [loaderOptions] - The options to pass to
 * {@link https://github.com/whitlockjc/path-loader/blob/master/docs/API.md#module_PathLoader.load|PathLoader~load}
 * @property {string} [location=root.json] - The location of the document being processed  *(This property is only
 * useful when resolving references as it will be used to locate relative references found within the document being
 * resolved. If this value is relative, {@link https://github.com/whitlockjc/path-loader|path-loader} will use
 * `window.location.href` for the browser and `process.cwd()` for Node.js.)*
 * @property {module:json-refs.RefPreProcessor} [refPreProcessor] - The callback used to pre-process a JSON Reference like
 * object *(This is called prior to validating the JSON Reference like object and getting its details)*
 * @property {module:json-refs.RefPostProcessor} [refPostProcessor] - The callback used to post-process the JSON Reference
 * metadata *(This is called prior filtering the references)*
 * @property {boolean} [resolveCirculars=false] - Whether to resolve circular references
 * @property {string|string[]} [subDocPath=[]] - The JSON Pointer or array of path segments to the sub document
 * location to search from
 *
 * @memberof module:json-refs
 */

/**
 * Simple function used to filter out JSON References.
 *
 * @typedef {function} RefDetailsFilter
 *
 * @param {module:json-refs.UnresolvedRefDetails} refDetails - The JSON Reference details to test
 * @param {string[]} path - The path to the JSON Reference
 *
 * @returns {boolean} whether the JSON Reference should be filtered *(out)* or not
 *
 * @memberof module:json-refs
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
 *
 * @memberof module:json-refs
 */

/**
 * Simple function used to post-process a JSON Reference details.
 *
 * @typedef {function} RefPostProcessor
 *
 * @param {module:json-refs.UnresolvedRefDetails} refDetails - The JSON Reference details to test
 * @param {string[]} path - The path to the JSON Reference
 *
 * @returns {object} the processed JSON Reference details object
 *
 * @memberof module:json-refs
 */

/**
 * Detailed information about resolved JSON References.
 *
 * @typedef {object} ResolvedRefDetails
 * @extends {module:json-refs.UnresolvedRefDetails}
 *
 * @property {boolean} [circular] - Whether or not the JSON Reference is circular *(Will not be set if the JSON
 * Reference is not circular)*
 * @property {string} fqURI - The fully-qualified version of the `uri` property for
 * {@link module:json-refs.UnresolvedRefDetails} but with the value being relative to the root document
 * @property {boolean} [missing] - Whether or not the referenced value was missing or not *(Will not be set if the
 * referenced value is not missing)*
 * @property {*} [value] - The referenced value *(Will not be set if the referenced value is missing)*
 *
 * @memberof module:json-refs
 */

/**
 * The results of resolving the JSON References of an array/object.
 *
 * @typedef {object} ResolvedRefsResults
 *
 * @property {module:json-refs.ResolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:json-refs.ResolvedRefDetails}
 * @property {object} resolved - The array/object with its JSON References fully resolved
 *
 * @memberof module:json-refs
 */

/**
 * An object containing the retrieved document and detailed information about its JSON References.
 *
 * @typedef {object}  RetrievedRefsResults
 * @extends {module:json-refs.ResolvedRefsResults}
 *
 * @property {object} value - The retrieved document
 *
 * @memberof module:json-refs
 */

/**
 * An object containing the retrieved document, the document with its references resolved and  detailed information
 * about its JSON References.
 *
 * @typedef {object} RetrievedResolvedRefsResults
 *
 * @property {module:json-refs.UnresolvedRefDetails} refs - An object whose keys are JSON Pointers *(fragment version)*
 * to where the JSON Reference is defined and whose values are {@link module:json-refs.UnresolvedRefDetails}
 * @property {object} resolved - The array/object with its JSON References fully resolved
 * @property {object} value - The retrieved document
 *
 * @memberof module:json-refs
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
 * @memberof module:json-refs
 */
