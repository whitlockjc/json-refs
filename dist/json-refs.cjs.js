'use strict';

if (process.env.NODE_ENV === "production") {
  module.exports = require("./json-refs.cjs.prod.js");
} else {
  module.exports = require("./json-refs.cjs.dev.js");
}
