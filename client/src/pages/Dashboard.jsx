import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Plus, Trash2, ExternalLink, LayoutGrid, List, Search, Filter, ArrowUpDown } from 'lucide-react'
import AddProductModal from '../components/AddProductModal'
import ConfirmationModal from '../components/ConfirmationModal'
import NotificationBell from '../components/NotificationBell'
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

  // Filter & Sort State
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStore, setSelectedStore] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')

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
        currency: data.currency,
        store: data.store,
        details: data.details
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

  // Derived State: Unique Stores
  const uniqueStores = useMemo(() => {
    const stores = products.map(p => p.store).filter(Boolean)
    return ['all', ...new Set(stores)]
  }, [products])

  // Derived State: Filtered & Sorted Products
  const filteredProducts = useMemo(() => {
    let result = [...products]

    // 1. Search
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase()
      result = result.filter(p => 
        p.name?.toLowerCase().includes(lowerTerm) || 
        p.store?.toLowerCase().includes(lowerTerm)
      )
    }

    // 2. Store Filter
    if (selectedStore !== 'all') {
      result = result.filter(p => p.store === selectedStore)
    }

    // 3. Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.created_at) - new Date(a.created_at)
        case 'date-asc':
          return new Date(a.created_at) - new Date(b.created_at)
        case 'price-asc':
          return a.current_price - b.current_price
        case 'price-desc':
          return b.current_price - a.current_price
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '')
        default:
          return 0
      }
    })

    return result
  }, [products, searchTerm, selectedStore, sortBy])

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          
          <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
            <span className="text-gray-400 hidden md:inline">{user?.email}</span>
            <div className="mr-2">
                <NotificationBell userId={user?.id} />
            </div>
            <Link
              to="/settings"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm"
            >
              Settings
            </Link>
            <button
              onClick={() => signOut()}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm"
            >
              Sign Out
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors text-sm ml-auto md:ml-0"
            >
              <Plus size={18} />
              <span className="hidden sm:inline">Add Product</span>
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="bg-gray-800 rounded-xl p-4 mb-8 border border-gray-700 flex flex-col md:flex-row gap-4 items-center justify-between">
          
          {/* Search */}
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search products..."
              className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3 w-full md:w-auto">
            {/* Store Filter */}
            <div className="relative flex-1 md:flex-none">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <select
                className="w-full md:w-40 pl-10 pr-8 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm appearance-none cursor-pointer"
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
              >
                <option value="all">All Stores</option>
                {uniqueStores.filter(s => s !== 'all').map(store => (
                  <option key={store} value={store}>{store}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="relative flex-1 md:flex-none">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <select
                className="w-full md:w-48 pl-10 pr-8 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm appearance-none cursor-pointer"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="date-desc">Newest First</option>
                <option value="date-asc">Oldest First</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name-asc">Name: A-Z</option>
              </select>
            </div>

            {/* View Toggle */}
            <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-600">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                title="Grid View"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                title="List View"
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
        
        {/* Product Grid/List */}
        <div className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {filteredProducts.length === 0 ? (
            <div className="col-span-full bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
              <p className="text-gray-400 py-12">
                {products.length === 0 
                  ? 'No products tracked yet. Click "Add Product" to start.' 
                  : 'No products match your filters.'}
              </p>
            </div>
          ) : (
            filteredProducts.map((product) => (
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
                    <div className="mb-2">
                      <span className="text-xs font-medium px-2 py-1 bg-gray-700 rounded text-gray-300 uppercase tracking-wider">
                        {product.store || 'Unknown Store'}
                      </span>
                    </div>
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
