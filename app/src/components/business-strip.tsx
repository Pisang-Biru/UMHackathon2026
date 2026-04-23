import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { CreateBusinessDialog } from '#/components/create-business-dialog'

interface Business {
  id: string
  name: string
  code: string
}

interface BusinessStripProps {
  businesses: Business[]
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

const COLORS = ['#3b7ef8', '#00c97a', '#a78bfa', '#f59e0b', '#ec4899', '#ef4444']

export function BusinessStrip({ businesses }: BusinessStripProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { businessCode?: string }
  const activeCode = params.businessCode

  return (
    <>
      <div
        className="w-12 shrink-0 flex flex-col items-center py-3 h-full"
        style={{ background: '#060608', borderRight: '1px solid #151518' }}
      >
        <div className="flex-1 flex flex-col items-center gap-2 pt-1">
          {businesses.map((biz, i) => {
            const color = COLORS[i % COLORS.length]
            const isActive = biz.code === activeCode
            return (
              <div key={biz.id} className="relative flex items-center">
                {isActive && (
                  <div
                    className="absolute -left-3 w-1 rounded-r-full"
                    style={{ background: color, height: '20px' }}
                  />
                )}
                <button
                  title={biz.name}
                  onClick={() =>
                    navigate({ to: '/$businessCode/dashboard', params: { businessCode: biz.code } })
                  }
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-white transition-all duration-150 hover:opacity-100"
                  style={{
                    background: isActive
                      ? `linear-gradient(135deg, ${color}, ${color}cc)`
                      : '#1a1a1f',
                    color: isActive ? '#fff' : '#555',
                    opacity: isActive ? 1 : 0.7,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {initials(biz.name)}
                </button>
              </div>
            )
          })}
        </div>

        <button
          title="Add business"
          onClick={() => setDialogOpen(true)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:opacity-80 mb-1"
          style={{ border: '1.5px dashed #252530', color: '#333340' }}
        >
          <Plus size={13} />
        </button>
      </div>

      <CreateBusinessDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
