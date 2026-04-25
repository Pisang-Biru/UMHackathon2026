import { useEffect, useState } from 'react'
import { fetchAgentStats } from '#/lib/agent-server-fns'
import { BarChart } from '#/components/dashboard/charts'

export interface PanelProps {
  businessId: string
  agentType: string
}

export default function CustomerSupportPanel({ businessId, agentType }: PanelProps) {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    fetchAgentStats({ data: { businessId, agentType, rangeDays: 14 } }).then(setData)
  }, [businessId, agentType])

  if (!data) {
    return (
      <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <p className="text-[12px]" style={{ color: '#555' }}>Loading messaging metrics…</p>
      </div>
    )
  }

  const confMax = Math.max(1, ...data.confidenceDistribution.map((x: any) => x.count))
  const confBars = data.confidenceDistribution.map((b: any) => ({
    label: b.bucket,
    height: (b.count / confMax) * 100,
    color: '#3b7ef8',
  }))

  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile label="Auto-send rate" value={`${Math.round(data.autoSendRate * 100)}%`} />
      <Tile label="Approval rate" value={`${Math.round(data.approvalRate * 100)}%`} />
      <Tile label="Avg confidence" value={data.avgConfidence.toFixed(2)} />
      <div className="col-span-3">
        <BarChart bars={confBars} title="Confidence distribution" />
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>{label}</p>
      <p className="text-[22px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>{value}</p>
    </div>
  )
}
