import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'

export interface Product {
  id: string
  name: string
  price: number
  stock: number
  description: string | null
  cogs: number | null
  packagingCost: number | null
}

interface ProductTableProps {
  products: Product[]
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
}

export function ProductTable({ products, onEdit, onDelete }: ProductTableProps) {
  if (products.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 rounded-xl border"
        style={{ borderColor: '#1a1a1e', background: '#111113', color: '#444' }}
      >
        <p className="text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>No products yet</p>
        <p className="text-[11px] mt-1" style={{ color: '#333' }}>Add your first product to get started</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#1a1a1e' }}>
      <table className="w-full text-[13px]" style={{ color: '#c8c5c0' }}>
        <thead>
          <tr style={{ background: '#0c0c0f', borderBottom: '1px solid #1a1a1e' }}>
            <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>Product</th>
            <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>Price</th>
            <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>Stock</th>
            <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>Description</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {products.map((product, i) => (
            <tr
              key={product.id}
              style={{ background: i % 2 === 0 ? '#111113' : '#0f0f12', borderBottom: '1px solid #1a1a1e' }}
            >
              <td className="px-4 py-3 font-medium" style={{ color: '#e8e6e2' }}>{product.name}</td>
              <td className="px-4 py-3" style={{ color: '#00c97a', fontFamily: 'var(--font-mono)' }}>RM {product.price.toFixed(2)}</td>
              <td className="px-4 py-3">
                <span
                  className="px-2 py-0.5 rounded text-[11px]"
                  style={{
                    background: product.stock > 0 ? 'rgba(0,201,122,0.1)' : 'rgba(239,68,68,0.1)',
                    color: product.stock > 0 ? '#00a863' : '#ef4444',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {product.stock}
                </span>
              </td>
              <td className="px-4 py-3 max-w-[200px] truncate" style={{ color: '#666' }}>{product.description ?? '—'}</td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7"
                    onClick={() => onEdit(product)}
                    style={{ color: '#555' }}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7"
                    onClick={() => onDelete(product)}
                    style={{ color: '#555' }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
