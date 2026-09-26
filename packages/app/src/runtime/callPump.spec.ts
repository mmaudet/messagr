import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * That the call runtime is wired to the decisions taken upstairs.
 *
 * # WHY A FILE IS READ HERE RATHER THAN A FUNCTION CALLED
 *
 * `callPump.ts` is glue into `matrix-js-sdk`, `react-native-webrtc` and an
 * audio session; it does not load in Node and it is not meant to. So what is
 * checked is the wiring itself -- and the wiring is the one thing no unit
 * test anywhere can fail on, because it is nobody's behaviour. A module with
 * a spec of its own, finished and correct and called by nothing, passes
 * every test in this repository.
 *
 * `calls/ringback.ts` decides when the caller's tone sounds and when it has
 * to stop (#294). That decision is worth nothing unless every one of its
 * four inputs reaches it and the tone answers back, so each is named below.
 * Held deliberately to a handful of lines: this is a check against a wire
 * being forgotten, not a transcription of the file.
 */

const callPump = readFileSync(join(__dirname, 'callPump.ts'), 'utf8')

describe("the caller's tone is wired to the module that bounds it", () => {
  it('builds it over the audio session, with the clock and the front it starts on', () => {
    expect(callPump).toContain('startRingback(')
    expect(callPump).toContain('deviceCallAudio.ringAgain()')
    expect(callPump).toContain('deviceCallAudio.stopRinging()')
  })

  it('tells it the four things it decides from', () => {
    // The audio session taken for a call this device places, every state the
    // machine reports, every change of front, and the session given back.
    expect(callPump).toContain('ringback.began()')
    expect(callPump).toContain('ringback.state(state)')
    expect(callPump).toContain('ringback.foreground(inFront)')
    expect(callPump).toContain('ringback.over()')
  })

  it('reads the clock for the running call when the application comes back', () => {
    // Without this the invitation's deadline is a number nothing compares
    // against until the suspended ticker happens to resume (#294).
    expect(callPump).toContain('held?.session.tick()')
  })
})
