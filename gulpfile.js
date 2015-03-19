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

var _ = require('lodash-compat');
var browserify = require('browserify');
var exposify = require('exposify');
var gulp = require('gulp');
var istanbul = require('gulp-istanbul');
var jshint = require('gulp-jshint');
var mocha = require('gulp-mocha');
var source = require('vinyl-source-stream');

gulp.task('browserify', function () {
  // Builds 4 browser binaries:
  //
  // 1 (json-refs.js): Bower build without uglification and including source maps
  // 2 (json-refs-min.js): Bower build uglified and without source maps
  // 3 (json-refs-standalone.js): Standalone build without uglification and including source maps
  // 4 (json-refs-standalone-min.js): Standalone build uglified and without source maps

  _.times(4, function (n) {
    var useDebug = n === 0 || n === 2;
    var isStandalone = n >= 2;
    var b = browserify('index.js', {
      debug: useDebug,
      standalone: 'JsonRefs'
    });

    if (!useDebug) {
      b.transform({global: true}, 'uglifyify');
    }

    if (!isStandalone) {
      // Expose Bower modules so they can be required
      exposify.config = {
        'lodash-compat': '_',
        'traverse': 'traverse'
      };

      b.transform('exposify');
    }

    b.transform('brfs')
      .bundle()
      .pipe(source('json-refs' + (isStandalone ? '-standalone' : '') + (!useDebug ? '-min' : '') + '.js'))
      .pipe(gulp.dest('browser/'));
  });
});

gulp.task('lint', function () {
  return gulp.src([
      'index.js',
      'test/**/*.js',
      'gulpfile.js'
    ])
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(jshint.reporter('fail'));
});

gulp.task('test', function () {
  gulp.src('index.js')
    .pipe(istanbul({includeUntested: true}))
    .pipe(istanbul.hookRequire()) // Force `require` to return covered files 
    .on('finish', function () {
      gulp.src('test/**/test-*.js')
        .pipe(mocha({reporter: 'spec'}))
        .pipe(istanbul.writeReports());
    });
});

gulp.task('default', ['lint', 'test']);
gulp.task('dist', ['default', 'browserify']);
