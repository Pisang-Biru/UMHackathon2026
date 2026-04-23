import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { getSession } from '#/lib/session'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/login')({
  loader: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/' })
    }
    return null
  },
  component: LoginPage,
})

function LoginPage() {
  const [loading, setLoading] = useState(false)

  async function handleGoogleSignIn() {
    setLoading(true)
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/',
      })
    } catch (err) {
      console.error('Sign-in failed', err)
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#0a0a0c' }}
    >
      <div
        className="w-full max-w-sm px-8 py-10 rounded-2xl flex flex-col items-center gap-8"
        style={{ background: '#0f0f12', border: '1px solid #1a1a1e' }}
      >
        {/* Logo / wordmark */}
        <div className="flex flex-col items-center gap-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ background: 'linear-gradient(135deg, #3b7ef8, #00c97a)', fontFamily: 'var(--font-mono)' }}
          >
            P
          </div>
          <h1
            className="text-[22px] font-bold tracking-tight"
            style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
          >
            Pisang
          </h1>
          <p
            className="text-[12px] text-center"
            style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
          >
            Sign in to manage your AI agents
          </p>
        </div>

        {/* Google sign-in button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: '#1a1a1f',
            color: '#e8e6e2',
            border: '1px solid #2a2a32',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <p
          className="text-[10px] text-center"
          style={{ color: '#2a2a32', fontFamily: 'var(--font-mono)' }}
        >
          By signing in you agree to our terms of service
        </p>
      </div>
    </div>
  )
}
