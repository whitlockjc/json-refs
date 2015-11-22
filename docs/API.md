<a name="module_JsonRefs"></a>
## JsonRefs
Various utilities for JSON References *(http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03)* and
JSON Pointers *(https://tools.ietf.org/html/rfc6901)*.

<a name="module_JsonRefs.isJsonReference"></a>
### JsonRefs.isJsonReference(obj) ⇒ <code>boolean</code>
Returns whether or not the object represents a JSON Reference.

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

