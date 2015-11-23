<a name="module_JsonRefs"></a>
## JsonRefs
Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.


* [JsonRefs](#module_JsonRefs)
  * [.isJsonPointer(str)](#module_JsonRefs.isJsonPointer) ⇒ <code>boolean</code>
  * [.isJsonReference(obj)](#module_JsonRefs.isJsonReference) ⇒ <code>boolean</code>

<a name="module_JsonRefs.isJsonPointer"></a>
### JsonRefs.isJsonPointer(str) ⇒ <code>boolean</code>
Returns whether the string represents a JSON Pointer.

A string is a JSON Pointer if the following are all true:

  * The string is of type `String`
  * The string must be empty or start with a `/` or `#/`

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**See**: [https://tools.ietf.org/html/rfc6901#section-3](https://tools.ietf.org/html/rfc6901#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| str | <code>string</code> | The string to check |

<a name="module_JsonRefs.isJsonReference"></a>
### JsonRefs.isJsonReference(obj) ⇒ <code>boolean</code>
Returns whether the object represents a JSON Reference.

An object is a JSON Reference only if the following are all true:

  * The object is of type `Object`
  * The object has a `$ref` property
  * The `$ref` property is a valid URI

**Kind**: static method of <code>[JsonRefs](#module_JsonRefs)</code>  
**Returns**: <code>boolean</code> - the result of the check  
**See**: [http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3](http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The object to check |

