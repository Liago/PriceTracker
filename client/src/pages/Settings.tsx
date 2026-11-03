import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Save, Trash2, Plus, Globe, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { SupportedDomain, UserSettings } from '../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input, Label } from '../components/ui/input'
import { BlurFade } from '../components/ui/blur-fade'
import { cn } from '../lib/utils'

export default function Settings() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<UserSettings>({
    price_check_interval: 360,
    scrape_delay: 2000,
    max_retries: 1,
    email_notifications: true,
  })
  const [domains, setDomains] = useState<SupportedDomain[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [addingDomain, setAddingDomain] = useState(false)

  const fetchSettings = useCallback(async () => {
    if (!user) return
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
        error = null
      } else if (error) {
        throw error
      }

      setSettings({
        price_check_interval: data.price_check_interval || 360,
        scrape_delay: data.scrape_delay || 2000,
        max_retries: data.max_retries || 1,
        email_notifications: data.email_notifications ?? true,
      })
    } catch (error) {
      console.error('Error fetching settings:', error)
      toast.error('Impossibile caricare le impostazioni')
    } finally {
      setLoading(false)
    }
  }, [user])

  const fetchDomains = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('supported_domains')
        .select('*')
        .order('domain')

      if (error) throw error
      setDomains((data as SupportedDomain[]) || [])
    } catch (error) {
      console.error('Error fetching domains:', error)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchDomains()
  }, [fetchSettings, fetchDomains])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({
          price_check_interval: parseInt(String(settings.price_check_interval)),
          scrape_delay: parseInt(String(settings.scrape_delay)),
          max_retries: parseInt(String(settings.max_retries)),
          email_notifications: settings.email_notifications,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)

      if (error) throw error
      toast.success('Impostazioni salvate')
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error('Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  const handleAddDomain = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!newDomain.trim()) return

    setAddingDomain(true)
    try {
      const { error } = await supabase
        .from('supported_domains')
        .insert({ domain: newDomain.trim() })

      if (error) {
        if (error.code === '23505') { // Unique violation
          toast.error('Questo dominio è già nell\'elenco')
        } else {
          throw error
        }
        return
      }

      toast.success('Dominio aggiunto')
      setNewDomain('')
      fetchDomains()
    } catch (error) {
      console.error('Error adding domain:', error)
      toast.error('Aggiunta del dominio non riuscita')
    } finally {
      setAddingDomain(false)
    }
  }

  const handleDeleteDomain = async (id: string) => {
    try {
      const { error } = await supabase
        .from('supported_domains')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Dominio rimosso')
      fetchDomains()
    } catch (error) {
      console.error('Error removing domain:', error)
      toast.error('Rimozione del dominio non riuscita')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
        <div className="h-10 w-48 animate-pulse rounded bg-soft" />
        <div className="h-72 animate-pulse rounded-[14px] bg-soft" />
        <div className="h-56 animate-pulse rounded-[14px] bg-soft" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BlurFade>
        <p className="border-b border-border pb-3 text-label text-muted-foreground">Impostazioni · {user?.email}</p>
        <h1 className="mt-5 font-serif text-title">Come e quanto spesso controllare i prezzi</h1>
      </BlurFade>

      <BlurFade delay={0.05}>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Controlli</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <NumberField
              id="interval"
              label="Controlla i prezzi ogni (minuti)"
              hint="Minimo 1 minuto"
              min={1}
              max={10080}
              value={settings.price_check_interval}
              onChange={(value) => setSettings({ ...settings, price_check_interval: value })}
            />
            <NumberField
              id="delay"
              label="Pausa tra un prodotto e l'altro (millisecondi)"
              hint="Da 1000 a 10000: evita i blocchi dei negozi"
              min={1000}
              max={10000}
              step={500}
              value={settings.scrape_delay}
              onChange={(value) => setSettings({ ...settings, scrape_delay: value })}
            />
            <NumberField
              id="retries"
              label="Nuovi tentativi se la lettura fallisce"
              hint="Da 0 a 3"
              min={0}
              max={3}
              value={settings.max_retries}
              onChange={(value) => setSettings({ ...settings, max_retries: value })}
            />

            <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-border pt-5">
              <span>
                <span className="block font-medium">Avvisami per email</span>
                <span className="text-label text-muted-foreground">Quando un prezzo scende sotto il tuo obiettivo</span>
              </span>
              <Switch
                checked={settings.email_notifications}
                onChange={(checked) => setSettings({ ...settings, email_notifications: checked })}
              />
            </label>

            <Button variant="main" onClick={handleSave} disabled={saving} className="w-full justify-center">
              {saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
              {saving ? 'Salvataggio…' : 'Salva le impostazioni'}
            </Button>
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade delay={0.1}>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe size={20} className="text-clay" aria-hidden="true" />
              Negozi supportati
            </CardTitle>
            <span className="text-label text-muted-foreground tabular-nums">{domains.length} domini</span>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddDomain} className="flex gap-2">
              <Input
                type="text"
                placeholder="Nuovo dominio, per esempio ebay.it"
                aria-label="Nuovo dominio"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
              <Button type="submit" variant="outline" size="icon" disabled={addingDomain || !newDomain.trim()} aria-label="Aggiungi dominio" className="h-11 w-11">
                {addingDomain ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
              </Button>
            </form>

            {domains.length === 0 ? (
              <p className="mt-4 rounded-[10px] bg-soft px-4 py-3 text-center text-muted-foreground">
                Nessun dominio configurato: si usano quelli di sistema.
              </p>
            ) : (
              <ul className="mt-4 max-h-72 divide-y divide-border overflow-y-auto rounded-[10px] border border-border">
                <AnimatePresence initial={false}>
                  {domains.map((domain) => (
                    <motion.li
                      key={domain.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      className="group flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="truncate font-mono text-label">{domain.domain}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteDomain(domain.id)}
                        title="Rimuovi dominio"
                        aria-label={`Rimuovi ${domain.domain}`}
                        className="hover:text-bad [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </CardContent>
        </Card>
      </BlurFade>
    </div>
  )
}

interface NumberFieldProps {
  id: string
  label: string
  hint: string
  min: number
  max: number
  step?: number
  value: number | string
  onChange: (value: string) => void
}

function NumberField({ id, label, hint, min, max, step, value, onChange }: NumberFieldProps) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[1fr_160px] sm:items-center">
      <div>
        <Label htmlFor={id} className="mb-0 text-body font-medium text-foreground">{label}</Label>
        <p id={`${id}-hint`} className="text-label text-muted-foreground">{hint}</p>
      </div>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        aria-describedby={`${id}-hint`}
        className="tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** Interruttore accessibile (role="switch") con il pallino che scorre in 200 ms. */
function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-soft',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}
