import { useState } from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'
import Header from './Header'
import AddProductModal from './AddProductModal'
import { Toaster } from 'sonner'
import { addProduct } from '../lib/api'

export default function Layout() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0) // Simple counter to trigger refreshes

  const handleAddProduct = async (url) => {
    // La scrittura avviene sul server: il client non tocca piu' products.
    // E' il server a decidere se il prezzo letto e' affidabile abbastanza da
    // avviare una storia prezzi.
    await addProduct({ url })
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      <Header onAddProduct={() => setIsAddModalOpen(true)} />
      
      <main className="py-8">
        {/* Pass refreshTrigger to children via context */}
        <Outlet context={{ refreshTrigger }} />
      </main>

      <AddProductModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        onAdd={handleAddProduct}
      />
      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}
