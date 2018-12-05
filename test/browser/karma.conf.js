/* Karma configuration for standalone build */
/* eslint-disable strict */
'use strict';

var babel = require('rollup-plugin-babel');
var resolve = require('rollup-plugin-node-resolve');
var commonjs = require('rollup-plugin-commonjs');
var json = require('rollup-plugin-json');
var replace = require('rollup-plugin-re');

module.exports = function (config) {
  console.log();
  console.log('Browser Tests');
  console.log();

  config.set({
    autoWatch: false,
    basePath: '..',
    browsers: [
      // The environment apparently adds code before the `import`, causing
      //   these two to fail
      'Chrome', 'Firefox'
      // 'Safari'
    ],
    frameworks: ['mocha'],
    reporters: ['mocha'],
    singleRun: true,
    files: [
      // Can add type: 'module', but that won't preprocess Node/commonjs, etc.
      {pattern: 'test-json-refs.js', watched: false},
      {pattern: 'browser/documents/**/*', watched: false, included: false}
    ],
    client: {
      mocha: {
        reporter: 'html',
        timeout: 10000,
        ui: 'bdd'
      }
    },
    plugins: [
      'karma-mocha',
      'karma-mocha-reporter',
      'karma-firefox-launcher',
      'karma-chrome-launcher',
      // 'karma-safari-launcher'
      'karma-rollup-preprocessor'
    ],
    preprocessors: {
      'test/**/*.js': ['rollup']
    },
    rollupPreprocessor: {
      /**
       * This is just a normal Rollup config object,
       * except that `input` is handled for you.
       */
      plugins: [
        replace({
          patterns: [
            {
              match: /formidable(\/|\\)lib/,
              test: 'if (global.GENTLY) require = GENTLY.hijack(require);',
              replace: '',
            }
          ]
        }), babel(), json(), resolve(), commonjs()
      ],
      output: {
        format: 'iife', // Helps prevent naming collisions.
        name: 'JsonRefs', // Required for 'iife' format.
        sourcemap: 'inline' // Sensible for testing.
      }
    }
  });
};
