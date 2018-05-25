'use strict'

var path = require('path')
var minimatch = require("minimatch")

module.exports = () => new IgnoreBase()


// A simple implementation of make-array
function make_array (subject) {
  return Array.isArray(subject)
    ? subject
    : [subject]
}

// const REGEX_BLANK_LINE = /^\s+$/
// const REGEX_LEADING_EXCAPED_EXCLAMATION = /^\\\!/
// const REGEX_LEADING_EXCAPED_HASH = /^\\#/
const REGEX_TRAILING_SLASH = /\/$/
const SLASH = '/'
const KEY_IGNORE = typeof Symbol !== 'undefined'
  ? Symbol.for('docker-ignore')
  : 'docker-ignore'

// An implementation of Go's filepath.Clean
function cleanPath (file) {
  return path.normalize(file).replace(REGEX_TRAILING_SLASH, '')
}

class IgnoreBase {
  constructor () {
    this._rules = []
    this[KEY_IGNORE] = true
    this._initCache()
    this._negatives = false;
  }

  _initCache () {
    this._cache = {}
  }

  // @param {Array.<string>|string|Ignore} pattern
  add (pattern) {
    this._added = false

    if (typeof pattern === 'string') {
      pattern = pattern.split(/\r?\n/g)
    }

    make_array(pattern).forEach(this._addPattern, this)

    // Some rules have just added to the ignore,
    // making the behavior changed.
    if (this._added) {
      this._initCache()
    }

    return this
  }

  // legacy
  addPattern (pattern) {
    return this.add(pattern)
  }

  _addPattern (pattern) {
    // #32
    if (pattern && pattern[KEY_IGNORE]) {
      this._rules = this._rules.concat(pattern._rules)
      this._added = true;
      return
    }

    if (this._checkPattern(pattern)) {
      const rule = this._createRule(pattern.trim())
      if(rule !== null) {
        this._added = true
        this._rules.push(rule)
      }
    }
  }

  _checkPattern (pattern) {
    // https://github.com/moby/moby/blob/4f0d95fa6ee7f865597c03b9e63702cdcb0f7067/builder/dockerignore/dockerignore.go#L33-L40
    return pattern
      && typeof pattern === 'string'
      && pattern.indexOf('#') !== 0
      && pattern.trim() !== ""
  }

  filter (paths) {
    return make_array(paths).filter(path => this._filter(path))
  }

  createFilter () {
    return path => this._filter(path)
  }

  ignores (path) {
    return !this._filter(path)
  }

  _createRule (pattern) {
    // https://github.com/moby/moby/blob/4f0d95fa6ee7f865597c03b9e63702cdcb0f7067/builder/dockerignore/dockerignore.go#L34-L40
    // TODO: Add link to github for dockerignore
    const origin = pattern
    let negative = false

    // > An optional prefix "!" which negates the pattern;
    if (pattern.indexOf('!') === 0) {
      negative = true
      this._negatives = true;
      pattern = pattern.substr(1).trim()
    }

    if (pattern.length > 0) {
      pattern = cleanPath(pattern)
			pattern = pattern.split(path.sept).join(SLASH);
			if (pattern.length > 1 && pattern[0] === SLASH) {
				pattern = pattern.slice(1)
			}
    }

    pattern = pattern.trim()
    if(pattern === "") {
      return null
    }

    // const regex = make_regex(pattern, negative)
    return {
      origin,
      pattern,
      dirs: pattern.split(path.sep),
      negative,
      // regex
    }
  }

  // @returns `Boolean` true if the `path` is NOT ignored
  _filter (path, slices) {
    if (!path) {
      return false
    }

    if (path in this._cache) {
      return this._cache[path]
    }

    if (!slices) {
      // path/to/a.js
      // ['path', 'to', 'a.js']
      slices = path.split(SLASH)
    }

    slices.pop()

    // For dockerignore, it is possible to re-include a file
    // even if a parent directory of that file is excluded.
    // const parentIsIncluded = !slices.length || this._filter(slices.join(SLASH) + SLASH, slices);

    // if (parentIsIncluded) {
      return this._test(path)
    // } else {
    //   // if a parent is ignored, the current file may still be included
    //   // if the path or a child is included
    //   let r = this._test(path, true);
    //   return r
    // }
  }

  // @returns {Boolean} true if a file is NOT ignored
  _test (file) {
    file = file.split(SLASH).join(path.sep)
    const parentPath = cleanPath(path.dirname(file))
    const parentPathDirs = parentPath.split(path.sep)
    
    let matched = false;

    this._rules.forEach(rule => {
      let match = this._match(file, rule)
  
      if (!match && parentPath !== ".") {
        // Check to see if the pattern matches one of our parent dirs.
        console.log(parentPathDirs, rule.dirs)
        if (rule.dirs.length <= parentPathDirs.length) {
          console.log('Checking to see if the pattern matches one of our parent dirs.')
          match = this._match(parentPathDirs.slice(0, rule.dirs.length).join(path.sep), rule)
        }
      }
  
      if (match) {
        matched = !rule.negative
      }
    })

    console.log('matched? %O', matched)
  
    return !matched
  }

  // @returns {Boolean} true if a file is matched by a rule
  _match(file, rule) {
    const r = this._compile(rule).regexp.test(file)
    console.log('%O\t%O\t%O', file, rule.pattern, r)
    return r
  }

  _compile(rule) {
    if(rule.regexp) {
      return rule;
    }

    let regStr = '^';

    // Go through the pattern and convert it to a regexp.
    let escapedSlash = path.sep === '\\' ? '\\\\' : path.sep
    for(let i = 0; i < rule.pattern.length; i++) {
      const ch = rule.pattern[i];
  
      if (ch === '*') {
        if (rule.pattern[i+1] === '*') {
          // is some flavor of "**"
          i++;
  
          // Treat **/ as ** so eat the "/"
          if (rule.pattern[i+1] === escapedSlash) {
            i++;
          }
  
          if (rule.pattern[i+1] === undefined) {
            // is "**EOF" - to align with .gitignore just accept all
            regStr += ".*"
          } else {
            // is "**"
            // Note that this allows for any # of /'s (even 0) because
            // the .* will eat everything, even /'s
            regStr += `(.*${escapedSlash})?`
          }
        } else {
          // is "*" so map it to anything but "/"
          regStr += `[^${escapedSlash}]*`;
        }
      } else if (ch === '?') {
        // "?" is any char except "/"
        regStr += `[^${escapedSlash}]`
      } else if (ch === '.' || ch === '$') {
        // Escape some regexp special chars that have no meaning
        // in golang's filepath.Match
        regStr += `\\${ch}`
      } else if (ch === '\\') {
        // escape next char. Note that a trailing \ in the pattern
        // will be left alone (but need to escape it)
        if (path.sep === '\\') {
          // On windows map "\" to "\\", meaning an escaped backslash,
          // and then just continue because filepath.Match on
          // Windows doesn't allow escaping at all
          regStr += escSL
          continue
        }
        if (rule.pattern[i+1] !== undefined) {
          regStr += '\\' + rule.pattern[i+1]
          i++
        } else {
          regStr += '\\'
        }
      } else {
        regStr += ch
      }
    }
  
    regStr += "$"
  
    rule.regexp = new RegExp(regStr, 'i');
    return rule
  }
}


// > If the pattern ends with a slash,
// > it is removed for the purpose of the following description,
// > but it would only find a match with a directory.
// > In other words, foo/ will match a directory foo and paths underneath it,
// > but will not match a regular file or a symbolic link foo
// >  (this is consistent with the way how pathspec works in general in Git).
// '`foo/`' will not match regular file '`foo`' or symbolic link '`foo`'
// -> ignore-rules will not deal with it, because it costs extra `fs.stat` call
//      you could use option `mark: true` with `glob`

// '`foo/`' should not continue with the '`..`'
const DEFAULT_REPLACER_PREFIX = [

  // > Trailing spaces are ignored unless they are quoted with backslash ("\")
  [
    // (a\ ) -> (a )
    // (a  ) -> (a)
    // (a \ ) -> (a  )
    /\\?\s+$/,
    match => match.indexOf('\\') === 0
      ? ' '
      : ''
  ],

  // Escape metacharacters
  // which is written down by users but means special for regular expressions.

  // > There are 12 characters with special meanings:
  // > - the backslash \,
  // > - the caret ^,
  // > - the dollar sign $,
  // > - the period or dot .,
  // > - the vertical bar or pipe symbol |,
  // > - the question mark ?,
  // > - the asterisk or star *,
  // > - the plus sign +,
  // > - the opening parenthesis (,
  // > - the closing parenthesis ),
  // > - and the opening square bracket [,
  // > - the opening curly brace {,
  // > These special characters are often called "metacharacters".
  [
    /[\\\^$.|?*+()\[{]/g,
    match => '\\' + match
  ],

  // leading slash
  [

    // > A leading slash matches the beginning of the pathname.
    // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
    // A leading slash matches the beginning of the pathname
    /^\//,
    () => '^'
  ],

  // replace special metacharacter slash after the leading slash
  [
    /\//g,
    () => '\\/'
  ],

  [
    // > A leading "**" followed by a slash means match in all directories.
    // > For example, "**/foo" matches file or directory "foo" anywhere,
    // > the same as pattern "foo".
    // > "**/foo/bar" matches file or directory "bar" anywhere that is directly under directory "foo".
    // Notice that the '*'s have been replaced as '\\*'
    /^\^*\\\*\\\*\\\//,

    // '**/foo' <-> 'foo'
    () => '^(?:.*\\/)?'
  ]
]


const DEFAULT_REPLACER_SUFFIX = [
  // starting
  [
    // there will be no leading '/' (which has been replaced by section "leading slash")
    // If starts with '**', adding a '^' to the regular expression also works
    /^(?=[^\^])/,
    () =>  '^'
  ],

  // two globstars
  [
    // Use lookahead assertions so that we could match more than one `'/**'`
    /\\\/\\\*\\\*(?=\\\/|$)/g,

    // Zero, one or several directories
    // should not use '*', or it will be replaced by the next replacer

    // Check if it is not the last `'/**'`
    (match, index, str) => index + 6 < str.length

      // case: /**/
      // > A slash followed by two consecutive asterisks then a slash matches zero or more directories.
      // > For example, "a/**/b" matches "a/b", "a/x/b", "a/x/y/b" and so on.
      // '/**/'
      ? '(?:\\/[^\\/]+)*'

      // case: /**
      // > A trailing `"/**"` matches everything inside.

      // #21: everything inside but it should not include the current folder
      : '\\/.+'
  ],

  // intermediate wildcards
  [
    // Never replace escaped '*'
    // ignore rule '\*' will match the path '*'

    // 'abc.*/' -> go
    // 'abc.*'  -> skip this rule
    /(^|[^\\]+)\\\*(?=.+)/g,

    // '*.js' matches '.js'
    // '*.js' doesn't match 'abc'
    (match, p1) => p1 + '[^\\/]*'
  ],

  // trailing wildcard
  [
    /(\^|\\\/)?\\\*$/,
    (match, p1) => (
      p1
        // '\^':
        // '/*' does not match ''
        // '/*' does not match everything

        // '\\\/':
        // 'abc/*' does not match 'abc/'
        ? p1 + '[^/]+'

        // 'a*' matches 'a'
        // 'a*' matches 'aa'
        // 'a*' matches 'aa/'
        : '[^/]*'

    ) + '(?=$|\\/$)'
  ],

  [
    // unescape
    /\\\\\\/g,
    () => '\\'
  ]
]


const POSITIVE_REPLACERS = [
  ...DEFAULT_REPLACER_PREFIX,

  // 'f'
  // matches
  // - /f(end)
  // - /f/
  // - (start)f(end)
  // - (start)f/
  // doesn't match
  // - oof
  // - foo
  // pseudo:
  // -> (^|/)f(/|$)

  // ending
  [
    // 'js' will not match 'js.'
    // 'ab' will not match 'abc'
    /(?:[^*\/])$/,

    // 'js*' will not match 'a.js'
    // 'js/' will not match 'a.js'
    // 'js' will match 'a.js' and 'a.js/'
    match => match + '(?=$|\\/)'
  ],

  ...DEFAULT_REPLACER_SUFFIX
]


const NEGATIVE_REPLACERS = [
  ...DEFAULT_REPLACER_PREFIX,

  // #24
  // The MISSING rule of [gitignore docs](https://git-scm.com/docs/gitignore)
  // A negative pattern without a trailing wildcard should not
  // re-include the things inside that directory.

  // eg:
  // ['node_modules/*', '!node_modules']
  // should ignore `node_modules/a.js`
  [
    /(?:[^*\/])$/,
    match => match + '(?=$|\\/$)'
  ],

  ...DEFAULT_REPLACER_SUFFIX
]


// A simple cache, because an ignore rule only has only one certain meaning
const cache = {}

// @param {pattern}
function make_regex (pattern, negative) {
  const r = cache[pattern]
  if (r) {
    return r
  }

  const replacers = negative
    ? NEGATIVE_REPLACERS
    : POSITIVE_REPLACERS

  const source = replacers.reduce((prev, current) => {
    return prev.replace(current[0], current[1].bind(pattern))
  }, pattern)

  return cache[pattern] = new RegExp(source, 'i')
}


// Windows
// --------------------------------------------------------------
/* istanbul ignore if  */
if (
  // Detect `process` so that it can run in browsers.
  typeof process !== 'undefined'
  && (
    process.env && process.env.IGNORE_TEST_WIN32
    || process.platform === 'win32'
  )
) {

  const filter = IgnoreBase.prototype._filter
  const make_posix = str => /^\\\\\?\\/.test(str)
    || /[^\x00-\x80]+/.test(str)
      ? str
      : str.replace(/\\/g, '/')

  IgnoreBase.prototype._filter = function (path, slices) {
    path = make_posix(path)
    return filter.call(this, path, slices)
  }
}
