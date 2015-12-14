json-refs is a simple library for interacting with [JSON References][json-reference-draft-spec] and
[JSON Pointers][json-pointer-spec].  While the main purpose of this library is to provide JSON References features,
since JSON References are a combination of `Object` structure and a `JSON Pointer`, this library also provides some
features for JSON Pointers as well.

To get an idea of what you can expect, feel free to look at the API Documentation located here:
https://github.com/whitlockjc/json-refs/blob/master/docs/API.md

# Project Status

Right now we are working on `2.0.0`.  *(For more details on its development, please view [Issue #42][issue-42]).  That
being said, the `master` branch for this project is currently for `2.0.0` development and is in an incomplete state.  I
would not suggest using `master` until this dislcaimer is removed from the homepage and/or `2.0.0` is released.

Should you need to use a working version, all `1.x` releases are tagged and should be installable via Bower/NPM without
issue.

## Installation

json-refs is available for both Node.js and the browser.  Installation instructions for each environment are below.

### Browser

Installation for browser applications can be done via [Bower][bower] or by downloading a standalone binary.

#### Using Bower

```
bower install json-refs --save
```

#### Standalone Binaries

The standalone binaries come in two flavors:

* [json-refs-standalone.js](https://raw.github.com/whitlockjc/json-refs/master/browser/json-refs-standalone.js): _180kb_, full source source maps
* [json-refs-standalone-min.js](https://raw.github.com/whitlockjc/json-refs/master/browser/json-refs-standalone-min.js): _24kb_, minified, compressed
and no sourcemap

### Node.js

Installation for Node.js applications can be done via [NPM][npm].

```
npm install json-refs --save
```

## API Documentation

The json-refs project's API documentation can be found here: https://github.com/whitlockjc/json-refs/blob/master/docs/API.md

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
