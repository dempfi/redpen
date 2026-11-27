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

let scorer
function loadedScorer() {
  scorer ??= (async () => {
    globalThis.toastr?.info('Loading the Redpen model (44 MB on first use).', 'Redpen')
    return loadScorer(await import(TRANSFORMERS))
  })().catch(error => {
    scorer = undefined
    throw error
  })
  return scorer
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
}

const { eventSource, eventTypes } = context()
eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessage)
await mountSettings()
