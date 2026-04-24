export function paymentUrl(base: string, orderId: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return `${trimmed}/pay/${orderId}`
}

export function formatOrderTotal(amount: number): string {
  return `RM${amount.toFixed(2)}`
}

export function isValidBuyerInput(input: { name: string; contact: string }): boolean {
  return input.name.trim().length > 0 && input.contact.trim().length > 0
}
