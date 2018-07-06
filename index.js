'use strict'

const path = require('path')

module.exports = () => new IgnoreBase()

// A simple implementation of make-array
function make_array (subject) {
  return Array.isArray(subject)
    ? subject
    : [subject]
}

const REGEX_TRAILING_SLASH = /\/$/
const SLASH = '/'
const KEY_IGNORE = typeof Symbol !== 'undefined'
  ? Symbol.for('dockerignore')
  : 'dockerignore'

// An implementation of Go's filepath.Clean
function cleanPath (file) {
  return path.normalize(file).replace(REGEX_TRAILING_SLASH, '')
}

class IgnoreBase {
  constructor () {
    this._rules = []
    this[KEY_IGNORE] = true
    this._initCache()
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
    // https://github.com/kaelzhang/node-ignore/issues/32
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
      pattern = pattern.substr(1).trim()
    }

    if (pattern.length > 0) {
      pattern = cleanPath(pattern)
			pattern = pattern.split(path.sep).join(SLASH);
			if (pattern.length > 1 && pattern[0] === SLASH) {
				pattern = pattern.slice(1)
			}
    }

    pattern = pattern.trim()
    if(pattern === "") {
      return null
    }

    return {
      origin,
      pattern,
      dirs: pattern.split(path.sep),
      negative,
    }
  }

  // @returns `Boolean` true if the `path` is NOT ignored
  _filter (path) {
    if (!path) {
      return false
    }

    if (path in this._cache) {
      return this._cache[path]
    }

    return this._cache[path] = this._test(path)
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
        if (rule.dirs.includes('**')) {
          // Ah shucks! We have to test every possible parent path that has 
          // a number of dirs _n_ where 
          // `rule.dirs.filter(doubleStar).length <= _n_ <= parentPathDirs.length`
          // since the ** can imply any number of directories including 0
          for (let i = rule.dirs.filter(x => x !== '**').length; i <= parentPathDirs.length; i++) {
            match = match || this._match(parentPathDirs.slice(0, i).join(path.sep), rule)
          }
        } else if (rule.dirs.length <= parentPathDirs.length) {
          // We can just test the parent path with the correct number of dirs
          // in the rule since, for a match to happen, rule.dirs.length HAS TO BE
          // EQUAL to the number of first in the parent path :D
          match = this._match(parentPathDirs.slice(0, rule.dirs.length).join(path.sep), rule)
        }
      }
  
      if (match) {
        matched = !rule.negative
      }
    })
  
    return !matched
  }

  // @returns {Boolean} true if a file is matched by a rule
  _match(file, rule) {
    return this._compile(rule).regexp.test(file)
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
          regStr += escapedSlash
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

// A simple cache, because an ignore rule only has only one certain meaning
const cache = {}

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

  IgnoreBase.prototype._filter = function (path) {
    path = make_posix(path)
    return filter.call(this, path)
  }
}
