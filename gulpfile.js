/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Jeremy Whitlock
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

var $ = require('gulp-load-plugins')({
  rename: {
    'gulp-jsdoc-to-markdown': 'jsdoc2MD'
  }
});
var del = require('del');
var gulp = require('gulp');
var gutil = require('gulp-util');
var KarmaServer = require('karma').Server;
var path = require('path');
var runSequence = require('run-sequence');
var webpack = require('webpack');
var webpackConfig = require('./webpack.config');

var runningAllTests = false;

// Load promises polyfill if necessary
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

function displayCoverageReport (display) {
  if (display) {
    gulp.src([])
      .pipe($.istanbul.writeReports());
  }
}

gulp.task('clean', function (done) {
  del([
    'bower_components',
    'coverage'
  ], done);
});

gulp.task('docs-raw', function () {
  return gulp.src([
    './index.js',
    './lib/typedefs.js'
  ])
    .pipe($.concat('API.md'))
    .pipe($.jsdoc2MD({'sort-by': ['category', 'name'], 'conf': 'jsdoc.config.json'}))
    .pipe(gulp.dest('docs'));
});

// Due to bugs in @otris/jsdoc-tsd, we need to "fix" the generated Markdown.
//
//  * https://github.com/jsdoc2md/jsdoc-to-markdown/issues/138
gulp.task('docs', ['docs-raw'], function () {
  return gulp.src(['docs/API.md'])
    .pipe($.replace('module:json-refs.UnresolvedRefDetails',
                    '[UnresolvedRefDetails](#module_json-refs.UnresolvedRefDetails)'))
    .pipe(gulp.dest('docs'));
});

gulp.task('dist', function (done) {
	webpack(webpackConfig, function (err, stats) {
		if (err) throw new gutil.PluginError('webpack', err);
		gutil.log('[webpack]', 'Bundles generated:\n' + stats.toString('minimal').split('\n').map(function (line) {
      return '  ' + line.replace('Child ', 'dist/').replace(':', '.js:');
    }).join('\n'));
		done();
	});
});

gulp.task('docs-ts-raw', function (done) {
  gulp.src([
    './index.js',
    './lib/typedefs.js'
  ])
    .pipe($.jsdoc3({
      opts: {
        destination: 'index.d.ts',
        template: 'node_modules/@otris/jsdoc-tsd'
      }
    }, done));
});

// Due to bugs in @otris/jsdoc-tsd, we need to "fix" the generated TSD.
//
//  * https://github.com/otris/jsdoc-tsd/issues/38
//  * https://github.com/otris/jsdoc-tsd/issues/39
gulp.task('docs-ts', ['docs-ts-raw'], function () {
  return gulp.src(['index.d.ts'])
    .pipe($.replace('<*>', '<any>'))
    .pipe($.replace('module:json-refs~', ''))
    .pipe($.replace('module:json-refs.', ''))
    .pipe($.replace('Promise.<', 'Promise<'))
    .pipe(gulp.dest('.'));
});

gulp.task('lint', function () {
  return gulp.src([
      'index.js',
      'lib/typedefs.js',
      'test/**/*.js',
      '!test/browser/**/*.js',
      'gulpfile.js'
    ])
    .pipe($.eslint())
    .pipe($.eslint.format('stylish'))
    .pipe($.eslint.failAfterError());
});

gulp.task('pre-test', function () {
  return gulp.src([
    'index.js',
    'lib/**/*.js'
  ])
    .pipe($.istanbul({includeUntested: true}))
    .pipe($.istanbul.hookRequire()); // Force `require` to return covered files
});

gulp.task('test-node', ['pre-test'], function () {
  return gulp.src([
    'test/test-cli.js',
    'test/test-json-refs.js'
  ])
    .pipe($.mocha({
      reporter: 'spec',
      timeout: 5000
    }))
    .on('end', function () {
      displayCoverageReport(!runningAllTests);
    });
});

gulp.task('test-browser', function () {
  var basePath = './test/browser/';

  function cleanUp () {
    // Clean up just in case
    del.sync([
      basePath + 'json-refs.js',
      basePath + 'json-refs-standalone.js',
      basePath + 'test-browser.js'
    ]);
  }


  return new Promise(function (resolve, reject) {
    cleanUp();

    new KarmaServer({
      configFile: path.join(__dirname, 'test/browser/karma.conf.js'),
      singleRun: true
    }, function (err) {
      cleanUp();

      displayCoverageReport(runningAllTests);

      if (err) {
        reject(err);
      } else {
        resolve();
      }
    }).start();
  });
});

gulp.task('test', function (done) {
  runningAllTests = true;

  // Done this way to ensure that test-node runs prior to test-browser.  Since both of those tasks are independent,
  // doing this 'The Gulp Way' isn't feasible.
  runSequence('test-node', 'test-browser', done);
});

gulp.task('default', function (done) {
  // Done this way to run in series until we upgrade to Gulp 4.x+
  runSequence('lint', 'test', 'dist', 'docs', 'docs-ts', done);
});
