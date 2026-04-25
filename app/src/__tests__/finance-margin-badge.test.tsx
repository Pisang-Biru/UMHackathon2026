import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MarginBadge } from '../components/MarginBadge'

describe('MarginBadge', () => {
  it('renders OK with value', () => {
    render(<MarginBadge status="OK" value="96.00" />)
    expect(screen.getByText(/RM96\.00/)).toBeInTheDocument()
  })
  it('renders LOSS in red', () => {
    render(<MarginBadge status="LOSS" value="-12.00" />)
    expect(screen.getByText(/loss RM-12\.00/)).toBeInTheDocument()
  })
  it('renders MISSING_DATA placeholder', () => {
    render(<MarginBadge status="MISSING_DATA" value={null} />)
    expect(screen.getByText(/missing data/i)).toBeInTheDocument()
  })
  it('renders dash when null', () => {
    render(<MarginBadge status={null} value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
