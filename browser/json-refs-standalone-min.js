(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.JsonRefs = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";function computeUrl(e,r){function n(e){".."===e?i.pop():"."!==e&&""!==e&&i.push(e)}var t="#"!==r.charAt(0)&&-1===r.indexOf(":"),i="/"===(e||"").charAt(0)?[""]:[],o=r.split("#")[0].split("/");return _.each((e||"").split("#")[0].split("/"),n),t?_.each(o,n):i=o,i.join("/")}function getRemoteJson(e,r,n){var t,i=computeUrl(r.location,e),o=remoteCache[i];_.isUndefined(o)?(t=pathLoader.load(i,r),t=t.then(r.processContent?function(e){return r.processContent(e,i)}:JSON.parse),t.then(function(e){return remoteCache[i]=e,e}).then(function(e){n(void 0,e)},function(e){n(e)})):n(void 0,o)}"undefined"==typeof Promise&&require("native-promise-only");var _={cloneDeep:require("lodash-compat/lang/cloneDeep"),each:require("lodash-compat/collection/each"),indexOf:require("lodash-compat/array/indexOf"),isArray:require("lodash-compat/lang/isArray"),isFunction:require("lodash-compat/lang/isFunction"),isPlainObject:require("lodash-compat/lang/isPlainObject"),isString:require("lodash-compat/lang/isString"),isUndefined:require("lodash-compat/lang/isUndefined"),keys:require("lodash-compat/object/keys"),lastIndexOf:require("lodash-compat/array/lastIndexOf"),map:require("lodash-compat/collection/map"),size:require("lodash-compat/collection/size")},pathLoader=require("path-loader"),traverse=require("traverse"),remoteCache={},supportedSchemes=["file","http","https"];module.exports.clearCache=function(){remoteCache={}};var isJsonReference=module.exports.isJsonReference=function(e){return _.isPlainObject(e)&&_.isString(e.$ref)},pathToPointer=module.exports.pathToPointer=function(e){if(_.isUndefined(e))throw new Error("path is required");if(!_.isArray(e))throw new Error("path must be an array");var r="#";return e.length>0&&(r+="/"+_.map(e,function(e){return e.replace(/~/g,"~0").replace(/\//g,"~1")}).join("/")),r},findRefs=module.exports.findRefs=function(e){if(_.isUndefined(e))throw new Error("json is required");if(!_.isPlainObject(e))throw new Error("json must be an object");return traverse(e).reduce(function(e){var r=this.node;return"$ref"===this.key&&isJsonReference(this.parent.node)&&(e[pathToPointer(this.path)]=r),e},{})},isRemotePointer=module.exports.isRemotePointer=function(e){if(_.isUndefined(e))throw new Error("ptr is required");if(!_.isString(e))throw new Error("ptr must be a string");return""!==e&&-1===_.indexOf(["#","/"],e.charAt(0))},pathFromPointer=module.exports.pathFromPointer=function(e){if(_.isUndefined(e))throw new Error("ptr is required");if(!_.isString(e))throw new Error("ptr must be a string");var r=[];return isRemotePointer(e)?r=e:"#"===e.charAt(0)&&"#"!==e&&(r=_.map(e.substring(1).split("/"),function(e){return e.replace(/~0/g,"~").replace(/~1/g,"/")}),r.length>1&&r.shift()),r};module.exports.resolveRefs=function e(r,n,t){function i(e){return e.map(function(){this.circular&&this.update(traverse(this.node).map(function(){this.circular&&this.parent.remove()}))})}function o(e,r,n,t){var i,o,s,a={ref:n},c=!1;n=-1===n.indexOf("#")?"#":n.substring(n.indexOf("#")),c=!r.has(pathFromPointer(n)),s=r.get(pathFromPointer(n)),o=pathFromPointer(t),i=o.slice(0,o.length-1),0===i.length?e.value=s:e.set(i,s),c||(a.value=s),d[t]=a}if(arguments.length<3?(t=arguments[1],n={}):_.isUndefined(n)&&(n={}),_.isUndefined(r))throw new Error("json is required");if(!_.isPlainObject(r))throw new Error("json must be an object");if(!_.isPlainObject(n))throw new Error("options must be an object");if(_.isUndefined(t))throw new Error("done is required");if(!_.isUndefined(t)&&!_.isFunction(t))throw new Error("done must be a function");if(!_.isUndefined(n.processContent)&&!_.isFunction(n.processContent))throw new Error("options.processContent must be a function");if(!_.isUndefined(n.location)&&!_.isString(n.location))throw new Error("options.location must be a string");var s,a,c={},u=findRefs(r),d={};Object.keys(u).length>0?(a=traverse(_.cloneDeep(r)),_.each(u,function(e,r){isRemotePointer(e)?c[r]=e:o(a,a,e,r)}),_.size(c)>0?(s=Promise.resolve(),_.each(c,function(r,t){var i,c=-1===_.indexOf(r,":")?void 0:r.split(":")[0];i=-1!==_.indexOf(supportedSchemes,c)||_.isUndefined(c)?new Promise(function(i,s){getRemoteJson(r,n,function(c,u){var d=_.cloneDeep(n),f=r.split("#")[0];f=f.substring(0,_.lastIndexOf(f,"/")+1),d.location=computeUrl(n.location,f),c?s(c):e(u,d,function(e,n){e?s(e):(o(a,traverse(n),r,t),i())})})}):Promise.resolve(),s=s.then(function(){return i})}),s.then(function(){t(void 0,i(a),d)},function(e){t(e)})):t(void 0,i(a),d)):t(void 0,r,d)};
},{"lodash-compat/array/indexOf":2,"lodash-compat/array/lastIndexOf":4,"lodash-compat/collection/each":5,"lodash-compat/collection/map":7,"lodash-compat/collection/size":8,"lodash-compat/lang/cloneDeep":60,"lodash-compat/lang/isArray":62,"lodash-compat/lang/isFunction":63,"lodash-compat/lang/isPlainObject":66,"lodash-compat/lang/isString":67,"lodash-compat/lang/isUndefined":69,"lodash-compat/object/keys":70,"native-promise-only":77,"path-loader":78,"traverse":84}],2:[function(require,module,exports){
function indexOf(e,n,r){var a=e?e.length:0;if(!a)return-1;if("number"==typeof r)r=0>r?nativeMax(a+r,0):r;else if(r){var i=binaryIndex(e,n),t=e[i];return(n===n?n===t:t!==t)?i:-1}return baseIndexOf(e,n,r||0)}var baseIndexOf=require("../internal/baseIndexOf"),binaryIndex=require("../internal/binaryIndex"),nativeMax=Math.max;module.exports=indexOf;


},{"../internal/baseIndexOf":21,"../internal/binaryIndex":33}],3:[function(require,module,exports){
function last(t){var e=t?t.length:0;return e?t[e-1]:void 0}module.exports=last;


},{}],4:[function(require,module,exports){
function lastIndexOf(n,e,r){var a=n?n.length:0;if(!a)return-1;var i=a;if("number"==typeof r)i=(0>r?nativeMax(a+r,0):nativeMin(r||0,a-1))+1;else if(r){i=binaryIndex(n,e,!0)-1;var t=n[i];return(e===e?e===t:t!==t)?i:-1}if(e!==e)return indexOfNaN(n,i,!0);for(;i--;)if(n[i]===e)return i;return-1}var binaryIndex=require("../internal/binaryIndex"),indexOfNaN=require("../internal/indexOfNaN"),nativeMax=Math.max,nativeMin=Math.min;module.exports=lastIndexOf;


},{"../internal/binaryIndex":33,"../internal/indexOfNaN":45}],5:[function(require,module,exports){
module.exports=require("./forEach");


},{"./forEach":6}],6:[function(require,module,exports){
var arrayEach=require("../internal/arrayEach"),baseEach=require("../internal/baseEach"),createForEach=require("../internal/createForEach"),forEach=createForEach(arrayEach,baseEach);module.exports=forEach;


},{"../internal/arrayEach":10,"../internal/baseEach":16,"../internal/createForEach":39}],7:[function(require,module,exports){
function map(a,r,e){var i=isArray(a)?arrayMap:baseMap;return r=baseCallback(r,e,3),i(a,r)}var arrayMap=require("../internal/arrayMap"),baseCallback=require("../internal/baseCallback"),baseMap=require("../internal/baseMap"),isArray=require("../lang/isArray");module.exports=map;


},{"../internal/arrayMap":11,"../internal/baseCallback":13,"../internal/baseMap":26,"../lang/isArray":62}],8:[function(require,module,exports){
function size(e){var t=e?getLength(e):0;return isLength(t)?t:keys(e).length}var getLength=require("../internal/getLength"),isLength=require("../internal/isLength"),keys=require("../object/keys");module.exports=size;


},{"../internal/getLength":43,"../internal/isLength":53,"../object/keys":70}],9:[function(require,module,exports){
function arrayCopy(r,a){var o=-1,y=r.length;for(a||(a=Array(y));++o<y;)a[o]=r[o];return a}module.exports=arrayCopy;


},{}],10:[function(require,module,exports){
function arrayEach(r,a){for(var e=-1,n=r.length;++e<n&&a(r[e],e,r)!==!1;);return r}module.exports=arrayEach;


},{}],11:[function(require,module,exports){
function arrayMap(r,a){for(var e=-1,n=r.length,o=Array(n);++e<n;)o[e]=a(r[e],e,r);return o}module.exports=arrayMap;


},{}],12:[function(require,module,exports){
var baseCopy=require("./baseCopy"),getSymbols=require("./getSymbols"),isNative=require("../lang/isNative"),keys=require("../object/keys"),preventExtensions=isNative(preventExtensions=Object.preventExtensions)&&preventExtensions,nativeAssign=function(){var e=preventExtensions&&isNative(e=Object.assign)&&e;try{if(e){var s=preventExtensions({1:0});s[0]=1}}catch(n){try{e(s,"xo")}catch(n){}return!s[1]&&e}return!1}(),baseAssign=nativeAssign||function(e,s){return null==s?e:baseCopy(s,getSymbols(s),baseCopy(s,keys(s),e))};module.exports=baseAssign;


},{"../lang/isNative":64,"../object/keys":70,"./baseCopy":15,"./getSymbols":44}],13:[function(require,module,exports){
function baseCallback(e,t,r){var a=typeof e;return"function"==a?void 0===t?e:bindCallback(e,t,r):null==e?identity:"object"==a?baseMatches(e):void 0===t?property(e):baseMatchesProperty(e,t)}var baseMatches=require("./baseMatches"),baseMatchesProperty=require("./baseMatchesProperty"),bindCallback=require("./bindCallback"),identity=require("../utility/identity"),property=require("../utility/property");module.exports=baseCallback;


},{"../utility/identity":75,"../utility/property":76,"./baseMatches":27,"./baseMatchesProperty":28,"./bindCallback":35}],14:[function(require,module,exports){
function baseClone(a,e,r,t,o,n,g){var l;if(r&&(l=o?r(a,t,o):r(a)),void 0!==l)return l;if(!isObject(a))return a;var b=isArray(a);if(b){if(l=initCloneArray(a),!e)return arrayCopy(a,l)}else{var T=objToString.call(a),i=T==funcTag;if(T!=objectTag&&T!=argsTag&&(!i||o))return cloneableTags[T]?initCloneByTag(a,T,e):o?a:{};if(isHostObject(a))return o?a:{};if(l=initCloneObject(i?{}:a),!e)return baseAssign(l,a)}n||(n=[]),g||(g=[]);for(var c=n.length;c--;)if(n[c]==a)return g[c];return n.push(a),g.push(l),(b?arrayEach:baseForOwn)(a,function(t,o){l[o]=baseClone(t,e,r,o,a,n,g)}),l}var arrayCopy=require("./arrayCopy"),arrayEach=require("./arrayEach"),baseAssign=require("./baseAssign"),baseForOwn=require("./baseForOwn"),initCloneArray=require("./initCloneArray"),initCloneByTag=require("./initCloneByTag"),initCloneObject=require("./initCloneObject"),isArray=require("../lang/isArray"),isHostObject=require("./isHostObject"),isObject=require("../lang/isObject"),argsTag="[object Arguments]",arrayTag="[object Array]",boolTag="[object Boolean]",dateTag="[object Date]",errorTag="[object Error]",funcTag="[object Function]",mapTag="[object Map]",numberTag="[object Number]",objectTag="[object Object]",regexpTag="[object RegExp]",setTag="[object Set]",stringTag="[object String]",weakMapTag="[object WeakMap]",arrayBufferTag="[object ArrayBuffer]",float32Tag="[object Float32Array]",float64Tag="[object Float64Array]",int8Tag="[object Int8Array]",int16Tag="[object Int16Array]",int32Tag="[object Int32Array]",uint8Tag="[object Uint8Array]",uint8ClampedTag="[object Uint8ClampedArray]",uint16Tag="[object Uint16Array]",uint32Tag="[object Uint32Array]",cloneableTags={};cloneableTags[argsTag]=cloneableTags[arrayTag]=cloneableTags[arrayBufferTag]=cloneableTags[boolTag]=cloneableTags[dateTag]=cloneableTags[float32Tag]=cloneableTags[float64Tag]=cloneableTags[int8Tag]=cloneableTags[int16Tag]=cloneableTags[int32Tag]=cloneableTags[numberTag]=cloneableTags[objectTag]=cloneableTags[regexpTag]=cloneableTags[stringTag]=cloneableTags[uint8Tag]=cloneableTags[uint8ClampedTag]=cloneableTags[uint16Tag]=cloneableTags[uint32Tag]=!0,cloneableTags[errorTag]=cloneableTags[funcTag]=cloneableTags[mapTag]=cloneableTags[setTag]=cloneableTags[weakMapTag]=!1;var objectProto=Object.prototype,objToString=objectProto.toString;module.exports=baseClone;


},{"../lang/isArray":62,"../lang/isObject":65,"./arrayCopy":9,"./arrayEach":10,"./baseAssign":12,"./baseForOwn":19,"./initCloneArray":46,"./initCloneByTag":47,"./initCloneObject":48,"./isHostObject":50}],15:[function(require,module,exports){
function baseCopy(e,o,r){r||(r={});for(var a=-1,n=o.length;++a<n;){var t=o[a];r[t]=e[t]}return r}module.exports=baseCopy;


},{}],16:[function(require,module,exports){
var baseForOwn=require("./baseForOwn"),createBaseEach=require("./createBaseEach"),baseEach=createBaseEach(baseForOwn);module.exports=baseEach;


},{"./baseForOwn":19,"./createBaseEach":37}],17:[function(require,module,exports){
var createBaseFor=require("./createBaseFor"),baseFor=createBaseFor();module.exports=baseFor;


},{"./createBaseFor":38}],18:[function(require,module,exports){
function baseForIn(e,r){return baseFor(e,r,keysIn)}var baseFor=require("./baseFor"),keysIn=require("../object/keysIn");module.exports=baseForIn;


},{"../object/keysIn":71,"./baseFor":17}],19:[function(require,module,exports){
function baseForOwn(e,r){return baseFor(e,r,keys)}var baseFor=require("./baseFor"),keys=require("../object/keys");module.exports=baseForOwn;


},{"../object/keys":70,"./baseFor":17}],20:[function(require,module,exports){
function baseGet(e,t,o){if(null!=e){e=toObject(e),void 0!==o&&o in e&&(t=[o]);for(var r=-1,n=t.length;null!=e&&++r<n;)e=toObject(e)[t[r]];return r&&r==n?e:void 0}}var toObject=require("./toObject");module.exports=baseGet;


},{"./toObject":58}],21:[function(require,module,exports){
function baseIndexOf(e,r,n){if(r!==r)return indexOfNaN(e,n);for(var f=n-1,a=e.length;++f<a;)if(e[f]===r)return f;return-1}var indexOfNaN=require("./indexOfNaN");module.exports=baseIndexOf;


},{"./indexOfNaN":45}],22:[function(require,module,exports){
function baseIsEqual(e,u,a,s,l,n){if(e===u)return!0;var t=typeof e,o=typeof u;return"function"!=t&&"object"!=t&&"function"!=o&&"object"!=o||null==e||null==u?e!==e&&u!==u:baseIsEqualDeep(e,u,baseIsEqual,a,s,l,n)}var baseIsEqualDeep=require("./baseIsEqualDeep");module.exports=baseIsEqual;


},{"./baseIsEqualDeep":23}],23:[function(require,module,exports){
function baseIsEqualDeep(r,e,a,t,o,s,u){var i=isArray(r),b=isArray(e),c=arrayTag,g=arrayTag;i||(c=objToString.call(r),c==argsTag?c=objectTag:c!=objectTag&&(i=isTypedArray(r))),b||(g=objToString.call(e),g==argsTag?g=objectTag:g!=objectTag&&(b=isTypedArray(e)));var y=c==objectTag&&!isHostObject(r),j=g==objectTag&&!isHostObject(e),l=c==g;if(l&&!i&&!y)return equalByTag(r,e,c);if(!o){var p=y&&hasOwnProperty.call(r,"__wrapped__"),T=j&&hasOwnProperty.call(e,"__wrapped__");if(p||T)return a(p?r.value():r,T?e.value():e,t,o,s,u)}if(!l)return!1;s||(s=[]),u||(u=[]);for(var n=s.length;n--;)if(s[n]==r)return u[n]==e;s.push(r),u.push(e);var q=(i?equalArrays:equalObjects)(r,e,a,t,o,s,u);return s.pop(),u.pop(),q}var equalArrays=require("./equalArrays"),equalByTag=require("./equalByTag"),equalObjects=require("./equalObjects"),isArray=require("../lang/isArray"),isHostObject=require("./isHostObject"),isTypedArray=require("../lang/isTypedArray"),argsTag="[object Arguments]",arrayTag="[object Array]",objectTag="[object Object]",objectProto=Object.prototype,hasOwnProperty=objectProto.hasOwnProperty,objToString=objectProto.toString;module.exports=baseIsEqualDeep;


},{"../lang/isArray":62,"../lang/isTypedArray":68,"./equalArrays":40,"./equalByTag":41,"./equalObjects":42,"./isHostObject":50}],24:[function(require,module,exports){
function baseIsFunction(n){return"function"==typeof n||!1}module.exports=baseIsFunction;


},{}],25:[function(require,module,exports){
function baseIsMatch(e,r,a,s,i){for(var u=-1,n=r.length,o=!i;++u<n;)if(o&&s[u]?a[u]!==e[r[u]]:!(r[u]in e))return!1;for(u=-1;++u<n;){var t=r[u],v=e[t],f=a[u];if(o&&s[u])var l=void 0!==v||t in e;else l=i?i(v,f,t):void 0,void 0===l&&(l=baseIsEqual(f,v,i,!0));if(!l)return!1}return!0}var baseIsEqual=require("./baseIsEqual");module.exports=baseIsMatch;


},{"./baseIsEqual":22}],26:[function(require,module,exports){
function baseMap(r,a){var e=-1,i=isArrayLike(r)?Array(r.length):[];return baseEach(r,function(r,s,n){i[++e]=a(r,s,n)}),i}var baseEach=require("./baseEach"),isArrayLike=require("./isArrayLike");module.exports=baseMap;


},{"./baseEach":16,"./isArrayLike":49}],27:[function(require,module,exports){
function baseMatches(t){var r=keys(t),e=r.length;if(!e)return constant(!0);if(1==e){var a=r[0],i=t[a];if(isStrictComparable(i))return function(t){return null==t?!1:(t=toObject(t),t[a]===i&&(void 0!==i||a in t))}}for(var n=Array(e),s=Array(e);e--;)i=t[r[e]],n[e]=i,s[e]=isStrictComparable(i);return function(t){return null!=t&&baseIsMatch(toObject(t),r,n,s)}}var baseIsMatch=require("./baseIsMatch"),constant=require("../utility/constant"),isStrictComparable=require("./isStrictComparable"),keys=require("../object/keys"),toObject=require("./toObject");module.exports=baseMatches;


},{"../object/keys":70,"../utility/constant":74,"./baseIsMatch":25,"./isStrictComparable":55,"./toObject":58}],28:[function(require,module,exports){
function baseMatchesProperty(e,r){var t=isArray(e),a=isKey(e)&&isStrictComparable(r),i=e+"";return e=toPath(e),function(s){if(null==s)return!1;var u=i;if(s=toObject(s),!(!t&&a||u in s)){if(s=1==e.length?s:baseGet(s,baseSlice(e,0,-1)),null==s)return!1;u=last(e),s=toObject(s)}return s[u]===r?void 0!==r||u in s:baseIsEqual(r,s[u],null,!0)}}var baseGet=require("./baseGet"),baseIsEqual=require("./baseIsEqual"),baseSlice=require("./baseSlice"),isArray=require("../lang/isArray"),isKey=require("./isKey"),isStrictComparable=require("./isStrictComparable"),last=require("../array/last"),toObject=require("./toObject"),toPath=require("./toPath");module.exports=baseMatchesProperty;


},{"../array/last":3,"../lang/isArray":62,"./baseGet":20,"./baseIsEqual":22,"./baseSlice":31,"./isKey":52,"./isStrictComparable":55,"./toObject":58,"./toPath":59}],29:[function(require,module,exports){
function baseProperty(e){return function(t){return null==t?void 0:toObject(t)[e]}}var toObject=require("./toObject");module.exports=baseProperty;


},{"./toObject":58}],30:[function(require,module,exports){
function basePropertyDeep(e){var t=e+"";return e=toPath(e),function(r){return baseGet(r,e,t)}}var baseGet=require("./baseGet"),toPath=require("./toPath");module.exports=basePropertyDeep;


},{"./baseGet":20,"./toPath":59}],31:[function(require,module,exports){
function baseSlice(e,r,l){var a=-1,n=e.length;r=null==r?0:+r||0,0>r&&(r=-r>n?0:n+r),l=void 0===l||l>n?n:+l||0,0>l&&(l+=n),n=r>l?0:l-r>>>0,r>>>=0;for(var o=Array(n);++a<n;)o[a]=e[a+r];return o}module.exports=baseSlice;


},{}],32:[function(require,module,exports){
function baseToString(n){return"string"==typeof n?n:null==n?"":n+""}module.exports=baseToString;


},{}],33:[function(require,module,exports){
function binaryIndex(e,n,r){var i=0,t=e?e.length:i;if("number"==typeof n&&n===n&&HALF_MAX_ARRAY_LENGTH>=t){for(;t>i;){var A=i+t>>>1,y=e[A];(r?n>=y:n>y)?i=A+1:t=A}return t}return binaryIndexBy(e,n,identity,r)}var binaryIndexBy=require("./binaryIndexBy"),identity=require("../utility/identity"),MAX_ARRAY_LENGTH=Math.pow(2,32)-1,HALF_MAX_ARRAY_LENGTH=MAX_ARRAY_LENGTH>>>1;module.exports=binaryIndex;


},{"../utility/identity":75,"./binaryIndexBy":34}],34:[function(require,module,exports){
function binaryIndexBy(n,o,r,A){o=r(o);for(var a=0,i=n?n.length:0,e=o!==o,t=void 0===o;i>a;){var M=floor((a+i)/2),v=r(n[M]),R=v===v;if(e)var _=R||A;else _=t?R&&(A||void 0!==v):A?o>=v:o>v;_?a=M+1:i=M}return nativeMin(i,MAX_ARRAY_INDEX)}var floor=Math.floor,nativeMin=Math.min,MAX_ARRAY_LENGTH=Math.pow(2,32)-1,MAX_ARRAY_INDEX=MAX_ARRAY_LENGTH-1;module.exports=binaryIndexBy;


},{}],35:[function(require,module,exports){
function bindCallback(n,t,r){if("function"!=typeof n)return identity;if(void 0===t)return n;switch(r){case 1:return function(r){return n.call(t,r)};case 3:return function(r,e,u){return n.call(t,r,e,u)};case 4:return function(r,e,u,i){return n.call(t,r,e,u,i)};case 5:return function(r,e,u,i,c){return n.call(t,r,e,u,i,c)}}return function(){return n.apply(t,arguments)}}var identity=require("../utility/identity");module.exports=bindCallback;


},{"../utility/identity":75}],36:[function(require,module,exports){
(function (global){
function bufferClone(r){return bufferSlice.call(r,0)}var constant=require("../utility/constant"),isNative=require("../lang/isNative"),ArrayBuffer=isNative(ArrayBuffer=global.ArrayBuffer)&&ArrayBuffer,bufferSlice=isNative(bufferSlice=ArrayBuffer&&new ArrayBuffer(0).slice)&&bufferSlice,floor=Math.floor,Uint8Array=isNative(Uint8Array=global.Uint8Array)&&Uint8Array,Float64Array=function(){try{var r=isNative(r=global.Float64Array)&&r,e=new r(new ArrayBuffer(10),0,1)&&r}catch(a){}return e}(),FLOAT64_BYTES_PER_ELEMENT=Float64Array?Float64Array.BYTES_PER_ELEMENT:0;bufferSlice||(bufferClone=ArrayBuffer&&Uint8Array?function(r){var e=r.byteLength,a=Float64Array?floor(e/FLOAT64_BYTES_PER_ELEMENT):0,t=a*FLOAT64_BYTES_PER_ELEMENT,f=new ArrayBuffer(e);if(a){var n=new Float64Array(f,0,a);n.set(new Float64Array(r,0,a))}return e!=t&&(n=new Uint8Array(f,t),n.set(new Uint8Array(r,t))),f}:constant(null)),module.exports=bufferClone;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../lang/isNative":64,"../utility/constant":74}],37:[function(require,module,exports){
function createBaseEach(e,t){return function(r,n){var a=r?getLength(r):0;if(!isLength(a))return e(r,n);for(var c=t?a:-1,g=toObject(r);(t?c--:++c<a)&&n(g[c],c,g)!==!1;);return r}}var getLength=require("./getLength"),isLength=require("./isLength"),toObject=require("./toObject");module.exports=createBaseEach;


},{"./getLength":43,"./isLength":53,"./toObject":58}],38:[function(require,module,exports){
function createBaseFor(e){return function(r,t,o){for(var a=toObject(r),c=o(r),n=c.length,u=e?n:-1;e?u--:++u<n;){var b=c[u];if(t(a[b],b,a)===!1)break}return r}}var toObject=require("./toObject");module.exports=createBaseFor;


},{"./toObject":58}],39:[function(require,module,exports){
function createForEach(r,a){return function(e,i,n){return"function"==typeof i&&void 0===n&&isArray(e)?r(e,i):a(e,bindCallback(i,n,3))}}var bindCallback=require("./bindCallback"),isArray=require("../lang/isArray");module.exports=createForEach;


},{"../lang/isArray":62,"./bindCallback":35}],40:[function(require,module,exports){
function equalArrays(r,e,a,o,f,i,l){var n=-1,t=r.length,u=e.length,v=!0;if(t!=u&&!(f&&u>t))return!1;for(;v&&++n<t;){var s=r[n],d=e[n];if(v=void 0,o&&(v=f?o(d,s,n):o(s,d,n)),void 0===v)if(f)for(var g=u;g--&&(d=e[g],!(v=s&&s===d||a(s,d,o,f,i,l))););else v=s&&s===d||a(s,d,o,f,i,l)}return!!v}module.exports=equalArrays;


},{}],41:[function(require,module,exports){
function equalByTag(e,a,r){switch(r){case boolTag:case dateTag:return+e==+a;case errorTag:return e.name==a.name&&e.message==a.message;case numberTag:return e!=+e?a!=+a:e==+a;case regexpTag:case stringTag:return e==a+""}return!1}var boolTag="[object Boolean]",dateTag="[object Date]",errorTag="[object Error]",numberTag="[object Number]",regexpTag="[object RegExp]",stringTag="[object String]";module.exports=equalByTag;


},{}],42:[function(require,module,exports){
function equalObjects(r,t,o,e,n,c,s){var i=keys(r),u=i.length,a=keys(t),f=a.length;if(u!=f&&!n)return!1;for(var y=n,p=-1;++p<u;){var v=i[p],l=n?v in t:hasOwnProperty.call(t,v);if(l){var b=r[v],j=t[v];l=void 0,e&&(l=n?e(j,b,v):e(b,j,v)),void 0===l&&(l=b&&b===j||o(b,j,e,n,c,s))}if(!l)return!1;y||(y="constructor"==v)}if(!y){var O=r.constructor,h=t.constructor;if(O!=h&&"constructor"in r&&"constructor"in t&&!("function"==typeof O&&O instanceof O&&"function"==typeof h&&h instanceof h))return!1}return!0}var keys=require("../object/keys"),objectProto=Object.prototype,hasOwnProperty=objectProto.hasOwnProperty;module.exports=equalObjects;


},{"../object/keys":70}],43:[function(require,module,exports){
var baseProperty=require("./baseProperty"),getLength=baseProperty("length");module.exports=getLength;


},{"./baseProperty":29}],44:[function(require,module,exports){
var constant=require("../utility/constant"),isNative=require("../lang/isNative"),toObject=require("./toObject"),getOwnPropertySymbols=isNative(getOwnPropertySymbols=Object.getOwnPropertySymbols)&&getOwnPropertySymbols,getSymbols=getOwnPropertySymbols?function(t){return getOwnPropertySymbols(toObject(t))}:constant([]);module.exports=getSymbols;


},{"../lang/isNative":64,"../utility/constant":74,"./toObject":58}],45:[function(require,module,exports){
function indexOfNaN(r,e,n){for(var f=r.length,t=e+(n?0:-1);n?t--:++t<f;){var a=r[t];if(a!==a)return t}return-1}module.exports=indexOfNaN;


},{}],46:[function(require,module,exports){
function initCloneArray(t){var r=t.length,n=new t.constructor(r);return r&&"string"==typeof t[0]&&hasOwnProperty.call(t,"index")&&(n.index=t.index,n.input=t.input),n}var objectProto=Object.prototype,hasOwnProperty=objectProto.hasOwnProperty;module.exports=initCloneArray;


},{}],47:[function(require,module,exports){
(function (global){
function initCloneByTag(a,t,r){var e=a.constructor;switch(t){case arrayBufferTag:return bufferClone(a);case boolTag:case dateTag:return new e(+a);case float32Tag:case float64Tag:case int8Tag:case int16Tag:case int32Tag:case uint8Tag:case uint8ClampedTag:case uint16Tag:case uint32Tag:e instanceof e&&(e=ctorByTag[t]);var g=a.buffer;return new e(r?bufferClone(g):g,a.byteOffset,a.length);case numberTag:case stringTag:return new e(a);case regexpTag:var n=new e(a.source,reFlags.exec(a));n.lastIndex=a.lastIndex}return n}var bufferClone=require("./bufferClone"),boolTag="[object Boolean]",dateTag="[object Date]",numberTag="[object Number]",regexpTag="[object RegExp]",stringTag="[object String]",arrayBufferTag="[object ArrayBuffer]",float32Tag="[object Float32Array]",float64Tag="[object Float64Array]",int8Tag="[object Int8Array]",int16Tag="[object Int16Array]",int32Tag="[object Int32Array]",uint8Tag="[object Uint8Array]",uint8ClampedTag="[object Uint8ClampedArray]",uint16Tag="[object Uint16Array]",uint32Tag="[object Uint32Array]",reFlags=/\w*$/,ctorByTag={};ctorByTag[float32Tag]=global.Float32Array,ctorByTag[float64Tag]=global.Float64Array,ctorByTag[int8Tag]=global.Int8Array,ctorByTag[int16Tag]=global.Int16Array,ctorByTag[int32Tag]=global.Int32Array,ctorByTag[uint8Tag]=global.Uint8Array,ctorByTag[uint8ClampedTag]=global.Uint8ClampedArray,ctorByTag[uint16Tag]=global.Uint16Array,ctorByTag[uint32Tag]=global.Uint32Array,module.exports=initCloneByTag;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./bufferClone":36}],48:[function(require,module,exports){
function initCloneObject(n){var t=n.constructor;return"function"==typeof t&&t instanceof t||(t=Object),new t}module.exports=initCloneObject;


},{}],49:[function(require,module,exports){
function isArrayLike(e){return null!=e&&isLength(getLength(e))}var getLength=require("./getLength"),isLength=require("./isLength");module.exports=isArrayLike;


},{"./getLength":43,"./isLength":53}],50:[function(require,module,exports){
var isHostObject=function(){try{Object({toString:0}+"")}catch(t){return function(){return!1}}return function(t){return"function"!=typeof t.toString&&"string"==typeof(t+"")}}();module.exports=isHostObject;


},{}],51:[function(require,module,exports){
function isIndex(n,E){return n=+n,E=null==E?MAX_SAFE_INTEGER:E,n>-1&&n%1==0&&E>n}var MAX_SAFE_INTEGER=Math.pow(2,53)-1;module.exports=isIndex;


},{}],52:[function(require,module,exports){
function isKey(r,e){var t=typeof r;if("string"==t&&reIsPlainProp.test(r)||"number"==t)return!0;if(isArray(r))return!1;var i=!reIsDeepProp.test(r);return i||null!=e&&r in toObject(e)}var isArray=require("../lang/isArray"),toObject=require("./toObject"),reIsDeepProp=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\n\\]|\\.)*?\1)\]/,reIsPlainProp=/^\w*$/;module.exports=isKey;


},{"../lang/isArray":62,"./toObject":58}],53:[function(require,module,exports){
function isLength(e){return"number"==typeof e&&e>-1&&e%1==0&&MAX_SAFE_INTEGER>=e}var MAX_SAFE_INTEGER=Math.pow(2,53)-1;module.exports=isLength;


},{}],54:[function(require,module,exports){
function isObjectLike(e){return!!e&&"object"==typeof e}module.exports=isObjectLike;


},{}],55:[function(require,module,exports){
function isStrictComparable(e){return e===e&&!isObject(e)}var isObject=require("../lang/isObject");module.exports=isStrictComparable;


},{"../lang/isObject":65}],56:[function(require,module,exports){
function shimIsPlainObject(t){var r;if(!isObjectLike(t)||objToString.call(t)!=objectTag||isHostObject(t)||!hasOwnProperty.call(t,"constructor")&&(r=t.constructor,"function"==typeof r&&!(r instanceof r))||!support.argsTag&&isArguments(t))return!1;var e;return support.ownLast?(baseForIn(t,function(t,r,o){return e=hasOwnProperty.call(o,r),!1}),e!==!1):(baseForIn(t,function(t,r){e=r}),void 0===e||hasOwnProperty.call(t,e))}var baseForIn=require("./baseForIn"),isArguments=require("../lang/isArguments"),isHostObject=require("./isHostObject"),isObjectLike=require("./isObjectLike"),support=require("../support"),objectTag="[object Object]",objectProto=Object.prototype,hasOwnProperty=objectProto.hasOwnProperty,objToString=objectProto.toString;module.exports=shimIsPlainObject;


},{"../lang/isArguments":61,"../support":73,"./baseForIn":18,"./isHostObject":50,"./isObjectLike":54}],57:[function(require,module,exports){
function shimKeys(r){for(var e=keysIn(r),s=e.length,n=s&&r.length,t=n&&isLength(n)&&(isArray(r)||support.nonEnumStrings&&isString(r)||support.nonEnumArgs&&isArguments(r)),i=-1,o=[];++i<s;){var u=e[i];(t&&isIndex(u,n)||hasOwnProperty.call(r,u))&&o.push(u)}return o}var isArguments=require("../lang/isArguments"),isArray=require("../lang/isArray"),isIndex=require("./isIndex"),isLength=require("./isLength"),isString=require("../lang/isString"),keysIn=require("../object/keysIn"),support=require("../support"),objectProto=Object.prototype,hasOwnProperty=objectProto.hasOwnProperty;module.exports=shimKeys;


},{"../lang/isArguments":61,"../lang/isArray":62,"../lang/isString":67,"../object/keysIn":71,"../support":73,"./isIndex":51,"./isLength":53}],58:[function(require,module,exports){
function toObject(r){if(support.unindexedChars&&isString(r)){for(var t=-1,e=r.length,i=Object(r);++t<e;)i[t]=r.charAt(t);return i}return isObject(r)?r:Object(r)}var isObject=require("../lang/isObject"),isString=require("../lang/isString"),support=require("../support");module.exports=toObject;


},{"../lang/isObject":65,"../lang/isString":67,"../support":73}],59:[function(require,module,exports){
function toPath(r){if(isArray(r))return r;var e=[];return baseToString(r).replace(rePropName,function(r,a,t,i){e.push(t?i.replace(reEscapeChar,"$1"):a||r)}),e}var baseToString=require("./baseToString"),isArray=require("../lang/isArray"),rePropName=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\n\\]|\\.)*?)\2)\]/g,reEscapeChar=/\\(\\)?/g;module.exports=toPath;


},{"../lang/isArray":62,"./baseToString":32}],60:[function(require,module,exports){
function cloneDeep(e,n,l){return n="function"==typeof n&&bindCallback(n,l,1),baseClone(e,!0,n)}var baseClone=require("../internal/baseClone"),bindCallback=require("../internal/bindCallback");module.exports=cloneDeep;


},{"../internal/baseClone":14,"../internal/bindCallback":35}],61:[function(require,module,exports){
function isArguments(r){return isObjectLike(r)&&isArrayLike(r)&&objToString.call(r)==argsTag}var isArrayLike=require("../internal/isArrayLike"),isObjectLike=require("../internal/isObjectLike"),support=require("../support"),argsTag="[object Arguments]",objectProto=Object.prototype,hasOwnProperty=objectProto.hasOwnProperty,objToString=objectProto.toString,propertyIsEnumerable=objectProto.propertyIsEnumerable;support.argsTag||(isArguments=function(r){return isObjectLike(r)&&isArrayLike(r)&&hasOwnProperty.call(r,"callee")&&!propertyIsEnumerable.call(r,"callee")}),module.exports=isArguments;


},{"../internal/isArrayLike":49,"../internal/isObjectLike":54,"../support":73}],62:[function(require,module,exports){
var isLength=require("../internal/isLength"),isNative=require("./isNative"),isObjectLike=require("../internal/isObjectLike"),arrayTag="[object Array]",objectProto=Object.prototype,objToString=objectProto.toString,nativeIsArray=isNative(nativeIsArray=Array.isArray)&&nativeIsArray,isArray=nativeIsArray||function(r){return isObjectLike(r)&&isLength(r.length)&&objToString.call(r)==arrayTag};module.exports=isArray;


},{"../internal/isLength":53,"../internal/isObjectLike":54,"./isNative":64}],63:[function(require,module,exports){
(function (global){
var baseIsFunction=require("../internal/baseIsFunction"),isNative=require("./isNative"),funcTag="[object Function]",objectProto=Object.prototype,objToString=objectProto.toString,Uint8Array=isNative(Uint8Array=global.Uint8Array)&&Uint8Array,isFunction=baseIsFunction(/x/)||Uint8Array&&!baseIsFunction(Uint8Array)?function(t){return objToString.call(t)==funcTag}:baseIsFunction;module.exports=isFunction;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../internal/baseIsFunction":24,"./isNative":64}],64:[function(require,module,exports){
function isNative(t){return null==t?!1:objToString.call(t)==funcTag?reIsNative.test(fnToString.call(t)):isObjectLike(t)&&(isHostObject(t)?reIsNative:reIsHostCtor).test(t)}var escapeRegExp=require("../string/escapeRegExp"),isHostObject=require("../internal/isHostObject"),isObjectLike=require("../internal/isObjectLike"),funcTag="[object Function]",reIsHostCtor=/^\[object .+?Constructor\]$/,objectProto=Object.prototype,fnToString=Function.prototype.toString,objToString=objectProto.toString,reIsNative=RegExp("^"+escapeRegExp(objToString).replace(/toString|(function).*?(?=\\\()| for .+?(?=\\\])/g,"$1.*?")+"$");module.exports=isNative;


},{"../internal/isHostObject":50,"../internal/isObjectLike":54,"../string/escapeRegExp":72}],65:[function(require,module,exports){
function isObject(t){var e=typeof t;return"function"==e||!!t&&"object"==e}module.exports=isObject;


},{}],66:[function(require,module,exports){
var isArguments=require("./isArguments"),isNative=require("./isNative"),shimIsPlainObject=require("../internal/shimIsPlainObject"),support=require("../support"),objectTag="[object Object]",objectProto=Object.prototype,objToString=objectProto.toString,getPrototypeOf=isNative(getPrototypeOf=Object.getPrototypeOf)&&getPrototypeOf,isPlainObject=getPrototypeOf?function(t){if(!t||objToString.call(t)!=objectTag||!support.argsTag&&isArguments(t))return!1;var e=t.valueOf,o=isNative(e)&&(o=getPrototypeOf(e))&&getPrototypeOf(o);return o?t==o||getPrototypeOf(t)==o:shimIsPlainObject(t)}:shimIsPlainObject;module.exports=isPlainObject;


},{"../internal/shimIsPlainObject":56,"../support":73,"./isArguments":61,"./isNative":64}],67:[function(require,module,exports){
function isString(t){return"string"==typeof t||isObjectLike(t)&&objToString.call(t)==stringTag}var isObjectLike=require("../internal/isObjectLike"),stringTag="[object String]",objectProto=Object.prototype,objToString=objectProto.toString;module.exports=isString;


},{"../internal/isObjectLike":54}],68:[function(require,module,exports){
function isTypedArray(a){return isObjectLike(a)&&isLength(a.length)&&!!typedArrayTags[objToString.call(a)]}var isLength=require("../internal/isLength"),isObjectLike=require("../internal/isObjectLike"),argsTag="[object Arguments]",arrayTag="[object Array]",boolTag="[object Boolean]",dateTag="[object Date]",errorTag="[object Error]",funcTag="[object Function]",mapTag="[object Map]",numberTag="[object Number]",objectTag="[object Object]",regexpTag="[object RegExp]",setTag="[object Set]",stringTag="[object String]",weakMapTag="[object WeakMap]",arrayBufferTag="[object ArrayBuffer]",float32Tag="[object Float32Array]",float64Tag="[object Float64Array]",int8Tag="[object Int8Array]",int16Tag="[object Int16Array]",int32Tag="[object Int32Array]",uint8Tag="[object Uint8Array]",uint8ClampedTag="[object Uint8ClampedArray]",uint16Tag="[object Uint16Array]",uint32Tag="[object Uint32Array]",typedArrayTags={};typedArrayTags[float32Tag]=typedArrayTags[float64Tag]=typedArrayTags[int8Tag]=typedArrayTags[int16Tag]=typedArrayTags[int32Tag]=typedArrayTags[uint8Tag]=typedArrayTags[uint8ClampedTag]=typedArrayTags[uint16Tag]=typedArrayTags[uint32Tag]=!0,typedArrayTags[argsTag]=typedArrayTags[arrayTag]=typedArrayTags[arrayBufferTag]=typedArrayTags[boolTag]=typedArrayTags[dateTag]=typedArrayTags[errorTag]=typedArrayTags[funcTag]=typedArrayTags[mapTag]=typedArrayTags[numberTag]=typedArrayTags[objectTag]=typedArrayTags[regexpTag]=typedArrayTags[setTag]=typedArrayTags[stringTag]=typedArrayTags[weakMapTag]=!1;var objectProto=Object.prototype,objToString=objectProto.toString;module.exports=isTypedArray;


},{"../internal/isLength":53,"../internal/isObjectLike":54}],69:[function(require,module,exports){
function isUndefined(e){return void 0===e}module.exports=isUndefined;


},{}],70:[function(require,module,exports){
var isArrayLike=require("../internal/isArrayLike"),isNative=require("../lang/isNative"),isObject=require("../lang/isObject"),shimKeys=require("../internal/shimKeys"),support=require("../support"),nativeKeys=isNative(nativeKeys=Object.keys)&&nativeKeys,keys=nativeKeys?function(e){var i=null!=e&&e.constructor;return"function"==typeof i&&i.prototype===e||("function"==typeof e?support.enumPrototypes:isArrayLike(e))?shimKeys(e):isObject(e)?nativeKeys(e):[]}:shimKeys;module.exports=keys;


},{"../internal/isArrayLike":49,"../internal/shimKeys":57,"../lang/isNative":64,"../lang/isObject":65,"../support":73}],71:[function(require,module,exports){
function keysIn(r){if(null==r)return[];isObject(r)||(r=Object(r));var o=r.length;o=o&&isLength(o)&&(isArray(r)||support.nonEnumStrings&&isString(r)||support.nonEnumArgs&&isArguments(r))&&o||0;for(var n=r.constructor,t=-1,e=isFunction(n)&&n.prototype||objectProto,s=e===r,a=Array(o),i=o>0,u=support.enumErrorProps&&(r===errorProto||r instanceof Error),p=support.enumPrototypes&&isFunction(r);++t<o;)a[t]=t+"";for(var g in r)p&&"prototype"==g||u&&("message"==g||"name"==g)||i&&isIndex(g,o)||"constructor"==g&&(s||!hasOwnProperty.call(r,g))||a.push(g);if(support.nonEnumShadows&&r!==objectProto){var c=r===stringProto?stringTag:r===errorProto?errorTag:objToString.call(r),P=nonEnumProps[c]||nonEnumProps[objectTag];for(c==objectTag&&(e=objectProto),o=shadowProps.length;o--;){g=shadowProps[o];var b=P[g];s&&b||(b?!hasOwnProperty.call(r,g):r[g]===e[g])||a.push(g)}}return a}var arrayEach=require("../internal/arrayEach"),isArguments=require("../lang/isArguments"),isArray=require("../lang/isArray"),isFunction=require("../lang/isFunction"),isIndex=require("../internal/isIndex"),isLength=require("../internal/isLength"),isObject=require("../lang/isObject"),isString=require("../lang/isString"),support=require("../support"),arrayTag="[object Array]",boolTag="[object Boolean]",dateTag="[object Date]",errorTag="[object Error]",funcTag="[object Function]",numberTag="[object Number]",objectTag="[object Object]",regexpTag="[object RegExp]",stringTag="[object String]",shadowProps=["constructor","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","toLocaleString","toString","valueOf"],errorProto=Error.prototype,objectProto=Object.prototype,stringProto=String.prototype,hasOwnProperty=objectProto.hasOwnProperty,objToString=objectProto.toString,nonEnumProps={};nonEnumProps[arrayTag]=nonEnumProps[dateTag]=nonEnumProps[numberTag]={constructor:!0,toLocaleString:!0,toString:!0,valueOf:!0},nonEnumProps[boolTag]=nonEnumProps[stringTag]={constructor:!0,toString:!0,valueOf:!0},nonEnumProps[errorTag]=nonEnumProps[funcTag]=nonEnumProps[regexpTag]={constructor:!0,toString:!0},nonEnumProps[objectTag]={constructor:!0},arrayEach(shadowProps,function(r){for(var o in nonEnumProps)if(hasOwnProperty.call(nonEnumProps,o)){var n=nonEnumProps[o];n[r]=hasOwnProperty.call(n,r)}}),module.exports=keysIn;


},{"../internal/arrayEach":10,"../internal/isIndex":51,"../internal/isLength":53,"../lang/isArguments":61,"../lang/isArray":62,"../lang/isFunction":63,"../lang/isObject":65,"../lang/isString":67,"../support":73}],72:[function(require,module,exports){
function escapeRegExp(e){return e=baseToString(e),e&&reHasRegExpChars.test(e)?e.replace(reRegExpChars,"\\$&"):e}var baseToString=require("../internal/baseToString"),reRegExpChars=/[.*+?^${}()|[\]\/\\]/g,reHasRegExpChars=RegExp(reRegExpChars.source);module.exports=escapeRegExp;


},{"../internal/baseToString":32}],73:[function(require,module,exports){
(function (global){
var argsTag="[object Arguments]",objectTag="[object Object]",arrayProto=Array.prototype,errorProto=Error.prototype,objectProto=Object.prototype,document=(document=global.window)&&document.document,objToString=objectProto.toString,propertyIsEnumerable=objectProto.propertyIsEnumerable,splice=arrayProto.splice,support={};!function(o){var r=function(){this.x=o},t=arguments,e={0:o,length:o},p=[];r.prototype={valueOf:o,y:o};for(var n in new r)p.push(n);support.argsTag=objToString.call(t)==argsTag,support.enumErrorProps=propertyIsEnumerable.call(errorProto,"message")||propertyIsEnumerable.call(errorProto,"name"),support.enumPrototypes=propertyIsEnumerable.call(r,"prototype"),support.funcDecomp=/\bthis\b/.test(function(){return this}),support.funcNames="string"==typeof Function.name,support.nodeTag=objToString.call(document)!=objectTag,support.nonEnumStrings=!propertyIsEnumerable.call("x",0),support.nonEnumShadows=!/valueOf/.test(p),support.ownLast="x"!=p[0],support.spliceObjects=(splice.call(e,0,1),!e[0]),support.unindexedChars="x"[0]+Object("x")[0]!="xx";try{support.dom=11===document.createDocumentFragment().nodeType}catch(s){support.dom=!1}try{support.nonEnumArgs=!propertyIsEnumerable.call(t,1)}catch(s){support.nonEnumArgs=!0}}(1,0),module.exports=support;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],74:[function(require,module,exports){
function constant(n){return function(){return n}}module.exports=constant;


},{}],75:[function(require,module,exports){
function identity(t){return t}module.exports=identity;


},{}],76:[function(require,module,exports){
function property(e){return isKey(e)?baseProperty(e):basePropertyDeep(e)}var baseProperty=require("../internal/baseProperty"),basePropertyDeep=require("../internal/basePropertyDeep"),isKey=require("../internal/isKey");module.exports=property;


},{"../internal/baseProperty":29,"../internal/basePropertyDeep":30,"../internal/isKey":52}],77:[function(require,module,exports){
(function (global){
!function(t,n,e){n[t]=n[t]||e(),"undefined"!=typeof module&&module.exports?module.exports=n[t]:"function"==typeof define&&define.amd&&define(function(){return n[t]})}("Promise","undefined"!=typeof global?global:this,function(){"use strict";function t(t,n){l.add(t,n),h||(h=y(l.drain))}function n(t){var n,e=typeof t;return null==t||"object"!=e&&"function"!=e||(n=t.then),"function"==typeof n?n:!1}function e(){for(var t=0;t<this.chain.length;t++)o(this,1===this.state?this.chain[t].success:this.chain[t].failure,this.chain[t]);this.chain.length=0}function o(t,e,o){var r,i;try{e===!1?o.reject(t.msg):(r=e===!0?t.msg:e.call(void 0,t.msg),r===o.promise?o.reject(TypeError("Promise-chain cycle")):(i=n(r))?i.call(r,o.resolve,o.reject):o.resolve(r))}catch(c){o.reject(c)}}function r(o){var c,u,a=this;if(!a.triggered){a.triggered=!0,a.def&&(a=a.def);try{(c=n(o))?(u=new f(a),c.call(o,function(){r.apply(u,arguments)},function(){i.apply(u,arguments)})):(a.msg=o,a.state=1,a.chain.length>0&&t(e,a))}catch(s){i.call(u||new f(a),s)}}}function i(n){var o=this;o.triggered||(o.triggered=!0,o.def&&(o=o.def),o.msg=n,o.state=2,o.chain.length>0&&t(e,o))}function c(t,n,e,o){for(var r=0;r<n.length;r++)!function(r){t.resolve(n[r]).then(function(t){e(r,t)},o)}(r)}function f(t){this.def=t,this.triggered=!1}function u(t){this.promise=t,this.state=0,this.triggered=!1,this.chain=[],this.msg=void 0}function a(n){if("function"!=typeof n)throw TypeError("Not a function");if(0!==this.__NPO__)throw TypeError("Not a promise");this.__NPO__=1;var o=new u(this);this.then=function(n,r){var i={success:"function"==typeof n?n:!0,failure:"function"==typeof r?r:!1};return i.promise=new this.constructor(function(t,n){if("function"!=typeof t||"function"!=typeof n)throw TypeError("Not a function");i.resolve=t,i.reject=n}),o.chain.push(i),0!==o.state&&t(e,o),i.promise},this["catch"]=function(t){return this.then(void 0,t)};try{n.call(void 0,function(t){r.call(o,t)},function(t){i.call(o,t)})}catch(c){i.call(o,c)}}var s,h,l,p=Object.prototype.toString,y="undefined"!=typeof setImmediate?function(t){return setImmediate(t)}:setTimeout;try{Object.defineProperty({},"x",{}),s=function(t,n,e,o){return Object.defineProperty(t,n,{value:e,writable:!0,configurable:o!==!1})}}catch(d){s=function(t,n,e){return t[n]=e,t}}l=function(){function t(t,n){this.fn=t,this.self=n,this.next=void 0}var n,e,o;return{add:function(r,i){o=new t(r,i),e?e.next=o:n=o,e=o,o=void 0},drain:function(){var t=n;for(n=e=h=void 0;t;)t.fn.call(t.self),t=t.next}}}();var g=s({},"constructor",a,!1);return a.prototype=g,s(g,"__NPO__",0,!1),s(a,"resolve",function(t){var n=this;return t&&"object"==typeof t&&1===t.__NPO__?t:new n(function(n,e){if("function"!=typeof n||"function"!=typeof e)throw TypeError("Not a function");n(t)})}),s(a,"reject",function(t){return new this(function(n,e){if("function"!=typeof n||"function"!=typeof e)throw TypeError("Not a function");e(t)})}),s(a,"all",function(t){var n=this;return"[object Array]"!=p.call(t)?n.reject(TypeError("Not an array")):0===t.length?n.resolve([]):new n(function(e,o){if("function"!=typeof e||"function"!=typeof o)throw TypeError("Not a function");var r=t.length,i=Array(r),f=0;c(n,t,function(t,n){i[t]=n,++f===r&&e(i)},o)})}),s(a,"race",function(t){var n=this;return"[object Array]"!=p.call(t)?n.reject(TypeError("Not an array")):new n(function(e,o){if("function"!=typeof e||"function"!=typeof o)throw TypeError("Not a function");c(n,t,function(t,n){e(n)},o)})}),a});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],78:[function(require,module,exports){
"use strict";function getLoader(e){return supportedLoaders[e.split(":")[0]]||defaultLoader}var supportedLoaders={file:require("./lib/loaders/file"),http:require("./lib/loaders/http"),https:require("./lib/loaders/http")},defaultLoader="undefined"==typeof window?supportedLoaders.file:supportedLoaders.http;"undefined"==typeof Promise&&require("native-promise-only"),module.exports.load=function(e,t,o){var r=Promise.resolve();return 2===arguments.length&&"function"==typeof t&&(o=t,t=void 0),r=r.then(function(){if("undefined"==typeof e)throw new TypeError("location is required");if("string"!=typeof e)throw new TypeError("location must be a string");if("undefined"!=typeof t){if("object"!=typeof t)throw new TypeError("options must be an object")}else t={};if("undefined"!=typeof o&&"function"!=typeof o)throw new TypeError("callback must be a function")}),r=r.then(function(){return new Promise(function(o,r){var n=getLoader(e);n.load(e,t,function(e,t){e?r(e):o(t)})})}),"function"==typeof o&&(r=r.then(function(e){o(void 0,e)},function(e){o(e)})),r};


},{"./lib/loaders/file":79,"./lib/loaders/http":80,"native-promise-only":77}],79:[function(require,module,exports){
"use strict";module.exports.load=function(e,o,r){r(new TypeError("The 'file' scheme is not supported in the browser"))};


},{}],80:[function(require,module,exports){
"use strict";var request=require("superagent"),supportedHttpMethods=["delete","get","head","patch","post","put"];module.exports.load=function(e,t,o){var p,r,s=e.split("#")[0],d=t.method?t.method.toLowerCase():"get";"undefined"!=typeof t.prepareRequest&&"function"!=typeof t.prepareRequest?p=new TypeError("options.prepareRequest must be a function"):"undefined"!=typeof t.method&&("string"!=typeof t.method?p=new TypeError("options.method must be a string"):-1===supportedHttpMethods.indexOf(t.method)&&(p=new TypeError("options.method must be one of the following: "+supportedHttpMethods.slice(0,supportedHttpMethods.length-1).join(", ")+" or "+supportedHttpMethods[supportedHttpMethods.length-1]))),p?o(p):(r=request["delete"===d?"del":d](s),t.prepareRequest&&t.prepareRequest(r),"function"==typeof r.buffer&&r.buffer(!0),r.end(function(e,t){o(e,t?t.text:t)}))};


},{"superagent":81}],81:[function(require,module,exports){
function noop(){}function isHost(t){var e={}.toString.call(t);switch(e){case"[object File]":case"[object Blob]":case"[object FormData]":return!0;default:return!1}}function isObject(t){return t===Object(t)}function serialize(t){if(!isObject(t))return t;var e=[];for(var r in t)null!=t[r]&&e.push(encodeURIComponent(r)+"="+encodeURIComponent(t[r]));return e.join("&")}function parseString(t){for(var e,r,s={},i=t.split("&"),o=0,n=i.length;n>o;++o)r=i[o],e=r.split("="),s[decodeURIComponent(e[0])]=decodeURIComponent(e[1]);return s}function parseHeader(t){var e,r,s,i,o=t.split(/\r?\n/),n={};o.pop();for(var a=0,u=o.length;u>a;++a)r=o[a],e=r.indexOf(":"),s=r.slice(0,e).toLowerCase(),i=trim(r.slice(e+1)),n[s]=i;return n}function type(t){return t.split(/ *; */).shift()}function params(t){return reduce(t.split(/ *; */),function(t,e){var r=e.split(/ *= */),s=r.shift(),i=r.shift();return s&&i&&(t[s]=i),t},{})}function Response(t,e){e=e||{},this.req=t,this.xhr=this.req.xhr,this.text="HEAD"!=this.req.method&&(""===this.xhr.responseType||"text"===this.xhr.responseType)||"undefined"==typeof this.xhr.responseType?this.xhr.responseText:null,this.statusText=this.req.xhr.statusText,this.setStatusProperties(this.xhr.status),this.header=this.headers=parseHeader(this.xhr.getAllResponseHeaders()),this.header["content-type"]=this.xhr.getResponseHeader("content-type"),this.setHeaderProperties(this.header),this.body="HEAD"!=this.req.method?this.parseBody(this.text?this.text:this.xhr.response):null}function Request(t,e){var r=this;Emitter.call(this),this._query=this._query||[],this.method=t,this.url=e,this.header={},this._header={},this.on("end",function(){var t=null,e=null;try{e=new Response(r)}catch(s){return t=new Error("Parser is unable to parse the response"),t.parse=!0,t.original=s,r.callback(t)}if(r.emit("response",e),t)return r.callback(t,e);if(e.status>=200&&e.status<300)return r.callback(t,e);var i=new Error(e.statusText||"Unsuccessful HTTP response");i.original=t,i.response=e,i.status=e.status,r.callback(t||i,e)})}function request(t,e){return"function"==typeof e?new Request("GET",t).end(e):1==arguments.length?new Request("GET",t):new Request(t,e)}var Emitter=require("emitter"),reduce=require("reduce"),root="undefined"==typeof window?this||self:window;request.getXHR=function(){if(!(!root.XMLHttpRequest||root.location&&"file:"==root.location.protocol&&root.ActiveXObject))return new XMLHttpRequest;try{return new ActiveXObject("Microsoft.XMLHTTP")}catch(t){}try{return new ActiveXObject("Msxml2.XMLHTTP.6.0")}catch(t){}try{return new ActiveXObject("Msxml2.XMLHTTP.3.0")}catch(t){}try{return new ActiveXObject("Msxml2.XMLHTTP")}catch(t){}return!1};var trim="".trim?function(t){return t.trim()}:function(t){return t.replace(/(^\s*|\s*$)/g,"")};request.serializeObject=serialize,request.parseString=parseString,request.types={html:"text/html",json:"application/json",xml:"application/xml",urlencoded:"application/x-www-form-urlencoded",form:"application/x-www-form-urlencoded","form-data":"application/x-www-form-urlencoded"},request.serialize={"application/x-www-form-urlencoded":serialize,"application/json":JSON.stringify},request.parse={"application/x-www-form-urlencoded":parseString,"application/json":JSON.parse},Response.prototype.get=function(t){return this.header[t.toLowerCase()]},Response.prototype.setHeaderProperties=function(t){var e=this.header["content-type"]||"";this.type=type(e);var r=params(e);for(var s in r)this[s]=r[s]},Response.prototype.parseBody=function(t){var e=request.parse[this.type];return e&&t&&(t.length||t instanceof Object)?e(t):null},Response.prototype.setStatusProperties=function(t){1223===t&&(t=204);var e=t/100|0;this.status=t,this.statusType=e,this.info=1==e,this.ok=2==e,this.clientError=4==e,this.serverError=5==e,this.error=4==e||5==e?this.toError():!1,this.accepted=202==t,this.noContent=204==t,this.badRequest=400==t,this.unauthorized=401==t,this.notAcceptable=406==t,this.notFound=404==t,this.forbidden=403==t},Response.prototype.toError=function(){var t=this.req,e=t.method,r=t.url,s="cannot "+e+" "+r+" ("+this.status+")",i=new Error(s);return i.status=this.status,i.method=e,i.url=r,i},request.Response=Response,Emitter(Request.prototype),Request.prototype.use=function(t){return t(this),this},Request.prototype.timeout=function(t){return this._timeout=t,this},Request.prototype.clearTimeout=function(){return this._timeout=0,clearTimeout(this._timer),this},Request.prototype.abort=function(){return this.aborted?void 0:(this.aborted=!0,this.xhr.abort(),this.clearTimeout(),this.emit("abort"),this)},Request.prototype.set=function(t,e){if(isObject(t)){for(var r in t)this.set(r,t[r]);return this}return this._header[t.toLowerCase()]=e,this.header[t]=e,this},Request.prototype.unset=function(t){return delete this._header[t.toLowerCase()],delete this.header[t],this},Request.prototype.getHeader=function(t){return this._header[t.toLowerCase()]},Request.prototype.type=function(t){return this.set("Content-Type",request.types[t]||t),this},Request.prototype.accept=function(t){return this.set("Accept",request.types[t]||t),this},Request.prototype.auth=function(t,e){var r=btoa(t+":"+e);return this.set("Authorization","Basic "+r),this},Request.prototype.query=function(t){return"string"!=typeof t&&(t=serialize(t)),t&&this._query.push(t),this},Request.prototype.field=function(t,e){return this._formData||(this._formData=new root.FormData),this._formData.append(t,e),this},Request.prototype.attach=function(t,e,r){return this._formData||(this._formData=new root.FormData),this._formData.append(t,e,r),this},Request.prototype.send=function(t){var e=isObject(t),r=this.getHeader("Content-Type");if(e&&isObject(this._data))for(var s in t)this._data[s]=t[s];else"string"==typeof t?(r||this.type("form"),r=this.getHeader("Content-Type"),"application/x-www-form-urlencoded"==r?this._data=this._data?this._data+"&"+t:t:this._data=(this._data||"")+t):this._data=t;return!e||isHost(t)?this:(r||this.type("json"),this)},Request.prototype.callback=function(t,e){var r=this._callback;this.clearTimeout(),r(t,e)},Request.prototype.crossDomainError=function(){var t=new Error("Origin is not allowed by Access-Control-Allow-Origin");t.crossDomain=!0,this.callback(t)},Request.prototype.timeoutError=function(){var t=this._timeout,e=new Error("timeout of "+t+"ms exceeded");e.timeout=t,this.callback(e)},Request.prototype.withCredentials=function(){return this._withCredentials=!0,this},Request.prototype.end=function(t){var e=this,r=this.xhr=request.getXHR(),s=this._query.join("&"),i=this._timeout,o=this._formData||this._data;this._callback=t||noop,r.onreadystatechange=function(){if(4==r.readyState){var t;try{t=r.status}catch(s){t=0}if(0==t){if(e.timedout)return e.timeoutError();if(e.aborted)return;return e.crossDomainError()}e.emit("end")}};var n=function(t){t.total>0&&(t.percent=t.loaded/t.total*100),e.emit("progress",t)};this.hasListeners("progress")&&(r.onprogress=n);try{r.upload&&this.hasListeners("progress")&&(r.upload.onprogress=n)}catch(a){}if(i&&!this._timer&&(this._timer=setTimeout(function(){e.timedout=!0,e.abort()},i)),s&&(s=request.serializeObject(s),this.url+=~this.url.indexOf("?")?"&"+s:"?"+s),r.open(this.method,this.url,!0),this._withCredentials&&(r.withCredentials=!0),"GET"!=this.method&&"HEAD"!=this.method&&"string"!=typeof o&&!isHost(o)){var u=request.serialize[this.getHeader("Content-Type")];u&&(o=u(o))}for(var h in this.header)null!=this.header[h]&&r.setRequestHeader(h,this.header[h]);return this.emit("request",this),r.send(o),this},request.Request=Request,request.get=function(t,e,r){var s=request("GET",t);return"function"==typeof e&&(r=e,e=null),e&&s.query(e),r&&s.end(r),s},request.head=function(t,e,r){var s=request("HEAD",t);return"function"==typeof e&&(r=e,e=null),e&&s.send(e),r&&s.end(r),s},request.del=function(t,e){var r=request("DELETE",t);return e&&r.end(e),r},request.patch=function(t,e,r){var s=request("PATCH",t);return"function"==typeof e&&(r=e,e=null),e&&s.send(e),r&&s.end(r),s},request.post=function(t,e,r){var s=request("POST",t);return"function"==typeof e&&(r=e,e=null),e&&s.send(e),r&&s.end(r),s},request.put=function(t,e,r){var s=request("PUT",t);return"function"==typeof e&&(r=e,e=null),e&&s.send(e),r&&s.end(r),s},module.exports=request;


},{"emitter":82,"reduce":83}],82:[function(require,module,exports){
function Emitter(t){return t?mixin(t):void 0}function mixin(t){for(var e in Emitter.prototype)t[e]=Emitter.prototype[e];return t}module.exports=Emitter,Emitter.prototype.on=Emitter.prototype.addEventListener=function(t,e){return this._callbacks=this._callbacks||{},(this._callbacks[t]=this._callbacks[t]||[]).push(e),this},Emitter.prototype.once=function(t,e){function i(){r.off(t,i),e.apply(this,arguments)}var r=this;return this._callbacks=this._callbacks||{},i.fn=e,this.on(t,i),this},Emitter.prototype.off=Emitter.prototype.removeListener=Emitter.prototype.removeAllListeners=Emitter.prototype.removeEventListener=function(t,e){if(this._callbacks=this._callbacks||{},0==arguments.length)return this._callbacks={},this;var i=this._callbacks[t];if(!i)return this;if(1==arguments.length)return delete this._callbacks[t],this;for(var r,s=0;s<i.length;s++)if(r=i[s],r===e||r.fn===e){i.splice(s,1);break}return this},Emitter.prototype.emit=function(t){this._callbacks=this._callbacks||{};var e=[].slice.call(arguments,1),i=this._callbacks[t];if(i){i=i.slice(0);for(var r=0,s=i.length;s>r;++r)i[r].apply(this,e)}return this},Emitter.prototype.listeners=function(t){return this._callbacks=this._callbacks||{},this._callbacks[t]||[]},Emitter.prototype.hasListeners=function(t){return!!this.listeners(t).length};


},{}],83:[function(require,module,exports){
module.exports=function(l,n,e){for(var r=0,t=l.length,u=3==arguments.length?e:l[r++];t>r;)u=n.call(null,u,l[r],++r,l);return u};


},{}],84:[function(require,module,exports){
function Traverse(e){this.value=e}function walk(e,t,r){var o=[],n=[],a=!0;return function i(e){function c(){if("object"==typeof l.node&&null!==l.node){l.keys&&l.node_===l.node||(l.keys=objectKeys(l.node)),l.isLeaf=0==l.keys.length;for(var t=0;t<n.length;t++)if(n[t].node_===e){l.circular=n[t];break}}else l.isLeaf=!0,l.keys=null;l.notLeaf=!l.isLeaf,l.notRoot=!l.isRoot}var s=r?copy(e):e,u={},f=!0,l={node:s,node_:e,path:[].concat(o),parent:n[n.length-1],parents:n,key:o.slice(-1)[0],isRoot:0===o.length,level:o.length,circular:null,update:function(e,t){l.isRoot||(l.parent.node[l.key]=e),l.node=e,t&&(f=!1)},"delete":function(e){delete l.parent.node[l.key],e&&(f=!1)},remove:function(e){isArray(l.parent.node)?l.parent.node.splice(l.key,1):delete l.parent.node[l.key],e&&(f=!1)},keys:null,before:function(e){u.before=e},after:function(e){u.after=e},pre:function(e){u.pre=e},post:function(e){u.post=e},stop:function(){a=!1},block:function(){f=!1}};if(!a)return l;c();var p=t.call(l,l.node);return void 0!==p&&l.update&&l.update(p),u.before&&u.before.call(l,l.node),f?("object"!=typeof l.node||null===l.node||l.circular||(n.push(l),c(),forEach(l.keys,function(e,t){o.push(e),u.pre&&u.pre.call(l,l.node[e],e);var n=i(l.node[e]);r&&hasOwnProperty.call(l.node,e)&&(l.node[e]=n.node),n.isLast=t==l.keys.length-1,n.isFirst=0==t,u.post&&u.post.call(l,n),o.pop()}),n.pop()),u.after&&u.after.call(l,l.node),l):l}(e).node}function copy(e){if("object"==typeof e&&null!==e){var t;if(isArray(e))t=[];else if(isDate(e))t=new Date(e.getTime?e.getTime():e);else if(isRegExp(e))t=new RegExp(e);else if(isError(e))t={message:e.message};else if(isBoolean(e))t=new Boolean(e);else if(isNumber(e))t=new Number(e);else if(isString(e))t=new String(e);else if(Object.create&&Object.getPrototypeOf)t=Object.create(Object.getPrototypeOf(e));else if(e.constructor===Object)t={};else{var r=e.constructor&&e.constructor.prototype||e.__proto__||{},o=function(){};o.prototype=r,t=new o}return forEach(objectKeys(e),function(r){t[r]=e[r]}),t}return e}function toS(e){return Object.prototype.toString.call(e)}function isDate(e){return"[object Date]"===toS(e)}function isRegExp(e){return"[object RegExp]"===toS(e)}function isError(e){return"[object Error]"===toS(e)}function isBoolean(e){return"[object Boolean]"===toS(e)}function isNumber(e){return"[object Number]"===toS(e)}function isString(e){return"[object String]"===toS(e)}var traverse=module.exports=function(e){return new Traverse(e)};Traverse.prototype.get=function(e){for(var t=this.value,r=0;r<e.length;r++){var o=e[r];if(!t||!hasOwnProperty.call(t,o)){t=void 0;break}t=t[o]}return t},Traverse.prototype.has=function(e){for(var t=this.value,r=0;r<e.length;r++){var o=e[r];if(!t||!hasOwnProperty.call(t,o))return!1;t=t[o]}return!0},Traverse.prototype.set=function(e,t){for(var r=this.value,o=0;o<e.length-1;o++){var n=e[o];hasOwnProperty.call(r,n)||(r[n]={}),r=r[n]}return r[e[o]]=t,t},Traverse.prototype.map=function(e){return walk(this.value,e,!0)},Traverse.prototype.forEach=function(e){return this.value=walk(this.value,e,!1),this.value},Traverse.prototype.reduce=function(e,t){var r=1===arguments.length,o=r?this.value:t;return this.forEach(function(t){this.isRoot&&r||(o=e.call(this,o,t))}),o},Traverse.prototype.paths=function(){var e=[];return this.forEach(function(t){e.push(this.path)}),e},Traverse.prototype.nodes=function(){var e=[];return this.forEach(function(t){e.push(this.node)}),e},Traverse.prototype.clone=function(){var e=[],t=[];return function r(o){for(var n=0;n<e.length;n++)if(e[n]===o)return t[n];if("object"==typeof o&&null!==o){var a=copy(o);return e.push(o),t.push(a),forEach(objectKeys(o),function(e){a[e]=r(o[e])}),e.pop(),t.pop(),a}return o}(this.value)};var objectKeys=Object.keys||function(e){var t=[];for(var r in e)t.push(r);return t},isArray=Array.isArray||function(e){return"[object Array]"===Object.prototype.toString.call(e)},forEach=function(e,t){if(e.forEach)return e.forEach(t);for(var r=0;r<e.length;r++)t(e[r],r,e)};forEach(objectKeys(Traverse.prototype),function(e){traverse[e]=function(t){var r=[].slice.call(arguments,1),o=new Traverse(t);return o[e].apply(o,r)}});var hasOwnProperty=Object.hasOwnProperty||function(e,t){return t in e};


},{}]},{},[1])(1)
});