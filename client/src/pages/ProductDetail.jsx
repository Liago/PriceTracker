import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Save, Trash2, RefreshCw, List, Maximize2, X, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import NotificationBell from '../components/NotificationBell'
import ConfirmationModal from '../components/ConfirmationModal'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { scrapeProduct } from '../lib/api'
import { parsePrice } from '../lib/utils'

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [product, setProduct] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [targetPrice, setTargetPrice] = useState('')
  const [monitoringUntil, setMonitoringUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)

  useEffect(() => {
    fetchProductAndHistory()
  }, [id])

  const fetchProductAndHistory = async () => {
    try {
      // Fetch product details
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single()
      
      if (productError) throw productError
      setProduct(productData)
      setTargetPrice(productData.target_price || '')
      setMonitoringUntil(productData.monitoring_until || '')

      // Fetch price history
      const { data: historyData, error: historyError } = await supabase
        .from('price_history')
        .select('*')
        .eq('product_id', id)
        .order('recorded_at', { ascending: true })

      if (historyError) throw historyError
      
      // Format history for chart
      const formattedHistory = historyData.map(item => ({
        price: Number(item.price),
        date: new Date(item.recorded_at).toLocaleDateString(undefined, { 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        originalDate: item.recorded_at
      }))
      
      setPriceHistory(formattedHistory)

    } catch (error) {
      console.error('Error fetching data:', error)
      // If product not found, redirect. If history fails, just show empty chart.
      if (!product) navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    if (!product?.url) return
    setRefreshing(true)
    
    try {
      // 1. Scrape fresh data
      const data = await scrapeProduct(product.url)
      const newPrice = parsePrice(data.price, data.currency)
      const oldPrice = product.current_price
      const priceChanged = Math.abs(newPrice - oldPrice) > 0.01

      // 2. Update product in DB
      const { error: updateError } = await supabase
        .from('products')
        .update({
          current_price: newPrice,
          store: data.store,
          details: { ...product.details, ...data.details, available: data.available },
          image: data.image, // Update image if changed
          last_checked_at: new Date().toISOString()
        })
        .eq('id', id)

      if (updateError) throw updateError

      // 3. If price changed, add to history
      if (priceChanged) {
        const { error: historyError } = await supabase
          .from('price_history')
          .insert({
            product_id: id,
            price: newPrice
          })
        
        if (historyError) throw historyError
        toast.success(`Price updated! ${oldPrice} -> ${newPrice}`)
      } else {
        toast.success('Product data refreshed!')
      }

      // 4. Reload data
      fetchProductAndHistory()

    } catch (error) {
      console.error('Error refreshing product:', error)
      toast.error('Failed to refresh product data')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({ 
          target_price: targetPrice ? parseFloat(targetPrice) : null,
          monitoring_until: monitoringUntil || null
        })
        .eq('id', id)
      
      if (error) throw error
      toast.success('Settings saved!')
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
      navigate('/')
    } catch (error) {
      console.error('Error deleting product:', error)
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading...</div>
  if (!product) return null

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
            <ArrowLeft size={20} />
            Back to Dashboard
            </button>
            <div className="mr-8">
                 <NotificationBell userId={user?.id} />
            </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl overflow-hidden border border-gray-700/50 shadow-2xl mb-8">
          <div className="grid md:grid-cols-2 gap-8 p-8">
            {/* Left Column: Image */}
            <div className="flex items-center justify-center bg-white/5 rounded-2xl p-8 shadow-inner relative group">
              {product.image ? (
                <>
                  <img 
                    src={product.image} 
                    alt={product.name} 
                    className="w-full h-auto max-h-[500px] object-contain drop-shadow-2xl transition-transform duration-300 group-hover:scale-105 cursor-zoom-in"
                    onClick={() => setIsImageModalOpen(true)}
                  />
                  <button 
                    onClick={() => setIsImageModalOpen(true)}
                    className="absolute bottom-4 right-4 p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-2 group-hover:translate-y-0"
                  >
                    <Maximize2 size={20} />
                  </button>
                </>
              ) : (
                <div className="text-gray-600">No Image</div>
              )}
            </div>
            
            {/* Right Column: Info & Actions */}
            <div className="space-y-8 flex flex-col justify-center">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className="badge badge-primary badge-lg uppercase tracking-wider font-bold">
                    {product.store || 'Unknown Store'}
                  </span>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`btn btn-circle btn-ghost btn-sm ${refreshing ? 'loading' : ''}`}
                    title="Refresh Data"
                  >
                    {!refreshing && <RefreshCw size={18} />}
                  </button>
                </div>
                <h1 className="text-3xl md:text-4xl font-extrabold mb-4 leading-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                  {product.name}
                </h1>
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-link text-blue-400 hover:text-blue-300 no-underline pl-0 flex items-center gap-2"
                >
                  View on Store <ExternalLink size={16} />
                </a>
              </div>

              <div className="stats shadow bg-gray-800/40 border border-gray-700/50 backdrop-blur-md overflow-visible">
                <div className="stat relative">
                  <div className="stat-title text-gray-400 font-medium tracking-wide uppercase text-xs mb-1">Current Price</div>
                  
                  {product.details?.available === false ? (
                    <div className="flex flex-col">
                      <div className="text-3xl md:text-4xl font-bold text-gray-500 line-through decoration-red-500/50 decoration-2">
                        {product.currency} {product.current_price}
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-red-400 bg-red-400/10 px-3 py-1 rounded-full w-fit">
                        <AlertCircle size={16} />
                        <span className="text-sm font-bold uppercase tracking-wide">Currently Unavailable</span>
                      </div>
                    </div>
                  ) : (
                    <div className="stat-value text-primary text-4xl md:text-6xl font-black tracking-tight">
                      <span className="text-2xl align-top opacity-60 mr-1">{product.currency}</span>
                      {product.current_price}
                    </div>
                  )}

                  {product.last_checked_at && (
                    <div className="stat-desc text-gray-500 mt-3 flex items-center gap-1.5">
                      <RefreshCw size={12} />
                      Last check: {new Date(product.last_checked_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <div className="card bg-gradient-to-br from-gray-800/80 to-gray-900/80 border border-gray-700/50 p-6 rounded-2xl shadow-xl">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-6 text-white/90">
                  <div className="p-1.5 bg-blue-500/20 rounded-lg text-blue-400">
                    <RefreshCw size={18} />
                  </div>
                  Monitoring Settings
                </h3>
                
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="form-control group">
                      <label className="label pt-0">
                        <span className="label-text text-gray-400 font-medium text-xs uppercase tracking-wider group-focus-within:text-blue-400 transition-colors">Target Price</span>
                      </label>
                      <label className="input input-bordered flex items-center gap-3 bg-gray-900/50 border-gray-700 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all h-12">
                        <span className="text-gray-500 font-bold">{product.currency}</span>
                        <input
                          type="number"
                          step="0.01"
                          className="grow font-mono text-lg bg-transparent"
                          placeholder="0.00"
                          value={targetPrice}
                          onChange={(e) => setTargetPrice(e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="form-control group">
                      <label className="label pt-0">
                        <span className="label-text text-gray-400 font-medium text-xs uppercase tracking-wider group-focus-within:text-blue-400 transition-colors">Monitor Until</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                          <Calendar size={18} />
                        </div>
                        <input
                          type="date"
                          className="input input-bordered w-full pl-10 bg-gray-900/50 border-gray-700 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all h-12 text-gray-200 [color-scheme:dark]"
                          value={monitoringUntil}
                          onChange={(e) => setMonitoringUntil(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleSaveSettings}
                      disabled={saving}
                      className="btn btn-primary flex-1 gap-2 h-12 text-base font-bold shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 border-none bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 transition-all"
                    >
                      {saving ? (
                        <>
                          <span className="loading loading-spinner loading-sm"></span>
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save size={18} />
                          Save Changes
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="btn btn-error btn-outline h-12 w-12 p-0 flex items-center justify-center border-red-500/30 hover:bg-red-500/10 hover:border-red-500 text-red-500"
                      title="Delete Product"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full Width Description / Features Section */}
          {product.details?.features && product.details.features.length > 0 && (
            <div className="border-t border-gray-700/50 bg-gray-800/30 p-8 md:p-12">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <List size={24} className="text-blue-500" />
                Key Features & Description
              </h3>
              <div className="prose prose-invert max-w-none">
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 text-lg text-gray-300 leading-relaxed list-disc pl-6">
                  {product.details.features.map((feature, index) => (
                    <li key={index} className="pl-2">{feature}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Price History Chart */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl p-8">
          <h2 className="text-xl font-bold mb-6">Price History</h2>
          <div className="h-[300px] w-full">
            {priceHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9CA3AF" 
                    tick={{ fill: '#9CA3AF' }}
                    tickMargin={10}
                  />
                  <YAxis 
                    stroke="#9CA3AF" 
                    tick={{ fill: '#9CA3AF' }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="price" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    dot={{ fill: '#3B82F6', strokeWidth: 2 }}
                    activeDot={{ r: 8 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                No price history available yet.
              </div>
            )}
          </div>
        </div>

        <ConfirmationModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={handleDelete}
          title="Delete Product"
          message="Are you sure you want to delete this product? This action cannot be undone."
          confirmText="Delete"
          isDanger
        />

        {/* Image Modal */}
        {isImageModalOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => setIsImageModalOpen(false)}
          >
            <button 
              className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
              onClick={() => setIsImageModalOpen(false)}
            >
              <X size={32} />
            </button>
            <img 
              src={product.image} 
              alt={product.name} 
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  )
}
