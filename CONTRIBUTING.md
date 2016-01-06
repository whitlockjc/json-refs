The purpose of this guide is to familiarize yourself with the json-refs development process.  My hopes are that this
guide will make contributing to json-refs much simpler.

# Development Process

Before contributing to json-refs, it makes sense to understand the development process.  Git of course is a given so
no time will be spent talking about it.  json-refs uses [Gulp][gulp] as its task runner, which is used to build, lint,
test, etc. all parts of json-refs.  Below are the gulp tasks:

* `browserify`: Builds the browser binaries using [Browserify][browserify]
* `clean`: Removes all development artifacts *(`bower_components`, `coverage`, ...)*
* `docs`: Generates `docs/API.md` from the [jsdoc][jsdoc] in the necessary sources
* `lint`: Lint checks the necessary sources using [ESLint][eslint]
* `test-browser`: Runs the test suite for the browser
* `test-node`: Runs the test suite for Node.js
* `test`: Runs both `test-node` and `test-browser`

If you just run `gulp`, all of these tasks mentioned above will be ran in the proper order.  When working on json-refs
myself, I typically just run `gulp test-node` while working on the bug fix or feature.  Once I get the code ready to
commit, I will then run `gulp` to lint check my code, generate the browser builds and sources, ...

# Reporting Bugs

To submit new a new bug report, please follow these steps:

1. Search that the bug hasn't already been reported
2. File the bug *(if the bug report is new)*

Your bug report should meet the following criteria:

1. Include a reproduction recipe *(Document the steps required to reproduce the bug including any example code, etc.)*
2. Include what happens when the bug occurs
3. Include what you expect to happen when the bug is fixed

In the end, please provide as much pertinent information as possible when describing the problem.  A good bug report is
clear, concise and requires no guess work on our part.  Help us help you! *(I couldn't resist...)*

# Submitting PRs

To submit a new PR, please follow these steps:

1. Write a test to reproduce your bug or to test your enhancement/feature
2. Write your code *(I typically only run `gulp test-node` while working on the code until I get it done)*
3. Run `gulp`
4. Commit

Your PR should meet the following criteria:

1. Should include all generated sources
2. Should pass lint checking and have all tests passing *(We do have [Travis CI][travis-ci] setup to catch failing lint
checks and failing tests but this is a safety net only)*
3. Should be squashed into one commit with the commit message being self explanatory
4. Should include tests *(Bug fixes and features should have tests included with them at all times)*

[bower]: http://bower.io/
[browserify]: http://browserify.org/
[eslint]: http://eslint.org/
[gulp]: http://gulpjs.com/
[jsdoc]: http://usejsdoc.org/
[npm]: https://www.npmjs.com/
[travis-ci]: https://travis-ci.org/whitlockjc/json-refs

