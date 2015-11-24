<a name="module_JsonRefs"></a>
## JsonRefs
Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.


* [JsonRefs](#module_JsonRefs)
  * [~isPtr](#module_JsonRefs..isPtr) ⇒ <code>boolean</code>
  * [~isRef](#module_JsonRefs..isRef) ⇒ <code>boolean</code>
  * [~pathFromPtr](#module_JsonRefs..pathFromPtr) ⇒ <code>Array.&lt;string&gt;</code>
  * [~pathToPtr](#module_JsonRefs..pathToPtr) ⇒ <code>string</code>

<a name="module_JsonRefs..isPtr"></a>
### JsonRefs~isPtr ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Pointer.

A string is a JSON Pointer if the following are all true:

  * The string is of type `String`
  * The string must be empty or start with a `/` or `#/`

**Kind**: inner property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The string to check |

<a name="module_JsonRefs..isRef"></a>
### JsonRefs~isRef ⇒ <code>boolean</code>
Returns whether the argument represents a JSON Reference.

An object is a JSON Reference only if the following are all true:

  * The object is of type `Object`
  * The object has a `$ref` property
  * The `$ref` property is a valid URI

**Kind**: inner property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**See**: [http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3](http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The object to check |

<a name="module_JsonRefs..pathFromPtr"></a>
### JsonRefs~pathFromPtr ⇒ <code>Array.&lt;string&gt;</code>
Returns an array of path segments for the provided JSON Pointer.

**Kind**: inner property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>Array.&lt;string&gt;</code> - the path segments  
**Throws**:

- <code>Error</code> if the provided argument is not a JSON Pointer


| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The JSON Pointer |

<a name="module_JsonRefs..pathToPtr"></a>
### JsonRefs~pathToPtr ⇒ <code>string</code>
Returns a JSON Pointer for the provided array of path segments.

**Note:** If a path segment in `path` is not a `String`, it will be converted to one using `JSON.stringify`.

**Kind**: inner property of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>string</code> - the corresponding JSON Pointer  
**Throws**:

- <code>Error</code> if the argument is not an array


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> |  | The array of path segments |
| [hashPrefix] | <code>boolean</code> | <code>true</code> | Whether or not create a hash-prefixed JSON Pointer |

