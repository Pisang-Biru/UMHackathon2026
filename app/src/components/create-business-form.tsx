import { useState } from 'react'
import { Building2, Bot, ListTodo, Rocket } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'

interface CreateBusinessFormProps {
  onSubmit: (data: { name: string; mission?: string }) => Promise<void>
  onCancel?: () => void
  showCancel?: boolean
}

const STEPS = [
  { icon: Building2, label: 'Company' },
  { icon: Bot, label: 'Agent' },
  { icon: ListTodo, label: 'Task' },
  { icon: Rocket, label: 'Launch' },
]

export function CreateBusinessForm({ onSubmit, onCancel, showCancel = true }: CreateBusinessFormProps) {
  const [name, setName] = useState('')
  const [mission, setMission] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters')
      return
    }
    setError('')
    setLoading(true)
    try {
      await onSubmit({ name: name.trim(), mission: mission.trim() || undefined })
    } catch {
      setError('Something went wrong. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="w-[400px]">
      {/* Step tabs — visual chrome only */}
      <div className="flex border-b mb-7" style={{ borderColor: '#222228' }}>
        {STEPS.map((step, i) => {
          const Icon = step.icon
          return (
            <div
              key={step.label}
              className="flex items-center gap-1.5 px-4 pb-3 text-[12px]"
              style={{
                color: i === 0 ? '#f0ede8' : '#3a3a42',
                borderBottom: i === 0 ? '2px solid #3b7ef8' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              <Icon size={12} />
              {step.label}
            </div>
          )
        })}
      </div>

      {/* Form header */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{ background: 'rgba(59,126,248,0.12)', border: '1px solid rgba(59,126,248,0.2)' }}
      >
        <Building2 size={16} style={{ color: '#3b7ef8' }} />
      </div>
      <p className="text-[16px] font-bold mb-1" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
        Name your company
      </p>
      <p className="text-[12px] mb-5" style={{ color: '#555' }}>
        This is the organization your agents will work for.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="block text-[12px] mb-1.5" style={{ color: '#888' }}>
            Company name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            className="w-full"
            style={{ background: '#111115', border: '1px solid #222228', color: '#f0ede8' }}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[12px] mb-1.5" style={{ color: '#888' }}>
            Mission / goal{' '}
            <span style={{ color: '#3a3a42' }}>(optional)</span>
          </label>
          <Textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder="What is this company trying to achieve?"
            rows={3}
            className="w-full resize-none"
            style={{ background: '#111115', border: '1px solid #222228', color: '#f0ede8' }}
          />
        </div>

        {error && (
          <p className="text-[11px]" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-1">
          {showCancel && onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="text-[13px]"
              style={{ color: '#555', border: '1px solid #222228' }}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={loading || name.trim().length < 2}
            className="text-[13px] font-semibold"
            style={{ background: '#3b7ef8', color: '#fff' }}
          >
            {loading ? 'Creating…' : '✦ Create Business'}
          </Button>
        </div>
      </form>
    </div>
  )
}
