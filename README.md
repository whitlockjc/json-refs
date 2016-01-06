# json-refs

json-refs is a simple library for interacting with [JSON References][json-reference-draft-spec] and
[JSON Pointers][json-pointer-spec].  While the main purpose of this library is to provide JSON References features,
since JSON References are a combination of `Object` structure and a `JSON Pointer`, this library also provides some
features for JSON Pointers as well.

# Project Status

Right now we are working on `2.0.0`.  *(For more details on its development, please view [Issue #42][issue-42]).  That
being said, the `master` branch for this project is currently for `2.0.0` development and is in an incomplete state.  I
would not suggest using `master` until this disclaimer is removed from the homepage and/or `2.0.0` is released.*

Should you need to use a working version, all `1.x` releases are tagged and should be installable via Bower/NPM without
issue.

## Project Badges

* Build status: [![Build Status](https://travis-ci.org/whitlockjc/json-refs.svg)](https://travis-ci.org/whitlockjc/json-refs)
* Dependencies: [![Dependencies](https://david-dm.org/whitlockjc/json-refs.svg)](https://david-dm.org/whitlockjc/json-refs)
* Developer dependencies: [![Dev Dependencies](https://david-dm.org/whitlockjc/json-refs/dev-status.svg)](https://david-dm.org/whitlockjc/json-refs#info=devDependencies&view=table)
* Downloads: [![NPM Downloads Per Month](http://img.shields.io/npm/dm/json-refs.svg)](https://www.npmjs.org/package/json-refs)
* Gitter: [![Join the chat at https://gitter.im/whitlockjc/json-refs](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/whitlockjc/json-refs?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
* License: [![License](http://img.shields.io/npm/l/json-refs.svg)](https://github.com/whitlockjc/json-refs/blob/master/LICENSE)
* Version: [![NPM Version](http://img.shields.io/npm/v/json-refs.svg)](https://www.npmjs.org/package/json-refs)

## Documentation

The documentation for this project can be found here: https://github.com/whitlockjc/json-refs/blob/master/docs/README.md

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

* [json-refs-standalone.js](https://raw.github.com/whitlockjc/json-refs/master/browser/json-refs-standalone.js): _400_, full source source maps
* [json-refs-standalone-min.js](https://raw.github.com/whitlockjc/json-refs/master/browser/json-refs-standalone-min.js): _44kb_, minified, compressed
and no sourcemap

### Node.js

Installation for Node.js applications can be done via [NPM][npm].

```
npm install json-refs --save
```

[bower]: http://bower.io/
[issue-42]: https://github.com/whitlockjc/json-refs/issues/42
[npm]: https://www.npmjs.com/
[json-reference-draft-spec]: http://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03
[json-pointer-spec]: http://tools.ietf.org/html/rfc6901
[path-loader]: https://github.com/whitlockjc/path-loader
