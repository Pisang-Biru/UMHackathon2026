export function enqueueProductReindex(productId: string) {
  const agentsUrl = process.env.AGENTS_URL ?? 'http://localhost:8000'
  fetch(`${agentsUrl}/memory/product/${productId}/reindex`, { method: 'POST' })
    .catch((err) => console.warn('reindex enqueue failed', err))
}
