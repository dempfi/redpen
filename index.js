import { DEFAULTS, redpen } from './src/cut.js'
import { loadScorer } from './src/model.js'

const KEY = 'redpen'
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2'
const INITIAL = Object.freeze({ enabled: true, ...DEFAULTS, keepOriginal: true, notify: true })
const context = () => globalThis.SillyTavern.getContext()

function settings() {
  const store = context().extensionSettings
  store[KEY] = { ...INITIAL, ...store[KEY] }
  return store[KEY]
}

const SERVER = '/api/plugins/redpen'

async function serverScorer() {
  const headers = () => ({ ...context().getRequestHeaders(), 'Content-Type': 'application/json' })
  const status = await fetch(`${SERVER}/status`, { headers: headers() }).catch(() => null)
  if (!status?.ok) return null
  return async text => {
    const response = await fetch(`${SERVER}/score`, { method: 'POST', headers: headers(), body: JSON.stringify({ texts: [text] }) })
    if (!response.ok) throw new Error(`Redpen server plugin answered ${response.status}`)
    return (await response.json()).scores[0]
  }
}

let scorer
let place
function loadedScorer() {
  scorer ??= (async () => {
    const remote = await serverScorer()
    place = remote ? 'server' : 'browser'
    showPlace()
    if (remote) return remote
    globalThis.toastr?.info('Loading the Redpen model (44 MB on first use).', 'Redpen')
    return loadScorer(await import(TRANSFORMERS))
  })().catch(error => {
    scorer = undefined
    throw error
  })
  return scorer
}

function showPlace() {
  const label = document.querySelector('[data-redpen-place]')
  if (label && place) label.textContent = place === 'server' ? 'The model runs on your SillyTavern server.' : 'The model runs in this browser.'
}

async function onMessage(id, type) {
  const options = settings()
  if (!options.enabled || type === 'first_message') return
  const { chat, updateMessageBlock, saveChat } = context()
  const message = chat[id]
  if (!message || message.is_user || message.is_system || !message.mes) return

  try {
    const { text, cuts } = await redpen(message.mes, await loadedScorer(), options)
    if (!cuts.length) return
    if (options.keepOriginal) message.extra = { ...message.extra, redpen_original: message.mes, redpen_cuts: cuts }
    message.mes = text
    if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = text
    updateMessageBlock(id, message)
    await saveChat()
    if (options.notify) globalThis.toastr?.info(cuts.map(cut => cut.removed).join(' · '), `Redpen cut ${cuts.length}`)
  } catch (error) {
    console.error('Redpen left the message untouched:', error)
  }
}

async function restoreLast() {
  const { chat, updateMessageBlock, saveChat } = context()
  const id = chat.findLastIndex(message => message.extra?.redpen_original)
  if (id < 0) return globalThis.toastr?.info('No message to restore.', 'Redpen')
  const message = chat[id]
  message.mes = message.extra.redpen_original
  if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = message.mes
  delete message.extra.redpen_original
  delete message.extra.redpen_cuts
  updateMessageBlock(id, message)
  await saveChat()
}

async function mountSettings() {
  const host = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings')
  if (!host) return
  const panel = document.createElement('div')
  panel.innerHTML = await (await fetch(new URL('./settings.html', import.meta.url))).text()
  host.append(panel)

  const options = settings()
  const save = () => context().saveSettingsDebounced()
  for (const input of panel.querySelectorAll('[data-redpen]')) {
    const name = input.dataset.redpen
    const percent = input.dataset.unit === 'percent'
    const show = () => {
      const label = panel.querySelector(`[data-redpen-value="${name}"]`)
      if (label) label.textContent = percent ? `${Math.round(options[name] * 100)}%` : Number(options[name]).toFixed(3)
    }
    if (input.type === 'checkbox') input.checked = options[name]
    else input.value = percent ? options[name] * 100 : options[name]
    show()
    input.addEventListener('input', () => {
      options[name] = input.type === 'checkbox' ? input.checked : percent ? Number(input.value) / 100 : Number(input.value)
      show()
      save()
    })
  }
  panel.querySelector('[data-redpen-restore]')?.addEventListener('click', restoreLast)
  place = (await serverScorer()) ? 'server' : 'browser'
  showPlace()
}

const { eventSource, eventTypes } = context()
eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessage)
await mountSettings()
