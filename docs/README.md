json-refs is a simple library for interacting with [JSON References][json-reference-draft-spec] and
[JSON Pointers][json-pointer-spec].  While the main purpose of this library is to provide JSON References features,
since JSON References are a combination of `Object` structure and a `JSON Pointer`, this library also provides some
features for JSON Pointers as well.

Feel free to look at the API Documentation located here:
https://github.com/whitlockjc/json-refs/blob/master/docs/API.md

## Installation

json-refs is available for both Node.js and the browser.  Installation instructions for each environment are below.

### Browser

Installation for browser applications can be done via [Bower][bower] or by downloading a standalone binary.

#### Using Bower

Installation is standard fare:

```
bower install json-refs --save
```

To use the Bower install, your HTML includes might look like this:

``` html
<!-- ... -->
<script src="bower_components/path-loader/browser/path-loader-min.js"></script>
<script src="bower_components/json-refs/browser/json-refs-min.js"></script>
<!-- ... -->
```

#### Standalone Binaries

The standalone binaries come in two flavors:

* [json-refs-standalone.js](https://raw.github.com/whitlockjc/json-refs/master/browser/json-refs-standalone.js): _424kb_, full source source maps
* [json-refs-standalone-min.js](https://raw.github.com/whitlockjc/json-refs/master/browser/json-refs-standalone-min.js): _48kb_, minified, compressed
and no sourcemap

Of course, these links are for the master builds so feel free to download from the release of your choice.  Once you've
gotten them downloaded, to use the standalone binaries, your HTML include might look like this:

``` html
<!-- ... -->
<script src="json-refs-standalone.js"></script>
<!-- ... -->
```

### Node.js

Installation for Node.js applications can be done via [NPM][npm].

```
npm install json-refs --save
```

## API Documentation

The json-refs project's API documentation can be found here: https://github.com/whitlockjc/json-refs/blob/master/docs/API.md

## CLI Documentation
The json-refs project's CLI documentation can be found here: https://github.com/whitlockjc/json-refs/blob/master/docs/CLI.md

## Dependencies

Below is the list of projects being used by json-refs and the purpose(s) they are used for:

* [native-promise-only][native-promise-only]: Used to shim in [Promises][promises] support
* [path-loader][path-loader]: Used to load Swagger files from the local filesystem and remote URLs
* [traverse][traverse]: Utilities for processing JSON

[bower]: http://bower.io/
[json-pointer-spec]: http://tools.ietf.org/html/rfc6901
[json-reference-draft-spec]: http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03
[native-promise-only]: https://www.npmjs.com/package/native-promise-only
[npm]: https://www.npmjs.org/
[path-loader]: https://github.com/whitlockjc/path-loader
[promises]: https://www.promisejs.org/
[traverse]: https://github.com/substack/js-traverse
