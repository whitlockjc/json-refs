## Functions

<dl>
<dt><a href="#clearCache">clearCache()</a></dt>
<dd><p>Clears the internal cache of remote documents, reference details, etc.</p>
</dd>
<dt><a href="#decodePath">decodePath(path)</a> ⇒ <code>string</code></dt>
<dd><p>Takes an array of path segments and decodes the JSON Pointer tokens in them.</p>
</dd>
<dt><a href="#encodePath">encodePath(path)</a> ⇒ <code>string</code></dt>
<dd><p>Takes an array of path segments and encodes the special JSON Pointer characters in them.</p>
</dd>
<dt><a href="#findRefs">findRefs(obj, [options])</a> ⇒ <code>object</code></dt>
<dd><p>Finds JSON References defined within the provided array/object.</p>
</dd>
<dt><a href="#findRefsAt">findRefsAt(location, [options])</a> ⇒ <code>Promise</code></dt>
<dd><p>Finds JSON References defined within the document at the provided location.</p>
<p>This API is identical to <a href="#findRefs">findRefs</a> except this API will retrieve a remote document and then
return the result of <a href="#findRefs">findRefs</a> on the retrieved document.</p>
</dd>
<dt><a href="#getRefDetails">getRefDetails(obj)</a> ⇒ <code><a href="#UnresolvedRefDetails">UnresolvedRefDetails</a></code></dt>
<dd><p>Returns detailed information about the JSON Reference.</p>
</dd>
<dt><a href="#isPtr">isPtr(ptr, [throwWithDetails])</a> ⇒ <code>boolean</code></dt>
<dd><p>Returns whether the argument represents a JSON Pointer.</p>
<p>A string is a JSON Pointer if the following are all true:</p>
<ul>
<li>The string is of type <code>String</code></li>
<li>The string must be empty, <code>#</code> or start with a <code>/</code> or <code>#/</code></li>
</ul>
</dd>
<dt><a href="#isRef">isRef(obj, [throwWithDetails])</a> ⇒ <code>boolean</code></dt>
<dd><p>Returns whether the argument represents a JSON Reference.</p>
<p>An object is a JSON Reference only if the following are all true:</p>
<ul>
<li>The object is of type <code>Object</code></li>
<li>The object has a <code>$ref</code> property</li>
<li>The <code>$ref</code> property is a valid URI <em>(We do not require 100% strict URIs and will handle unescaped special
characters.)</em></li>
</ul>
</dd>
<dt><a href="#pathFromPtr">pathFromPtr(ptr)</a> ⇒ <code>Array.&lt;string&gt;</code></dt>
<dd><p>Returns an array of path segments for the provided JSON Pointer.</p>
</dd>
<dt><a href="#pathToPtr">pathToPtr(path, [hashPrefix])</a> ⇒ <code>string</code></dt>
<dd><p>Returns a JSON Pointer for the provided array of path segments.</p>
<p><strong>Note:</strong> If a path segment in <code>path</code> is not a <code>String</code>, it will be converted to one using <code>JSON.stringify</code>.</p>
</dd>
<dt><a href="#resolveRefs">resolveRefs(obj, [options])</a> ⇒ <code>Promise</code></dt>
<dd><p>Finds JSON References defined within the provided array/object and resolves them.</p>
</dd>
<dt><a href="#resolveRefsAt">resolveRefsAt(location, [options])</a> ⇒ <code>Promise</code></dt>
<dd><p>Resolves JSON References defined within the document at the provided location.</p>
<p>This API is identical to <a href="#resolveRefs">resolveRefs</a> except this API will retrieve a remote document and then
return the result of <a href="#resolveRefs">resolveRefs</a> on the retrieved document.</p>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#JsonRefsOptions">JsonRefsOptions</a> : <code>object</code></dt>
<dd><p>The options used for various JsonRefs APIs.</p>
</dd>
<dt><a href="#RefDetailsFilter">RefDetailsFilter</a> ⇒ <code>boolean</code></dt>
<dd><p>Simple function used to filter out JSON References.</p>
</dd>
<dt><a href="#RefPostProcessor">RefPostProcessor</a> ⇒ <code>object</code></dt>
<dd><p>Simple function used to post-process a JSON Reference details.</p>
</dd>
<dt><a href="#RefPreProcessor">RefPreProcessor</a> ⇒ <code>object</code></dt>
<dd><p>Simple function used to pre-process a JSON Reference like object.</p>
</dd>
<dt><a href="#ResolvedRefDetails">ResolvedRefDetails</a> : <code><a href="#UnresolvedRefDetails">UnresolvedRefDetails</a></code></dt>
<dd><p>Detailed information about resolved JSON References.</p>
</dd>
<dt><a href="#ResolvedRefsResults">ResolvedRefsResults</a> : <code>object</code></dt>
<dd><p>The results of resolving the JSON References of an array/object.</p>
</dd>
<dt><a href="#RetrievedRefsResults">RetrievedRefsResults</a> : <code><a href="#ResolvedRefsResults">ResolvedRefsResults</a></code></dt>
<dd><p>An object containing the retrieved document and detailed information about its JSON References.</p>
</dd>
<dt><a href="#RetrievedResolvedRefsResults">RetrievedResolvedRefsResults</a> : <code>object</code></dt>
<dd><p>An object containing the retrieved document, the document with its references resolved and  detailed information
about its JSON References.</p>
</dd>
<dt><a href="#UnresolvedRefDetails">UnresolvedRefDetails</a> : <code>object</code></dt>
<dd><p>Detailed information about unresolved JSON References.</p>
</dd>
</dl>

<a name="JsonRefsOptions"></a>

## JsonRefsOptions : <code>object</code>
The options used for various JsonRefs APIs.

**Kind**: global typedef  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| filter | <code>string</code> &#124; <code>Array.&lt;string&gt;</code> &#124; <code>function</code> | <code>&quot;function () {return true;}&quot;</code> | The filter to use when gathering JSON References *(If this value is a single string or an array of strings, the value(s) are expected to be the `type(s)` you are interested in collecting as described in [getRefDetails](#getRefDetails).  If it is a function, it is expected that the function behaves like [RefDetailsFilter](#RefDetailsFilter).)* |
| includeInvalid | <code>boolean</code> | <code>false</code> | Whether or not to include invalid JSON Reference details *(This will make it so that objects that are like JSON Reference objects, as in they are an `Object` and the have a `$ref` property, but fail validation will be included.  This is very useful for when you want to know if you have invalid JSON Reference definitions.  This will not mean that APIs will process invalid JSON References but the reasons as to why the JSON References are invalid will be included in the returned metadata.)* |
| loaderOptions | <code>object</code> |  | The options to pass to [PathLoader~load](https://github.com/whitlockjc/path-loader/blob/master/docs/API.md#module_PathLoader.load) |
| location | <code>string</code> | <code>&quot;root.json&quot;</code> | The location of the document being processed  *(This property is only useful when resolving references as it will be used to locate relative references found within the document being resolved. If this value is relative, [path-loader](https://github.com/whitlockjc/path-loader) will use `window.location.href` for the browser and `process.cwd()` for Node.js.)* |
| refPreProcessor | <code>[RefPreProcessor](#RefPreProcessor)</code> |  | The callback used to pre-process a JSON Reference like object *(This is called prior to validating the JSON Reference like object and getting its details)* |
| refPostProcessor | <code>[RefPostProcessor](#RefPostProcessor)</code> |  | The callback used to post-process the JSON Reference metadata *(This is called prior filtering the references)* |
| resolveCirculars | <code>boolean</code> | <code>false</code> | Whether to resolve circular references |
| subDocPath | <code>string</code> &#124; <code>Array.&lt;string&gt;</code> | <code>&quot;[]&quot;</code> | The JSON Pointer or array of path segments to the sub document location to search from |

<a name="RefDetailsFilter"></a>

## RefDetailsFilter ⇒ <code>boolean</code>
Simple function used to filter out JSON References.

**Kind**: global typedef  
**Returns**: <code>boolean</code> - whether the JSON Reference should be filtered *(out)* or not  

| Param | Type | Description |
| --- | --- | --- |
| refDetails | <code>[UnresolvedRefDetails](#UnresolvedRefDetails)</code> | The JSON Reference details to test |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference |

<a name="RefPostProcessor"></a>

## RefPostProcessor ⇒ <code>object</code>
Simple function used to post-process a JSON Reference details.

**Kind**: global typedef  
**Returns**: <code>object</code> - the processed JSON Reference details object  

| Param | Type | Description |
| --- | --- | --- |
| refDetails | <code>[UnresolvedRefDetails](#UnresolvedRefDetails)</code> | The JSON Reference details to test |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference |

<a name="RefPreProcessor"></a>

## RefPreProcessor ⇒ <code>object</code>
Simple function used to pre-process a JSON Reference like object.

**Kind**: global typedef  
**Returns**: <code>object</code> - the processed JSON Reference like object  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The JSON Reference like object |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference like object |

<a name="ResolvedRefDetails"></a>

## ResolvedRefDetails : <code>[UnresolvedRefDetails](#UnresolvedRefDetails)</code>
Detailed information about resolved JSON References.

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| circular | <code>boolean</code> | Whether or not the JSON Reference is circular *(Will not be set if the JSON Reference is not circular)* |
| fqURI | <code>string</code> | The fully-qualified version of the `uri` property for                            [UnresolvedRefDetails](#UnresolvedRefDetails) but with the value being relative to the root                            document |
| missing | <code>boolean</code> | Whether or not the referenced value was missing or not *(Will not be set if the referenced value is not missing)* |
| value | <code>\*</code> | The referenced value *(Will not be set if the referenced value is missing)* |

<a name="ResolvedRefsResults"></a>

## ResolvedRefsResults : <code>object</code>
The results of resolving the JSON References of an array/object.

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| refs | <code>[ResolvedRefDetails](#ResolvedRefDetails)</code> | An object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined and whose values are [ResolvedRefDetails](#ResolvedRefDetails) |
| resolved | <code>object</code> | The array/object with its JSON References fully resolved |

<a name="RetrievedRefsResults"></a>

## RetrievedRefsResults : <code>[ResolvedRefsResults](#ResolvedRefsResults)</code>
An object containing the retrieved document and detailed information about its JSON References.

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| value | <code>object</code> | The retrieved document |

<a name="RetrievedResolvedRefsResults"></a>

## RetrievedResolvedRefsResults : <code>object</code>
An object containing the retrieved document, the document with its references resolved and  detailed information
about its JSON References.

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| refs | <code>[UnresolvedRefDetails](#UnresolvedRefDetails)</code> | An object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined and whose values are [UnresolvedRefDetails](#UnresolvedRefDetails) |
|  | <code>[ResolvedRefsResults](#ResolvedRefsResults)</code> | An object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined and whose values are [ResolvedRefDetails](#ResolvedRefDetails) |
| value | <code>object</code> | The retrieved document |

<a name="UnresolvedRefDetails"></a>

## UnresolvedRefDetails : <code>object</code>
Detailed information about unresolved JSON References.

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| def | <code>object</code> | The JSON Reference definition |
| error | <code>string</code> | The error information for invalid JSON Reference definition *(Only present when the JSON Reference definition is invalid or there was a problem retrieving a remote reference during resolution)* |
| uri | <code>string</code> | The URI portion of the JSON Reference |
| uriDetails | <code>object</code> | Detailed information about the URI as provided by [URI.parse](https://github.com/garycourt/uri-js). |
| type | <code>string</code> | The JSON Reference type *(This value can be one of the following: `invalid`, `local`, `relative` or `remote`.)* |
| warning | <code>string</code> | The warning information *(Only present when the JSON Reference definition produces a warning)* |

<a name="clearCache"></a>

## clearCache()
Clears the internal cache of remote documents, reference details, etc.

**Kind**: global function  
<a name="decodePath"></a>

## decodePath(path) ⇒ <code>string</code>
Takes an array of path segments and decodes the JSON Pointer tokens in them.

**Kind**: global function  
**Returns**: <code>string</code> - the array of path segments with their JSON Pointer tokens decoded  
**Throws**:

- <code>Error</code> if the path is not an `Array`

**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> | The array of path segments |

<a name="encodePath"></a>

## encodePath(path) ⇒ <code>string</code>
Takes an array of path segments and encodes the special JSON Pointer characters in them.

**Kind**: global function  
**Returns**: <code>string</code> - the array of path segments with their JSON Pointer tokens encoded  
**Throws**:

- <code>Error</code> if the path is not an `Array`

**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> | The array of path segments |

<a name="findRefs"></a>

## findRefs(obj, [options]) ⇒ <code>object</code>
Finds JSON References defined within the provided array/object.

**Kind**: global function  
**Returns**: <code>object</code> - an object whose keys are JSON Pointers *(fragment version)* to where the JSON Reference is defined
and whose values are [UnresolvedRefDetails](#UnresolvedRefDetails).  
**Throws**:

- <code>Error</code> when the input arguments fail validation or if `options.subDocPath` points to an invalid location


| Param | Type | Description |
| --- | --- | --- |
| obj | <code>array</code> &#124; <code>object</code> | The structure to find JSON References within |
| [options] | <code>[JsonRefsOptions](#JsonRefsOptions)</code> | The JsonRefs options |

**Example**  
```js
// Finding all valid references
var allRefs = JsonRefs.findRefs(obj);
// Finding all remote references
var remoteRefs = JsonRefs.findRefs(obj, {filter: ['relative', 'remote']});
// Finding all invalid references
var invalidRefs = JsonRefs.findRefs(obj, {filter: 'invalid', includeInvalid: true});
```
<a name="findRefsAt"></a>

## findRefsAt(location, [options]) ⇒ <code>Promise</code>
Finds JSON References defined within the document at the provided location.

This API is identical to [findRefs](#findRefs) except this API will retrieve a remote document and then
return the result of [findRefs](#findRefs) on the retrieved document.

**Kind**: global function  
**Returns**: <code>Promise</code> - a promise that resolves a [RetrievedRefsResults](#RetrievedRefsResults) and rejects with an
`Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 the location argument points to an unloadable resource  

| Param | Type | Description |
| --- | --- | --- |
| location | <code>string</code> | The location to retrieve *(Can be relative or absolute, just make sure you look at the [options documentation](#JsonRefsOptions) to see how relative references are handled.)* |
| [options] | <code>[JsonRefsOptions](#JsonRefsOptions)</code> | The JsonRefs options |

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
<a name="getRefDetails"></a>

## getRefDetails(obj) ⇒ <code>[UnresolvedRefDetails](#UnresolvedRefDetails)</code>
Returns detailed information about the JSON Reference.

**Kind**: global function  
**Returns**: <code>[UnresolvedRefDetails](#UnresolvedRefDetails)</code> - the detailed information  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The JSON Reference definition |

<a name="isPtr"></a>

## isPtr(ptr, [throwWithDetails]) ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Pointer.

A string is a JSON Pointer if the following are all true:

  * The string is of type `String`
  * The string must be empty, `#` or start with a `/` or `#/`

**Kind**: global function  
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
<a name="isRef"></a>

## isRef(obj, [throwWithDetails]) ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Reference.

An object is a JSON Reference only if the following are all true:

  * The object is of type `Object`
  * The object has a `$ref` property
  * The `$ref` property is a valid URI *(We do not require 100% strict URIs and will handle unescaped special
    characters.)*

**Kind**: global function  
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
<a name="pathFromPtr"></a>

## pathFromPtr(ptr) ⇒ <code>Array.&lt;string&gt;</code>
Returns an array of path segments for the provided JSON Pointer.

**Kind**: global function  
**Returns**: <code>Array.&lt;string&gt;</code> - the path segments  
**Throws**:

- <code>Error</code> if the provided `ptr` argument is not a JSON Pointer


| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The JSON Pointer |

<a name="pathToPtr"></a>

## pathToPtr(path, [hashPrefix]) ⇒ <code>string</code>
Returns a JSON Pointer for the provided array of path segments.

**Note:** If a path segment in `path` is not a `String`, it will be converted to one using `JSON.stringify`.

**Kind**: global function  
**Returns**: <code>string</code> - the corresponding JSON Pointer  
**Throws**:

- <code>Error</code> if the `path` argument is not an array


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> |  | The array of path segments |
| [hashPrefix] | <code>boolean</code> | <code>true</code> | Whether or not create a hash-prefixed JSON Pointer |

<a name="resolveRefs"></a>

## resolveRefs(obj, [options]) ⇒ <code>Promise</code>
Finds JSON References defined within the provided array/object and resolves them.

**Kind**: global function  
**Returns**: <code>Promise</code> - a promise that resolves a [ResolvedRefsResults](#ResolvedRefsResults) and rejects with an
`Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 the location argument points to an unloadable resource  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>array</code> &#124; <code>object</code> | The structure to find JSON References within |
| [options] | <code>[JsonRefsOptions](#JsonRefsOptions)</code> | The JsonRefs options |

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
<a name="resolveRefsAt"></a>

## resolveRefsAt(location, [options]) ⇒ <code>Promise</code>
Resolves JSON References defined within the document at the provided location.

This API is identical to [resolveRefs](#resolveRefs) except this API will retrieve a remote document and then
return the result of [resolveRefs](#resolveRefs) on the retrieved document.

**Kind**: global function  
**Returns**: <code>Promise</code> - a promise that resolves a [RetrievedResolvedRefsResults](#RetrievedResolvedRefsResults) and rejects with an
`Error` when the input arguments fail validation, when `options.subDocPath` points to an invalid location or when
 the location argument points to an unloadable resource  

| Param | Type | Description |
| --- | --- | --- |
| location | <code>string</code> | The location to retrieve *(Can be relative or absolute, just make sure you look at the [options documentation](#JsonRefsOptions) to see how relative references are handled.)* |
| [options] | <code>[JsonRefsOptions](#JsonRefsOptions)</code> | The JsonRefs options |

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
