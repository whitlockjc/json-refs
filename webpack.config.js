'use strict';

var path = require('path');

module.exports = [{
  devtool: 'inline-source-map',
  entry: './index.js',
  mode: 'development',
  module: {
    rules: [
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
  name: 'json-refs',
  optimization: {
    minimize: false
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'json-refs.js',
    library: 'JsonRefs'
  }
}, {
  entry: './index.js',
  mode: 'production',
  module: {
    rules: [
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
  name: 'json-refs-min',
  optimization: {
    minimize: true
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'json-refs-min.js',
    library: 'JsonRefs'
  }
}];
