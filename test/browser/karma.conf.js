/* Karma configuration for standalone build */
const webpack = require('webpack');

module.exports = function (config) {
  console.log();
  console.log('Browser Tests');
  console.log();

  config.set({
    autoWatch: false,
    basePath: '..',
    browsers: ['jsdom'],
    frameworks: ['webpack', 'mocha'],
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
      'karma-jsdom-launcher',
      'karma-mocha',
      'karma-mocha-reporter',
      'karma-webpack',
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
            loader: 'babel-loader',
            options: {
              presets: ['@babel/env'],
              plugins: ['babel-plugin-static-fs']
            }
          }
        ]
      },
      node: {
        global: true,
      },
      resolve: {
        fallback: {
          'path': require.resolve('path-browserify'),
          'querystring': require.resolve('query-string'),
          'assert': require.resolve('assert'),
          'buffer': require.resolve('buffer'),
        }
      },
      plugins: [
        new webpack.ProvidePlugin({
          process: 'process',
        }),
        // new webpack.DefinePlugin({
        //   global: 'window'
        // })
      ]
    },
    webpackMiddleware: {
      stats: 'errors-only'
    }
  });
};
