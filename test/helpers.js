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
var nestedPersonJson = require('./browser/nested/project.json');
var personJson = require('./browser/project.json');
var personNestedJson = require('./browser/project-nested.json');
var refJson = require('./browser/ref.json');

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
  switch (req.url) {
  case '/ref.json':
  case '/secure/ref.json':
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(refJson));

    break;
  case '/project.json':
  case '/secure/project.json':
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(personJson));

    break;
  case '/project-nested.json':
  case '/secure/project-nested.json':
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(personNestedJson));

    break;
  case '/nested/project.json':
  case '/secure/nested/project.json':
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(nestedPersonJson));

    break;
  case '/project.yaml':
  case '/secure/project.yaml':
    res.setHeader('Content-Type', 'application/x-yaml');
    res.statusCode = 200;
    res.end(YAML.safeDump(personJson));

    break;
  default:
    res.writeHead(404);
    res.end();
  }
});

module.exports.createServer = function (transport) {
  return transport.createServer(app);
};
