import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Save, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import ConfirmationModal from '../components/ConfirmationModal'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [loading, setLoading] = useState(true)
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

        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-2xl mb-8">
          <div className="grid md:grid-cols-2 gap-8 p-8">
            <div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative flex items-center justify-center">
              {product.image ? (
                <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
              ) : (
                <div className="text-gray-600">No Image</div>
              )}
            </div>
            
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold mb-2">{product.name}</h1>
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 flex items-center gap-2 text-sm"
                >
                  View on Store <ExternalLink size={14} />
                </a>
              </div>

              <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
                <p className="text-sm text-gray-400 mb-1">Current Price</p>
                <p className="text-4xl font-bold text-white">
                  {product.currency} {product.current_price}
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Monitoring Settings</h3>
                
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Target Price</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">{product.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full pl-12 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                      placeholder="0.00"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Monitor Until</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    value={monitoringUntil}
                    onChange={(e) => setMonitoringUntil(e.target.value)}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Save size={20} />
                    {saving ? 'Saving...' : 'Save Settings'}
                  </button>
                  <button
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="px-4 py-3 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/50 rounded-lg transition-colors"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
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
