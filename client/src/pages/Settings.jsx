import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ArrowLeft, Save, Trash2, Plus, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import NotificationBell from '../components/NotificationBell'

export default function Settings() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    price_check_interval: 360,
    scrape_delay: 2000,
    max_retries: 1,
    email_notifications: true
  })
  const [domains, setDomains] = useState([])
  const [newDomain, setNewDomain] = useState('')
  const [addingDomain, setAddingDomain] = useState(false)

  useEffect(() => {
    fetchSettings()
    fetchDomains()
  }, [user])

  const fetchSettings = async () => {
    try {
      let { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code === 'PGRST116') {
        // No settings found, create default
        const { data: newSettings, error: insertError } = await supabase
          .from('user_settings')
          .insert({ user_id: user.id })
          .select()
          .single()

        if (insertError) throw insertError
        data = newSettings
      } else if (error) {
        throw error
      }

      setSettings({
        price_check_interval: data.price_check_interval || 360,
        scrape_delay: data.scrape_delay || 2000,
        max_retries: data.max_retries || 1,
        email_notifications: data.email_notifications ?? true
      })
    } catch (error) {
      console.error('Error fetching settings:', error)
      toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({
          price_check_interval: parseInt(settings.price_check_interval),
          scrape_delay: parseInt(settings.scrape_delay),
          max_retries: parseInt(settings.max_retries),
          email_notifications: settings.email_notifications,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)

      if (error) throw error
      toast.success('Settings saved successfully!')
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const fetchDomains = async () => {
    try {
      const { data, error } = await supabase
        .from('supported_domains')
        .select('*')
        .order('domain')
      
      if (error) throw error
      setDomains(data || [])
    } catch (error) {
      console.error('Error fetching domains:', error)
    }
  }

  const handleAddDomain = async (e) => {
    e.preventDefault()
    if (!newDomain.trim()) return

    setAddingDomain(true)
    try {
      const { error } = await supabase
        .from('supported_domains')
        .insert({ domain: newDomain.trim() })

      if (error) {
        if (error.code === '23505') { // Unique violation
            toast.error('Domain already exists')
        } else {
            throw error
        }
        return
      }
      
      toast.success('Domain added successfully')
      setNewDomain('')
      fetchDomains()
    } catch (error) {
      console.error('Error adding domain:', error)
      toast.error('Failed to add domain')
    } finally {
      setAddingDomain(false)
    }
  }

  const handleDeleteDomain = async (id) => {
    try {
      const { error } = await supabase
        .from('supported_domains')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Domain removed')
      fetchDomains()
    } catch (error) {
      console.error('Error removing domain:', error)
      toast.error('Failed to remove domain')
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading...</div>

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

        <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl p-8">
          <h1 className="text-3xl font-bold mb-2">Settings</h1>
          <p className="text-gray-400 mb-8">Customize your price tracking preferences</p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Price Check Interval (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="10080"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                value={settings.price_check_interval}
                onChange={(e) => setSettings({ ...settings, price_check_interval: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-2">How often to check product prices (minimum 1 minute)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Scrape Delay (milliseconds)
              </label>
              <input
                type="number"
                min="1000"
                max="10000"
                step="500"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                value={settings.scrape_delay}
                onChange={(e) => setSettings({ ...settings, scrape_delay: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-2">Delay between checking each product (helps prevent rate limiting)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Max Retries
              </label>
              <input
                type="number"
                min="0"
                max="3"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                value={settings.max_retries}
                onChange={(e) => setSettings({ ...settings, max_retries: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-2">Number of retry attempts if scraping fails</p>
            </div>

            <div className="border-t border-gray-700 pt-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Globe size={20} className="text-blue-400" />
                Supported Stores
              </h2>
              
              <div className="space-y-4">
                <form onSubmit={handleAddDomain} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add new domain (e.g. ebay.it)"
                    className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={addingDomain || !newDomain.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                </form>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                  {domains.map((domain) => (
                    <div key={domain.id} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 p-3 rounded-lg group">
                      <span className="text-gray-300 text-sm font-mono">{domain.domain}</span>
                      <button
                        onClick={() => handleDeleteDomain(domain.id)}
                        className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                        title="Remove domain"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {domains.length === 0 && (
                    <p className="text-gray-500 text-sm italic text-center py-2">No domains configured. Using system defaults.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-6">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-2"
                  checked={settings.email_notifications}
                  onChange={(e) => setSettings({ ...settings, email_notifications: e.target.checked })}
                />
                <div>
                  <span className="text-sm font-medium text-gray-300">Email Notifications</span>
                  <p className="text-xs text-gray-500">Receive email alerts when prices drop below your target</p>
                </div>
              </label>
            </div>

            <div className="pt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Save size={20} />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
