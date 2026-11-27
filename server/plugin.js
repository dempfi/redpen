import { nodeScorer } from './scorer.js'

const MAX_TEXTS = 512

export const info = {
  id: 'redpen',
  name: 'Redpen',
  description: 'Scores model replies for slop on the server, so no browser has to run the model.',
}

async function payload(request) {
  if (request.body && typeof request.body === 'object') return request.body
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function init(router) {
  router.get('/status', (_request, response) => response.json({ ok: true }))

  router.post('/score', async (request, response) => {
    try {
      const { texts } = await payload(request)
      if (!Array.isArray(texts) || texts.length > MAX_TEXTS || texts.some(text => typeof text !== 'string')) {
        return response.status(400).json({ error: `texts must be an array of at most ${MAX_TEXTS} strings` })
      }
      const score = await nodeScorer()
      const scores = []
      for (const text of texts) scores.push(await score(text))
      return response.json({ scores })
    } catch (error) {
      console.error('Redpen scoring failed:', error)
      return response.status(500).json({ error: 'scoring failed' })
    }
  })
}
