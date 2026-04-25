import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchProducts, createProduct, updateProduct, deleteProduct } from '#/lib/product-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { ProductTable, type Product } from '#/components/products/product-table'
import { ProductDialog, type ProductFormData } from '#/components/products/product-dialog'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/$businessCode/products')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/products',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }
    const [initialProducts, sidebarAgents] = await Promise.all([
      fetchProducts({ data: { businessId: current.id } }),
      fetchSidebarAgents({ data: { businessId: current.id } }),
    ])
    return { businesses, current, initialProducts, sidebarAgents }
  },
  component: ProductsPage,
})

function ProductsPage() {
  const { businesses, current, initialProducts, sidebarAgents } = Route.useLoaderData()

  const [products, setProducts] = React.useState<Product[]>(
    initialProducts.map((p) => ({
      ...p,
      price: typeof p.price === 'number' ? p.price : Number(p.price),
      cogs: p.cogs ?? null,
      packagingCost: p.packagingCost ?? null,
    })) as Product[]
  )

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingProduct, setEditingProduct] = React.useState<(ProductFormData & { id: string }) | undefined>(undefined)

  function handleAddClick() {
    setEditingProduct(undefined)
    setDialogOpen(true)
  }

  function handleEditClick(product: Product) {
    setEditingProduct({
      id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
      description: product.description ?? '',
      cogs: product.cogs ?? null,
      packagingCost: product.packagingCost ?? null,
    })
    setDialogOpen(true)
  }

  async function handleDeleteClick(product: Product) {
    if (!window.confirm(`Delete "${product.name}"? This cannot be undone.`)) return
    await deleteProduct({ data: { id: product.id } })
    setProducts((prev) => prev.filter((p) => p.id !== product.id))
  }

  async function handleDialogSubmit(data: ProductFormData) {
    if (editingProduct) {
      const updated = await updateProduct({
        data: {
          id: editingProduct.id,
          businessId: current.id,
          name: data.name,
          price: data.price,
          stock: data.stock,
          description: data.description,
          cogs: data.cogs,
          packagingCost: data.packagingCost,
        },
      })
      const updatedProduct: Product = {
        ...updated,
        price: typeof updated.price === 'number' ? updated.price : Number(updated.price),
        cogs: updated.cogs ?? null,
        packagingCost: updated.packagingCost ?? null,
      }
      setProducts((prev) =>
        prev.map((p) => (p.id === updatedProduct.id ? updatedProduct : p))
      )
    } else {
      const created = await createProduct({
        data: {
          businessId: current.id,
          name: data.name,
          price: data.price,
          stock: data.stock,
          description: data.description,
          cogs: data.cogs,
          packagingCost: data.packagingCost,
        },
      })
      const createdProduct: Product = {
        ...created,
        price: typeof created.price === 'number' ? created.price : Number(created.price),
        cogs: created.cogs ?? null,
        packagingCost: created.packagingCost ?? null,
      }
      setProducts((prev) => [...prev, createdProduct])
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />

      <main className="flex-1 overflow-auto" style={{ background: '#111113' }}>
        {/* Header */}
        <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#1a1a1e' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
                Catalogue
              </p>
              <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
                Products
              </h1>
            </div>
            <Button
              onClick={handleAddClick}
              className="flex items-center gap-1.5"
              style={{ background: '#3b7ef8', color: '#fff' }}
            >
              <Plus size={14} />
              Add Product
            </Button>
          </div>
        </div>

        <div className="px-8 py-5">
          <ProductTable
            products={products}
            onEdit={handleEditClick}
            onDelete={handleDeleteClick}
          />
        </div>
      </main>

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editingProduct}
        onSubmit={handleDialogSubmit}
      />
    </div>
  )
}
