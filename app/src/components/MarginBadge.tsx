type Props = {
  status: 'OK' | 'LOSS' | 'MISSING_DATA' | null
  value: string | null
}

export function MarginBadge({ status, value }: Props) {
  if (status == null) return <span className="text-xs opacity-60">—</span>
  if (status === 'MISSING_DATA') return <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs">missing data</span>
  if (status === 'LOSS') return <span className="rounded bg-red-100 text-red-700 px-2 py-0.5 text-xs">loss RM{value}</span>
  return <span className="rounded bg-green-100 text-green-700 px-2 py-0.5 text-xs">RM{value}</span>
}
