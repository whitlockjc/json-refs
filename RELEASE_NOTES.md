## Release Notes

### TBD

* Added `options.location` to allow for better relative reference resolution
* Removed `options.relativeBase` as it's too confusing and easier to get right using `options.location`
* Fixed accidental feature of resolver that would that resolved remote references against parent documents *(Issue #100)*
* Fixed issue where `json-refs resolve` did not handle a location with a fragment in it *(Issue #104)*
* Fixed issue where circular reference in remote documents were not handled properly *(Issue #97)*
* Fixed issue where references to the root document were not marked as circular at proper depth *(Issue #88)*
* Fixed issue where documents could be resolved more than once *(Issues #87, #89 and #103)*
* Fixed issue with remote references not being fully resolved *(Issue #80)*
* Rewrote resolver for accuracy and efficiency *(Issues #80, #87, #88, #89, #97, #100 and #103)*
* Updated `#pathFromPtr` to include the reason why `#isPtr` fails *(Issue #85)*

### v2.1.7 (2017-04-22)

* Updated dependencies for security *(Issues #108, #109)*

### v2.1.6 (2016-06-14)

* Fixed a bug where identifying circular references failed for local, indirect references *(Issue #82)*

### v2.1.5 (2016-02-02)

* Fixed an issue with altering the original input
* Fixed an issue with recursively processing references already planned to be processed created extra reference
metadata which caused issues with resolution *(Issue #73)*

### v2.1.4 (2016-02-02)

* Fixed a problem where multiple references to the same object were not all fully resolved *(Issue #72)*

### v2.1.3 (2016-01-31)

* Fixed a problem where references were not fully resolved for remote references with fragments *(Issue #70)*
* Updated handling of resolving circular references to leave circular references as-is instead of resolving to an empty
object *(Issue #69)*

### v2.1.2 (2016-01-23)

* Scoped fixed for issue #67 to relative references only
* Use Node.js `path` APIs instead of reinventing them

### v2.1.1 (2016-01-23)

* Fixed an issue with `#findRefsAt` and `#resolveRefsAt` and relative locations *(Issue #67)*
* Updated `json-refs resolve` to validate by default to avoid confusion *(Removed the `--validate` flag and replaced
it with the `--force` flag to disable validation)*

### v2.1.0 (2016-01-23)

* First pass at a `json-refs` CLI utility

### v2.0.8 (2016-01-23)

* Fixed an issue with options that filter references *(`options.filter` and `options.subDocPath`)* and the internal
document cache

### v2.0.7 (2016-01-23)

* Further address issues with lack of encoding in JSON References *(path segments instead of fragments)* *(Issue #61)*

### v2.0.6 (2016-01-22)

* Fix an issue where a JSON Reference at the root of the document was not resolved properly *(Issue #65)*

### v2.0.5 (2016-01-22)

* Added support to work with URI encoded JSON References and to handle JSON References with unescaped special
characters *(This means that if you have a reference like `#/paths/{petId}`, which is technically invalid, we will not
mark it as invalid and will process it.  It also means if your reference is escaped, like `#/definitions/My%20Pet`, it
will also work as expected.)* *(Issue #61)*
* Fix an issue with combining `options.filter` and `options.includeInvalid` *(Issue #63)*
* We now clone the JSON Reference definition and JSON Reference details respectively for `options.refPreProcessor' and
`options.refPostProcessor` *(Issue #64)*

### v2.0.4 (2016-01-21)

* Fixed a bug where a reference to another object that shares a common pointer could be marked as `circular`
erroneously *(For example: `#/definitions/Person/properties/name` references `#/definitions/PersonWithName` shares the
same `#/definitions/Person` base but are to different objects)* *(PR #59)*

### v2.0.3 (2016-01-11)

* Fixed a problem when loading relative paths with relative references

### v2.0.2 (2016-01-06)

* Fixed another inconsistency with error handling

### v2.0.1 (2016-01-06)

* Fix a consistency issue with error handling

### v2.0.0 (2016-01-06)

* Added `#clearCache` to allow you to clear the remote document cache and its JSON References details
* Added `#decodePath` to allow you to take an array of path segments and decode their JSON Pointer tokens *(Issue #47)*
* Added `#encodePath` to allow you to take an array of path segments and encode the special JSON Pointer characters *(Issue #47)*
* Added `#findRefsAt` to allow you to retrieve a remote document and then find its references
* Added `#getRefDetails` to centralize the code used to generate reference metadata *(Also allows you to see why an
object you expect to be returned by `#findRefs` is not returned.)*
* Added `#resolveRefsAt` to allow you to retrieve a remote document and then resolve its references
* Fixed a bug where Windows paths containing `\` were not processed properly *(Issue #48)*
* Removed `#resolveLocalRefs`
* Renamed `#isJsonPointer` to `#isPtr`
* Renamed `#isJsonReference` to `#isRef`
* Renamed `#pathFromPointer` to `#pathFromPtr`
* Renamed `#pathToPointer` to `#pathToPtr`
* Updated `#findRefs` to no longer process child properties of JSON Reference objects
* Updated `#findRefs` to no longer use [js-traverse](https://github.com/substack/js-traverse)
* Updated `#findRefs` to use an *options* object
    * `options.filter` allows you to filter references
    * `options.includeInvalid` allows you to include JSON Reference details for invalid references
    * `options.refPreProcessor` allows you to take a JSON Reference like object and process it prior to `#isRef` being
    called against it
    * `options.refPostProcessor` allows you to take the JSON Reference details/metadata and process it *(This runs prior
    to `options.filter`)*
    * `options.subDocPath` allows you to find JSON References at/below a certain location in the document
like objects that fail validation so that you can identify invalid JSON References easier *(See API documentation for details)*
* Updated `#isPtr` to validate the `$ref` value is a URI instead of treating all string values as valid
* Updated `#isPtr` to validate the [tokens](http://tools.ietf.org/html/rfc6901#section-4) *(Issue #47)*
* Updated `#isPtr` to have an optional second argument which dictates whether or not to throw an `Error` for invalid JSON
Pointer values *(The `Error` would have the details as to why the provided value is not a JSON Pointer)* *(Issue #47)*
* Updated `#isRef` to have an optional second argument which dictates whether or not to throw an `Error` for invalid JSON
Reference values *(The `Error` would have the details as to why the provided value is not a JSON Reference)* *(Issue #47)*
* Updated `#pathToPtr` to take an optional second argument to allow for returning both hash-based *(default)* and
slash-based JSON Pointers
* Updated `#resolveRefs` to work with the new `options` object
    * `options.depth` was removed
    * `options.loaderOptions` is now used for the options passed to [path-loader](https://github.com/whitlockjc/path-loader)
    * `options.prepareRequest` was removed *(Now available at `options.loaderOptions.prepareRequest`)*
    * `options.processContent` was removed *(Now available at `options.loaderOptions.processContent`)*
    * `options.location` was removed *(Now available at `options.relativeBase`)*
    * `options.relativeBase` is used to specify the root location to resolve relative references from
    * All `options` used by `#findRefs` are supported here

### v1.3.0 (2015-11-19)

* Added `#resolveLocalRefs` to avoid forcing consumers only resolving local references to use a callback/Promise based
API *(`#resolveRefs`)*
* Update reference metadata to record when a reference is remote

### v1.2.1 (2015-11-18)

* Updated `#findRefs` and `#resolveRefs` to work with arrays and objects *(Issue #39)*

### v1.2.0 (2015-11-16)

* Added options to `#resolveRefs` that allow you to choose which reference type(s) to resolve *(Issue #27, PR #41)*

### v1.1.2 (2015-10-21)

* Fix a bug in the handling of remote reference errors _(Issue #37)_

### v1.1.1 (2015-09-28)

* Fix issue where a hash in `options.location` could create a double slash in the requested path _(Issue #34)_

### v1.1.0 (2015-09-18)

* Fixed support for service/web workers *(Issue #32)*

### v1.0.5 (2015-08-31)

* Fixed a bug where unresolved references occur for remote document fragments did not get reported

### v1.0.4 (2015-08-31)

* Fix problem where local references in a remote document, referenced using a fragment, were not resolved _(Issue #30)_

### v1.0.3 (2015-08-31)

* Fix problem where local references in a remote document were not resolved _(Issue #30)_

### v1.0.2 (2015-07-21)

* Fix problem where references to schemas with circular composition/inheritance could result in attempting to update
reference metadata that does not exist

### v1.0.1 (2015-07-20)

* Fix problem where circular references caused by composition/inheritance wasn't caught properly

### v1.0.0 (2015-07-17)

* Circular references are now identified in metadata _(Issue #22)_
* Fixed a few scenarios where local self references to root didn't work right
* Rewrote using ES5 which removed the need for `lodash-compat`
* `#resolveRefs` now collapses all reference pointers so that the metadata key is now the reference to the local
document instead of where
its `$ref` was *(This is a breaking change and that is why we are doing a `1.0` release)*
* `#resolveRefs` now defers local reference resolution until after remote references are resolved _(Issue #26)_
* `#resolveRefs` now handles recursive relative references gracefully _(Issue #24)_
* `#resolveRefs` now records metadata for remote references _(Issue #25)_
* `#resolveRefs` now supports callbacks, as always, and promises
_(Always returns a promise even if callbacks are used)_

### v0.3.2 (2015-07-08)

* Unresolved references leave the original reference in the document so as not to break JSON Schema validation

### v0.3.1 (2015-07-08)

* Errors resolving remote references no longer bubble up errors and instead show up in metadata as unresolved

### v0.3.0 (2015-07-08)

* Fix issue with Bower build as it had old dependency paths in it *(PR #15)*
* Fix issue with circular references not being detected in arrays *(Issue #20)*
* Fix problem with references at the root of the document and having hashes *(Issue #19)*
* Support relative references *(Issue 11)*
* Support to specify a depth for `#resolveRefs` for circular references *(Issue #5)*

### v0.2.0 (2015-05-12)

* Replace file loading with [path-loader](https://github.com/whitlockjc/path-loader)

### v0.1.10 (2015-04-16)

* Fixed an issue due to difference in superagent in browser vs. Node.js

### v0.1.9 (2015-04-16)

* Fixed a browser build issue

### v0.1.8 (2015-04-16)

* Updated `isRemotePointer` to only return `true` for explicit URLs or relative paths

### v0.1.7 (2015-04-16)

* Added support in `resolveRefs` to alter a remote request prior to sending the request _(Useful for authentication)_
_(Issue #12)_
* Added support in `resolveRefs` to process the remote request responses
* Fixed bug in `resolveRefs` where multiple remote references resulted in callback being called multiple times
* Updated `isRemotePointer` to handle relative references and file URL references _(Issue #9)_
* Updated `resolveRefs` to return resolution metadata _(What references were resolved, where they were located and what
they resolved to)_
