var webpack = require('webpack');
var path = require('path');

module.exports = [{
  entry: './src/index.js',
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/env', {
                targets: 'cover 100%'
              }]
            ],
            plugins: ['babel-plugin-lodash']
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
  ]
}];
