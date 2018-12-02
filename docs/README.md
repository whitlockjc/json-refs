json-refs is a simple library for interacting with [JSON References][json-reference-draft-spec] and
[JSON Pointers][json-pointer-spec].  While the main purpose of this library is to provide JSON References features,
since JSON References are a combination of `Object` structure and a `JSON Pointer`, this library also provides some
features for JSON Pointers as well.

Feel free to look at the API Documentation located here:
https://github.com/whitlockjc/json-refs/blob/master/docs/API.md

## Installation

json-refs is available for both Node.js and the browser.  Installation instructions for each environment are below.

### Browser

json-refs binaries for the browser are available in the `dist/` directory:

* [json-refs.js](https://raw.github.com/whitlockjc/json-refs/master/dist/json-refs.js): _2,292kb_, full source source maps
* [json-refs-min.js](https://raw.github.com/whitlockjc/json-refs/master/dist/json-refs-min.js): _148kb_, minified, compressed and no sourcemap

Of course, these links are for the master builds so feel free to download from the release of your choice.  Once you've
gotten them downloaded, to use the standalone binaries, your HTML include might look like this:

``` html
<!-- ... -->
<script src="json-refs.js"></script>
<!-- ... -->
```

### Node.js

Installation for Node.js applications can be done via [NPM][npm].

```
npm install json-refs --save
```

If you plan on using the `json-refs` CLI executable, you can install json-refs globally like this:

```
npm install json-refs --global
```

After this, feel free to run `json-refs help` to see what you can do or view the CLI documentation linked above

## API Documentation

The json-refs project's API documentation can be found here: https://github.com/whitlockjc/json-refs/blob/master/docs/API.md

## CLI Documentation
The json-refs project's CLI documentation can be found here: https://github.com/whitlockjc/json-refs/blob/master/docs/CLI.md

## Dependencies

Below is the list of projects being used by json-refs and the purpose(s) they are used for:

* [graphlib][graphlib]: Used to identify circular paths _(to avoid reinventing the wheel)_
* [lodash][lodash]: JavaScript utilities _(to avoid reinventing the wheel)_
* [native-promise-only][native-promise-only]: Used to shim in [Promises][promises] support
* [path-loader][path-loader]: Used to load Swagger files from the local filesystem and remote URLs

## Resolution

json-refs' resolution is pretty straight forward: Find JSON Reference definitions in the source document, lookup the
location being referenced and then replace the JSON Reference definition with the referenced value.  During this process
json-refs will also record _metadata_ that provides more information about the JSON Reference and its resolution _(or
attempted resolution)_.  From a performance perspective, two things must be mentioned:

1. json-refs will never process the same node in any document more than once
2. json-refs will never clone a referenced value _(JavaScript rules apply)_

### Identifying Circulars

As part of the resolution process, and the information recorded in the metadata, json-refs needs to identify the JSON
Reference definitions that are circular.  From a resolution perspective, if `options.resolveCirculars` is set to
`false`, this information is used to avoid resolving circular JSON References.  From a metadata perspective, when a JSON
Reference definition is circular, it is marked as such.

There are three scenarios in which a JSON Reference definition is marked as circular:

**JSON Reference to Ancestor**

```yaml
definitions:
  Person:
    type: object
    properties:
      family:
        type: array
        items:
          $ref: '#/definitions/Person'
```

Based on this example, the following are marked as circular:

* `#/definitions/Person/properties/family/items`

**Local-Only Circular Chain**

```yaml
A:
  b:
    "$ref": "#/B"
B:
  c:
    "$ref": "#/C"
C:
  a:
    "$ref": "#/A"
D:
  a:
    "$ref": "#/A"

```

Based on this example, the following are marked as circular:

* `#/A/b`
* `#/B/c`
* `#/C/a`

The reason `#/D/a` is **not** marked as circular is because while it references a circular, `#/D` is not itself part of
the circular path that resulted in `#/A/b` being marked as circular.

**Circular Chain Containing Remote Documents**

`root.json`

```json
{
  "remote": {
    "$ref": "./remote.json"
  },
  "remote-with-fragment": {
    "$ref": "./remote.json#/definitions/Person"
  }
}
```

`remote.json`

```json
{
  "ancestor": {
    "$ref": "./root.json"
  },
  "definitions": {
    "Person": {
      "type": "object",
      "properties": {
        "age": {
          "type": "integer"
        },
        "name": {
          "type": "string"
        }
      }
    }
  }
}
```

Based on the example above, only `#/remote/ancestor` would be marked as _circular_.  _(You're right, `#/remote/ancestor`
is not a JSON Reference definition location in the source document but if you look at the
[JSON Reference Metadata](#json-reference-metadata) section.)_  The reason we don't mark `#/remote` as circular is
because while `#/remote` is part of the circular path, not all JSON Reference definitions within `remote.json` are
circular and it wouldn't make sense to stop resolution just because we point to a document that somewhere within it gets
us back to where we are.  So unlike local-only circulars, multi-document circulars will only mark the JSON Reference
definition that points to an ancestor document that is part of the circular chain as circular.

### JSON Reference Metadata <a name="json-reference-metadata"></a>

This metadata mentioned above is a map with the following structure:

* **key:** A JSON Pointer relative to the root of the source document to where the resolution of a JSON Reference
contributed to the resolved document
* **value:** The [JsonRefs~ResolvedRefDetails][json-refs-refdetails] that contains the details of the JSON Reference
definition and information about the resolution

The most important part to know that might not be 100% clear is that the `key` part of the metadata is _"relative to the
root of the source document."_  Instead of getting all wordy, let's use an example:

`root.json`

```json
{
  "definitions": {
    "Person": {
      "type": "object",
      "properties": {
        "address": {
          "$ref": "http://api.example.com/schemas/types.json#/definitions/Address"
        },
        "age": {
          "$ref": "http://api.example.com/schemas/types.json#/definitions/Integer"
        },
        "name": {
          "$ref": "http://api.example.com/schemas/types.json#definitions/String"
        }
      }
    }
  }
}
```

`http://api.example.com/schemas/types.json`

```json
{
  "definitions": {
    "Address": {
      "type": "object",
      "properties": {
        "street": {
          "$ref": "#/definitions/String"
        }
      }
    },
    "Integer": {
      "type": "integer"
    },
    "String": {
      "type": "string"
    }
  },
  "State": {
    "type": "string"
  }
}
```

Based on the example above, the following metadata keys would be collected as part of resolving `root.json`:

* `#/definitions/Person/properties/address`
* `#/definitions/Person/properties/address/properties/street`
* `#/definitions/Person/properties/age`
* `#/definitions/Person/properties/name`

The second key is the one that is most important because it shows how a a JSON Reference in a remote document rolls up
to be relative to the root of the source document.  Since `#/definitions/Person/properties/address` references
`http://api.example.com/schemas/types.json#/definitions/Address`, all JSON Reference definitions locations beneath
`#/definitions/Address` in `http://api.example.com/schemas/types.json` are joined to the JSON Reference definition
location in the source document.  So `#/definitions/Person/properties/address + #/properties/street` becomes
`#/definitions/Person/properties/address/properties/street`.

Now the metadata `value` is pretty straight forward and it includes the reference and resolution details documented in
the [API documentation][json-refs-refdetails].

[graphlib]: https://github.com/cpettitt/graphlib
[json-pointer-spec]: http://tools.ietf.org/html/rfc6901
[json-reference-draft-spec]: http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03
[json-refs-refdetails]: https://github.com/whitlockjc/json-refs/blob/master/docs/API.md#module_JsonRefs..ResolvedRefDetails
[lodash]: https://lodash.com
[native-promise-only]: https://www.npmjs.com/package/native-promise-only
[npm]: https://www.npmjs.org/
[path-loader]: https://github.com/whitlockjc/path-loader
[promises]: https://www.promisejs.org/
