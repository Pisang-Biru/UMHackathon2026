const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:8000'

export async function triggerFinanceCheck(orderId: string): Promise<void> {
  try {
    const res = await fetch(`${AGENTS_URL}/finance/check/${orderId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) {
      console.warn(`finance check failed for ${orderId}: ${res.status}`)
    }
  } catch (e) {
    console.warn(`finance check error for ${orderId}:`, e)
  }
}
