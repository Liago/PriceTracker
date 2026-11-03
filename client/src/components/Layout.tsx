import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import AddProductModal from './AddProductModal'
import { addProduct } from '../lib/api'

export interface LayoutContext {
  refreshTrigger: number
  openAddProduct: () => void
}

export default function Layout() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0) // Simple counter to trigger refreshes

  const handleAddProduct = async (url: string) => {
    // La scrittura avviene sul server: il client non tocca piu' products.
    // E' il server a decidere se il prezzo letto e' affidabile abbastanza da
    // avviare una storia prezzi.
    await addProduct({ url })
    setRefreshTrigger((prev) => prev + 1)
  }

  const context: LayoutContext = { refreshTrigger, openAddProduct: () => setIsAddModalOpen(true) }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header onAddProduct={() => setIsAddModalOpen(true)} />

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-6">
        <Outlet context={context} />
      </main>

      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddProduct}
      />
    </div>
  )
}
