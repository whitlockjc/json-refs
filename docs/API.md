<a name="module_JsonRefs"></a>

## JsonRefs
Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.


* [JsonRefs](#module_JsonRefs)
    * _inner_
        * [~JsonRefsOptions](#module_JsonRefs..JsonRefsOptions) : <code>object</code>
        * [~RefDetailsFilter](#module_JsonRefs..RefDetailsFilter) ⇒ <code>boolean</code>
        * [~RefPostProcessor](#module_JsonRefs..RefPostProcessor) ⇒ <code>object</code>
        * [~RefPreProcessor](#module_JsonRefs..RefPreProcessor) ⇒ <code>object</code>
        * [~ResolvedRefDetails](#module_JsonRefs..ResolvedRefDetails) : <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code>
        * [~ResolvedRefsResults](#module_JsonRefs..ResolvedRefsResults) : <code>object</code>
        * [~RetrievedRefsResults](#module_JsonRefs..RetrievedRefsResults) : <code>[ResolvedRefsResults](#module_JsonRefs..ResolvedRefsResults)</code>
        * [~RetrievedResolvedRefsResults](#module_JsonRefs..RetrievedResolvedRefsResults) : <code>object</code>
        * [~UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails) : <code>object</code>
    * _static_
        * [.clearCache()](#module_JsonRefs.clearCache)
        * [.decodePath(path)](#module_JsonRefs.decodePath) ⇒ <code>string</code>
        * [.encodePath(path)](#module_JsonRefs.encodePath) ⇒ <code>string</code>
        * [.findRefs(obj, [options])](#module_JsonRefs.findRefs) ⇒ <code>object</code>
        * [.findRefsAt(location, [options])](#module_JsonRefs.findRefsAt) ⇒ <code>Promise</code>
        * [.getRefDetails(obj)](#module_JsonRefs.getRefDetails) ⇒ <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code>
        * [.isPtr(ptr, [throwWithDetails])](#module_JsonRefs.isPtr) ⇒ <code>boolean</code>
        * [.isRef(obj, [throwWithDetails])](#module_JsonRefs.isRef) ⇒ <code>boolean</code>
        * [.pathFromPtr(ptr)](#module_JsonRefs.pathFromPtr) ⇒ <code>Array.&lt;string&gt;</code>
        * [.pathToPtr(path, [hashPrefix])](#module_JsonRefs.pathToPtr) ⇒ <code>string</code>
        * [.resolveRefs(obj, [options])](#module_JsonRefs.resolveRefs) ⇒ <code>Promise</code>
        * [.resolveRefsAt(location, [options])](#module_JsonRefs.resolveRefsAt) ⇒ <code>Promise</code>

<a name="module_JsonRefs..JsonRefsOptions"></a>

### JsonRefs~JsonRefsOptions : <code>object</code>
The options used for various JsonRefs APIs.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [filter] | <code>string</code> &#124; <code>Array.&lt;string&gt;</code> &#124; <code>function</code> | <code>&quot;function () {return true;}&quot;</code> | The filter to use when gathering JSON References *(If this value is a single string or an array of strings, the value(s) are expected to be the `type(s)` you are interested in collecting as described in [getRefDetails](#module_JsonRefs.getRefDetails).  If it is a function, it is expected that the function behaves like [RefDetailsFilter](#module_JsonRefs..RefDetailsFilter).)* |
| [includeInvalid] | <code>boolean</code> | <code>false</code> | Whether or not to include invalid JSON Reference details *(This will make it so that objects that are like JSON Reference objects, as in they are an `Object` and the have a `$ref` property, but fail validation will be included.  This is very useful for when you want to know if you have invalid JSON Reference definitions.  This will not mean that APIs will process invalid JSON References but the reasons as to why the JSON References are invalid will be included in the returned metadata.)* |
| [loaderOptions] | <code>object</code> |  | The options to pass to [PathLoader~load](https://github.com/whitlockjc/path-loader/blob/master/docs/API.md#module_PathLoader.load) |
| [location] | <code>string</code> | <code>&quot;root.json&quot;</code> | The location of the document being processed  *(This property is only useful when resolving references as it will be used to locate relative references found within the document being resolved. If this value is relative, [path-loader](https://github.com/whitlockjc/path-loader) will use `window.location.href` for the browser and `process.cwd()` for Node.js.)* |
| [refPreProcessor] | <code>[RefPreProcessor](#module_JsonRefs..RefPreProcessor)</code> |  | The callback used to pre-process a JSON Reference like object *(This is called prior to validating the JSON Reference like object and getting its details)* |
| [refPostProcessor] | <code>[RefPostProcessor](#module_JsonRefs..RefPostProcessor)</code> |  | The callback used to post-process the JSON Reference metadata *(This is called prior filtering the references)* |
| [resolveCirculars] | <code>boolean</code> | <code>false</code> | Whether to resolve circular references |
| [noCache] | <code>boolean</code> | <code>false</code> | Whether to cache remote references |
| [options.subDocPath] | <code>string</code> &#124; <code>Array.&lt;string&gt;</code> | <code>&quot;[]&quot;</code> | The JSON Pointer or array of path segments to the sub document location to search from |

<a name="module_JsonRefs..RefDetailsFilter"></a>

### JsonRefs~RefDetailsFilter ⇒ <code>boolean</code>
Simple function used to filter out JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - whether the JSON Reference should be filtered *(out)* or not  

| Param | Type | Description |
| --- | --- | --- |
| refDetails | <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code> | The JSON Reference details to test |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference |

<a name="module_JsonRefs..RefPostProcessor"></a>

### JsonRefs~RefPostProcessor ⇒ <code>object</code>
Simple function used to post-process a JSON Reference details.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>object</code> - the processed JSON Reference details object  

| Param | Type | Description |
| --- | --- | --- |
| refDetails | <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code> | The JSON Reference details to test |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference |

<a name="module_JsonRefs..RefPreProcessor"></a>

### JsonRefs~RefPreProcessor ⇒ <code>object</code>
Simple function used to pre-process a JSON Reference like object.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>object</code> - the processed JSON Reference like object  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The JSON Reference like object |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference like object |

<a name="module_JsonRefs..ResolvedRefDetails"></a>

### JsonRefs~ResolvedRefDetails : <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code>
Detailed information about resolved JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| circular | <code>boolean</code> | Whether or not the JSON Reference is circular *(Will not be set if the JSON Reference is not circular)* |
| missing | <code>boolean</code> | Whether or not the referenced value was missing or not *(Will not be set if the referenced value is not missing)* |
| value | <code>\*</code> | The referenced value *(Will not be set if the referenced value is missing)* |

<a name="module_JsonRefs..ResolvedRefsResults"></a>

### JsonRefs~ResolvedRefsResults : <code>object</code>
The results of resolving the JSON References of an array/object.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| refs | <code>[ResolvedRefDetails](#module_JsonRefs..ResolvedRefDetails)</code> | An object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined and whose values are [ResolvedRefDetails](#module_JsonRefs..ResolvedRefDetails) |
| resolved | <code>object</code> | The array/object with its JSON References fully resolved |

<a name="module_JsonRefs..RetrievedRefsResults"></a>

### JsonRefs~RetrievedRefsResults : <code>[ResolvedRefsResults](#module_JsonRefs..ResolvedRefsResults)</code>
An object containing the retrieved document and detailed information about its JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| value | <code>object</code> | The retrieved document |

<a name="module_JsonRefs..RetrievedResolvedRefsResults"></a>

### JsonRefs~RetrievedResolvedRefsResults : <code>object</code>
An object containing the retrieved document, the document with its references resolved and  detailed information
about its JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| refs | <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code> | An object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined and whose values are [UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails) |
|  | <code>ResolvedRefsResults</code> | An object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined and whose values are [ResolvedRefDetails](#module_JsonRefs..ResolvedRefDetails) |
| value | <code>object</code> | The retrieved document |

<a name="module_JsonRefs..UnresolvedRefDetails"></a>

### JsonRefs~UnresolvedRefDetails : <code>object</code>
Detailed information about unresolved JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| def | <code>object</code> | The JSON Reference definition |
| error | <code>string</code> | The error information for invalid JSON Reference definition *(Only present when the JSON Reference definition is invalid or there was a problem retrieving a remote reference during resolution)* |
| uri | <code>string</code> | The URI portion of the JSON Reference |
| uriDetails | <code>object</code> | Detailed information about the URI as provided by [URI.parse](https://github.com/garycourt/uri-js). |
| type | <code>string</code> | The JSON Reference type *(This value can be one of the following: `invalid`, `local`, `relative` or `remote`.)* |
| warning | <code>string</code> | The warning information *(Only present when the JSON Reference definition produces a warning)* |

<a name="module_JsonRefs.clearCache"></a>

### JsonRefs.clearCache()
Clears the internal cache of remote documents, reference details, etc.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
<a name="module_JsonRefs.decodePath"></a>

### JsonRefs.decodePath(path) ⇒ <code>string</code>
Takes an array of path segments and decodes the JSON Pointer tokens in them.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>string</code> - the array of path segments with their JSON Pointer tokens decoded  
**Throws**:

- <code>Error</code> if the path is not an `Array`

**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> | The array of path segments |

<a name="module_JsonRefs.encodePath"></a>

### JsonRefs.encodePath(path) ⇒ <code>string</code>
Takes an array of path segments and encodes the special JSON Pointer characters in them.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>string</code> - the array of path segments with their JSON Pointer tokens encoded  
**Throws**:

- <code>Error</code> if the path is not an `Array`

**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> | The array of path segments |

<a name="module_JsonRefs.findRefs"></a>

### JsonRefs.findRefs(obj, [options]) ⇒ <code>object</code>
Finds JSON References defined within the provided array/object.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>object</code> - an object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined
and whose values are [UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails).  
**Throws**:

- <code>Error</code> when the input arguments fail validation or if `options.subDocPath` points to an invalid location


| Param | Type | Description |
| --- | --- | --- |
| obj | <code>array</code> &#124; <code>object</code> | The structure to find JSON References within |
| [options] | <code>[JsonRefsOptions](#module_JsonRefs..JsonRefsOptions)</code> | The JsonRefs options |

**Example**  
```js
// Finding all valid references
var allRefs = JsonRefs.findRefs(obj);
// Finding all remote references
var remoteRefs = JsonRefs.findRefs(obj, {filter: ['relative', 'remote']});
// Finding all invalid references
var invalidRefs = JsonRefs.findRefs(obj, {filter: 'invalid', includeInvalid: true});
```
<a name="module_JsonRefs.findRefsAt"></a>

### JsonRefs.findRefsAt(location, [options]) ⇒ <code>Promise</code>
Finds JSON References defined within the document at the provided location.

This API is identical to [findRefs](#module_JsonRefs.findRefs) except this API will retrieve a remote document and then
return the result of [findRefs](#module_JsonRefs.findRefs) on the retrieved document.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>Promise</code> - a promise that resolves a [RetrievedRefsResults](#module_JsonRefs..RetrievedRefsResults) and rejects with an
`Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 the location argument points to an unloadable resource  

| Param | Type | Description |
| --- | --- | --- |
| location | <code>string</code> | The location to retrieve *(Can be relative or absolute, just make sure you look at the [options documentation](#module_JsonRefs..JsonRefsOptions) to see how relative references are handled.)* |
| [options] | <code>[JsonRefsOptions](#module_JsonRefs..JsonRefsOptions)</code> | The JsonRefs options |

**Example**  
```js
// Example that only resolves references within a sub document
JsonRefs.findRefsAt('http://petstore.swagger.io/v2/swagger.json', {
    subDocPath: '#/definitions'
  })
  .then(function (res) {
     // Do something with the response
     //
     // res.refs: JSON Reference locations and details
     // res.value: The retrieved document
  }, function (err) {
    console.log(err.stack);
  });
```
<a name="module_JsonRefs.getRefDetails"></a>

### JsonRefs.getRefDetails(obj) ⇒ <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code>
Returns detailed information about the JSON Reference.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code> - the detailed information  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The JSON Reference definition |

<a name="module_JsonRefs.isPtr"></a>

### JsonRefs.isPtr(ptr, [throwWithDetails]) ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Pointer.

A string is a JSON Pointer if the following are all true:

  * The string is of type `String`
  * The string must be empty, `#` or start with a `/` or `#/`

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**Throws**:

- <code>error</code> when the provided value is invalid and the `throwWithDetails` argument is `true`

**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| ptr | <code>string</code> |  | The string to check |
| [throwWithDetails] | <code>boolean</code> | <code>false</code> | Whether or not to throw an `Error` with the details as to why the value provided is invalid |

**Example**  
```js
// Separating the different ways to invoke isPtr for demonstration purposes
if (isPtr(str)) {
  // Handle a valid JSON Pointer
} else {
  // Get the reason as to why the value is not a JSON Pointer so you can fix/report it
  try {
    isPtr(str, true);
  } catch (err) {
    // The error message contains the details as to why the provided value is not a JSON Pointer
  }
}
```
<a name="module_JsonRefs.isRef"></a>

### JsonRefs.isRef(obj, [throwWithDetails]) ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Reference.

An object is a JSON Reference only if the following are all true:

  * The object is of type `Object`
  * The object has a `$ref` property
  * The `$ref` property is a valid URI *(We do not require 100% strict URIs and will handle unescaped special
    characters.)*

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**Throws**:

- <code>error</code> when the provided value is invalid and the `throwWithDetails` argument is `true`

**See**: [http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3](http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| obj | <code>object</code> |  | The object to check |
| [throwWithDetails] | <code>boolean</code> | <code>false</code> | Whether or not to throw an `Error` with the details as to why the value provided is invalid |

**Example**  
```js
// Separating the different ways to invoke isRef for demonstration purposes
if (isRef(obj)) {
  // Handle a valid JSON Reference
} else {
  // Get the reason as to why the value is not a JSON Reference so you can fix/report it
  try {
    isRef(str, true);
  } catch (err) {
    // The error message contains the details as to why the provided value is not a JSON Reference
  }
}
```
<a name="module_JsonRefs.pathFromPtr"></a>

### JsonRefs.pathFromPtr(ptr) ⇒ <code>Array.&lt;string&gt;</code>
Returns an array of path segments for the provided JSON Pointer.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>Array.&lt;string&gt;</code> - the path segments  
**Throws**:

- <code>Error</code> if the provided `ptr` argument is not a JSON Pointer


| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The JSON Pointer |

<a name="module_JsonRefs.pathToPtr"></a>

### JsonRefs.pathToPtr(path, [hashPrefix]) ⇒ <code>string</code>
Returns a JSON Pointer for the provided array of path segments.

**Note:** If a path segment in `path` is not a `String`, it will be converted to one using `JSON.stringify`.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>string</code> - the corresponding JSON Pointer  
**Throws**:

- <code>Error</code> if the `path` argument is not an array


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> |  | The array of path segments |
| [hashPrefix] | <code>boolean</code> | <code>true</code> | Whether or not create a hash-prefixed JSON Pointer |

<a name="module_JsonRefs.resolveRefs"></a>

### JsonRefs.resolveRefs(obj, [options]) ⇒ <code>Promise</code>
Finds JSON References defined within the provided array/object and resolves them.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>Promise</code> - a promise that resolves a [ResolvedRefsResults](#module_JsonRefs..ResolvedRefsResults) and rejects with an
`Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 the location argument points to an unloadable resource  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>array</code> &#124; <code>object</code> | The structure to find JSON References within |
| [options] | <code>[JsonRefsOptions](#module_JsonRefs..JsonRefsOptions)</code> | The JsonRefs options |

**Example**  
```js
// Example that only resolves relative and remote references
JsonRefs.resolveRefs(swaggerObj, {
    filter: ['relative', 'remote']
  })
  .then(function (res) {
     // Do something with the response
     //
     // res.refs: JSON Reference locations and details
     // res.resolved: The document with the appropriate JSON References resolved
  }, function (err) {
    console.log(err.stack);
  });
```
<a name="module_JsonRefs.resolveRefsAt"></a>

### JsonRefs.resolveRefsAt(location, [options]) ⇒ <code>Promise</code>
Resolves JSON References defined within the document at the provided location.

This API is identical to [resolveRefs](#module_JsonRefs.resolveRefs) except this API will retrieve a remote document and then
return the result of [resolveRefs](#module_JsonRefs.resolveRefs) on the retrieved document.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>Promise</code> - a promise that resolves a [RetrievedResolvedRefsResults](#module_JsonRefs..RetrievedResolvedRefsResults) and rejects with an
`Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 the location argument points to an unloadable resource  

| Param | Type | Description |
| --- | --- | --- |
| location | <code>string</code> | The location to retrieve *(Can be relative or absolute, just make sure you look at the [options documentation](#module_JsonRefs..JsonRefsOptions) to see how relative references are handled.)* |
| [options] | <code>[JsonRefsOptions](#module_JsonRefs..JsonRefsOptions)</code> | The JsonRefs options |

**Example**  
```js
// Example that loads a JSON document (No options.loaderOptions.processContent required) and resolves all references
JsonRefs.resolveRefsAt('./swagger.json')
  .then(function (res) {
     // Do something with the response
     //
     // res.refs: JSON Reference locations and details
     // res.resolved: The document with the appropriate JSON References resolved
     // res.value: The retrieved document
  }, function (err) {
    console.log(err.stack);
  });
```
