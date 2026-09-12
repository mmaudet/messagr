#!/usr/bin/env node
//
// What went into a build, published where somebody can find it.
//
// # Why this exists
//
// Two builds went to TestFlight on 11 September 2026 and neither carried any
// record of what was in it. The account holder asked for one: « publier
// automatiquement un changelog sur le repos avec les changements majeurs qui
// sont intégrés dans cette build ».
//
// # Why the commit log IS the changelog here
//
// Every pull request is squash-merged, so `master` carries one commit per
// change, and its subject is a sentence somebody wrote for a reader: « Un
// coffre de clés, que tout client Matrix ouvre », « Une page blanche sans
// issue quand l'état de la sauvegarde ne se lit pas ». A generator that
// rewrote those would be a generator writing worse French than the people it
// quotes.
//
// So this selects and formats. It invents no prose.
//
// # A release rather than a file
//
// A `CHANGELOG.md` would have to be committed and pushed by the build script,
// and `build.sh` deliberately refuses that side effect for the version number
// itself: « The bump is in the working tree and is not committed: commit it
// with whatever else this build carries. » A release is dated, sits on the
// repository, links each line to its pull request, and changes nothing in the
// tree.
//
// # What it refuses to do
//
// **Publish empty notes.** A build with nothing in it is a build nobody
// needed, and a release saying so is worse than no release: it teaches a
// reader that the list is unreliable.
//
// **Tag a commit the remote has never seen.** The tag would point at
// something nobody else can fetch, and the release's links would all be
// broken.
//
// **Release a build number twice.** A build number is spent once — App Store
// Connect and Play both refuse one they have seen — so a store number that is
// already stamped on a tag means this build already happened, and the honest
// answer is to name the release it became rather than to move the label.
//
// # One tag for the product, and a stamp for the store
//
// The tag is `build-<n>`, where `<n>` counts this repository's published
// builds. It is deliberately neither store's number: TestFlight counts iOS
// builds from `CURRENT_PROJECT_VERSION` and Play counts Android ones from a
// run counter, so a shared name taken from either would make the other lie.
//
// Which store a build went to, and the number that store knows it by, live in
// the tag's message: `ios 25`. That is what lets the next release measure from
// the previous build OF THE SAME STORE, which is the only baseline that makes
// its list true.
//
// # Usage
//
//	node scripts/release-notes.mjs ios 24              # print them
//	node scripts/release-notes.mjs ios 24 --publish    # tag and release
//	node scripts/release-notes.mjs android 125 --since 0a4dab0
//	node scripts/release-notes.mjs --self-test
//
// `--since` is for the first build of a store, when no tag carries one of its
// builds yet. After that the baseline is found on its own.

import { execFileSync } from 'node:child_process'

/**
 * The tag a build carries. ONE NAMESPACE FOR THE PRODUCT, not one per store.
 *
 * It used to be `ios-24`, and the account holder asked for the opposite on 12
 * September 2026: « les tags ne devraient [pas] être spécifiques à iOS ». What
 * goes out is a build of Messagr. Which store received it is something the
 * release says, not something its name is about.
 *
 * The number is this repository's own count of published builds, deliberately
 * neither store's: TestFlight numbers iOS builds from `CURRENT_PROJECT_VERSION`
 * and Play numbers Android ones from a run counter, so the two disagree, and
 * naming a shared tag after either of them would make the other one lie.
 */
export function tagFor(number) {
  return `build-${number}`
}

/**
 * What the tag records about the build it names: the store, and the number
 * that store knows it by.
 *
 * IN THE MESSAGE RATHER THAN IN THE NAME, which is what lets the name stay
 * about the product, and `previousTagFor` reads it back.
 */
export function stampFor(platform, build) {
  return `${platform} ${build}`
}

/** `build-7\tios 25` read into its parts, or `null` for anything else. */
export function readTagLine(line) {
  const match = /^build-(\d+)\t?(ios|android)?\s*(\d+)?/.exec(line.trim())
  if (match === null) return null
  return {
    name: `build-${match[1]}`,
    number: Number(match[1]),
    platform: match[2] ?? null,
    build: match[3] === undefined ? null : Number(match[3]),
  }
}

/** The next number in this repository's count of builds. */
export function nextNumber(lines) {
  const numbers = lines.map(readTagLine).filter(one => one !== null)
  return numbers.reduce((highest, one) => Math.max(highest, one.number), 0) + 1
}

/**
 * The newest tag that went to THIS store, or `null` when there is none yet.
 *
 * Per store and not simply the newest tag, because the two do not move at the
 * same pace: measuring an Android release from the last iOS one would drop
 * every change that shipped to iOS in between, which is exactly the list an
 * Android reader is owed. A list that can be false is worse than no list.
 */
export function previousTagFor(platform, lines) {
  const mine = lines
    .map(readTagLine)
    .filter(one => one !== null && one.platform === platform)
    .sort((a, b) => b.number - a.number)
  return mine.length === 0 ? null : mine[0].name
}

/**
 * Whether this store has already released this build number.
 *
 * The refusal that used to be « this tag exists » — a build number is spent
 * once, App Store Connect and Play both refuse a number they have seen. The
 * tag name no longer carries that number, so the question is asked of the
 * stamps instead, and the answer names the tag that spent it.
 */
export function releasedAlready(platform, build, lines) {
  const match = lines
    .map(readTagLine)
    .find(
      one =>
        one !== null &&
        one.platform === platform &&
        one.build === Number(build),
    )
  return match === undefined ? null : match.name
}

/**
 * The identity a tag is signed with, when the machine has none of its own.
 *
 * AN ANNOTATED TAG NEEDS A TAGGER, and `git tag -a` refuses without one:
 * « Please tell me who you are ». A continuous integration runner has no
 * `user.email`, so the step that publishes the Android journal could never
 * have worked -- and `continue-on-error` would have swallowed the refusal,
 * which is how a build goes out with no record and nobody learns of it.
 *
 * A developer's own identity is left alone: this answers nothing when git
 * already knows who they are.
 */
export function taggerFor(configured) {
  if (configured !== '') return {}
  return {
    GIT_COMMITTER_NAME: 'messagr-ci',
    GIT_COMMITTER_EMAIL: 'ci@messagr.eu',
    GIT_AUTHOR_NAME: 'messagr-ci',
    GIT_AUTHOR_EMAIL: 'ci@messagr.eu',
  }
}

/** « iOS », « Android »: the store as somebody writes it, not as a flag. */
function storeNamed(platform) {
  return platform === 'ios' ? 'iOS' : 'Android'
}

/**
 * A subject, split into what it says and which pull request said it.
 *
 * `null` for a commit with no pull request. Those are rare on `master` and
 * they are NOT dropped: a change that reached a build without going through
 * review is the one a reader most wants to see.
 */
export function readSubject(subject) {
  const match = /^(.*?)\s*\(#(\d+)\)$/.exec(subject)
  if (match === null) return { said: subject.trim(), pull: null }
  return { said: match[1].trim(), pull: Number(match[2]) }
}

/** « 1 changement », « 11 changements ». */
function countIn(howMany) {
  return `${howMany} changement${howMany > 1 ? 's' : ''}`
}

/**
 * The body of the release.
 *
 * Pure, and exercised by `--self-test`: this produces a public artefact, and
 * a generator that quietly produced the wrong list would be believed.
 */
export function notesFrom({
  tag,
  platform,
  build,
  commit,
  previous,
  subjects,
}) {
  const entries = subjects.map(readSubject).filter(entry => entry.said !== '')
  if (entries.length === 0) {
    throw new Error(
      `nothing has been merged since ${previous ?? 'the starting point'}, so ` +
        `there is nothing for ${tag} to say it carries.`,
    )
  }

  const since =
    previous === null ? 'depuis le début de ce décompte' : `depuis ${previous}`
  const lines = entries.map(entry =>
    entry.pull === null
      ? `- ${entry.said} — poussé directement`
      : `- ${entry.said} (#${entry.pull})`,
  )

  return [
    `${countIn(entries.length)} ${since}.`,
    '',
    ...lines,
    '',
    // WHICH STORE, AND ITS OWN NUMBER, because the tag no longer says either.
    // A reader holding TestFlight build 25 has to be able to find the release
    // that goes with it.
    `${storeNamed(platform)}, build ${build}, construite depuis \`${commit}\`.`,
  ].join('\n')
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/** Every build tag, as `build-7\tios 25` lines. */
function tagLines() {
  const listed = git(
    'tag',
    '--list',
    'build-*',
    '--format=%(refname:short)%09%(contents:subject)',
  )
  return listed.split('\n').filter(one => one !== '')
}

function selfTest() {
  const failures = []
  const check = (what, actual, expected) => {
    const same = JSON.stringify(actual) === JSON.stringify(expected)
    if (!same) {
      failures.push(
        `${what}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`,
      )
    }
  }

  check(
    'a squash subject yields its sentence and its number',
    readSubject('Un coffre de clés, que tout client Matrix ouvre (#233)'),
    { said: 'Un coffre de clés, que tout client Matrix ouvre', pull: 233 },
  )
  check(
    'a subject naming two issues keeps only the pull request at the end',
    readSubject('Lot 1 : les fondations (#216, #217) (#222)'),
    { said: 'Lot 1 : les fondations (#216, #217)', pull: 222 },
  )
  check(
    'a commit with no pull request is read, not dropped',
    readSubject('iOS build 22'),
    { said: 'iOS build 22', pull: null },
  )
  check('the tag names the product, not a store', tagFor(7), 'build-7')
  check('the store is stamped in the message', stampFor('ios', 25), 'ios 25')
  check('a tag line is read into its parts', readTagLine('build-7\tios 25'), {
    name: 'build-7',
    number: 7,
    platform: 'ios',
    build: 25,
  })
  check(
    'a tag somebody made by hand, with no stamp, is still a build',
    readTagLine('build-3\t'),
    { name: 'build-3', number: 3, platform: null, build: null },
  )

  // The count is the repository's, so it is read as a number and not as text:
  // `build-10` sorts before `build-9` in any alphabet.
  const tags = ['build-9\tios 24', 'build-10\tandroid 148', 'build-3\tios 23']
  check('the next number is one above the highest', nextNumber(tags), 11)
  check('the first build of an empty repository is 1', nextNumber([]), 1)
  check(
    'the baseline is the last build of THIS store, not the last build',
    previousTagFor('ios', tags),
    'build-9',
  )
  check(
    'a store that has never been released has no baseline',
    previousTagFor('ios', ['build-1\tandroid 148']),
    null,
  )
  check(
    'a store build number that was already released names its tag',
    releasedAlready('ios', 24, tags),
    'build-9',
  )
  check(
    'a number nobody has spent is free',
    releasedAlready('ios', 25, tags),
    null,
  )

  const body = notesFrom({
    tag: 'build-10',
    platform: 'ios',
    build: 25,
    commit: '25d3d47',
    previous: 'build-9',
    subjects: ['Un coffre (#233)', 'poussé à la main'],
  })
  check(
    'the body counts, quotes, and names the store and the commit',
    body,
    [
      '2 changements depuis build-9.',
      '',
      '- Un coffre (#233)',
      '- poussé à la main — poussé directement',
      '',
      'iOS, build 25, construite depuis `25d3d47`.',
    ].join('\n'),
  )
  check(
    'one change is singular',
    notesFrom({
      tag: 'build-2',
      platform: 'android',
      build: 148,
      commit: 'abc1234',
      previous: null,
      subjects: ['Le premier (#1)'],
    }).split('\n')[0],
    '1 changement depuis le début de ce décompte.',
  )
  check(
    'the android release says Android',
    notesFrom({
      tag: 'build-2',
      platform: 'android',
      build: 148,
      commit: 'abc1234',
      previous: null,
      subjects: ['Le premier (#1)'],
    }).split('\n')[4],
    'Android, build 148, construite depuis `abc1234`.',
  )

  check(
    'a machine that knows who it is keeps its own identity',
    taggerFor('somebody@example.org'),
    {},
  )
  check(
    'a machine that does not is given one, because a tag needs a tagger',
    taggerFor('').GIT_COMMITTER_EMAIL,
    'ci@messagr.eu',
  )

  let refused = false
  try {
    notesFrom({
      tag: 'build-4',
      platform: 'ios',
      build: 3,
      commit: 'abc1234',
      previous: 'build-3',
      subjects: [],
    })
  } catch {
    refused = true
  }
  check('empty notes are refused rather than published', refused, true)

  if (failures.length > 0) {
    console.error(`release-notes self-test: ${failures.length} failed\n`)
    for (const one of failures) console.error(one + '\n')
    process.exit(1)
  }
  console.log('release-notes self-test: every case passed')
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest()

  const [platform, build] = argv
  if (platform !== 'ios' && platform !== 'android') {
    console.error(
      'usage: release-notes.mjs ios|android <build> [--publish] [--since <ref>]',
    )
    process.exit(2)
  }
  if (!/^\d+$/.test(build ?? '')) {
    console.error(`"${build}" is not a build number.`)
    process.exit(2)
  }

  const lines = tagLines()
  const sinceFlag = argv.indexOf('--since')
  const previous =
    sinceFlag === -1 ? previousTagFor(platform, lines) : argv[sinceFlag + 1]
  if (previous === undefined) {
    console.error('--since needs a ref.')
    process.exit(2)
  }
  if (previous === null && sinceFlag === -1) {
    console.error(
      `no build-* tag carries an ${platform} build yet, so there is no ` +
        'previous one to measure from. Give the first one a floor with ' +
        '--since <ref>.',
    )
    process.exit(2)
  }

  const commit = git('rev-parse', '--short', 'HEAD')
  const subjects = git('log', `${previous}..HEAD`, '--no-merges', '--format=%s')
    .split('\n')
    .filter(one => one !== '')

  const tag = tagFor(nextNumber(lines))
  const body = notesFrom({ tag, platform, build, commit, previous, subjects })

  if (!argv.includes('--publish')) {
    console.log(body)
    return
  }

  // REFUSED RATHER THAN MOVED. A build number is spent once -- App Store
  // Connect and Play both refuse one they have seen -- so a stamp that is
  // already on a tag means this build already happened, and the honest answer
  // says which release it became.
  const spent = releasedAlready(platform, build, lines)
  if (spent !== null) {
    console.error(
      `${platform} build ${build} was already released, as ${spent}.`,
    )
    process.exit(1)
  }
  if (git('tag', '--list', tag) !== '') {
    console.error(`${tag} already exists. Fetch the tags and run this again.`)
    process.exit(1)
  }

  // AND NOT A COMMIT THE REMOTE HAS NEVER SEEN, which would give a release
  // whose every link is broken.
  const onRemote = execFileSync(
    'git',
    ['branch', '--remotes', '--contains', 'HEAD'],
    { encoding: 'utf8' },
  ).trim()
  if (onRemote === '') {
    console.error(
      `${commit} is on no remote branch. Push it before releasing, or the ` +
        'tag will point at something nobody else can fetch.',
    )
    process.exit(1)
  }

  // THE STAMP IS THE MESSAGE, and it is what the next build reads to find its
  // baseline. A tag written without one still counts as a build, but it stops
  // being able to say which store it went to.
  let configured = ''
  try {
    configured = git('config', '--get', 'user.email')
  } catch {
    // `git config --get` sort en erreur quand la clé n'existe pas, ce qui
    // est précisément le cas qui nous intéresse.
  }
  execFileSync('git', ['tag', '-a', tag, '-m', stampFor(platform, build)], {
    stdio: 'inherit',
    env: { ...process.env, ...taggerFor(configured) },
  })
  execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' })
  execFileSync(
    'gh',
    [
      'release',
      'create',
      tag,
      '--title',
      `${tag} (${storeNamed(platform)} ${build})`,
      '--notes',
      body,
    ],
    { stdio: 'inherit' },
  )
  console.log(`${tag} released.`)
}

main(process.argv.slice(2))
