<a name="module_JsonRefs"></a>
## JsonRefs
Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.


* [JsonRefs](#module_JsonRefs)
  * _static_
    * [.getRefDetails](#module_JsonRefs.getRefDetails) ⇒ <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code>
    * [.isPtr](#module_JsonRefs.isPtr) ⇒ <code>boolean</code>
    * [.isRef](#module_JsonRefs.isRef) ⇒ <code>boolean</code>
    * [.pathFromPtr](#module_JsonRefs.pathFromPtr) ⇒ <code>Array.&lt;string&gt;</code>
    * [.pathToPtr](#module_JsonRefs.pathToPtr) ⇒ <code>string</code>
    * [.findRefs(obj, [options])](#module_JsonRefs.findRefs) ⇒ <code>object</code>
  * _inner_
    * [~RefDetailsFilter](#module_JsonRefs..RefDetailsFilter) ⇒ <code>boolean</code>
    * [~UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails) : <code>object</code>

<a name="module_JsonRefs.getRefDetails"></a>
### JsonRefs.getRefDetails ⇒ <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code>
Returns detailed information about the JSON Reference.

**Kind**: static property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code> - the detailed information  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The JSON Reference definition |

<a name="module_JsonRefs.isPtr"></a>
### JsonRefs.isPtr ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Pointer.

A string is a JSON Pointer if the following are all true:

  * The string is of type `String`
  * The string must be empty or start with a `/` or `#/`

**Kind**: static property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The string to check |

<a name="module_JsonRefs.isRef"></a>
### JsonRefs.isRef ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Reference.

An object is a JSON Reference only if the following are all true:

  * The object is of type `Object`
  * The object has a `$ref` property
  * The `$ref` property is a valid URI

**Kind**: static property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**See**: [http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3](http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The object to check |

<a name="module_JsonRefs.pathFromPtr"></a>
### JsonRefs.pathFromPtr ⇒ <code>Array.&lt;string&gt;</code>
Returns an array of path segments for the provided JSON Pointer.

**Kind**: static property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>Array.&lt;string&gt;</code> - the path segments  
**Throws**:

- <code>Error</code> if the provided argument is not a JSON Pointer


| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The JSON Pointer |

<a name="module_JsonRefs.pathToPtr"></a>
### JsonRefs.pathToPtr ⇒ <code>string</code>
Returns a JSON Pointer for the provided array of path segments.

**Note:** If a path segment in `path` is not a `String`, it will be converted to one using `JSON.stringify`.

**Kind**: static property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>string</code> - the corresponding JSON Pointer  
**Throws**:

- <code>Error</code> if the argument is not an array


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> |  | The array of path segments |
| [hashPrefix] | <code>boolean</code> | <code>true</code> | Whether or not create a hash-prefixed JSON Pointer |

<a name="module_JsonRefs.findRefs"></a>
### JsonRefs.findRefs(obj, [options]) ⇒ <code>object</code>
Finds JSON References defined within the provided array/object.

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>object</code> - an object whose keys are JSON Pointers (fragment version) to where the JSON Reference is defined
and whose values are [UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails).  
**Throws**:

- <code>Error</code> if `from` is not a valid JSON Pointer


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| obj | <code>array</code> &#124; <code>object</code> |  | The structure to find JSON References within |
| [options] | <code>object</code> | <code>{}</code> | The options to use when finding references |
| [options.filter] | <code>string</code> &#124; <code>Array.&lt;string&gt;</code> &#124; <code>function</code> | <code>&quot;[]&quot;</code> | The filter to use when gathering JSON References *(If this value is a single string or an array of strings, the value(s) are expected to be the `type(s)` you are interested in collecting as described in [getRefDetails](#module_JsonRefs.getRefDetails).  If it is a function, it is expected that the function behaves like [RefDetailsFilter](#module_JsonRefs..RefDetailsFilter).)* |
| [options.subDocPath] | <code>string</code> &#124; <code>Array.&lt;string&gt;</code> | <code>&quot;[]&quot;</code> | The JSON Pointer or array of path segments to the sub document location to search from |

<a name="module_JsonRefs..RefDetailsFilter"></a>
### JsonRefs~RefDetailsFilter ⇒ <code>boolean</code>
Simple function used to filter our JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - whether the JSON Reference should be filtered *(out)* or not  

| Param | Type | Description |
| --- | --- | --- |
| refDetails | <code>[UnresolvedRefDetails](#module_JsonRefs..UnresolvedRefDetails)</code> | The JSON Reference Details to test |
| path | <code>Array.&lt;string&gt;</code> | The path to the JSON Reference |

<a name="module_JsonRefs..UnresolvedRefDetails"></a>
### JsonRefs~UnresolvedRefDetails : <code>object</code>
Detailed information about unresolved JSON References.

**Kind**: inner typedef of <code>[JsonRefs](#module_JsonRefs)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| def | <code>object</code> | The JSON Reference definition |
| error | <code>string</code> | The error information for invalid JSON Reference definition *(Only present when the JSON Reference definition is invalid)* |
| uri | <code>string</code> | The URI portion of the JSON Reference |
| uriDetails | <code>object</code> | Detailed information about the URI as provided by [URI.parse](https://github.com/garycourt/uri-js). |
| type | <code>string</code> | The JSON Reference type *(This value can be one of the following: `invalid`, `local`, `relative` or `remote`.)* |
| warning | <code>string</code> | The warning information *(Only present when the JSON Reference definition produces a warning)* |

