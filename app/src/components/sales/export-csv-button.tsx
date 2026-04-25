import { Download } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { serializeSalesCsv, type SalesOrder } from '#/lib/sales-logic'

export function ExportCsvButton({
  rows,
  businessCode,
}: {
  rows: SalesOrder[]
  businessCode: string
}) {
  const disabled = rows.length === 0

  function handleClick() {
    const csv = serializeSalesCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const today = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-${businessCode}-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      onClick={handleClick}
      disabled={disabled}
      className="flex items-center gap-1.5 disabled:opacity-50"
      style={{ background: '#1a1a1f', color: '#e8e6e2', border: '1px solid #2a2a32' }}
    >
      <Download size={13} />
      Export CSV
    </Button>
  )
}
