import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, redpen } from '../src/cut.js'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const COMPLETIONS = '/chat/completions'

export function createProxy({ upstream, score, settings = DEFAULTS, fetcher = fetch }) {
  const base = upstream.replace(/\/+$/, '').replace(new RegExp(`${COMPLETIONS}$`), '')
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
  const forwarded = request => Object.fromEntries(['authorization', 'content-type', 'accept'].filter(name => request.headers.has(name)).map(name => [name, request.headers.get(name)]))
  const relay = async response => new Response(await response.text(), { status: response.status, headers: { ...CORS, 'content-type': response.headers.get('content-type') ?? 'application/json' } })

  const clean = async content => {
    try {
      return (await redpen(content, score, settings)).text
    } catch (error) {
      console.error('Redpen left the reply untouched:', error)
      return content
    }
  }

  const stream = completion => {
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: completion.id, object: 'chat.completion.chunk', model: completion.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const choice = completion.choices[0]
    const body = chunk({ role: 'assistant', content: choice.message.content }) + chunk({}, choice.finish_reason ?? 'stop') + 'data: [DONE]\n\n'
    return new Response(body, { headers: { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
  }

  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const path = new URL(request.url).pathname.replace(/^\/v1(?=\/)/, '')

    if (request.method !== 'POST' || !path.endsWith(COMPLETIONS)) {
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()
      return relay(await fetcher(base + path, { method: request.method, headers: forwarded(request), body }))
    }

    const wanted = await request.json()
    const response = await fetcher(base + COMPLETIONS, { method: 'POST', headers: { ...forwarded(request), 'content-type': 'application/json' }, body: JSON.stringify({ ...wanted, stream: false }) })
    if (!response.ok) return relay(response)

    const completion = await response.json()
    for (const choice of completion.choices ?? []) {
      if (typeof choice.message?.content === 'string') choice.message.content = await clean(choice.message.content)
    }
    return wanted.stream && completion.choices?.length ? stream(completion) : json(completion)
  }
}

function settingsFromEnv(env) {
  const number = (name, fallback) => (env[name] === undefined ? fallback : Number(env[name]))
  const flag = (name, fallback) => (env[name] === undefined ? fallback : env[name] !== '0' && env[name] !== 'false')
  return {
    threshold: number('REDPEN_THRESHOLD', DEFAULTS.threshold),
    maxCutFraction: number('REDPEN_MAX_CUT', DEFAULTS.maxCutFraction),
    cutSentences: flag('REDPEN_CUT_SENTENCES', DEFAULTS.cutSentences),
    cutTails: flag('REDPEN_CUT_TAILS', DEFAULTS.cutTails),
    skipDialogue: flag('REDPEN_SKIP_DIALOGUE', DEFAULTS.skipDialogue),
  }
}

async function main() {
  const upstream = process.env.REDPEN_UPSTREAM
  if (!upstream) {
    console.error('Set REDPEN_UPSTREAM to your provider, for example https://openrouter.ai/api/v1')
    process.exit(1)
  }
  const { nodeScorer } = await import('../server/scorer.js')
  const handle = createProxy({ upstream, settings: settingsFromEnv(process.env), score: async text => (await nodeScorer())(text) })
  const port = Number(process.env.PORT ?? 8787)

  createServer(async (incoming, outgoing) => {
    try {
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD'
      const response = await handle(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, body: hasBody ? Buffer.concat(chunks) : undefined }))
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error(error)
      outgoing.writeHead(502, { ...CORS, 'content-type': 'application/json' })
      outgoing.end(JSON.stringify({ error: { message: 'Redpen proxy could not reach the upstream.' } }))
    }
  }).listen(port, () => console.log(`Redpen proxy on http://localhost:${port}/v1/chat/completions -> ${upstream}`))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
