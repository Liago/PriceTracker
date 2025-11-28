import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Save, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [targetPrice, setTargetPrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchProduct()
  }, [id])

  const fetchProduct = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single()
      
      if (error) throw error
      setProduct(data)
      setTargetPrice(data.target_price || '')
    } catch (error) {
      console.error('Error fetching product:', error)
      navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({ target_price: targetPrice ? parseFloat(targetPrice) : null })
        .eq('id', id)
      
      if (error) throw error
      alert('Settings saved!')
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this product?')) return
    
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

        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-2xl">
          <div className="grid md:grid-cols-2 gap-8 p-8">
            <div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative">
              {product.image ? (
                <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">No Image</div>
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
                  <p className="text-xs text-gray-500 mt-2">We'll notify you when the price drops below this amount.</p>
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
                    onClick={handleDelete}
                    className="px-4 py-3 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/50 rounded-lg transition-colors"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
