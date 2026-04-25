export interface PanelProps { businessId: string; agentType: string }

export default function Panel(_: PanelProps) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p className="text-[12px]" style={{ color: '#555' }}>No custom panel yet — common shell only.</p>
    </div>
  )
}
