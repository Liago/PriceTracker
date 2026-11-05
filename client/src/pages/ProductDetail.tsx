import { useLiveRefresh } from '../lib/useLiveRefresh'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ExternalLink, Save, Trash2, RefreshCw, Maximize2, X, Calendar, AlertCircle, Loader2, ImageOff, Target } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import TrackingHealthBadge from '../components/TrackingHealthBadge'
import PriceFeedbackButton from '../components/PriceFeedbackButton'
import ConfirmationModal from '../components/ConfirmationModal'
import PriceHistoryChart from '../components/PriceHistoryChart'
import { errorMessage, refreshProduct } from '../lib/api'
import type { PricePoint, PriceHistoryRow, Product } from '../lib/types'
import { decimalsOf, formatDateTime, priceText, toNumber } from '../lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input, Label } from '../components/ui/input'
import { NumberTicker } from '../components/ui/number-ticker'
import { BlurFade } from '../components/ui/blur-fade'
import { cn } from '../lib/utils'

/**
 * Come sta la disponibilita' di un prodotto.
 *
 * Si legge da `products.availability`, che e' la colonna che il motore
 * aggiorna a ogni controllo. Prima si leggeva `details.available`, un booleano
 * che il vecchio scraper scriveva dentro il JSON dei dettagli e che il motore
 * nuovo non tocca piu': i prodotti aggiunti prima del refactor mostravano per
 * sempre lo stato del giorno in cui erano stati aggiunti. Una sedia disponibile
 * a 379,99 appariva «Currently Unavailable» perche' cosi' era stata letta a
 * novembre.
 *
 * L'altra meta' del problema era il booleano stesso. `unknown` - il motore non
 * e' riuscito a stabilirlo - non e' `false`, e mostrarlo come "esaurito"
 * significa affermare una cosa che nessuno ha verificato. Uno stato ignoto non
 * merita un'etichetta: si mostra il prezzo e basta.
 */
function readAvailability(product: Product | null): { unavailable: boolean; label: string | null } {
  switch (product?.availability) {
    case 'out_of_stock':
      return { unavailable: true, label: 'Non disponibile' }
    case 'discontinued':
      return { unavailable: true, label: 'Fuori produzione' }
    case 'preorder':
      return { unavailable: false, label: 'Preordine' }
    case 'backorder':
      return { unavailable: false, label: 'In riassortimento' }
    default:
      // in_stock, unknown, null: nessuna etichetta, nessuna affermazione.
      return { unavailable: false, label: null }
  }
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [targetPrice, setTargetPrice] = useState('')
  const [monitoringUntil, setMonitoringUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    fetchProductAndHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!isImageModalOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsImageModalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isImageModalOpen])

  useLiveRefresh('products', () => { void fetchProductAndHistory(true) }, `id=eq.${id}`)

  const fetchProductAndHistory = async (preserveSettings = false) => {
    try {
      // Fetch product details
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single()

      if (productError) throw productError
      const loaded = productData as Product
      setProduct(loaded)
      if (!preserveSettings) {
        setTargetPrice(loaded.target_price != null ? String(loaded.target_price) : '')
        setMonitoringUntil(loaded.monitoring_until || '')
      }

      // Fetch price history
      const { data: historyData, error: historyError } = await supabase
        .from('price_history')
        .select('*')
        .eq('product_id', id)
        .order('recorded_at', { ascending: true })

      if (historyError) throw historyError

      // Il tempo resta un numero fino al disegno. Formattarlo qui - com'era
      // prima - lo trasformava in una categoria per il grafico: due letture a
      // cinque minuti di distanza finivano lontane quanto due a una settimana,
      // e la forma della curva mentiva sui tempi.
      const formattedHistory = ((historyData as PriceHistoryRow[]) || [])
        .map((item) => ({
          price: Number(item.price),
          timestamp: new Date(item.recorded_at).getTime(),
          originalDate: item.recorded_at,
        }))
        .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.timestamp))

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
    if (!product?.id) return
    setRefreshing(true)

    try {
      // Il refresh passa dalla stessa validazione del controllo automatico:
      // un prezzo non attendibile non sovrascrive quello buono.
      const result = await refreshProduct(product.id)

      if (!result.accepted) {
        toast.warning('Aggiornato, ma il prezzo letto non è attendibile: resta quello precedente.')
      } else if (result.priceChanged) {
        toast.success(`Prezzo aggiornato: ${result.previousPrice} → ${result.price}`)
      } else {
        toast.success('Prodotto aggiornato, prezzo invariato.')
      }

      fetchProductAndHistory()
    } catch (error) {
      console.error('Errore durante l\'aggiornamento:', error)
      toast.error(errorMessage(error, 'Aggiornamento fallito'))
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
          monitoring_until: monitoringUntil || null,
        })
        .eq('id', id)

      if (error) throw error
      setProduct((prev) => (prev ? { ...prev, target_price: targetPrice ? parseFloat(targetPrice) : null, monitoring_until: monitoringUntil || null } : prev))
      toast.success('Impostazioni salvate')
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error('Salvataggio non riuscito')
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

  if (loading) return <DetailSkeleton />
  if (!product) return null

  const availability = readAvailability(product)
  const currency = product.currency || ''
  const currentPrice = toNumber(product.current_price)
  const target = toNumber(product.target_price)
  const atTarget = currentPrice !== null && target !== null && currentPrice <= target
  const features = product.details?.features ?? []
  const hasImage = Boolean(product.image) && !imageFailed

  return (
    <div>
      <BlurFade>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-md text-label text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Torna ai prodotti
          </Link>
          <span className="text-label text-muted-foreground">
            Ultimo prezzo verificato: {refreshing ? 'in corso…' : formatDateTime(product.last_success_at)}
          </span>
        </div>
      </BlurFade>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Immagine */}
        <BlurFade delay={0.04}>
          <Card className="group relative overflow-hidden">
            <div className={cn('relative flex aspect-square items-center justify-center p-8 sm:aspect-[4/3] lg:aspect-square', hasImage ? 'bg-white' : 'bg-soft')}>
              {hasImage ? (
                <button
                  type="button"
                  onClick={() => !refreshing && setIsImageModalOpen(true)}
                  className="flex h-full w-full cursor-zoom-in items-center justify-center rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-clay"
                  aria-label="Ingrandisci immagine"
                >
                  <img
                    src={product.image ?? undefined}
                    alt={product.name ?? ''}
                    onError={() => setImageFailed(true)}
                    className={cn(
                      'max-h-full max-w-full object-contain mix-blend-multiply transition-[opacity,transform] duration-300 ease-out',
                      refreshing && 'scale-95 opacity-40',
                    )}
                  />
                </button>
              ) : (
                <span className="flex flex-col items-center gap-2 text-label text-subtle">
                  <ImageOff size={28} aria-hidden="true" />
                  Nessuna immagine
                </span>
              )}
              {refreshing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={40} className="animate-spin text-clay" aria-label="Aggiornamento in corso" />
                </div>
              )}
              {hasImage && !refreshing && (
                <span className="pointer-events-none absolute right-4 bottom-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <Maximize2 size={16} aria-hidden="true" />
                </span>
              )}
            </div>
          </Card>
        </BlurFade>

        {/* Informazioni e prezzo */}
        <BlurFade delay={0.08}>
          <div className="flex flex-col gap-6">
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <Badge tone="neutral" className="uppercase tracking-wide">{product.store || 'Negozio sconosciuto'}</Badge>
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} title="Aggiorna i dati adesso">
                  {refreshing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
                  {refreshing ? 'Aggiornamento…' : 'Aggiorna ora'}
                </Button>
              </div>
              <h1 className="font-serif text-title">{product.name}</h1>
              {product.details?.variant && Object.keys(product.details.variant).length > 0 && (
                <p className="mt-2 text-label text-muted-foreground">
                  Configurazione monitorata: {Object.entries(product.details.variant).map(([key, value]) =>
                    `${({ storage: 'Memoria', color: 'Colore', grade: 'Condizione', batteryType: 'Batteria' } as Record<string, string>)[key] || key}: ${value}`,
                  ).join(' · ')}
                </p>
              )}

              <a
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline dark:text-clay"
              >
                Vedi sul negozio <ExternalLink size={15} aria-hidden="true" />
              </a>
            </div>

            <Card>
              <CardContent>
                <p className="text-label text-muted-foreground">Prezzo attuale</p>

                {refreshing ? (
                  <div className="mt-2 flex flex-col gap-2" aria-hidden="true">
                    <div className="h-10 w-48 animate-pulse rounded-[10px] bg-soft" />
                    <div className="h-4 w-56 animate-pulse rounded bg-soft" />
                  </div>
                ) : availability.unavailable ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-num font-medium whitespace-nowrap text-subtle tabular-nums line-through decoration-bad/60 decoration-2">
                      {currency} {priceText(product.current_price)}
                    </span>
                    <Badge tone="bad">
                      <AlertCircle size={13} aria-hidden="true" />
                      {availability.label}
                    </Badge>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-num font-medium whitespace-nowrap">
                      <span className="mr-1.5 align-baseline text-heading text-muted-foreground">{currency}</span>
                      {currentPrice !== null ? (
                        <NumberTicker
                          value={currentPrice}
                          decimalPlaces={decimalsOf(product.current_price)}
                          startValue={Math.floor(currentPrice * 0.9)}
                        />
                      ) : '—'}
                    </span>
                    {availability.label && <Badge tone="watch">{availability.label}</Badge>}
                    {atTarget && (
                      <Badge tone="good">
                        <Target size={13} aria-hidden="true" />
                        Obiettivo raggiunto
                      </Badge>
                    )}
                  </div>
                )}

                {/* Stato del tracking: distingue "prezzo fermo" da "non
                    riesco piu' a leggere questa pagina". */}
                <TrackingHealthBadge health={product.tracking_health} className="mt-4" />

                <div className="mt-3">
                  <PriceFeedbackButton productId={product.id} currentPrice={product.current_price} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quando avvisarti</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="target-price">Prezzo obiettivo</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-label font-medium text-subtle">
                        {currency}
                      </span>
                      <Input
                        id="target-price"
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        className={cn('tabular-nums', currency.length > 1 ? 'pl-14' : 'pl-8')}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="monitor-until">Monitora fino al</Label>
                    <div className="relative">
                      <Calendar size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" aria-hidden="true" />
                      <Input
                        id="monitor-until"
                        type="date"
                        value={monitoringUntil}
                        onChange={(e) => setMonitoringUntil(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex gap-2">
                  <Button variant="main" onClick={handleSaveSettings} disabled={saving} className="flex-1 justify-center">
                    {saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                    {saving ? 'Salvataggio…' : 'Salva'}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setIsDeleteModalOpen(true)}
                    title="Elimina prodotto"
                    aria-label="Elimina prodotto"
                    className="h-11 w-11 text-bad hover:border-bad hover:bg-bad-bg"
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </BlurFade>
      </div>

      {/* Price History Chart */}
      <BlurFade delay={0.12} inView>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Storico prezzi</CardTitle>
          </CardHeader>
          <CardContent>
            <PriceHistoryChart history={priceHistory} currency={currency} />
          </CardContent>
        </Card>
      </BlurFade>

      {/* Caratteristiche */}
      {(refreshing || features.length > 0) && (
        <BlurFade delay={0.04} inView>
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Caratteristiche</CardTitle>
            </CardHeader>
            <CardContent>
              {refreshing ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-hidden="true">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-5 w-full animate-pulse rounded bg-soft" />
                  ))}
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
                  {features.map((feature, index) => (
                    <li key={index} className="flex gap-3 leading-relaxed">
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </BlurFade>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Eliminare il prodotto?"
        message="Il prodotto e il suo storico prezzi vengono cancellati. Non si può annullare."
        confirmText="Elimina"
        isDanger
      />

      {/* Image Modal */}
      {createPortal(
        <AnimatePresence>
          {isImageModalOpen && product.image && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
              onClick={() => setIsImageModalOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label={product.name ?? 'Immagine prodotto'}
            >
              <button
                type="button"
                className="pressable absolute top-4 right-4 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors duration-150 hover:bg-white/20 hover:text-white"
                onClick={() => setIsImageModalOpen(false)}
                aria-label="Chiudi"
                autoFocus
              >
                <X size={24} aria-hidden="true" />
              </button>
              <motion.img
                src={product.image}
                alt={product.name ?? ''}
                className="max-h-[90vh] max-w-full rounded-[14px] bg-white object-contain p-4"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
                onClick={(e) => e.stopPropagation()}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Caricamento prodotto">
      <div className="h-5 w-40 animate-pulse rounded bg-soft" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="aspect-square animate-pulse rounded-[14px] bg-soft" />
        <div className="space-y-4">
          <div className="h-6 w-24 animate-pulse rounded-full bg-soft" />
          <div className="h-10 w-full animate-pulse rounded bg-soft" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-soft" />
          <div className="h-40 w-full animate-pulse rounded-[14px] bg-soft" />
          <div className="h-48 w-full animate-pulse rounded-[14px] bg-soft" />
        </div>
      </div>
    </div>
  )
}
