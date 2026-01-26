import { useState } from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'
import Header from './Header'
import AddProductModal from './AddProductModal'
import { Toaster } from 'sonner'
import { scrapeProduct } from '../lib/api'
import { supabase } from '../lib/supabase'
import { parsePrice } from '../lib/utils'
import { useAuth } from '../context/AuthContext' // Needed for user.id in addProduct logic

export default function Layout() {
  const { user } = useAuth()
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0) // Simple counter to trigger refreshes

  const handleAddProduct = async (url) => {
    // Shared Logic for Adding Product
    const data = await scrapeProduct(url)
    
    // Save to Supabase
    const { error } = await supabase.from('products').insert([
      {
        user_id: user.id,
        url,
        name: data.title,
        image: data.image,
        description: data.description,
        current_price: parsePrice(data.price, data.currency),
        currency: data.currency,
        store: data.store,
        details: data.details
      }
    ])

    if (error) throw error
    
    // Trigger refresh in children
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
