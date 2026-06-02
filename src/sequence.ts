import type { ZoneFrames } from './parse.ts'

/** Stable-ish color per zone name, derived from a simple string hash. */
function zoneHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/**
 * A single scrubbable frame sequence.
 *
 * Each dropped image is one frame. Dragging across the canvas's full width
 * sweeps the entire sequence (relative drag — you can fling back and forth).
 *
 * Optionally an array of per-frame zones (3ds Max export) can be overlaid as
 * polygons drawn on top of the current frame.
 */
export class FrameSequence {
  readonly el: HTMLElement

  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private label: HTMLElement
  private progress: HTMLElement

  private scaleControl: HTMLElement
  private scaleValLabel: HTMLElement
  private shiftControl: HTMLElement

  private frames: HTMLImageElement[]
  private names: string[]
  private zones: ZoneFrames | null = null
  /** Multiplier applied to each polygon around its centroid (1 = unchanged). */
  private zoneScale = 1

  /** Current position in the sequence as a float, so partial drags accumulate. */
  private pos = 0
  private dragStartX = 0
  private dragStartPos = 0
  private activePointer: number | null = null

  constructor(frames: HTMLImageElement[], names: string[]) {
    this.frames = frames
    this.names = names

    this.el = document.createElement('section')
    this.el.className = 'seq'
    this.el.innerHTML = `
      <div class="seq-bar">
        <span class="seq-label"></span>
        <span class="seq-shift" hidden>
          <button class="seq-shift-l" type="button">‹ shift left</button>
          <button class="seq-shift-r" type="button">shift right ›</button>
        </span>
      </div>
      <canvas class="seq-canvas" tabindex="0"></canvas>
      <div class="seq-track"><div class="seq-progress"></div></div>
      <label class="seq-scale" hidden>
        Zone size
        <input class="seq-scale-input" type="range" min="0" max="200" value="100" step="1" />
        <span class="seq-scale-val">100%</span>
      </label>
    `

    this.canvas = this.el.querySelector('.seq-canvas')!
    this.ctx = this.canvas.getContext('2d')!
    this.label = this.el.querySelector('.seq-label')!
    this.progress = this.el.querySelector('.seq-progress')!
    this.scaleControl = this.el.querySelector('.seq-scale')!
    this.scaleValLabel = this.el.querySelector('.seq-scale-val')!
    this.shiftControl = this.el.querySelector('.seq-shift')!

    // Lock the canvas aspect ratio to the first decodable frame.
    const sample = this.frames.find((f) => f.naturalWidth > 0)
    if (sample) {
      this.canvas.style.aspectRatio = `${sample.naturalWidth} / ${sample.naturalHeight}`
    }

    this.wireEvents()

    // Draw once layout settles (canvas needs a measured width first).
    const ro = new ResizeObserver(() => this.render())
    ro.observe(this.canvas)

    this.update()
  }

  /** Rotate the per-frame zone array one step (circular). dir -1 = left, +1 = right. */
  private shiftZones(dir: -1 | 1) {
    const z = this.zones
    if (!z || z.length === 0) return
    if (dir < 0) z.push(z.shift()!)
    else z.unshift(z.pop()!)
    this.update()
  }

  private get count() {
    return this.frames.length
  }

  /** Attach per-frame zone polygons (3ds Max export) and redraw. */
  setZones(zones: ZoneFrames) {
    this.zones = zones
    this.scaleControl.hidden = false
    this.shiftControl.hidden = false
    if (zones.length < this.count) {
      console.warn(
        `Zone data has ${zones.length} frame(s) but the sequence has ${this.count}. ` +
          `Frames past index ${zones.length - 1} will show no zones.`,
      )
    }
    this.update()
  }

  private wireEvents() {
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointer) return
      const rect = this.canvas.getBoundingClientRect()
      const span = this.count - 1
      const delta = ((e.clientX - this.dragStartX) / rect.width) * span
      this.setPos(this.dragStartPos + delta)
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointer) return
      this.activePointer = null
      this.canvas.classList.remove('dragging')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.count < 2) return
      this.activePointer = e.pointerId
      this.dragStartX = e.clientX
      this.dragStartPos = this.pos
      this.canvas.classList.add('dragging')
      this.canvas.focus()
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    })

    // Jump by clicking/dragging the track (absolute positioning).
    const track = this.el.querySelector<HTMLElement>('.seq-track')!
    const seekTrack = (clientX: number) => {
      const rect = track.getBoundingClientRect()
      const t = (clientX - rect.left) / rect.width
      this.setPos(t * (this.count - 1))
    }
    track.addEventListener('pointerdown', (e) => {
      seekTrack(e.clientX)
      const move = (ev: PointerEvent) => seekTrack(ev.clientX)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    })

    // Shift the per-frame zone alignment one step (circular).
    this.el.querySelector('.seq-shift-l')!.addEventListener('click', () => this.shiftZones(-1))
    this.el.querySelector('.seq-shift-r')!.addEventListener('click', () => this.shiftZones(1))

    // Zone-size slider: percentage offset, so 0% leaves polygons unchanged.
    const scaleInput = this.el.querySelector<HTMLInputElement>('.seq-scale-input')!
    scaleInput.addEventListener('input', () => {
      const pct = Number(scaleInput.value)
      this.zoneScale = pct / 100
      this.scaleValLabel.textContent = `${pct}%`
      this.render()
    })

    // Arrow-key stepping when the canvas is focused.
    this.canvas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.setPos(this.pos + 1)
      else if (e.key === 'ArrowLeft') this.setPos(this.pos - 1)
      else if (e.key === 'Home') this.setPos(0)
      else if (e.key === 'End') this.setPos(this.count - 1)
      else return
      e.preventDefault()
    })
  }

  private setPos(p: number) {
    // Wrap into [0, count) so dragging past either end loops continuously.
    const n = this.count
    this.pos = ((p % n) + n) % n
    this.update()
  }

  private get index() {
    return Math.round(this.pos) % this.count
  }

  private update() {
    this.render()
    const zoneCount = this.zones ? Object.keys(this.zones[this.index] ?? {}).length : null
    const zoneInfo = zoneCount === null ? '' : ` · ${zoneCount} zone${zoneCount === 1 ? '' : 's'}`
    this.label.textContent = `${this.index + 1} / ${this.count} · ${this.names[this.index] ?? ''}${zoneInfo}`
    const pct = this.count > 1 ? (this.index / (this.count - 1)) * 100 : 100
    this.progress.style.width = `${pct}%`
  }

  private render() {
    const frame = this.frames[this.index]
    const dpr = window.devicePixelRatio || 1
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    if (cw === 0 || ch === 0) return

    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr)
      this.canvas.height = Math.round(ch * dpr)
    }

    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)

    if (!frame || frame.naturalWidth === 0) return

    // Contain-fit the frame within the canvas box.
    const scale = Math.min(cw / frame.naturalWidth, ch / frame.naturalHeight)
    const w = frame.naturalWidth * scale
    const h = frame.naturalHeight * scale
    const ox = (cw - w) / 2
    const oy = (ch - h) / 2
    ctx.drawImage(frame, ox, oy, w, h)

    this.drawZones(ctx, ox, oy, scale)
  }

  /** Draw the current frame's zone polygons, mapping frame-pixel coords to canvas space. */
  private drawZones(ctx: CanvasRenderingContext2D, ox: number, oy: number, scale: number) {
    const frameZones = this.zones?.[this.index]
    if (!frameZones) return

    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.font = '12px ui-monospace, monospace'
    ctx.textBaseline = 'top'

    const k = this.zoneScale
    // Multiply each coordinate by the modifier, then apply the canvas fit.
    const tx = (px: number) => ox + px * k * scale
    const ty = (py: number) => oy + py * k * scale

    for (const [name, poly] of Object.entries(frameZones)) {
      if (!poly || poly.length === 0) continue
      const hue = zoneHue(name)

      ctx.beginPath()
      for (let i = 0; i < poly.length; i++) {
        const x = tx(poly[i][0])
        const y = ty(poly[i][1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.18)`
      ctx.strokeStyle = `hsl(${hue}, 85%, 55%)`
      ctx.fill()
      ctx.stroke()

      // Label near the first vertex.
      ctx.fillStyle = `hsl(${hue}, 85%, 55%)`
      ctx.fillText(name, tx(poly[0][0]) + 3, ty(poly[0][1]) + 3)
    }
  }
}
