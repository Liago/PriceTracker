import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Plus, Trash2, ExternalLink } from 'lucide-react'
import AddProductModal from '../components/AddProductModal'
import { scrapeProduct } from '../lib/api'
import { supabase } from '../lib/supabase'
import { parsePrice } from '../lib/utils'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProducts()
  }, [user])

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setProducts(data || [])
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddProduct = async (url) => {
    // 1. Scrape product data
    const data = await scrapeProduct(url)
    
    // 2. Save to Supabase
    const { error } = await supabase.from('products').insert([
      {
        user_id: user.id,
        url,
        name: data.title,
        image: data.image,
        description: data.description,
        current_price: parsePrice(data.price, data.currency),
        currency: data.currency
      }
    ])

    if (error) throw error
    
    // 3. Refresh list
    fetchProducts()
  }

  const handleDelete = async (id) => {
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (!error) {
      setProducts(products.filter(p => p.id !== id))
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus size={20} />
              Add Product
            </button>
            <div className="h-8 w-px bg-gray-700"></div>
            <span className="text-gray-400">{user?.email}</span>
            <button
              onClick={() => signOut()}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.length === 0 ? (
            <div className="col-span-full bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
              <p className="text-gray-400 py-12">No products tracked yet. Click "Add Product" to start.</p>
            </div>
          ) : (
            products.map((product) => (
              <div key={product.id} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-blue-500 transition-colors group relative">
                <Link to={`/product/${product.id}`} className="block">
                  <div className="aspect-video bg-gray-900 relative overflow-hidden">
                    {product.image ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">No Image</div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-white mb-2 line-clamp-2" title={product.name}>{product.name || 'Untitled Product'}</h3>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-sm text-gray-400">Current Price</p>
                        <p className="text-xl font-bold text-blue-400">
                          {product.currency} {product.current_price}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      handleDelete(product.id)
                    }}
                    className="p-2 bg-red-500/80 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <AddProductModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onAdd={handleAddProduct}
        />
      </div>
    </div>
  )
}
