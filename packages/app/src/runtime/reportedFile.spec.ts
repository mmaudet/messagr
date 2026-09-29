import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { mediaDownloader } from '../../../../scripts/lib/ouvrir-un-fichier-signale.mjs'
import { openTool } from '../../../../scripts/lib/ouvrir-un-signalement.mjs'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import { generateKeyPair } from './hpke'
import { payloadBytes, type ReportPayload } from './reportFormat'
import { reportMessages } from './reportMessages'
import { sealReportWithEphemeral } from './sealedReport'

/**
 * A photograph or a document a report carries, opened by the operator on
 * its own machine, on demand only (#471, ADR 0015).
 *
 * The report holds the description of its encrypted file, never the file.
 * Asked to open one (`--ouvrir <n>`), the tool downloads the encrypted copy
 * with the operator's account, refuses it unless its SHA-256 hash is the one
 * the report states, decrypts it in memory, shows it from a private copy,
 * and erases that copy whatever happens: nothing of it is left behind.
 *
 * The homeserver is a local file double: the encrypted copy is a file here,
 * served for its `mxc://` address. The viewer is a double too, which reads
 * what it is handed while it is there.
 */

const FIXTURES = join(__dirname, '../../../../scripts/fixtures')
/** The test key, in the format of the operator's key file. TEST ONLY. */
const TEST_KEY_FILE = join(FIXTURES, 'cle-de-test-de-l-exploitant.json')
const TEST_KEY = JSON.parse(readFileSync(TEST_KEY_FILE, 'utf8')) as {
  readonly public_key: string
}

/**
 * NIST SP 800-38A, appendix F.5.5, CTR-AES256.Encrypt: a file of four
 * blocks, its key, its initial counter, and its ciphertext. Matrix encrypts
 * a file in AES-256-CTR, so this is an encrypted file whose every byte was
 * computed outside this repository.
 */
const NIST = {
  key: '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
  counter: 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
  plaintext:
    '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
    '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
  ciphertext:
    '601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c5' +
    '2b0930daa23de94ce87017ba2d84988ddfc9c58db67aada613c2dd08457941a6',
}

/**
 * That ciphertext described as Matrix describes an encrypted file: the key
 * in unpadded base64url, the counter in unpadded base64, and the SHA-256
 * hash of the ciphertext, computed apart with `openssl dgst -sha256`.
 */
const MATERIAL = {
  v: 'v2',
  key: {
    kty: 'oct',
    key_ops: ['encrypt', 'decrypt'],
    alg: 'A256CTR',
    k: 'YD3rEBXKcb4rc67whX13gR81LAc7YQjXLZgQowkU3_Q',
    ext: true,
  },
  iv: '8PHy8/T19vf4+fr7/P3+/w',
  hashes: { sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U' },
}

const ME = '@alice:example.org'
const HIM = '@bob:example.org'

function bytes(hexadecimal: string): Uint8Array {
  return Uint8Array.from(hexadecimal.match(/../g) ?? [], pair =>
    parseInt(pair, 16),
  )
}

function hex(of: Uint8Array): string {
  return Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

/** `hexadecimal` in an `ArrayBuffer` of its own, as `fetch` answers. */
function arrayBufferOf(hexadecimal: string): ArrayBuffer {
  const held = bytes(hexadecimal)
  const buffer = new ArrayBuffer(held.length)
  new Uint8Array(buffer).set(held)
  return buffer
}

/** A homeserver's media, as local files: each `mxc://` address, a file. */
function mediaHeld(copies: Readonly<Record<string, string>>) {
  const directory = mkdtempSync(join(tmpdir(), 'serveur-471-'))
  const files = new Map<string, string>()
  for (const [url, ciphertext] of Object.entries(copies)) {
    const path = join(directory, String(files.size))
    writeFileSync(path, bytes(ciphertext))
    files.set(url, path)
  }
  const downloaded: string[] = []
  return {
    downloaded,
    download: async (url: string): Promise<Uint8Array> => {
      downloaded.push(url)
      const path = files.get(url)
      if (path === undefined) throw new Error('le serveur répond 404')
      return new Uint8Array(readFileSync(path))
    },
  }
}

/** What the viewer was handed, read while it was there. */
interface Seen {
  readonly path: string
  readonly bytes: string
  readonly mode: number
  readonly directoryMode: number
}

/** A viewer that reads what it is shown, or one that fails. */
function viewer(fails = false) {
  const seen: Seen[] = []
  return {
    seen,
    show: async (path: string): Promise<void> => {
      seen.push({
        path,
        bytes: hex(new Uint8Array(readFileSync(path))),
        mode: statSync(path).mode % 0o1000,
        directoryMode: statSync(dirname(path)).mode % 0o1000,
      })
      if (fails) throw new Error('Aperçu ne s’est pas ouvert')
    },
  }
}

/** What the tool says and prints, how it ends, and where it may write. */
async function run(
  argv: readonly string[],
  media: ReturnType<typeof mediaHeld>,
  shown: ReturnType<typeof viewer>,
  temporary = mkdtempSync(join(tmpdir(), 'ouverture-471-')),
) {
  const said: string[] = []
  const printed: string[] = []
  const accounts: (string | null)[] = []
  const status = await openTool([...argv], {
    home: mkdtempSync(join(tmpdir(), 'exploitant-471-')),
    stdin: async () => '',
    stderr: (line: string) => said.push(line),
    stdout: (line: string) => printed.push(line),
    media: async (named: string | null) => {
      accounts.push(named)
      return { ok: true, download: media.download }
    },
    show: shown.show,
    temporary,
  })
  return {
    status,
    said: said.join('\n'),
    printed: printed.join('\n').split('\n'),
    accounts,
    temporary,
  }
}

/** A payload carrying words, a photograph and a document of one author. */
const PAYLOAD: ReportPayload = {
  reason: 'sexual_without_consent',
  reportedAt: 1_790_000_060_000,
  reportingAccount: ME,
  reportedAccount: HIM,
  roomId: '!room:example.org',
  messages: [
    {
      kind: 'text',
      eventId: '$words',
      sentAt: 1_790_000_010_000,
      sender: HIM,
      text: 'Regarde.',
    },
    {
      kind: 'photograph',
      eventId: '$photograph',
      sentAt: 1_790_000_020_000,
      sender: HIM,
      file: { ...MATERIAL, url: 'mxc://example.org/photograph' },
      mimetype: 'image/jpeg',
      name: 'image.jpg',
      size: 64,
    },
    {
      kind: 'document',
      eventId: '$document',
      sentAt: 1_790_000_030_000,
      sender: HIM,
      file: { ...MATERIAL, url: 'mxc://example.org/document' },
      mimetype: 'application/pdf',
      name: 'contrat.pdf',
      size: 64,
    },
  ],
}

/** `payload`, sealed for the test key and written as the service exports it. */
function sealed(payload: ReportPayload = PAYLOAD): string {
  const binding = {
    reason: payload.reason,
    reporter: payload.reportingAccount,
  }
  const path = join(mkdtempSync(join(tmpdir(), 'pli-471-')), 'pli.json')
  writeFileSync(
    path,
    JSON.stringify({
      ...binding,
      sealed: sealReportWithEphemeral(
        generateKeyPair(),
        payloadBytes(payload),
        binding,
        TEST_KEY.public_key,
      ),
    }),
  )
  return path
}

describe('A reported photograph or document, on the operator’s machine (#471)', () => {
  it('shows each file’s description and how to open it, and opens nothing unasked', async () => {
    const media = mediaHeld({})
    const shown = viewer()

    const { status, printed, accounts } = await run(
      ['--cle', TEST_KEY_FILE, sealed()],
      media,
      shown,
    )

    expect(status).toBe(0)
    expect(printed).toEqual([
      'compte qui signale : @alice:example.org',
      'auteur             : @bob:example.org',
      'conversation       : !room:example.org',
      'motif              : sexual_without_consent',
      'signalé le         : 2026-09-21 14:14:20 UTC',
      '',
      'message 1 sur 3, écrit le 2026-09-21 14:13:30 UTC',
      '  événement : $words',
      '  │ Regarde.',
      '',
      'message 2 sur 3, écrit le 2026-09-21 14:13:40 UTC',
      '  événement : $photograph',
      '  photo : image.jpg (image/jpeg, 64 octets)',
      '  copie chiffrée : mxc://example.org/photograph',
      '  pour l’ouvrir, à la demande : --ouvrir 2',
      '',
      'message 3 sur 3, écrit le 2026-09-21 14:13:50 UTC',
      '  événement : $document',
      '  document : contrat.pdf (application/pdf, 64 octets)',
      '  copie chiffrée : mxc://example.org/document',
      '  pour l’ouvrir, à la demande : --ouvrir 3',
    ])
    // Neither the account nor the homeserver was asked anything.
    expect(accounts).toEqual([])
    expect(media.downloaded).toEqual([])
    expect(shown.seen).toEqual([])
  })

  it('opens a photograph on demand: downloaded with the operator’s account, its hash checked, shown from a private copy, then erased', async () => {
    // From the selection to the operator's screen: the application reports
    // a photograph as it does (`reportMessages`), for the test key, and the
    // tool opens what the device described.
    const photograph: TimelineEntry = {
      eventId: '$photograph',
      claimedSender: HIM,
      sentAt: 1_790_000_020_000,
      body: 'image.jpg',
      msgtype: 'm.image',
      image: {
        url: 'mxc://example.org/photograph',
        secret: JSON.stringify(MATERIAL),
        mimeType: 'image/jpeg',
        width: 4,
        height: 4,
        size: 64,
        thumbnail: null,
      },
    }
    const sent: string[] = []
    await reportMessages(
      {
        whoami: async () => ME,
        seal: (payload, binding) =>
          sealReportWithEphemeral(
            generateKeyPair(),
            payload,
            binding,
            TEST_KEY.public_key,
          ),
        keyOf: () => 'report-key-1',
        service: {
          send: async body => {
            sent.push(body)
            return { status: 201, body: '{"number":"K7QM-4ZT2"}' }
          },
        },
        now: () => 1_790_000_060_000,
        after: () => new Promise(() => {}),
      },
      {
        self: ME,
        roomId: '!room:example.org',
        reason: 'sexual_without_consent',
        selected: new Set(['$photograph']),
        timeline: [photograph],
      },
    )
    const report = join(mkdtempSync(join(tmpdir(), 'pli-471-')), 'pli.json')
    writeFileSync(
      report,
      JSON.stringify({ ...JSON.parse(sent[0]!), reporter: ME }),
    )
    const media = mediaHeld({ 'mxc://example.org/photograph': NIST.ciphertext })
    const shown = viewer()

    const { status, said, accounts, temporary } = await run(
      ['--cle', TEST_KEY_FILE, report, '--ouvrir', '1'],
      media,
      shown,
    )

    expect(status).toBe(0)
    expect(accounts).toEqual([null])
    expect(media.downloaded).toEqual(['mxc://example.org/photograph'])
    // What was shown is the file itself, decrypted, in a copy only this
    // user can read, in a directory only this user can enter.
    expect(shown.seen).toHaveLength(1)
    const [seen] = shown.seen
    expect(seen!.bytes).toBe(NIST.plaintext)
    expect(seen!.mode).toBe(0o600)
    expect(seen!.directoryMode).toBe(0o700)
    expect(seen!.path.startsWith(temporary)).toBe(true)
    expect(seen!.path.endsWith('.jpg')).toBe(true)
    // And nothing is left: not the copy, not its directory.
    expect(existsSync(seen!.path)).toBe(false)
    expect(readdirSync(temporary)).toEqual([])
    expect(said).toContain('empreinte')
  })

  it('opens a document on demand the same way', async () => {
    const media = mediaHeld({ 'mxc://example.org/document': NIST.ciphertext })
    const shown = viewer()

    const { status, temporary } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '3'],
      media,
      shown,
    )

    expect(status).toBe(0)
    expect(media.downloaded).toEqual(['mxc://example.org/document'])
    expect(shown.seen.map(one => one.bytes)).toEqual([NIST.plaintext])
    expect(shown.seen[0]!.path.endsWith('.pdf')).toBe(true)
    expect(readdirSync(temporary)).toEqual([])
  })

  it('refuses a file whose hash does not match, and neither decrypts, writes nor shows anything', async () => {
    // The homeserver serves other bytes than those the device described:
    // not the file that was reported.
    const other = bytes(NIST.ciphertext)
    other[17] = (other[17]! + 1) % 256
    const media = mediaHeld({ 'mxc://example.org/photograph': hex(other) })
    const shown = viewer()

    const { status, said, temporary } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      media,
      shown,
    )

    expect(status).toBe(1)
    expect(said).toContain('L’empreinte ne correspond pas')
    expect(shown.seen).toEqual([])
    expect(readdirSync(temporary)).toEqual([])
  })

  it('erases the copy even when the viewer fails', async () => {
    const media = mediaHeld({ 'mxc://example.org/photograph': NIST.ciphertext })
    const shown = viewer(true)

    const { status, temporary } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      media,
      shown,
    )

    expect(status).toBe(1)
    expect(shown.seen).toHaveLength(1)
    expect(existsSync(shown.seen[0]!.path)).toBe(false)
    expect(readdirSync(temporary)).toEqual([])
  })

  it('erases a copy an interrupted opening left behind, and nothing else', async () => {
    // A tool killed while a file was shown leaves its private copy: the next
    // opening finds it and erases it.
    const temporary = mkdtempSync(join(tmpdir(), 'ouverture-471-'))
    mkdirSync(join(temporary, 'messagr-signalement-ancien'))
    writeFileSync(
      join(temporary, 'messagr-signalement-ancien', 'signalement.jpg'),
      'ce qui restait',
    )
    writeFileSync(join(temporary, 'autre-chose'), 'pas à nous')
    const media = mediaHeld({ 'mxc://example.org/photograph': NIST.ciphertext })

    const { status, said } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      media,
      viewer(),
      temporary,
    )

    expect(status).toBe(0)
    expect(readdirSync(temporary)).toEqual(['autre-chose'])
    expect(said).toContain('messagr-signalement-ancien')
  })

  it('opens nothing for a message that carries no file, a number no message has, or no number', async () => {
    for (const asked of [
      ['--ouvrir', '1'],
      ['--ouvrir', '4'],
      ['--ouvrir', 'deux'],
      ['--ouvrir'],
    ]) {
      const media = mediaHeld({})
      const shown = viewer()

      const { status, accounts } = await run(
        ['--cle', TEST_KEY_FILE, sealed(), ...asked],
        media,
        shown,
      )

      expect(status, asked.join(' ')).toBe(2)
      expect(accounts).toEqual([])
      expect(media.downloaded).toEqual([])
      expect(shown.seen).toEqual([])
    }
  })

  it('reads no report in a payload carrying a file that could not be opened, and asks nothing', async () => {
    // What makes a file openable is one rule, the application's and the
    // tool's (`openingOf`): the application reports no such file, and the
    // tool reads no such report.
    const withKey = (k: string): ReportPayload => ({
      ...PAYLOAD,
      messages: [
        {
          kind: 'photograph',
          eventId: '$photograph',
          sentAt: 1_790_000_020_000,
          sender: HIM,
          file: {
            ...MATERIAL,
            key: { ...MATERIAL.key, k },
            url: 'mxc://example.org/photograph',
          },
          mimetype: 'image/jpeg',
          name: 'image.jpg',
          size: 64,
        },
      ],
    })
    const media = mediaHeld({ 'mxc://example.org/photograph': NIST.ciphertext })
    const shown = viewer()

    const { status, said, temporary } = await run(
      ['--cle', TEST_KEY_FILE, sealed(withKey('trop-courte')), '--ouvrir', '1'],
      media,
      shown,
    )

    expect(status).toBe(2)
    expect(said).toContain('pas un signalement au format 1')
    expect(media.downloaded).toEqual([])
    expect(shown.seen).toEqual([])
    expect(readdirSync(temporary)).toEqual([])
  })

  it('names the account file it was given, and stops when the account cannot be read', async () => {
    const said: string[] = []
    const accounts: (string | null)[] = []
    const status = await openTool(
      [
        '--cle',
        TEST_KEY_FILE,
        sealed(),
        '--ouvrir',
        '2',
        '--compte',
        '/a.json',
      ],
      {
        home: mkdtempSync(join(tmpdir(), 'exploitant-471-')),
        stdin: async () => '',
        stderr: (line: string) => said.push(line),
        stdout: () => {},
        media: async (named: string | null) => {
          accounts.push(named)
          return { ok: false, why: '/a.json : `access_token` manque' }
        },
        show: async () => {
          throw new Error('nothing to show')
        },
        temporary: mkdtempSync(join(tmpdir(), 'ouverture-471-')),
      },
    )

    expect(status).toBe(2)
    expect(accounts).toEqual(['/a.json'])
    expect(said.join('\n')).toContain('`access_token` manque')
  })
})

describe('Downloading a reported file with the operator’s account (#471)', () => {
  it('asks the operator’s own homeserver, with the account’s token, whatever server the address names', async () => {
    const asked: { url: string; authorization: string | undefined }[] = []
    const download = mediaDownloader(
      'https://messagr.example',
      'the-account-token',
      async (url: string, init: { headers: Record<string, string> }) => {
        asked.push({ url, authorization: init.headers.Authorization })
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => arrayBufferOf(NIST.ciphertext),
        }
      },
    )

    const got = await download('mxc://elsewhere.example/AbC-d_9')

    expect(hex(got)).toBe(NIST.ciphertext)
    // The token goes to the account's own server, never to the host the
    // address names: that one is only a path segment.
    expect(asked).toEqual([
      {
        url: 'https://messagr.example/_matrix/client/v1/media/download/elsewhere.example/AbC-d_9',
        authorization: 'Bearer the-account-token',
      },
    ])
  })

  it('says what the homeserver answered, and never the token', async () => {
    const download = mediaDownloader(
      'https://messagr.example',
      'the-account-token',
      async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    )

    await expect(download('mxc://messagr.example/AbC')).rejects.toThrow(/404/)
    await expect(download('mxc://messagr.example/AbC')).rejects.not.toThrow(
      /the-account-token/,
    )
  })

  it('refuses an address that is not a homeserver’s media, and asks nothing', async () => {
    let asked = 0
    const download = mediaDownloader(
      'https://messagr.example',
      'the-account-token',
      async () => {
        asked += 1
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    )

    for (const url of [
      'https://elsewhere.example/a.jpg',
      'mxc://messagr.example/../../_matrix/client/v3/account/whoami',
      'mxc://messagr.example/a/b',
      'mxc://messagr.example/',
    ]) {
      await expect(download(url), url).rejects.toThrow()
    }
    expect(asked).toBe(0)
  })
})
