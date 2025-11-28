import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Plus, Trash2, ExternalLink, LayoutGrid, List } from 'lucide-react'
import AddProductModal from '../components/AddProductModal'
import ConfirmationModal from '../components/ConfirmationModal'
import { scrapeProduct } from '../lib/api'
import { supabase } from '../lib/supabase'
import { parsePrice } from '../lib/utils'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState('grid')
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteProductId, setDeleteProductId] = useState(null)

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
            <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <LayoutGrid size={20} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <List size={20} />
              </button>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus size={20} />
              <span className="hidden sm:inline">Add Product</span>
            </button>
            <div className="h-8 w-px bg-gray-700"></div>
            <span className="text-gray-400 hidden sm:inline">{user?.email}</span>
            <Link
              to="/settings"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Settings
            </Link>
            <button
              onClick={() => signOut()}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
        
        <div className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {products.length === 0 ? (
            <div className="col-span-full bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
              <p className="text-gray-400 py-12">No products tracked yet. Click "Add Product" to start.</p>
            </div>
          ) : (
            products.map((product) => (
              <div key={product.id} className={`bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-blue-500 transition-colors group relative ${viewMode === 'list' ? 'flex flex-row-reverse' : ''}`}>
                <Link to={`/product/${product.id}`} className={`block w-full ${viewMode === 'list' ? 'flex flex-row-reverse items-center justify-between p-4' : ''}`}>
                  <div className={`aspect-video bg-gray-900 relative overflow-hidden ${viewMode === 'list' ? 'w-32 h-24 rounded-lg shrink-0 ml-4' : ''}`}>
                    {product.image ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">No Image</div>
                    )}
                  </div>
                  <div className={`${viewMode === 'list' ? 'flex-1 min-w-0' : 'p-4'}`}>
                    <h3 className={`font-semibold text-white mb-2 line-clamp-2 ${viewMode === 'list' ? 'text-lg' : ''}`} title={product.name}>{product.name || 'Untitled Product'}</h3>
                    <div className={`${viewMode === 'list' ? 'flex gap-6' : 'space-y-3'}`}>
                      <div>
                        <p className="text-xs text-gray-400">Current Price</p>
                        <p className="text-lg font-bold text-blue-400">
                          {product.currency} {product.current_price}
                        </p>
                      </div>
                      {product.target_price && (
                        <div>
                          <p className="text-xs text-gray-400">Target Price</p>
                          <p className="text-lg font-semibold text-green-400">
                            {product.currency} {product.target_price}
                          </p>
                        </div>
                      )}
                    </div>
                    {(product.last_checked_at || product.monitoring_until) && (
                      <div className={`${viewMode === 'list' ? 'flex gap-4' : 'space-y-1'} mt-3 pt-3 border-t border-gray-700`}>
                        {product.last_checked_at && (
                          <div className="text-xs text-gray-500">
                            Last check: {new Date(product.last_checked_at).toLocaleDateString()}
                          </div>
                        )}
                        {product.monitoring_until && (
                          <div className="text-xs text-gray-500">
                            Until: {new Date(product.monitoring_until).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
                <div className={`absolute ${viewMode === 'list' ? 'top-4 right-4' : 'top-2 right-2'} opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      setDeleteProductId(product.id)
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

        <ConfirmationModal
          isOpen={deleteProductId !== null}
          onClose={() => setDeleteProductId(null)}
          onConfirm={() => {
            handleDelete(deleteProductId)
            setDeleteProductId(null)
          }}
          title="Delete Product"
          message="Are you sure you want to delete this product from your tracking list?"
          confirmText="Delete"
          isDanger
        />
      </div>
    </div>
  )
}
