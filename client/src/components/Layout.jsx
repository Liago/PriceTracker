import { useState } from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'
import Header from './Header'
import AddProductModal from './AddProductModal'
import { Toaster } from 'sonner'
import { scrapeProduct } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext' // Needed for user.id in addProduct logic

export default function Layout() {
  const { user } = useAuth()
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0) // Simple counter to trigger refreshes

  const handleAddProduct = async (url) => {
    // Shared Logic for Adding Product
    const data = await scrapeProduct(url)

    // The server returns the price already parsed. A null means the page was
    // read but no trustworthy price was found - tracking it would produce a
    // history that starts from a wrong number, so we stop here instead.
    if (data.priceValue === null || data.priceValue === undefined) {
      throw new Error("Couldn't read a price on that page. Check the link points to a product page.")
    }

    // Save to Supabase
    const { error } = await supabase.from('products').insert([
      {
        user_id: user.id,
        url,
        name: data.title,
        image: data.image,
        description: data.description,
        current_price: data.priceValue,
        currency: data.currency,
        store: data.store,
        details: { ...data.details, availability: data.availability }
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
