import babel from 'rollup-plugin-babel';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import replace from 'rollup-plugin-re';
import {terser} from 'rollup-plugin-terser';

/**
 * @external RollupConfig
 * @type {PlainObject}
 * @see {@link https://rollupjs.org/guide/en#big-list-of-options}
 */

/**
 * @param {PlainObject} config
 * @param {boolean} config.minifying
 * @param {string} [config.format='umd'} = {}]
 * @returns {external:RollupConfig}
 */
function getRollupObject ({minifying, format = 'umd'} = {}) {
  const nonMinified = {
    input: 'index.js',
    output: {
      format,
      sourcemap: minifying,
      file: `dist/json-refs${format !== 'umd' ? '-' + format : ''}${minifying ? '-min' : ''}.js`,
      name: 'JsonRefs'
    },
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
    ]
  };

  if (minifying) {
    nonMinified.plugins.push(terser());
  }
  return nonMinified;
}

export default [
  getRollupObject({format: 'umd', minifying: false}),
  getRollupObject({format: 'umd', minifying: true}),
  getRollupObject({format: 'esm', minifying: false}),
  getRollupObject({format: 'esm', minifying: true})
];
