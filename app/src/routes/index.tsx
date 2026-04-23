import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { fetchBusinesses, createBusiness } from '#/lib/business-server-fns'
import { CreateBusinessForm } from '#/components/create-business-form'

export const Route = createFileRoute('/')({
  loader: async () => {
    const businesses = await fetchBusinesses()
    if (businesses.length > 0) {
      throw redirect({
        to: '/$businessCode/dashboard',
        params: { businessCode: businesses[0].code },
      })
    }
    return { businesses }
  },
  component: IndexPage,
})

function IndexPage() {
  const router = useRouter()

  async function handleSubmit(data: { name: string; mission?: string }) {
    const business = await createBusiness({ data })
    await router.navigate({
      to: '/$businessCode/dashboard',
      params: { businessCode: business.code },
    })
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative"
      style={{ background: '#0a0a0c' }}
    >
      {/* X button — no-op on startup (no businesses to go back to) */}
      <button
        className="absolute top-4 left-4 p-1 rounded transition-colors hover:bg-white/5"
        style={{ color: '#3a3a42' }}
        aria-label="Close"
      >
        <X size={16} />
      </button>

      <CreateBusinessForm onSubmit={handleSubmit} showCancel={false} />
    </div>
  )
}
