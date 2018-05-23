'use strict'

// For old node.js versions, we use es5
var fs = require('fs')
var ignore = require('../')
var expect = require('chai').expect
var spawn = require('spawn-sync')
var tmp = require('tmp').dirSync
var mkdirp = require('mkdirp').sync
var path = require('path')
var rm = require('rimraf').sync
var preSuf = require('pre-suf')

var removeEnding = preSuf.removeEnding
var removeLeading = preSuf.removeLeading

var IS_WINDOWS = process.platform === 'win32'
var SHOULD_TEST_WINDOWS = !process.env.IGNORE_TEST_WIN32
  && IS_WINDOWS

var cases = [
  [
    'spaces are accepted in patterns. "\\ " doesn\'t mean anything special',
    [
      'abc d',
      'abc\ e',
      'abc\\ f',
      'abc/a b c'
    ],
    {
      'abc d': 1,
      'abc\ e': 1,
      'abc/a b c': 1,
      'abc\\ f': 0,
      'abc': 0,
      'abc/abc d': 0,
      'abc/abc e': 0,
      'abc/abc f': 0
    }
  ],
  [
    'special cases: invalid empty paths, just ignore',
    [
    ],
    {
      '': 1
    }
  ],
  [
    '.git files are just like any other files',
    [
      '.git/*',
      '!.git/config',
      '.ftpconfig'
    ],
    {
      '.ftpconfig': 1,
      '.git': 0,
      '.git/config': 0,
      '.git/description': 1
    }
  ],
  [
    '.dockerignore documentation sample 1',
    [
      '# comment',
      '*/temp*',
      '*/*/temp*',
      'temp?'
    ],
    {
      'somedir/temporary.txt': 1,
      'somedir/temp/something.txt': 1,
      'somedir/subdir/temporary.txt': 1,
      'somedir/subdir/temp/something.txt': 1,
      'tempa/something.txt': 1,
      'tempb/something.txt': 1,
      'something.txt': 0,
      'somedir': 0,
      'somedir/something.txt': 0,
      'somedir/subdir': 0,
      'somedir/subdir/something.txt': 0,
    }
  ],
  [
    '.dockerignore documentation sample 2',
    [
      '*.md',
      '!README.md'
    ],
    {
      'test.txt': 0,
      'test.md': 1,
      'README.md': 0,
    }
  ],
  [
    '.dockerignore documentation sample 3',
    [
      '*.md',
      '!README*.md',
      'README-secret.md'
    ],
    {
      'test.txt': 0,
      'test.md': 1,
      'README.md': 0,
      'README-public.md': 0,
      'README-secret.md': 1,
    }
  ],
  [
    '.dockerignore documentation sample 4',
    [
      '*.md',
      'README-secret.md',
      '!README*.md'
    ],
    {
      'test.txt': 0,
      'test.md': 1,
      'README.md': 0,
      'README-public.md': 0,
      'README-secret.md': 0,
    }
  ],
  [
    'wildcard: special case, escaped wildcard',
    [
      '*.html',
      'a/b/*.html',
      '!a/b/\\*/index.html'
    ],
    {
      'a': 0,
      'a/b': 0,
      'a/b/*': 0,
      'a/b/*/index.html': 0,
      'a/b/index.html': 1,
      'index.html': 1
    }
  ],
  [
    'wildcard: treated as a shell glob suitable for consumption by fnmatch(3)',
    [
      '*.html',
      '*/*.html',
      '*/*/*.html',
      '*/*/*/*.html',
      '!b/\*/index.html'
    ],
    {
      'a': 0,
      'a/b': 0,
      'a/b/*': 0,
      'b': 0,
      'b/*': 0,
      'a/b/*/index.html': 1,
      'a/b/index.html': 1,
      'b/*/index.html': 0,
      'b/index.html': 1,
      'index.html': 1
    }
  ],
  [
    'wildcard: with no escape',
    [
      '*.html',
      'a/b/*.html',
      '!a/b/*/index.html'
    ],
    {
      'a': 0,
      'a/b': 0,
      'a/b/*': 0,
      'a/b/*/index.html': 0,
      'a/b/index.html': 1,
      'index.html': 1,
    }
  ],
  [
    'a negative pattern without a trailing wildcard re-includes the directory (unlike gitignore)',
    [
      '/node_modules/*',
      '!/node_modules',
      '!/node_modules/package'
    ],
    {
      'node_modules': 0,
      'node_modules/a': 0,
      'node_modules/a/a.js': 0,
      'node_modules/package': 0,
      'node_modules/package/a.js': 0
    }
  ],
  [
    'unignore with 1 globstar, reversed order',
    [
      '!foo/bar.js',
      'foo/*'
    ],
    {
      'foo': 0,
      'foo/bar.js': 1,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1
    }
  ],

  [
    'unignore with 2 globstars, reversed order',
    [
      '!foo/bar.js',
      'foo/**'
    ],
    {
      'foo': 0,
      'foo/bar.js': 1,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1
    }
  ],

  [
    'unignore with several groups of 2 globstars, reversed order',
    [
      '!foo/bar.js',
      'foo/**/**'
    ],
    {
      'foo': 0,
      'foo/bar': 1,
      'foo/bar.js': 1,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1
    }
  ],

  [
    'unignore with 1 globstar',
    [
      'foo/*',
      '!foo/bar.js'
    ],
    {
      'foo': 0,
      'foo/bar.js': 0,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1
    }
  ],

  [
    'unignore with 2 globstars',
    [
      'foo/**',
      '!foo/bar.js'
    ],
    {
      'foo': 0,
      'foo/bar.js': 0,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1
    }
  ],

  [
    'several groups of 2 globstars',
    [
      'foo/**/**',
      '!foo/bar.js'
    ],
    {
      'foo': 0,
      'foo/bar.js': 0,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1
    }
  ],

  // description  patterns  paths/expect  only
  [
    'ignore dot files',
    [
      '.*'
    ],
    {
      '.a': 1,
      '.gitignore': 1
    }
  ],

  [
    'Negate direcory inside ignored directory',
    [
      '.abc/*',
      '!.abc/d/'
    ],
    {
      '.abc': 0,
      '.abc/d': 0,
      '.abc/a.js': 1,
      '.abc/d/e.js': 0
    }
  ],

  [
    'Negate wildcard inside ignored parent directory (gitignore differs here)',
    [
      '.abc/*',
      // .abc/d will be ignored
      '!.abc/d/*'
    ],
    {
      '.abc/a.js': 1,
      // but '.abc/d/e.js' won't be (unlike gitignore)
      '.abc': 0,
      '.abc/d': 0,
      '.abc/d/e.js': 0
    }
  ],

  [
    'A blank line matches no files',
    [
      ''
    ],
    {
      'a.txt': 0,
      'a': 0,
      'a/b': 0,
      'a/b/c.txt': 0
    }
  ],
  [
    'A line starting with # serves as a comment.',
    ['#abc'],
    {
      '#abc': 0
    }
  ],
  [
    'Put a backslash ("\\") in front of the first hash for patterns that begin with a hash.',
    ['\\#abc'],
    {
      '#abc': 1
    }
  ],
  [
    'Trailing spaces are ignored unless they are quoted with backslash ("\")',
    [
      'abc\\  ', // only one space left -> (abc )
      'bcd  ',   // no space left -> (bcd)
      'cde \\ '  // two spaces -> (cde  )
    ],
    {
      // nothing to do with backslashes
      'abc\\  ': 0,
      'abc  ': 0,
      'abc ': 1,
      'abc   ': 0,
      'bcd': 1,
      'bcd ': 0,
      'bcd  ': 0,
      'cde  ': 1,
      'cde ': 0,
      'cde   ': 0
    },
    false,
    true
  ],
  [
    'An optional prefix "!" which negates the pattern; any matching file excluded by a previous pattern will become included again',
    [
      'abc',
      '!abc'
    ],
    {
      'abc': 0,
      'abc/a.js': 0,
    }
  ],
  [
    'It is possible to re-include a file if a parent directory of that file is excluded',
    [
      '/abc/',
      '!/abc/a.js'
    ],
    {
      'abc': 0,
      'abc/a.js': 0,
      'abc/d/e.js': 1
    }
  ],
  [
    'we did not know whether the rule is a dir first',
    [
      'abc',
      'bcd/abc',
      '!bcd/abc/a.js'
    ],
    {
      'abc/a.js': 1,
      'bcd/abc/f.js': 1,
      'bcd': 0,
      'bcd/abc': 0,
      'bcd/abc/a.js': 0
    }
  ],
  [
    'Put a backslash ("\\") in front of the first "!" for patterns that begin with a literal "!"',
    [
      '\\!abc',
      '\\!important!.txt'
    ],
    {
      '!abc': 1,
      'abc': 0,
      'b': 0,
      'b/!important!.txt': 0,
      '!important!.txt': 1
    }
  ],

  [
    'If the pattern ends with a slash, the slash is basically ignored/dropped',
    [
      'abc/'
    ],
    {
      'abc': 1,
      'abc/def.txt': 1
    }
  ],

  [
    'If the pattern does not contain a slash /, it\'s just a file in current directory',
    [
      'a.js',
      'f/'
    ],
    {
      'a.js': 1,
      'a': 0,
      'b': 0,
      'b/a': 0,
      'b/a/a.js': 0,
      'a/a.js': 0,
      'b/a.jsa': 0,
      'f/h': 1,
      'g': 0,
      'g/f': 0,
      'g/f/h': 0
    }
  ],
  [
    'Otherwise, it\'s a complete relative path',
    [
      'a/a.js'
    ],
    {
      'a': 0,
      'a/a.js': 1,
      'a/a.jsa': 0,
      'b': 0,
      'b/a': 0,
      'b/a/a.js': 0,
      'c': 0,
      'c/a': 0,
      'c/a/a.js': 0
    }
  ],

  [
    'wildcards in the pattern will not match a / in the pathname.',
    [
      'Documentation/*.html'
    ],
    {
      'Documentation': 0,
      'Documentation/git.html': 1,
      'Documentation/dir.html': 1,
      'Documentation/dir.html/test.txt': 1,
      'Documentation/ppc': 0,
      'Documentation/ppc/ppc.html': 0,
      'tools': 0,
      'tools/perf': 0,
      'tools/perf/Documentation': 0,
      'tools/perf/Documentation/perf.html': 0
    }
  ],

  [
    'A leading slash matches the beginning of the pathname',
    [
      '/*.c'
    ],
    {
      'cat-file.c': 1,
      'mozilla-sha1': 0,
      'mozilla-sha1/sha1.c': 0
    }
  ],

  [
    'A leading "**" followed by a slash means match in all directories',
    [
      '**/foo'
    ],
    {
      'foo': 1,
      'a': 0,
      'a/foo': 1,
      'foo/a': 1,
      'a/foo/a': 1,
      'a/b': 0,
      'a/b/c': 0,
      'a/b/c/foo/a': 1
    }
  ],

  [
    '"**/foo/bar" matches file or directory "bar" anywhere that is directly under directory "foo"',
    [
      '**/foo/bar'
    ],
    {
      'foo': 0,
      'foo/bar': 1,
      'abc/foo/bar': 1,
      'abc/foo/bar/': 1
    }
  ],

  [
    'A trailing "/**" matches everything inside',
    [
      'abc/**'
    ],
    {
      'abc/a/': 1,
      'abc/b': 1,
      'abc/d/e/f/g': 1,
      'bcd': 0,
      'bcd/abc': 0,
      'bcd/abc/a': 0,
      'abc': 0
    }
  ],

  [
    'A slash followed by two consecutive asterisks then a slash matches zero or more directories',
    [
      'a/**/b'
    ],
    {
      'a': 0,
      'a/b': 1,
      'a/x': 0,
      'a/x/b': 1,
      'a/x/y': 0,
      'a/x/y/b': 1,
      'b': 0,
      'b/a': 0,
      'b/a/b': 0
    }
  ],

  [
    'add a file content',
    'test/fixtures/.aignore',
    {
      'abc': 0,
      'abc/a.js': 1,
      'abc/b': 0,
      'abc/b/b.js': 0,
      '#e': 0,
      '#f': 1
    }
  ],

  // old test cases
  [
    'should excape metacharacters of regular expressions', [
      '*.js',
      '!\\*.js',
      '!a#b.js',
      '!?.js',

      // comments
      '#abc',

      '\\#abc'
    ], {
      '*.js': 0,
      'abc.js': 1,
      'a#b.js': 0,
      'abc': 0,
      '#abc': 1,
      '?.js': 0
    }
  ],

  [
    'question mark should not break all things',
    'test/fixtures/.ignore-issue-2', {
      '.project': 1,
      // remain
      'abc': 0,
      'abc/.project': 0,
      '.a.sw': 0,
      '.a.sw?': 1,
      'thumbs.db': 1
    }
  ],
  [
    'dir ended with "*"', [
      'abc/*'
    ], {
      'abc': 0
    }
  ],
  [
    'file ended with "*"', [
      'abc.js*',
    ], {
      'abc.js/': 1,
      'abc.js/abc': 1,
      'abc.jsa/': 1,
      'abc.jsa/abc': 1
    }
  ],
  [
    'wildcard as filename', [
      '*.b'
    ], {
      'b': 0,
      '.b': 1,
      'a.b': 1,
      'b/.b': 0,
      'b/a.b': 0,
      'b/.ba': 0,
      'b/c': 0,
      'b/c/a.b': 0
    }
  ],
  [
    'slash at the beginning and come with a wildcard', [
      '/*.c'
    ], {
      '.c': 1,
      'c': 0,
      'c.c': 1,
      'c/c.c': 0,
      'c/d': 0
    }
  ],
  [
    'dot file', [
      '.d',
      '*/.d',
    ], {
      '.d': 1,
      '.dd': 0,
      'd.d': 0,
      'd': 0,
      'd/.d': 1,
      'd/d.d': 0,
      'd/e': 0
    }
  ],
  [
    'dot dir', [
      '.e',
      '*/.e'
    ], {
      '.e/': 1,
      '.ee': 0,
      'e.e': 0,
      '.e/e': 1,
      'e/.e': 1,
      'e/e.e': 0,
      'e': 0,
      'e/f': 0
    }
  ],
  [
    'node modules: once', [
      'node_modules/'
    ], {
      'node_modules/gulp/node_modules/abc.md': 1,
      'node_modules/gulp/node_modules/abc.json': 1
    }
  ],
  [
    'node modules: twice', [
      'node_modules/',
      'node_modules/'
    ], {
      'node_modules/gulp/node_modules/abc.md': 1,
      'node_modules/gulp/node_modules/abc.json': 1
    }
  ]
]

var cases_to_test_only = cases.filter(function (c) {
  return c[3]
})

function readPatterns(file) {
  return fs.readFileSync(file).toString()
}

var real_cases = cases_to_test_only.length
  ? cases_to_test_only
  : cases

describe("cases", function() {
  real_cases.forEach(function(c) {
    var description = c[0]
    var patterns = c[1]
    var paths_object = c[2]
    var skip_test_test = c[4]

    if (typeof patterns === 'string') {
      patterns = readPatterns(patterns)
    }

    // All paths to test
    var paths = Object.keys(paths_object)

    // paths that NOT ignored
    var expected = paths
    .filter(function(p) {
      return !paths_object[p]
    })
    .sort()

    function expect_result(result, mapper) {
      if (mapper) {
        expected = expected.map(mapper)
      }

      expect(result.sort()).to.deep.equal(expected.sort())
    }

    it('.filter():        ' + description, function() {
      var ig = ignore()
      var result = ig
        .addPattern(patterns)
        .filter(paths)

      expect_result(result)
    })

    it('.createFilter():  ' + description, function() {
      var result = paths.filter(
        ignore()
        .addPattern(patterns)
        .createFilter(),
        // thisArg should be binded
        null
      )

      expect_result(result)
    })

    it('.ignores(path):   ' + description, function () {
      var ig = ignore().addPattern(patterns)

      Object.keys(paths_object).forEach(function (path) {
        expect(ig.ignores(path)).to.equal(!!paths_object[path])
      })
    })


    // TODO: Is this still applicable with dockerignore
    // Perhaps we should update the test and remov this flag
    // In some platform, the behavior of trailing spaces is weird
    // is not implemented as documented, so skip test
    !skip_test_test
    // Tired to handle test cases for test cases for windows
    && !IS_WINDOWS
    && it('test for test:    ' + description, function () {
      var result = getNativeDockerIgnoreResults(patterns, paths).sort()

      expect_result(result)
    })

    SHOULD_TEST_WINDOWS && it('win32: .filter(): ' + description, function() {
      var win_paths = paths.map(make_win32)

      var ig = ignore()
      var result = ig
        .addPattern(patterns)
        .filter(win_paths)

      expect_result(result, make_win32)
    })
  })

  it('.add(<Ignore>)', function() {
    var a = ignore().add(['.abc/*', '!.abc/d/'])
    var b = ignore().add(a).add('!.abc/e/')

    var paths = [
      '.abc/a.js',    // filtered out
      '.abc/d/e.js',  // included
      '.abc/e/e.js'   // included by b, filtered out by a
    ]

    expect(a.filter(paths)).to.eql(['.abc/d/e.js']);
    expect(b.filter(paths)).to.eql(['.abc/d/e.js', '.abc/e/e.js']);
  })
})

function make_win32 (path) {
  return path.replace(/\//g, '\\')
}


describe('for coverage', function () {
  it('fixes babel class', function () {
    var constructor = ignore().constructor

    try {
      constructor()
    } catch (e) {
      return
    }

    expect('there should be an error').to.equal('no error found')
  })
})


describe('github issues', function () {
  it('https://github.com/kaelzhang/node-ignore/issues/32', function () {
    var KEY_IGNORE = typeof Symbol !== 'undefined'
      ? Symbol.for('docker-ignore')
      : 'docker-ignore';

    var a = ignore().add(['.abc/*', '!.abc/d/'])

    // aa is actually not an IgnoreBase instance
    var aa = {}
    aa._rules = a._rules.slice()
    aa[KEY_IGNORE] = true

    var b = ignore().add(aa).add('!.abc/e/')

    var paths = [
      '.abc/a.js',    // filtered out
      '.abc/d/e.js',  // included
      '.abc/e/e.js'   // included by b, filtered out by a
    ]

    expect(a.filter(paths)).to.eql(['.abc/d/e.js']);
    expect(b.filter(paths)).to.eql(['.abc/d/e.js', '.abc/e/e.js']);
  })
})

var tmpCount = 0
var tmpRoot = tmp().name


function createUniqueTmp () {
  var dir = path.join(tmpRoot, String(tmpCount ++))
  // Make sure the dir not exists,
  // clean up dirty things
  rm(dir)
  mkdirp(dir)
  return dir
}


function getNativeDockerIgnoreResults (rules, paths) {
  var dir = createUniqueTmp()

  var dockerignore = typeof rules === 'string'
    ? rules
    : rules.join('\n')

  var DockerfileName = 'Dockerfile.build-context'
  var Dockerfile = `
    FROM busybox
    COPY . /build-context
    WORKDIR /build-context
    CMD find .
  `
  var ignores = new Set([DockerfileName, '.dockerignore', '.']) // TODO: Include Dockerfile and .dockerignore in tests and remove this

  touch(dir, '.dockerignore', dockerignore)
  touch(dir, DockerfileName, Dockerfile)

  paths.forEach(function (path, i) {
    if (path === '.dockerignore') {
      return
    }

    // We do not know if a path is NOT a file,
    // if we:
    // `touch a`
    // and then `touch a/b`, then boooom!
    if (containsInOthers(path, i, paths)) {
      return
    }

    touch(dir, path)
  })

  spawn('docker', ['build', '-f', DockerfileName, '-t', 'build-context', '.'], {
    cwd: dir
  })

  var runProc = spawn('docker', ['run', '--rm', 'build-context'], {
    cwd: dir
  })

  var out = runProc.stdout.toString()
  .split('\n')
  .map(s => removeLeading(s, './'))
  .filter(s => Boolean(s) && !ignores.has(s))

  return out
}


function touch (root, file, content) {
  // file = specialCharInFileOrDir(file)

  var dirs = file.split('/')
  var basename = dirs.pop()

  var dir = dirs.join('/')

  if (dir) {
    mkdirp(path.join(root, dir))
  }

  // abc/ -> should not create file, but only dir
  if (basename) {
    fs.writeFileSync(path.join(root, file), content || '')
  }
}


function containsInOthers (path, index, paths) {
  path = removeEnding(path, '/')

  return paths.some(function (p, i) {
    if (index === i) {
      return
    }

    return p === path
    || p.indexOf(path) === 0 && p[path.length] === '/'
  })
}
