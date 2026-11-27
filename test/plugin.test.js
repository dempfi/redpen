import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as transformers from '@huggingface/transformers'
import { info, init } from '../server/plugin.js'

if (process.env.REDPEN_MODELS) {
  transformers.env.localModelPath = process.env.REDPEN_MODELS
  transformers.env.allowRemoteModels = false
}

const routes = {}
await init({ get: (path, handler) => (routes[`GET ${path}`] = handler), post: (path, handler) => (routes[`POST ${path}`] = handler) })

function reply() {
  const sent = { status: 200, body: undefined }
  const response = { status: code => ((sent.status = code), response), json: body => ((sent.body = body), response) }
  return { sent, response }
}

test('the plugin declares what the loader requires', () => {
  assert.match(info.id, /^[a-z0-9_-]+$/)
  assert.equal(typeof info.name, 'string')
  assert.equal(typeof info.description, 'string')
})

test('the status route answers so the extension can find the plugin', () => {
  const { sent, response } = reply()
  routes['GET /status']({}, response)
  assert.deepEqual(sent.body, { ok: true })
})

test('the score route returns a probability for every piece of every text', async () => {
  const { sent, response } = reply()
  await routes['POST /score']({ body: { texts: ['Her breath hitches.', 'He sets the cup down and opens the window.'] } }, response)
  assert.equal(sent.status, 200)
  const [slop, clean] = sent.body.scores.map(scored => Math.max(...scored.map(piece => piece.prob)))
  assert.ok(slop > 0.99, `slop ${slop}`)
  assert.ok(clean < 0.1, `clean ${clean}`)
  assert.deepEqual(sent.body.scores[0].map(piece => piece.text), ['Her', 'breath', 'hitches', '.'])
})

test('a malformed request is refused', async () => {
  const { sent, response } = reply()
  await routes['POST /score']({ body: { texts: 'Her breath hitches.' } }, response)
  assert.equal(sent.status, 400)
})
