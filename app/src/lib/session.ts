import { createServerFn } from '@tanstack/react-start'
import { auth } from './auth'

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return null
  return { userId: session.user.id, email: session.user.email }
})
