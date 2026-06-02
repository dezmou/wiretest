import './style.css'
import { FrameSequence } from './sequence.ts'
import { parse3DmaxZone } from './parse.ts'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header>
    <h1>wiretest</h1>
    <p>Drop a batch of images to build a scrubbable frame sequence. Drag a canvas left/right to play through it.</p>
  </header>
  <main id="stage">
    <p class="empty">No sequences yet — drop some images anywhere on the page.</p>
  </main>
  <div id="dropzone" hidden><span></span></div>
`

const stage = document.querySelector<HTMLDivElement>('#stage')!
const dropzone = document.querySelector<HTMLDivElement>('#dropzone')!
const dropLabel = dropzone.querySelector('span')!

/** The single active sequence (null until images are dropped). */
let current: FrameSequence | null = null

const isImage = (f: File) => f.type.startsWith('image/')
const isJson = (f: File) => f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')

function naturalSort(a: File, b: File) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

async function loadFrame(file: File): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = URL.createObjectURL(file)
  await img.decode().catch(() => {})
  return img
}

async function addSequenceFromFiles(images: File[]) {
  const files = images.sort(naturalSort).reverse()
  if (files.length === 0) return

  const frames = await Promise.all(files.map(loadFrame))
  current = new FrameSequence(
    frames,
    files.map((f) => f.name),
  )

  // One sequence at a time — replace whatever's there (drop hint, or a prior
  // sequence). Refresh the page to start over with something new.
  app.classList.add('has-seq')
  stage.replaceChildren(current.el)
}

async function applyZonesFromFile(file: File) {
  if (!current) {
    alert('Drop an image sequence first, then drop the 3ds Max JSON onto it.')
    return
  }
  try {
    const zones = await parse3DmaxZone(file)
    // Frames were reversed on load, so reverse the per-frame zones to match.
    current.setZones(zones.reverse())
  } catch (err) {
    console.error(err)
    alert(`Could not parse "${file.name}" as a 3ds Max zone export.`)
  }
}

async function handleDrop(fileList: FileList) {
  const files = Array.from(fileList)
  const images = files.filter(isImage)
  if (images.length) {
    await addSequenceFromFiles(images)
    return
  }
  const json = files.find(isJson)
  if (json) await applyZonesFromFile(json)
}

// --- Drag & drop wiring (the whole window is a drop target) ---

let dragDepth = 0

window.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dragDepth++
  dropLabel.textContent = current
    ? 'Drop a 3ds Max JSON to overlay zones (or images for a new sequence)'
    : 'Drop images to create a sequence'
  dropzone.hidden = false
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})

window.addEventListener('dragleave', (e) => {
  e.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropzone.hidden = true
})

window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  dropzone.hidden = true
  if (e.dataTransfer?.files.length) {
    void handleDrop(e.dataTransfer.files)
  }
})
