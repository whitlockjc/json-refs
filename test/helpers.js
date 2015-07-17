/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Jeremy Whitlock
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use strict';

var basicAuth = require('basic-auth');
var connect = require('connect');
var YAML = require('js-yaml');

var app = connect();
var nestedProjectCircularChildJson = require('./browser/nested/project-circular-child.json');
var nestedProjectCircularRootJson = require('./browser/nested/project-circular-root.json');
var nestedProjectJson = require('./browser/nested/project.json');
var projectCircularAncestorChildJson = require('./browser/nested/project-circular-ancestor-child.json');
var projectCircularAncestorRootJson = require('./browser/nested/project-circular-ancestor-root.json');
var projectCircularChildDescendantJson = require('./browser/project-circular-child-descendant.json');
var projectCircularChildJson = require('./browser/project-circular-child.json');
var projectCircularRootJson = require('./browser/project-circular-root.json');
var projectCircularRootDescendantJson = require('./browser/project-circular-root-descendant.json');
var projectJson = require('./browser/project.json');
var projectNestedJson = require('./browser/project-nested.json');
var refJson = require('./browser/ref.json');

var responses = {
  '/nested/project-circular-ancestor-child.json': projectCircularAncestorChildJson,
  '/nested/project-circular-ancestor-root.json': projectCircularAncestorRootJson,
  '/nested/project-circular-child.json': nestedProjectCircularChildJson,
  '/nested/project-circular-root.json': nestedProjectCircularRootJson,
  '/nested/project.json': nestedProjectJson,
  '/project-circular-child-descendant.json': projectCircularChildDescendantJson,
  '/project-circular-child.json': projectCircularChildJson,
  '/project-circular-root.json': projectCircularRootJson,
  '/project-nested.json': projectNestedJson,
  '/project.circular-root-descendant.json': projectCircularRootDescendantJson,
  '/project.json': projectJson,
  '/project.yaml': projectJson,
  '/ref.json': refJson
};

app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Accept,Allow,Authorization,Content-Type');
  res.setHeader('Access-Control-Request-Methods', 'GET,PUT,POST,DELETE');

  next();
});

app.use('/secure', function (req, res, next) {
  var user = basicAuth(req);

  if (!user || (user.name !== 'whitlockjc' || user.pass !== 'json-refs')) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="json-refs Test Realm"'
    });

    res.end();
  } else {
    next();
  }
});

app.use(function (req, res) {
  var contentType = 'application/json';
  var statusCode = 200;
  var response = responses[req.url.replace(/^\/secure/, '')];
  var content;

  if (typeof response === 'undefined') {
    statusCode = 404;
    content = '';
  } else {
    if (req.url.indexOf('.yaml') > -1) {
      content = YAML.safeDump(response);
      contentType = 'application/x-yaml';
    } else {
      content = JSON.stringify(response);
    }
  }

  res.setHeader('Content-Type', contentType);
  res.statusCode = statusCode;
  res.end(content);
});

module.exports.createServer = function (transport) {
  return transport.createServer(app);
};
