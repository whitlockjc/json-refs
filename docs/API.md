## Members
<dl>
<dt><a href="#isJsonReference">isJsonReference</a> ⇒ <code>boolean</code></dt>
<dd><p>Returns whether or not the object represents a JSON Reference.</p>
</dd>
<dt><a href="#pathToPointer">pathToPointer</a> ⇒ <code>string</code></dt>
<dd><p>Takes an array of path segments and creates a JSON Pointer from it.</p>
</dd>
<dt><a href="#findRefs">findRefs</a> ⇒ <code>object</code></dt>
<dd><p>Find all JSON References in the document.</p>
</dd>
<dt><a href="#isRemotePointer">isRemotePointer</a> ⇒ <code>boolean</code></dt>
<dd><p>Returns whether or not the JSON Pointer is a remote reference.</p>
</dd>
<dt><a href="#pathFromPointer">pathFromPointer</a> ⇒ <code>Array.&lt;string&gt;</code></dt>
<dd><p>Takes a JSON Reference and returns an array of path segments.</p>
</dd>
</dl>
## Functions
<dl>
<dt><a href="#getRemoteJson">getRemoteJson(url, options)</a> ⇒ <code>Promise</code></dt>
<dd><p>Retrieves the content at the URL and returns its JSON content.</p>
</dd>
<dt><a href="#clearCache">clearCache()</a></dt>
<dd><p>Clears the internal cache of url -&gt; JavaScript object mappings based on previously resolved references.</p>
</dd>
<dt><a href="#resolveRefs">resolveRefs(json, [options], [done])</a> ⇒ <code>Promise</code></dt>
<dd><p>Takes a JSON document, resolves all JSON References and returns a fully resolved equivalent along with reference
resolution metadata.</p>
<p><strong>Important Details</strong></p>
<ul>
<li>The input arguments are never altered</li>
<li>When using promises, only one value can be resolved so it is an object whose keys and values are the same name and
value as arguments 1 and 2 for <a href="#resultCallback">resultCallback</a></li>
</ul>
</dd>
</dl>
## Typedefs
<dl>
<dt><a href="#resultCallback">resultCallback</a> : <code>function</code></dt>
<dd><p>Callback used by <a href="#resolveRefs">resolveRefs</a>.</p>
</dd>
<dt><a href="#prepareRequestCallback">prepareRequestCallback</a> : <code>function</code></dt>
<dd><p>Callback used to provide access to altering a remote request prior to the request being made.</p>
</dd>
<dt><a href="#processContentCallback">processContentCallback</a> ⇒ <code>object</code></dt>
<dd><p>Callback used to process the content of a reference.</p>
</dd>
</dl>
<a name="isJsonReference"></a>
## isJsonReference ⇒ <code>boolean</code>
Returns whether or not the object represents a JSON Reference.

**Kind**: global variable  
**Returns**: <code>boolean</code> - true if the argument is an object and its $ref property is a string and false otherwise  

| Param | Type | Description |
| --- | --- | --- |
| [obj] | <code>object</code> &#124; <code>string</code> | The object to check |

<a name="pathToPointer"></a>
## pathToPointer ⇒ <code>string</code>
Takes an array of path segments and creates a JSON Pointer from it.

**Kind**: global variable  
**Returns**: <code>string</code> - A JSON Pointer based on the path segments  
**Throws**:

- Error if the arguments are missing or invalid

**See**: [http://tools.ietf.org/html/rfc6901](http://tools.ietf.org/html/rfc6901)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;string&gt;</code> | The path segments |

<a name="findRefs"></a>
## findRefs ⇒ <code>object</code>
Find all JSON References in the document.

**Kind**: global variable  
**Returns**: <code>object</code> - An object whose keys are JSON Pointers to the '$ref' node of the JSON Reference  
**Throws**:

- Error if the arguments are missing or invalid

**See**: [http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3](http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03#section-3)  

| Param | Type | Description |
| --- | --- | --- |
| json | <code>object</code> | The JSON document to find references in |

<a name="isRemotePointer"></a>
## isRemotePointer ⇒ <code>boolean</code>
Returns whether or not the JSON Pointer is a remote reference.

**Kind**: global variable  
**Returns**: <code>boolean</code> - true if the JSON Pointer is remote or false if not  
**Throws**:

- Error if the arguments are missing or invalid


| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The JSON Pointer |

<a name="pathFromPointer"></a>
## pathFromPointer ⇒ <code>Array.&lt;string&gt;</code>
Takes a JSON Reference and returns an array of path segments.

**Kind**: global variable  
**Returns**: <code>Array.&lt;string&gt;</code> - An array of path segments or the passed in string if it is a remote reference  
**Throws**:

- Error if the arguments are missing or invalid

**See**: [http://tools.ietf.org/html/rfc6901](http://tools.ietf.org/html/rfc6901)  

| Param | Type | Description |
| --- | --- | --- |
| ptr | <code>string</code> | The JSON Pointer for the JSON Reference |

<a name="getRemoteJson"></a>
## getRemoteJson(url, options) ⇒ <code>Promise</code>
Retrieves the content at the URL and returns its JSON content.

**Kind**: global function  
**Returns**: <code>Promise</code> - The promise  
**Throws**:

- Error if there is a problem making the request or the content is not JSON


| Param | Type | Description |
| --- | --- | --- |
| url | <code>string</code> | The URL to retrieve |
| options | <code>object</code> | The options passed to resolveRefs |

<a name="clearCache"></a>
## clearCache()
Clears the internal cache of url -> JavaScript object mappings based on previously resolved references.

**Kind**: global function  
<a name="resolveRefs"></a>
## resolveRefs(json, [options], [done]) ⇒ <code>Promise</code>
Takes a JSON document, resolves all JSON References and returns a fully resolved equivalent along with reference
resolution metadata.

**Important Details**

* The input arguments are never altered
* When using promises, only one value can be resolved so it is an object whose keys and values are the same name and
  value as arguments 1 and 2 for [resultCallback](#resultCallback)

**Kind**: global function  
**Returns**: <code>Promise</code> - The promise.  
**Throws**:

- Error if the arguments are missing or invalid


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| json | <code>object</code> |  | The JSON  document having zero or more JSON References |
| [options] | <code>object</code> |  | The options (All options are passed down to whitlockjc/path-loader) |
| [options.depth] | <code>number</code> | <code>1</code> | The depth to resolve circular references |
| [options.location] | <code>string</code> |  | The location to which relative references should be resolved |
| [options.prepareRequest] | <code>[prepareRequestCallback](#prepareRequestCallback)</code> |  | The callback used to prepare an HTTP request |
| [options.processContent] | <code>[processContentCallback](#processContentCallback)</code> |  | The callback used to process a reference's content |
| [done] | <code>[resultCallback](#resultCallback)</code> |  | The result callback |

**Example**  
```js
// Example using callbacks

JsonRefs.resolveRefs({
  name: 'json-refs',
  owner: {
    $ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'
  }
}, function (err, resolved, metadata) {
  if (err) throw err;

  console.log(JSON.stringify(resolved)); // {name: 'json-refs', owner: { ... }}
  console.log(JSON.stringify(metadata)); // {'#/owner': {ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'}}
});
```
**Example**  
```js
// Example using promises

JsonRefs.resolveRefs({
  name: 'json-refs',
  owner: {
    $ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'
  }
}).then(function (results) {
  console.log(JSON.stringify(results.resolved)); // {name: 'json-refs', owner: { ... }}
  console.log(JSON.stringify(results.metadata)); // {'#/owner': {ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'}}
});
```
**Example**  
```js
// Example using options.prepareRequest (to add authentication credentials) and options.processContent (to process YAML)

JsonRefs.resolveRefs({
  name: 'json-refs',
  owner: {
    $ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'
  }
}, {
  prepareRequest: function (req) {
    // Add the 'Basic Authentication' credentials
    req.auth('whitlockjc', 'MY_GITHUB_PASSWORD');

    // Add the 'X-API-Key' header for an API Key based authentication
    // req.set('X-API-Key', 'MY_API_KEY');
  },
  processContent: function (content) {
    return YAML.parse(content);
  }
}).then(function (results) {
  console.log(JSON.stringify(results.resolved)); // {name: 'json-refs', owner: { ... }}
  console.log(JSON.stringify(results.metadata)); // {'#/owner': {ref: 'https://api.github.com/repos/whitlockjc/json-refs#/owner'}}
});
```
<a name="resultCallback"></a>
## resultCallback : <code>function</code>
Callback used by [resolveRefs](#resolveRefs).

**Kind**: global typedef  

| Param | Type | Description |
| --- | --- | --- |
| [err] | <code>error</code> | The error if there is a problem |
| [resolved] | <code>object</code> | The resolved results |
| [metadata] | <code>object</code> | The reference resolution metadata.  *(The key a JSON Pointer to a path in the resolved                              document where a JSON Reference was dereferenced.  The value is also an object.  Every                              metadata entry has a `ref` property to tell you where the dereferenced value came from.                              If there is an `err` property, it is the `Error` object encountered retrieving the                              referenced value.  If there is a `missing` property, it means the referenced value could                              not be resolved.)* |

<a name="prepareRequestCallback"></a>
## prepareRequestCallback : <code>function</code>
Callback used to provide access to altering a remote request prior to the request being made.

**Kind**: global typedef  

| Param | Type | Description |
| --- | --- | --- |
| req | <code>object</code> | The Superagent request object |
| ref | <code>string</code> | The reference being resolved (When applicable) |

<a name="processContentCallback"></a>
## processContentCallback ⇒ <code>object</code>
Callback used to process the content of a reference.

**Kind**: global typedef  
**Returns**: <code>object</code> - The JavaScript object representation of the reference  

| Param | Type | Description |
| --- | --- | --- |
| content | <code>string</code> | The content loaded from the file/URL |
| ref | <code>string</code> | The reference string (When applicable) |
| [res] | <code>object</code> | The Superagent response object (For remote URL requests only) |

