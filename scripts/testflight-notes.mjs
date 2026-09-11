#!/usr/bin/env node
//
// Putting a build's changelog into TestFlight's « What to Test ».
//
// # Why this is a separate step from the upload
//
// `publish-ios.sh` hands Apple an archive and stops. The build does not exist
// in App Store Connect at that moment: Apple takes five to thirty minutes to
// process it, and until it has, there is nothing to attach notes to.
//
// So this polls, with a bound, and says plainly when the bound is reached
// rather than failing in a way that reads as a credential problem. Re-running
// it later costs one request and is the ordinary thing to do.
//
// # No dependency for the token
//
// App Store Connect wants a JWT signed ES256. Node signs P-256 natively; the
// only thing worth knowing is `dsaEncoding: 'ieee-p1363'`, which produces the
// raw r‖s pair a JWT wants rather than the DER wrapper `crypto.sign` defaults
// to. A DER signature is rejected with a message about authentication, which
// is how somebody spends an afternoon looking at their key.
//
// # The key is the same one the upload uses, and it is never printed
//
// `~/.appstoreconnect/env` and the `.p8` beside it, at chmod 600, outside
// this repository because it is public. Nothing here echoes the key, the key
// id or the issuer id: a build log is a place secrets go to be found.
//
// # Usage
//
//	node scripts/testflight-notes.mjs 24 --notes-file <path>
//	node scripts/testflight-notes.mjs 24 --notes-file <path> --wait 1800

import { Buffer } from 'node:buffer'
import { sign as signWith } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BUNDLE_ID = 'eu.messagr'
/** The locale TestFlight shows when a tester's own is not provided. */
const LOCALE = 'en-US'
const API = 'https://api.appstoreconnect.apple.com/v1'

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/[=]+$/, '')
}

function tokenFor({ keyId, issuerId, privateKey }) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
  const payload = {
    iss: issuerId,
    iat: issuedAt,
    // Twenty minutes. Apple refuses anything beyond twenty, and a token that
    // outlived its errand would be a credential sitting in a process for no
    // reason.
    exp: issuedAt + 20 * 60,
    aud: 'appstoreconnect-v1',
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload),
  )}`
  // `ieee-p1363` and not DER. See the note at the top: the difference is
  // invisible until Apple answers 401 about something that is not the key.
  const signature = signWith('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${b64url(signature)}`
}

function credentials() {
  const envFile = join(homedir(), '.appstoreconnect', 'env')
  const fromFile = {}
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = /^([A-Z_]+)[=](.*)$/.exec(line.trim())
      if (match !== null) fromFile[match[1]] = match[2]
    }
  }
  const keyId = process.env.ASC_KEY_ID ?? fromFile.ASC_KEY_ID
  const issuerId = process.env.ASC_ISSUER_ID ?? fromFile.ASC_ISSUER_ID
  if (!keyId || !issuerId) {
    console.error(
      'ASC_KEY_ID and ASC_ISSUER_ID must be set, in the environment or in ' +
        '~/.appstoreconnect/env. See publishing-ios.md.',
    )
    process.exit(2)
  }
  const keyPath =
    process.env.ASC_KEY_PATH ??
    join(homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`)
  if (!existsSync(keyPath)) {
    // The path is printed with the key id blotted: knowing WHICH file is
    // missing is the whole point of the message, and the identifier in its
    // name is not.
    console.error(`no key at ${keyPath.replace(keyId, '********')}`)
    process.exit(2)
  }
  return { keyId, issuerId, privateKey: readFileSync(keyPath, 'utf8') }
}

async function ask(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `${options.method ?? 'GET'} ${path}: ${response.status} ${detail.slice(0, 400)}`,
    )
  }
  return response.status === 204 ? null : response.json()
}

async function appId(token) {
  const found = await ask(token, `/apps?filter[bundleId]=${BUNDLE_ID}`)
  const [app] = found.data
  if (app === undefined) {
    throw new Error(
      `App Store Connect knows no app with bundle id ${BUNDLE_ID}`,
    )
  }
  return app.id
}

/**
 * The build, once Apple has finished with it.
 *
 * `PROCESSING` is not a failure and not an answer: it is the ordinary state
 * for the first several minutes, and the only thing to do about it is wait.
 */
async function waitForBuild(token, app, number, seconds) {
  const deadline = Date.now() + seconds * 1000
  for (;;) {
    const found = await ask(
      token,
      `/builds?filter[app]=${app}&filter[version]=${number}&limit=1`,
    )
    const [build] = found.data
    if (build !== undefined && build.attributes.processingState === 'VALID') {
      return build.id
    }
    if (Date.now() > deadline) {
      const state = build?.attributes.processingState ?? 'absent'
      throw new Error(
        `build ${number} is still ${state} after ${seconds}s. Nothing is ` +
          'wrong; Apple is slow. Run this again when it appears in ' +
          'TestFlight.',
      )
    }
    await new Promise(resume => setTimeout(resume, 30_000))
  }
}

async function setNotes(token, build, whatsNew) {
  const existing = await ask(
    token,
    `/builds/${build}/betaBuildLocalizations?limit=50`,
  )
  const mine = existing.data.find(one => one.attributes.locale === LOCALE)

  if (mine !== undefined) {
    await ask(token, `/betaBuildLocalizations/${mine.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'betaBuildLocalizations',
          id: mine.id,
          attributes: { whatsNew },
        },
      }),
    })
    return 'replaced'
  }

  await ask(token, '/betaBuildLocalizations', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: LOCALE, whatsNew },
        relationships: { build: { data: { type: 'builds', id: build } } },
      },
    }),
  })
  return 'written'
}

async function main(argv) {
  const [number] = argv
  if (!/^\d+$/.test(number ?? '')) {
    console.error(
      'usage: testflight-notes.mjs <build> --notes-file <path> [--wait <seconds>]',
    )
    process.exit(2)
  }
  const notesAt = argv[argv.indexOf('--notes-file') + 1]
  if (!notesAt || !existsSync(notesAt)) {
    console.error('--notes-file must point at a file that exists.')
    process.exit(2)
  }
  const waitFlag = argv.indexOf('--wait')
  const seconds = waitFlag === -1 ? 900 : Number(argv[waitFlag + 1])

  const whatsNew = readFileSync(notesAt, 'utf8').trim()
  if (whatsNew === '') {
    console.error(
      'the notes are empty, and an empty « What to Test » is worse than none.',
    )
    process.exit(2)
  }
  // Apple's own limit. Truncating silently would hand a tester half a
  // sentence; refusing says which build needs a shorter list.
  if (whatsNew.length > 4000) {
    console.error(
      `these notes are ${whatsNew.length} characters and App Store Connect ` +
        'takes 4000.',
    )
    process.exit(2)
  }

  const token = tokenFor(credentials())
  const app = await appId(token)
  console.log(`waiting for build ${number} to finish processing…`)
  const build = await waitForBuild(token, app, number, seconds)
  const what = await setNotes(token, build, whatsNew)
  console.log(`« What to Test » ${what} for build ${number}.`)
}

main(process.argv.slice(2)).catch(cause => {
  console.error(String(cause.message ?? cause))
  process.exit(1)
})
