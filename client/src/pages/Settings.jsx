import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ArrowLeft, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'

export default function Settings() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    price_check_interval: 6,
    scrape_delay: 2000,
    max_retries: 1,
    email_notifications: true
  })

  useEffect(() => {
    fetchSettings()
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
        price_check_interval: data.price_check_interval || 6,
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

  if (loading) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading...</div>

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

        <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl p-8">
          <h1 className="text-3xl font-bold mb-2">Settings</h1>
          <p className="text-gray-400 mb-8">Customize your price tracking preferences</p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Price Check Interval (hours)
              </label>
              <input
                type="number"
                min="1"
                max="24"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                value={settings.price_check_interval}
                onChange={(e) => setSettings({ ...settings, price_check_interval: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-2">How often to check product prices (minimum 1 hour, maximum 24 hours)</p>
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
