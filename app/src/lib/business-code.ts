/**
 * Strips non-alpha chars, uppercases, takes first `length` chars.
 */
export function deriveCode(name: string, length: number): string {
  const stripped = name.replace(/[^a-zA-Z]/g, '').toUpperCase()
  return stripped.slice(0, length)
}

/**
 * Generates a unique business code by querying for collisions.
 * Starts at 3 chars, increments until unique.
 * checkExists: returns true if the code is already taken.
 */
export async function generateUniqueCode(
  name: string,
  checkExists: (code: string) => Promise<boolean>,
): Promise<string> {
  const stripped = name.replace(/[^a-zA-Z]/g, '').toUpperCase()
  if (stripped.length === 0) throw new Error('Business name must contain letters')

  for (let len = 3; len <= stripped.length; len++) {
    const code = stripped.slice(0, len)
    const taken = await checkExists(code)
    if (!taken) return code
  }

  // All prefix lengths collide — append timestamp suffix as last resort
  return stripped.slice(0, 3) + Date.now().toString().slice(-3)
}
