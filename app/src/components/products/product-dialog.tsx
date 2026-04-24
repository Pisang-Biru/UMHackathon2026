import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'

export interface ProductFormData {
  name: string
  price: number
  stock: number
  description: string
}

interface ProductDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ProductFormData & { id: string }
  onSubmit: (data: ProductFormData) => Promise<void>
}

export function ProductDialog({ open, onOpenChange, initial, onSubmit }: ProductDialogProps) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [price, setPrice] = React.useState(initial?.price?.toString() ?? '')
  const [stock, setStock] = React.useState(initial?.stock?.toString() ?? '0')
  const [description, setDescription] = React.useState(initial?.description ?? '')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setPrice(initial?.price?.toString() ?? '')
      setStock(initial?.stock?.toString() ?? '0')
      setDescription(initial?.description ?? '')
      setError(null)
    }
  }, [open, initial])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsedPrice = parseFloat(price)
    const parsedStock = parseInt(stock, 10)
    if (!name.trim()) return setError('Name is required')
    if (isNaN(parsedPrice) || parsedPrice < 0) return setError('Price must be a valid number')
    if (isNaN(parsedStock) || parsedStock < 0) return setError('Stock must be a valid number')
    setLoading(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), price: parsedPrice, stock: parsedStock, description })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const label = (text: string) => (
    <span className="text-[11px] uppercase tracking-[0.12em] font-medium" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>
      {text}
    </span>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-8 border" style={{ background: '#0c0c0f', borderColor: '#2e2e35', maxWidth: '480px' }}>
        <DialogHeader>
          <DialogTitle className="text-[18px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
            {initial ? 'Edit Product' : 'Add Product'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
          <div className="flex flex-col gap-1.5">
            {label('Product Name')}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chocojar Original"
              style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2' }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              {label('Price (RM)')}
              <Input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="12.00"
                style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              {label('Stock')}
              <Input
                type="number"
                min="0"
                step="1"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="50"
                style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2' }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {label('Description (optional)')}
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of the product"
              rows={3}
              style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2', resize: 'none' }}
            />
          </div>
          {error && (
            <p className="text-[12px]" style={{ color: '#ef4444' }}>{error}</p>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              style={{ color: '#666' }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              style={{ background: '#3b7ef8', color: '#fff' }}
            >
              {loading ? 'Saving...' : initial ? 'Save Changes' : 'Add Product'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
