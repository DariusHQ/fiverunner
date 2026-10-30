/**
 * The soundtrack of the demo of FiveRunner, of its own: music that
 * oscillators and noise play in an OfflineAudioContext of Chrome, at 100
 * beats a minute over A minor, F, C and G, and the sounds of what happens
 * on screen, clicks, keys, whooshes and pops.
 */

/** What the soundtrack follows, in milliseconds of the video. */
export interface Sounds {
  readonly length: number
  /** When the scenes after the first start: the drums come in with the second scene, the claps with the third, and stop with the last. */
  readonly changes: readonly number[]
  readonly clicks: readonly number[]
  readonly keys: readonly number[]
  readonly whooshes: readonly number[]
  readonly pops: readonly number[]
}

const RATE = 48000
const BEAT = 0.6
const BAR = BEAT * 4

/** The chords of the bars, in turn, as the MIDI notes of the pad, and the root of each for the bass. */
const CHORDS: readonly { readonly notes: readonly number[]; readonly root: number }[] = [
  { notes: [57, 60, 64, 69], root: 33 },
  { notes: [53, 57, 60, 65], root: 29 },
  { notes: [55, 60, 64, 67], root: 36 },
  { notes: [55, 59, 62, 67], root: 31 },
]

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)

/** Numbers that look random, from 0 to 1, but are the same at each render. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The response of a room, for the reverb: noise that fades, darker as it goes. */
function room(context: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(2, Math.round(RATE * seconds), RATE)
  const next = random(7)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < data.length; i++) {
      const t = i / RATE
      low += (next() * 2 - 1 - low) * (0.5 - 0.35 * (t / seconds))
      data[i] = t < 0.02 ? 0 : low * Math.exp(-t * 2.6)
    }
  }
  return buffer
}

/** Renders the soundtrack, at a level that peaks just under full scale. */
export async function soundtrack(sounds: Sounds): Promise<AudioBuffer> {
  const length = sounds.length / 1000
  const context = new OfflineAudioContext(2, Math.ceil(length * RATE), RATE)
  const noise = context.createBuffer(1, RATE * 2, RATE)
  const next = random(11)
  noise.getChannelData(0).forEach((_, i, data) => (data[i] = next() * 2 - 1))

  // The buses: the music, ducked by its kick, and the sounds of the screen, into a reverb, a delay and a compressor.
  const master = context.createGain()
  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 10
  compressor.ratio.value = 3
  compressor.attack.value = 0.01
  compressor.release.value = 0.25
  // A high pass, under what anyone hears, keeps the sound centred on zero.
  const floor = context.createBiquadFilter()
  floor.type = 'highpass'
  floor.frequency.value = 25
  master.connect(floor).connect(compressor).connect(context.destination)
  master.gain.setValueAtTime(0, 0)
  master.gain.linearRampToValueAtTime(1, 0.4)
  master.gain.setValueAtTime(1, Math.max(length - 1.8, 0.4))
  master.gain.linearRampToValueAtTime(0, length)
  const reverb = context.createConvolver()
  reverb.buffer = room(context, 2.8)
  const wet = context.createGain()
  wet.gain.value = 0.32
  reverb.connect(wet).connect(master)
  const delay = context.createDelay(1)
  delay.delayTime.value = BEAT * 0.75
  const feedback = context.createGain()
  feedback.gain.value = 0.32
  const darker = context.createBiquadFilter()
  darker.type = 'lowpass'
  darker.frequency.value = 2600
  delay.connect(darker).connect(feedback).connect(delay)
  darker.connect(master)
  const ducked = context.createGain()
  ducked.connect(master)
  ducked.connect(reverb)
  const effects = context.createGain()
  effects.gain.value = 0.55
  effects.connect(master)

  const [drums = length, claps = length, end = length] = sounds.changes.map((time) => time / 1000)
  const onBar = (time: number) => Math.ceil(time / BAR - 0.05) * BAR
  const groove = onBar(drums)
  const clapping = onBar(claps)
  const stop = onBar(end - BAR / 2)

  // The pad, whose filter opens as the drums come in.
  const pad = context.createBiquadFilter()
  pad.type = 'lowpass'
  pad.Q.value = 0.6
  pad.frequency.setValueAtTime(500, 0)
  pad.frequency.linearRampToValueAtTime(1500, groove)
  pad.frequency.linearRampToValueAtTime(2200, groove + BAR * 4)
  pad.frequency.setValueAtTime(2200, stop)
  pad.frequency.linearRampToValueAtTime(900, length)
  const padLevel = context.createGain()
  padLevel.gain.value = 0.05
  pad.connect(padLevel).connect(ducked)
  for (let bar = 0; bar * BAR < length; bar++) {
    const start = bar * BAR
    // The last chord rings on to the end.
    const last = start >= stop
    const chord = CHORDS[last ? 0 : bar % CHORDS.length]!
    const ends = last ? length : start + BAR
    chord.notes.forEach((note, index) => {
      for (const detune of [-9, 0, 9]) {
        const oscillator = context.createOscillator()
        oscillator.type = 'sawtooth'
        oscillator.frequency.value = hz(note)
        oscillator.detune.value = detune + index * 1.5
        const gain = context.createGain()
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(1, start + 0.35)
        gain.gain.setValueAtTime(1, ends - 0.05)
        gain.gain.linearRampToValueAtTime(0, ends + 0.6)
        const pan = context.createStereoPanner()
        pan.pan.value = (detune / 9) * 0.5
        oscillator.connect(gain).connect(pan).connect(pad)
        oscillator.start(start)
        oscillator.stop(ends + 0.7)
      }
    })
    if (last) break
  }

  // A plucked arpeggio of the chords, in eighths, into the delay.
  const pluck = (time: number, note: number, level: number, pan: number) => {
    const oscillator = context.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = hz(note)
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(4200, time)
    filter.frequency.exponentialRampToValueAtTime(700, time + 0.2)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(level, time + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42)
    const panner = context.createStereoPanner()
    panner.pan.value = pan
    oscillator.connect(filter).connect(gain).connect(panner)
    panner.connect(ducked)
    panner.connect(delay)
    oscillator.start(time)
    oscillator.stop(time + 0.45)
  }
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3]
  for (let step = 0; step * BEAT * 0.5 < Math.min(stop + BAR * 2, length); step++) {
    const time = step * BEAT * 0.5
    const chord = CHORDS[Math.floor(time / BAR) % CHORDS.length]!
    const note = chord.notes[pattern[step % pattern.length]!]! + 12
    const swell =
      Math.min(time / 6, 1) * (time > stop ? Math.max(1 - (time - stop) / (BAR * 2), 0) : 1)
    pluck(time, note, 0.085 * swell, step % 2 === 0 ? -0.35 : 0.35)
  }

  // The bass, the kick, the hats and the claps of the groove.
  const bass = context.createBiquadFilter()
  bass.type = 'lowpass'
  bass.frequency.value = 700
  const bassLevel = context.createGain()
  bassLevel.gain.value = 0.1
  bass.connect(bassLevel).connect(ducked)
  const drum = context.createGain()
  drum.gain.value = 0.45
  drum.connect(master)
  for (let beat = Math.round(groove / BEAT); beat * BEAT < stop; beat++) {
    const time = beat * BEAT
    const chord = CHORDS[Math.floor(time / BAR + 1e-6) % CHORDS.length]!
    // The kick, which ducks the music for it.
    const kick = context.createOscillator()
    kick.frequency.setValueAtTime(150, time)
    kick.frequency.exponentialRampToValueAtTime(46, time + 0.11)
    const kickGain = context.createGain()
    kickGain.gain.setValueAtTime(0.7, time)
    kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.34)
    kick.connect(kickGain).connect(drum)
    kick.start(time)
    kick.stop(time + 0.36)
    ducked.gain.setValueAtTime(1, time)
    ducked.gain.linearRampToValueAtTime(0.55, time + 0.02)
    ducked.gain.setTargetAtTime(1, time + 0.03, 0.1)
    for (const eighth of [0, 0.5]) {
      const at = time + eighth * BEAT
      for (const [type, octave, level] of [
        ['sine', 0, 1],
        ['sawtooth', 12, 0.25],
      ] as const) {
        const oscillator = context.createOscillator()
        oscillator.type = type
        oscillator.frequency.value = hz(chord.root + 12 + octave)
        const gain = context.createGain()
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(level, at + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.26)
        oscillator.connect(gain).connect(bass)
        oscillator.start(at)
        oscillator.stop(at + 0.28)
      }
    }
    // The hat, off the beat.
    const hat = context.createBufferSource()
    hat.buffer = noise
    const high = context.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 7500
    const hatGain = context.createGain()
    const at = time + BEAT / 2
    hatGain.gain.setValueAtTime(0.11, at)
    hatGain.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
    hat.connect(high).connect(hatGain).connect(drum)
    hat.start(at, (beat * 0.37) % 1.5, 0.06)
    if (time >= clapping && beat % 2 === 1) {
      const clap = context.createBufferSource()
      clap.buffer = noise
      const band = context.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 1500
      band.Q.value = 0.8
      const clapGain = context.createGain()
      clapGain.gain.setValueAtTime(0, time)
      for (const [offset, level] of [
        [0, 0.22],
        [0.012, 0.18],
        [0.024, 0.2],
      ] as const) {
        clapGain.gain.setValueAtTime(level, time + offset)
        clapGain.gain.exponentialRampToValueAtTime(0.02, time + offset + 0.011)
      }
      clapGain.gain.setValueAtTime(0.16, time + 0.036)
      clapGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2)
      clap.connect(band).connect(clapGain)
      clapGain.connect(drum)
      clapGain.connect(reverb)
      clap.start(time, (beat * 0.53) % 1.5, 0.22)
    }
  }

  // The sounds of the screen.
  const burst = (
    time: number,
    filter: BiquadFilterType,
    frequency: number,
    level: number,
    seconds: number,
  ) => {
    const source = context.createBufferSource()
    source.buffer = noise
    const shape = context.createBiquadFilter()
    shape.type = filter
    shape.frequency.value = frequency
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + seconds)
    source.connect(shape).connect(gain).connect(effects)
    source.start(time, (time * 0.71) % 1.5, seconds + 0.02)
  }
  const tone = (time: number, from: number, to: number, level: number, seconds: number) => {
    const oscillator = context.createOscillator()
    oscillator.frequency.setValueAtTime(from, time)
    oscillator.frequency.exponentialRampToValueAtTime(to, time + seconds * 0.5)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(level, time + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.001, time + seconds)
    oscillator.connect(gain).connect(effects)
    oscillator.start(time)
    oscillator.stop(time + seconds + 0.02)
  }
  for (const time of sounds.clicks.map((ms) => ms / 1000)) {
    tone(time, 2300, 1900, 0.16, 0.035)
    burst(time, 'highpass', 4200, 0.12, 0.015)
  }
  sounds.keys.forEach((ms, index) =>
    burst(ms / 1000, 'bandpass', 2600 + (index % 5) * 260, 0.05 + (index % 3) * 0.012, 0.022),
  )
  for (const time of sounds.pops.map((ms) => ms / 1000)) tone(time, 520, 900, 0.1, 0.12)
  for (const time of sounds.whooshes.map((ms) => ms / 1000)) {
    // A sweep of noise that peaks at the moment it marks.
    const start = Math.max(time - 0.35, 0)
    const source = context.createBufferSource()
    source.buffer = noise
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = 1.4
    band.frequency.setValueAtTime(320, start)
    band.frequency.exponentialRampToValueAtTime(3600, start + 0.55)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.32, start + 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8)
    const pan = context.createStereoPanner()
    pan.pan.setValueAtTime(-0.6, start)
    pan.pan.linearRampToValueAtTime(0.6, start + 0.8)
    source.connect(band).connect(gain).connect(pan)
    pan.connect(effects)
    pan.connect(reverb)
    source.start(start, (time * 0.43) % 1, 0.85)
  }

  const rendered = await context.startRendering()
  // Its peak, just under full scale.
  let peak = 0
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    for (const sample of rendered.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample))
  }
  if (peak > 0) {
    const gain = 0.89 / peak
    for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
      const data = rendered.getChannelData(channel)
      for (let i = 0; i < data.length; i++) data[i] = data[i]! * gain
    }
  }
  return rendered
}
