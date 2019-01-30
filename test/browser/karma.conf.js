/* Karma configuration for standalone build */

'use strict';

module.exports = function (config) {
  console.log();
  console.log('Browser Tests');
  console.log();

  config.set({
    autoWatch: false,
    basePath: '..',
    browsers: ['PhantomJS'],
    frameworks: ['mocha'],
    reporters: ['mocha'],
    singleRun: true,
    files: [
      {pattern: 'test-json-refs.js', watch: false},
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
      'karma-phantomjs-launcher',
      'karma-webpack'
    ],
    preprocessors: {
      'test-json-refs.js': ['webpack']
    },
    webpack: {
      mode: 'development',
      module: {
        rules: [
          {
            test: /\.js$/,
            loader: 'transform-loader?brfs'
          },
          {
            test: /\.js$/,
            use: {
              loader: 'babel-loader',
              options: {
                presets: ['@babel/env']
              }
            }
          }
        ]
      },
      node: {
        fs: 'empty'
      }
    },
    webpackMiddleware: {
      stats: 'errors-only'
    }
  });
};
