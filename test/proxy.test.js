import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS, pieces } from '../src/cut.js'
import { createProxy } from '../proxy/server.js'

const REPLY = 'He takes the chair by the window. Her breath hitches. He opens the book on the table.'
const CLEANED = 'He takes the chair by the window. He opens the book on the table.'

const score = async text => pieces(text).map(piece => ({ ...piece, prob: text.includes('breath hitches') ? 0.999 : 0.01 }))
const completion = content => ({ id: 'cmpl-1', model: 'storyteller', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] })

function upstream(status = 200, payload = completion(REPLY)) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetcher }
}

const request = (body, headers = {}) =>
  new Request('http://proxy.test/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer key-1', ...headers }, body: JSON.stringify(body) })

test('a reply comes back with the slop cut and everything else intact', async () => {
  const { calls, fetcher } = upstream()
  const handle = createProxy({ upstream: 'https://llm.example.com/v1', score, settings: DEFAULTS, fetcher })
  const response = await handle(request({ model: 'storyteller', messages: [{ role: 'user', content: 'Hi' }] }))
  const body = await response.json()
  assert.equal(body.choices[0].message.content, CLEANED)
  assert.equal(body.model, 'storyteller')
  assert.equal(calls[0].url, 'https://llm.example.com/v1/chat/completions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer key-1')
})

test('an upstream given as the full endpoint is used as written', async () => {
  const { calls, fetcher } = upstream()
  const handle = createProxy({ upstream: 'https://llm.example.com/v1/chat/completions', score, settings: DEFAULTS, fetcher })
  await handle(request({ model: 'storyteller', messages: [] }))
  assert.equal(calls[0].url, 'https://llm.example.com/v1/chat/completions')
})

test('a streaming client gets the cleaned reply as an event stream, while the upstream is asked for the whole reply', async () => {
  const { calls, fetcher } = upstream()
  const handle = createProxy({ upstream: 'https://llm.example.com/v1', score, settings: DEFAULTS, fetcher })
  const response = await handle(request({ model: 'storyteller', stream: true, messages: [] }))
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  assert.equal(JSON.parse(calls[0].init.body).stream, false)
  const events = (await response.text()).split('\n\n').filter(Boolean).map(event => event.replace(/^data: /, ''))
  assert.equal(events.at(-1), '[DONE]')
  const text = events.slice(0, -1).map(event => JSON.parse(event).choices[0].delta.content ?? '').join('')
  assert.equal(text, CLEANED)
})

test('an upstream error is passed through untouched', async () => {
  const { fetcher } = upstream(429, { error: { message: 'rate limited' } })
  const handle = createProxy({ upstream: 'https://llm.example.com/v1', score, settings: DEFAULTS, fetcher })
  const response = await handle(request({ model: 'storyteller', messages: [] }))
  assert.equal(response.status, 429)
  assert.equal((await response.json()).error.message, 'rate limited')
})

test('when scoring fails the original reply is returned', async () => {
  const { fetcher } = upstream()
  const handle = createProxy({ upstream: 'https://llm.example.com/v1', settings: DEFAULTS, fetcher, score: async () => { throw new Error('model unavailable') } })
  const response = await handle(request({ model: 'storyteller', messages: [] }))
  assert.equal((await response.json()).choices[0].message.content, REPLY)
})

test('a browser preflight is answered with permissive CORS headers', async () => {
  const handle = createProxy({ upstream: 'https://llm.example.com/v1', score, settings: DEFAULTS, fetcher: upstream().fetcher })
  const response = await handle(new Request('http://proxy.test/v1/chat/completions', { method: 'OPTIONS' }))
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('other paths are forwarded to the upstream as they are', async () => {
  const { calls, fetcher } = upstream(200, { data: [{ id: 'storyteller' }] })
  const handle = createProxy({ upstream: 'https://llm.example.com/v1', score, settings: DEFAULTS, fetcher })
  const response = await handle(new Request('http://proxy.test/v1/models', { headers: { authorization: 'Bearer key-1' } }))
  assert.equal(calls[0].url, 'https://llm.example.com/v1/models')
  assert.equal((await response.json()).data[0].id, 'storyteller')
})
