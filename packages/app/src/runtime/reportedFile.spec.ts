import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

import { describe, expect, it, onTestFinished } from 'vitest'

import { terminalAt } from '../../../../scripts/lib/ouvrir-un-fichier-signale.mjs'
import { openTool } from '../../../../scripts/lib/ouvrir-un-signalement.mjs'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import { generateKeyPair } from './hpke'
import {
  payloadBytes,
  type ReportBinding,
  type ReportPayload,
} from './reportFormat'
import { reportMessages } from './reportMessages'
import { sealReportWithEphemeral } from './sealedReport'

/**
 * A photograph or a document a report carries, opened by the operator on
 * its own machine, on demand only (#471, ADR 0015).
 *
 * The report holds the description of its encrypted file, never the file.
 * Asked to open one (`--ouvrir <n>`), the tool first erases what an
 * interrupted opening left, reads the operator's account, downloads the
 * encrypted copy from that account's own server, refuses it unless its
 * SHA-256 hash is the one the report states, decrypts it in memory, listens
 * for an interruption, writes a private copy, hands it to Preview, waits for
 * Enter, and erases the copy whatever happens.
 *
 * Everything the tool reaches of the machine is a double here: the
 * homeserver is a local file behind `fetch`, Preview is what the test says,
 * the terminal is a named pipe the tool reads as it reads /dev/tty
 * (`terminalAt`) and the test types into, and the interruptions are emitted
 * by the test. The account is a file of a home made for the test: never the
 * real one.
 */

const FIXTURES = join(__dirname, '../../../../scripts/fixtures')
/** The test key, in the format of the operator's key file. TEST ONLY. */
const TEST_KEY_FILE = join(FIXTURES, 'cle-de-test-de-l-exploitant.json')
const TEST_KEY = JSON.parse(readFileSync(TEST_KEY_FILE, 'utf8')) as {
  readonly public_key: string
}

/**
 * NIST SP 800-38A, appendix F.5.5, CTR-AES256.Encrypt: a file of four
 * blocks, and its ciphertext. Matrix encrypts a file in AES-256-CTR, so this
 * is an encrypted file whose every byte was computed outside this repository.
 */
const NIST = {
  plaintext:
    '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
    '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
  ciphertext:
    '601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c5' +
    '2b0930daa23de94ce87017ba2d84988ddfc9c58db67aada613c2dd08457941a6',
}

/**
 * That ciphertext described as Matrix describes an encrypted file: its key
 * (603deb10…) in unpadded base64url, its counter (f0f1…) in unpadded base64,
 * and the SHA-256 hash of the ciphertext, computed apart with
 * `openssl dgst -sha256`.
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

/**
 * A photograph's thumbnail, sealed apart under a key of its own, as its
 * sender seals one (`imageEvent.ts`): the ASCII of « the thumbnail the
 * conversation drew », in AES-256-CTR under the key 000102…1f from the
 * counter a0a1a2a3a4a5a6a7 then eight zeros. Its ciphertext was computed
 * outside this repository, with `openssl enc -aes-256-ctr` and again with
 * RustCrypto's `ctr`, and its hash with `openssl dgst -sha256`.
 */
const THUMBNAIL = {
  plaintext:
    '746865207468756d626e61696c2074686520636f6e766572736174696f6e2064726577',
  ciphertext:
    'aa141e65e99c3312ecb647c7ab9979284ceb1dd528979da3f1d305ead7c7e2788c3c99',
}

/** That thumbnail described as Matrix describes an encrypted file. */
const THUMBNAIL_MATERIAL = {
  v: 'v2',
  key: {
    kty: 'oct',
    key_ops: ['encrypt', 'decrypt'],
    alg: 'A256CTR',
    k: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    ext: true,
  },
  iv: 'oKGio6SlpqcAAAAAAAAAAA',
  hashes: { sha256: 'piM3s213LABROxYZnnkExsCsjY9idjZfqVCxYxA3TRE' },
}

const ME = '@alice:example.org'
const HIM = '@bob:example.org'
/** The operator's account of these tests, on its own server. TEST ONLY. */
const ACCOUNT = {
  serveur: 'https://messagr.example',
  user_id: '@exploitation:messagr.example',
  access_token: 'jeton-d-essai-471',
}
/** Where that server serves a media of `mxc://<server>/<id>`. */
const DOWNLOADS = 'https://messagr.example/_matrix/client/v1/media/download'

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

/** A home holding the operator's account, as its own file. */
function homeWith(account: object | null = ACCOUNT): string {
  const home = mkdtempSync(join(tmpdir(), 'exploitant-471-'))
  if (account !== null) {
    mkdirSync(join(home, '.messagr-exploitation'))
    writeFileSync(
      join(home, '.messagr-exploitation', 'messagr-eu.json'),
      JSON.stringify(account),
    )
  }
  return home
}

/**
 * The operator's terminal, doubled by a named pipe (#496). Like a terminal,
 * a read there waits for the next line, and nothing ends it but a line, or
 * the stream that reads being let go of. The tool reads it through
 * `terminalAt`, as it reads /dev/tty; the test types into its other end,
 * which it holds from the start, so that opening it never waits for a
 * writer, and closes once the test is over.
 */
function keyboard() {
  const path = join(mkdtempSync(join(tmpdir(), 'terminal-496-')), 'tty')
  execFileSync('mkfifo', [path])
  const typing = openSync(path, 'r+')
  onTestFinished(() => closeSync(typing))
  /** Each terminal the tool opened, and when it was let go of. */
  const opened: { readonly closed: Promise<unknown> }[] = []
  return {
    open: (): Readable => {
      const terminal = terminalAt(path)
      // Not `events.once`, which would reject on the terminal's own error.
      opened.push({
        closed: new Promise(resolve => terminal.once('close', resolve)),
      })
      return terminal
    },
    type: (text: string) => writeSync(typing, text),
    opened,
  }
}

/**
 * What became of each terminal the tool opened, a second after it
 * returned: let go of, or still reading, waiting for a line.
 */
async function terminalsLeft(
  opened: readonly { readonly closed: Promise<unknown> }[],
): Promise<string[]> {
  const aSecond = new Promise(resolve => setTimeout(resolve, 1000))
  return Promise.all(
    opened.map(({ closed }) =>
      Promise.race([
        closed.then(() => 'let go'),
        aSecond.then(() => 'still reading'),
      ]),
    ),
  )
}

/**
 * What the Mac is for the tool, doubled: a homeserver whose media are
 * local files, Preview, the terminal, and the interruptions.
 */
function machine(
  options: {
    /** The encrypted copy of each media, by the download address. */
    readonly served?: Readonly<Record<string, string>>
    /** What Preview does once handed a file. */
    readonly preview?: 'shows' | 'fails' | 'is-interrupted'
    /**
     * What happens once the tool waits for Enter: Enter is pressed, Ctrl-C
     * is, the tool is stopped, the terminal fails while it is read, or there
     * is no terminal at all.
     */
    readonly terminal?: 'enter' | 'ctrl-c' | 'is-interrupted' | 'fails' | 'none'
    readonly home?: string
    readonly environment?: Readonly<Record<string, string>>
    readonly temporary?: string
  } = {},
) {
  const media = mkdtempSync(join(tmpdir(), 'serveur-471-'))
  const files = new Map<string, string>()
  for (const [url, ciphertext] of Object.entries(options.served ?? {})) {
    const path = join(media, String(files.size))
    writeFileSync(path, bytes(ciphertext))
    files.set(url, path)
  }
  const asked: { url: string; authorization: string | undefined }[] = []
  const handed: {
    command: string
    args: readonly string[]
    bytes: string
    mode: number
    directoryMode: number
  }[] = []
  const signals = new EventEmitter()
  const said: string[] = []
  const printed: string[] = []
  const terminal = keyboard()
  const ports = {
    home: options.home ?? homeWith(),
    environment: options.environment ?? {},
    stdin: async () => '',
    stderr: (line: string) => said.push(line),
    stdout: (line: string) => printed.push(line),
    fetch: async (url: string, init: { headers: Record<string, string> }) => {
      asked.push({ url, authorization: init.headers.Authorization })
      const path = files.get(url)
      return path === undefined
        ? {
            ok: false,
            status: 404,
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        : {
            ok: true,
            status: 200,
            arrayBuffer: async () =>
              arrayBufferOf(hex(new Uint8Array(readFileSync(path)))),
          }
    },
    run: async (command: string, args: readonly string[]) => {
      // What Preview would read, read while it is there.
      const path = args[args.length - 1]!
      handed.push({
        command,
        args,
        bytes: hex(new Uint8Array(readFileSync(path))),
        mode: statSync(path).mode % 0o1000,
        directoryMode: statSync(dirname(path)).mode % 0o1000,
      })
      if (options.preview === 'fails') throw new Error('Aperçu est absent')
      if (options.preview === 'is-interrupted') {
        signals.emit('SIGINT')
        await new Promise(() => {})
      }
    },
    terminal: (): Readable => {
      if (options.terminal === 'none') {
        // Nothing to open, as /dev/tty does not open without a terminal.
        return terminalAt(join(media, 'aucun-terminal'))
      }
      const tty = terminal.open()
      setTimeout(() => {
        if (options.terminal === 'ctrl-c') signals.emit('SIGINT')
        else if (options.terminal === 'is-interrupted') signals.emit('SIGTERM')
        else if (options.terminal === 'fails') {
          tty.destroy(new Error('EIO: i/o error, read'))
        } else terminal.type('\n')
      }, 0)
      return tty
    },
    signals,
    temporary:
      options.temporary ?? mkdtempSync(join(tmpdir(), 'ouverture-471-')),
  }
  return {
    ports,
    asked,
    handed,
    signals,
    said,
    printed,
    terminals: terminal.opened,
  }
}

/** What the tool says and prints, and how it ends. */
async function run(
  argv: readonly string[],
  mac: ReturnType<typeof machine>,
): Promise<{ status: number; said: string; printed: string[] }> {
  const status = await openTool([...argv], mac.ports)
  return {
    status,
    said: mac.said.join('\n'),
    printed: mac.printed.join('\n').split('\n'),
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
      thumbnail: {
        file: { ...THUMBNAIL_MATERIAL, url: 'mxc://example.org/thumbnail' },
        mimetype: 'image/jpeg',
      },
    },
    {
      kind: 'document',
      eventId: '$document',
      sentAt: 1_790_000_030_000,
      sender: HIM,
      file: { ...MATERIAL, url: 'mxc://elsewhere.example/contract' },
      mimetype: 'application/pdf',
      name: 'contrat.pdf',
      size: 64,
    },
  ],
}

/** `payload`, sealed for the test key and written as the service exports it. */
function sealed(payload: ReportPayload = PAYLOAD): string {
  return sealedBytes(payloadBytes(payload), {
    reason: payload.reason,
    reporter: payload.reportingAccount,
  })
}

/** The payload `held`, sealed for the test key, as the service exports it. */
function sealedBytes(held: Uint8Array, binding: ReportBinding): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pli-471-')), 'pli.json')
  writeFileSync(
    path,
    JSON.stringify({
      ...binding,
      sealed: sealReportWithEphemeral(
        generateKeyPair(),
        held,
        binding,
        TEST_KEY.public_key,
      ),
    }),
  )
  return path
}

/**
 * `entry` reported by the application as it reports (`reportMessages`), for
 * the test key, and written as the service exports it: from the selection
 * to what the operator opens.
 */
async function reportedByTheApplication(entry: TimelineEntry): Promise<string> {
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
      selected: new Set([entry.eventId]),
      timeline: [entry],
    },
  )
  const report = join(mkdtempSync(join(tmpdir(), 'pli-471-')), 'pli.json')
  writeFileSync(
    report,
    JSON.stringify({ ...JSON.parse(sent[0]!), reporter: ME }),
  )
  return report
}

/** The photograph of `PAYLOAD`, served as the homeserver keeps it. */
const PHOTOGRAPH = { [`${DOWNLOADS}/example.org/photograph`]: NIST.ciphertext }

/** Its thumbnail, served as the homeserver keeps it. */
const ITS_THUMBNAIL = {
  [`${DOWNLOADS}/example.org/thumbnail`]: THUMBNAIL.ciphertext,
}

/** The number of listeners left on the interruptions. */
function listening(signals: EventEmitter): number {
  return ['SIGINT', 'SIGTERM', 'SIGHUP']
    .map(signal => signals.listenerCount(signal))
    .reduce((a, b) => a + b, 0)
}

describe('A reported photograph or document, on the operator’s machine (#471)', () => {
  it('shows each file’s description and how to open it, and opens nothing unasked', async () => {
    const mac = machine({ served: PHOTOGRAPH })

    const { status, printed } = await run(
      ['--cle', TEST_KEY_FILE, sealed()],
      mac,
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
      '  vignette, ce que la conversation montre : image/jpeg',
      '  copie chiffrée de la vignette : mxc://example.org/thumbnail',
      '  pour l’ouvrir, à la demande : --ouvrir-vignette 2',
      '',
      'message 3 sur 3, écrit le 2026-09-21 14:13:50 UTC',
      '  événement : $document',
      '  document : contrat.pdf (application/pdf, 64 octets)',
      '  copie chiffrée : mxc://elsewhere.example/contract',
      '  pour l’ouvrir, à la demande : --ouvrir 3',
    ])
    expect(mac.asked).toEqual([])
    expect(mac.handed).toEqual([])
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
    const report = await reportedByTheApplication(photograph)
    const mac = machine({ served: PHOTOGRAPH })

    const { status, said, printed } = await run(
      ['--cle', TEST_KEY_FILE, report, '--ouvrir', '1'],
      mac,
    )

    expect(status).toBe(0)
    // The account's own server, with the account's token.
    expect(mac.asked).toEqual([
      {
        url: `${DOWNLOADS}/example.org/photograph`,
        authorization: 'Bearer jeton-d-essai-471',
      },
    ])
    // Preview was handed the file itself, decrypted, in a copy only this
    // user can read, in a directory only this user can enter.
    expect(mac.handed).toHaveLength(1)
    const [handed] = mac.handed
    expect(handed!.command).toBe('open')
    expect(handed!.args.slice(0, 2)).toEqual(['-a', 'Preview'])
    expect(handed!.bytes).toBe(NIST.plaintext)
    expect(handed!.mode).toBe(0o600)
    expect(handed!.directoryMode).toBe(0o700)
    const path = handed!.args[2]!
    expect(path.startsWith(mac.ports.temporary)).toBe(true)
    expect(path.endsWith('.jpeg')).toBe(true)
    // And nothing is left: not the copy, not its directory, not a listener.
    expect(existsSync(path)).toBe(false)
    expect(readdirSync(mac.ports.temporary)).toEqual([])
    expect(listening(mac.signals)).toBe(0)
    expect(said).toContain('empreinte')
    expect(`${said}\n${printed.join('\n')}`).not.toContain('jeton-d-essai-471')
  })

  it('opens a document the same way, from the account’s server whatever server its address names', async () => {
    const mac = machine({
      served: { [`${DOWNLOADS}/elsewhere.example/contract`]: NIST.ciphertext },
    })

    const { status } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '3'],
      mac,
    )

    expect(status).toBe(0)
    expect(mac.asked.map(one => one.url)).toEqual([
      `${DOWNLOADS}/elsewhere.example/contract`,
    ])
    expect(mac.handed.map(one => one.bytes)).toEqual([NIST.plaintext])
    expect(mac.handed[0]!.args[2]!.endsWith('.pdf')).toBe(true)
    expect(readdirSync(mac.ports.temporary)).toEqual([])
  })

  it('opens a photograph’s thumbnail on demand, what the conversation drew of it: its own copy, its own key, its hash checked, then erased (#496)', async () => {
    // From the selection to the operator's screen: the conversation drew
    // this photograph from its thumbnail, whose key another client wrote
    // padded (`openingOf`), and the application reports both. The tool
    // opens the thumbnail, not the photograph.
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
        thumbnail: {
          url: 'mxc://example.org/thumbnail',
          secret: JSON.stringify({
            ...THUMBNAIL_MATERIAL,
            key: {
              ...THUMBNAIL_MATERIAL.key,
              k: `${THUMBNAIL_MATERIAL.key.k}=`,
            },
          }),
          mimeType: 'image/png',
          width: 2,
          height: 2,
        },
      },
    }
    const report = await reportedByTheApplication(photograph)
    const mac = machine({ served: { ...PHOTOGRAPH, ...ITS_THUMBNAIL } })

    const { status, said, printed } = await run(
      ['--cle', TEST_KEY_FILE, report, '--ouvrir-vignette', '1'],
      mac,
    )

    expect(status).toBe(0)
    expect(printed).toContain(
      '  pour l’ouvrir, à la demande : --ouvrir-vignette 1',
    )
    expect(mac.asked).toEqual([
      {
        url: `${DOWNLOADS}/example.org/thumbnail`,
        authorization: 'Bearer jeton-d-essai-471',
      },
    ])
    expect(mac.handed).toHaveLength(1)
    const [handed] = mac.handed
    expect(handed!.bytes).toBe(THUMBNAIL.plaintext)
    expect(handed!.mode).toBe(0o600)
    expect(handed!.directoryMode).toBe(0o700)
    // Named for what it is, by the thumbnail's own type.
    expect(handed!.args[2]!.endsWith('vignette.png')).toBe(true)
    expect(existsSync(handed!.args[2]!)).toBe(false)
    expect(readdirSync(mac.ports.temporary)).toEqual([])
    expect(listening(mac.signals)).toBe(0)
    expect(said).toContain('la vignette que l’appareil a signalée')
  })

  it('opens no thumbnail for words, a document or a photograph without one, and asks nothing (#496)', async () => {
    const withoutOne: ReportPayload = {
      ...PAYLOAD,
      messages: PAYLOAD.messages.map(message =>
        message.kind === 'photograph'
          ? { ...message, thumbnail: null }
          : message,
      ),
    }
    for (const [what, payload, number, why] of [
      ['words', PAYLOAD, '1', 'ne porte ni photo ni document'],
      [
        'a document',
        PAYLOAD,
        '3',
        'ne porte pas de vignette : rien à ouvrir.\n--ouvrir 3 ouvre le document',
      ],
      [
        'a photograph without a thumbnail',
        withoutOne,
        '2',
        'ne porte pas de vignette : rien à ouvrir.\n--ouvrir 2 ouvre la photo',
      ],
    ] as const) {
      const mac = machine({ served: { ...PHOTOGRAPH, ...ITS_THUMBNAIL } })

      const { status, said } = await run(
        ['--cle', TEST_KEY_FILE, sealed(payload), '--ouvrir-vignette', number],
        mac,
      )

      expect(status, what).toBe(2)
      expect(said, what).toContain(why)
      expect(mac.asked, what).toEqual([])
      expect(mac.handed, what).toEqual([])
    }
  })

  it('reads a report of #471 as it was sealed, its photograph without a thumbnail, and opens that photograph (#496)', async () => {
    // A report sealed before #496: its photograph carries no `thumbnail`.
    const binding: ReportBinding = {
      reason: 'sexual_without_consent',
      reporter: ME,
    }
    const of471 = new TextEncoder().encode(
      JSON.stringify({
        format: 1,
        reason: 'sexual_without_consent',
        reported_at: 1790000060000,
        reporting_account: ME,
        reported_account: HIM,
        room_id: '!room:example.org',
        messages: [
          {
            event_id: '$photograph',
            sent_at: 1790000020000,
            sender: HIM,
            kind: 'photograph',
            file: { ...MATERIAL, url: 'mxc://example.org/photograph' },
            mimetype: 'image/jpeg',
            name: 'image.jpg',
            size: 64,
          },
        ],
      }),
    )
    const mac = machine({ served: PHOTOGRAPH })

    const { status, printed } = await run(
      ['--cle', TEST_KEY_FILE, sealedBytes(of471, binding), '--ouvrir', '1'],
      mac,
    )

    expect(status).toBe(0)
    expect(printed.slice(-5)).toEqual([
      'message 1 sur 1, écrit le 2026-09-21 14:13:40 UTC',
      '  événement : $photograph',
      '  photo : image.jpg (image/jpeg, 64 octets)',
      '  copie chiffrée : mxc://example.org/photograph',
      '  pour l’ouvrir, à la demande : --ouvrir 1',
    ])
    expect(mac.handed.map(one => one.bytes)).toEqual([NIST.plaintext])
  })

  it('refuses a file whose hash does not match, and neither decrypts, writes nor shows anything', async () => {
    // The homeserver serves other bytes than those the device described:
    // not the file that was reported.
    const other = bytes(NIST.ciphertext)
    other[17] = (other[17]! + 1) % 256
    const mac = machine({
      served: { [`${DOWNLOADS}/example.org/photograph`]: hex(other) },
    })

    const { status, said } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      mac,
    )

    expect(status).toBe(1)
    expect(said).toContain('L’empreinte ne correspond pas')
    expect(mac.handed).toEqual([])
    expect(readdirSync(mac.ports.temporary)).toEqual([])
  })

  it('erases the copy when Preview fails, when the terminal cannot be read, and when the tool is interrupted', async () => {
    for (const [what, options, expected] of [
      ['Preview fails', { preview: 'fails' }, 1],
      ['no terminal', { terminal: 'none' }, 1],
      ['the terminal fails while it is read', { terminal: 'fails' }, 1],
      // Between writing the copy and viewing it: Ctrl-C while Preview opens.
      ['interrupted while Preview opens', { preview: 'is-interrupted' }, 130],
      [
        'interrupted while waiting for Enter',
        { terminal: 'is-interrupted' },
        130,
      ],
    ] as const) {
      const mac = machine({ served: PHOTOGRAPH, ...options })

      const { status } = await run(
        ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
        mac,
      )

      expect(status, what).toBe(expected)
      expect(mac.handed, what).toHaveLength(1)
      expect(existsSync(mac.handed[0]!.args[2]!), what).toBe(false)
      expect(readdirSync(mac.ports.temporary), what).toEqual([])
      expect(listening(mac.signals), what).toBe(0)
    }
  })

  it('erases what an interrupted opening left, first, before anything else, and nothing else', async () => {
    // A tool killed while a file was shown leaves its private copy. The next
    // opening erases it before it reads the account: here the account does
    // not read, and the copy goes all the same.
    const temporary = mkdtempSync(join(tmpdir(), 'ouverture-471-'))
    mkdirSync(join(temporary, 'messagr-signalement-ancien'))
    writeFileSync(
      join(temporary, 'messagr-signalement-ancien', 'signalement.jpeg'),
      'ce qui restait',
    )
    writeFileSync(join(temporary, 'autre-chose'), 'pas à nous')
    const mac = machine({ served: PHOTOGRAPH, home: homeWith(null), temporary })

    const { status, said } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      mac,
    )

    expect(status).toBe(2)
    expect(readdirSync(temporary)).toEqual(['autre-chose'])
    expect(said).toContain('messagr-signalement-ancien')
    expect(mac.asked).toEqual([])
  })

  it('opens nothing for a message that carries no file, a number no message has, or no number', async () => {
    for (const asked of [
      ['--ouvrir', '1'],
      ['--ouvrir', '4'],
      ['--ouvrir', 'deux'],
      ['--ouvrir'],
      ['--compte', '/a.json'],
      ['--ouvrir-vignette', '4'],
      ['--ouvrir-vignette', 'deux'],
      ['--ouvrir-vignette'],
      // One opening at a time: which would it be?
      ['--ouvrir', '2', '--ouvrir-vignette', '2'],
    ]) {
      const mac = machine({ served: PHOTOGRAPH })

      const { status } = await run(
        ['--cle', TEST_KEY_FILE, sealed(), ...asked],
        mac,
      )

      expect(status, asked.join(' ')).toBe(2)
      expect(mac.asked).toEqual([])
      expect(mac.handed).toEqual([])
    }
  })

  it('reads the account from the file --compte names, else the one the environment names, else the one in the home', async () => {
    const elsewhere = homeWith({ ...ACCOUNT, access_token: 'jeton-nomme' })
    const named = join(elsewhere, '.messagr-exploitation', 'messagr-eu.json')
    const byEnvironment = homeWith({
      ...ACCOUNT,
      access_token: 'jeton-de-l-environnement',
    })
    const cases: [readonly string[], Record<string, string>, string][] = [
      [['--compte', named], {}, 'Bearer jeton-nomme'],
      [
        [],
        {
          MESSAGR_EXPLOITATION_IDENTIFIANTS: join(
            byEnvironment,
            '.messagr-exploitation',
            'messagr-eu.json',
          ),
        },
        'Bearer jeton-de-l-environnement',
      ],
      [[], {}, 'Bearer jeton-d-essai-471'],
    ]
    for (const [flags, environment, authorization] of cases) {
      const mac = machine({ served: PHOTOGRAPH, environment })

      const { status } = await run(
        ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2', ...flags],
        mac,
      )

      expect(status, authorization).toBe(0)
      expect(mac.asked.map(one => one.authorization)).toEqual([authorization])
    }
  })

  it('stops when the account cannot be read, and says why without what it holds', async () => {
    const mac = machine({
      served: PHOTOGRAPH,
      home: homeWith({ ...ACCOUNT, access_token: '' }),
    })

    const { status, said } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      mac,
    )

    expect(status).toBe(2)
    expect(said).toContain('`access_token` manque')
    expect(mac.asked).toEqual([])
  })

  it('says what the homeserver answered, and never the token', async () => {
    const mac = machine({ served: {} })

    const { status, said, printed } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      mac,
    )

    expect(status).toBe(1)
    expect(said).toContain('404')
    expect(`${said}\n${printed.join('\n')}`).not.toContain('jeton-d-essai-471')
    expect(mac.handed).toEqual([])
  })

  it('reads no report in a payload carrying a file that could not be opened, and asks nothing', async () => {
    // What makes a file openable is one rule, the application's and the
    // tool's (`openingOf`): the application reports no such file, and the
    // tool reads no such report.
    const mac = machine({ served: PHOTOGRAPH })
    const unopenable: ReportPayload = {
      ...PAYLOAD,
      messages: [
        {
          kind: 'photograph',
          eventId: '$photograph',
          sentAt: 1_790_000_020_000,
          sender: HIM,
          file: {
            ...MATERIAL,
            key: { ...MATERIAL.key, k: 'trop-courte' },
            url: 'mxc://example.org/photograph',
          },
          mimetype: 'image/jpeg',
          name: 'image.jpg',
          size: 64,
          thumbnail: null,
        },
      ],
    }

    const { status, said } = await run(
      ['--cle', TEST_KEY_FILE, sealed(unopenable), '--ouvrir', '1'],
      mac,
    )

    expect(status).toBe(2)
    expect(said).toContain('pas un signalement au format 1')
    expect(mac.asked).toEqual([])
    expect(mac.handed).toEqual([])
  })
})

describe('The tool returns once Enter or Ctrl-C is pressed (#496)', () => {
  // It read /dev/tty through a stream whose read under way nothing cancels:
  // once Enter or Ctrl-C was pressed, it erased the copy and said so, and
  // then held the terminal until another line came. The terminal here is
  // the named pipe of `keyboard`, where a read waits for a line as it does
  // on a terminal.
  it('returns once Enter is pressed, the copy erased, and waits for nothing more from the terminal', async () => {
    const mac = machine({ served: PHOTOGRAPH })

    const { status } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      mac,
    )

    expect(status).toBe(0)
    expect(readdirSync(mac.ports.temporary)).toEqual([])
    expect(await terminalsLeft(mac.terminals)).toEqual(['let go'])
  })

  it('returns once Ctrl-C is pressed, the copy erased, and waits for nothing more from the terminal', async () => {
    const mac = machine({ served: PHOTOGRAPH, terminal: 'ctrl-c' })

    const { status } = await run(
      ['--cle', TEST_KEY_FILE, sealed(), '--ouvrir', '2'],
      mac,
    )

    expect(status).toBe(130)
    expect(readdirSync(mac.ports.temporary)).toEqual([])
    expect(listening(mac.signals)).toBe(0)
    expect(await terminalsLeft(mac.terminals)).toEqual(['let go'])
  })
})
