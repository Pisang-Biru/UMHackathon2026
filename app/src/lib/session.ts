import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/start-server-core'
import { redirect } from '@tanstack/react-router'
import { auth } from './auth'

export const requireSession = async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() as Headers })
  if (!session) {
    throw redirect({ to: '/login' })
  }
  return session
}

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() as Headers })
  return session ?? null
})
