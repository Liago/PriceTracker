import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Save, Trash2, RefreshCw, List } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import ConfirmationModal from '../components/ConfirmationModal'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { scrapeProduct } from '../lib/api'
import { parsePrice } from '../lib/utils'

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [targetPrice, setTargetPrice] = useState('')
  const [monitoringUntil, setMonitoringUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

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
          details: data.details,
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
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Dashboard
        </button>

        <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl overflow-hidden border border-gray-700/50 shadow-2xl mb-8">
          <div className="grid md:grid-cols-2 gap-8 p-8">
            {/* Left Column: Image */}
            <div className="flex items-center justify-center bg-white/5 rounded-2xl p-8 shadow-inner">
              {product.image ? (
                <img 
                  src={product.image} 
                  alt={product.name} 
                  className="w-full h-auto max-h-[500px] object-contain drop-shadow-2xl hover:scale-105 transition-transform duration-300" 
                />
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

              <div className="stats shadow bg-gray-700/30 border border-gray-600/30 backdrop-blur-md">
                <div className="stat">
                  <div className="stat-title text-gray-400">Current Price</div>
                  <div className="stat-value text-primary text-4xl md:text-5xl">
                    {product.currency} {product.current_price}
                  </div>
                  {product.last_checked_at && (
                    <div className="stat-desc text-gray-500 mt-1">
                      Last check: {new Date(product.last_checked_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <div className="card bg-base-200/50 border border-white/5 p-6 rounded-2xl space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                  Monitoring Settings
                </h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text text-gray-400">Target Price</span>
                    </label>
                    <label className="input input-bordered flex items-center gap-2 bg-gray-900/50 border-gray-600 focus-within:border-blue-500">
                      <span className="text-gray-500">{product.currency}</span>
                      <input
                        type="number"
                        step="0.01"
                        className="grow"
                        placeholder="0.00"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text text-gray-400">Monitor Until</span>
                    </label>
                    <input
                      type="date"
                      className="input input-bordered w-full bg-gray-900/50 border-gray-600 focus-within:border-blue-500"
                      value={monitoringUntil}
                      onChange={(e) => setMonitoringUntil(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="btn btn-primary flex-1 gap-2"
                  >
                    <Save size={20} />
                    {saving ? 'Saving...' : 'Save Settings'}
                  </button>
                  <button
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="btn btn-error btn-outline"
                  >
                    <Trash2 size={20} />
                  </button>
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
      </div>
    </div>
  )
}
