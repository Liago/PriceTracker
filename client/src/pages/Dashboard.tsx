import { useLiveRefresh } from '../lib/useLiveRefresh'
import { useState, useEffect, useMemo, useCallback, type MouseEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { motion } from 'motion/react'
import { Plus, Trash2, LayoutGrid, List, Search, Store, ArrowUpDown, ChevronDown, ImageOff, Target } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import ConfirmationModal from '../components/ConfirmationModal'
import { supabase } from '../lib/supabase'
import TrackingHealthBadge, { needsAttention } from '../components/TrackingHealthBadge'
import type { LayoutContext } from '../components/Layout'
import type { Product, TrackingHealth } from '../lib/types'
import { formatDate, priceText, toNumber } from '../lib/format'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input, Select } from '../components/ui/input'
import { NumberTicker } from '../components/ui/number-ticker'
import { BlurFade } from '../components/ui/blur-fade'
import { cn } from '../lib/utils'

type ViewMode = 'grid' | 'list'
type SortKey = 'date-desc' | 'date-asc' | 'price-asc' | 'price-desc' | 'name-asc'

/** Le colonne leggere che servono ai numeri in alto e all'elenco dei negozi. */
interface SummaryRow {
  id: string
  store: string | null
  current_price: number | string | null
  target_price: number | string | null
  tracking_health: TrackingHealth | null
}

const PAGE_SIZE = 12

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem('viewMode') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/** Il prezzo attuale è uguale o sotto l'obiettivo che l'utente ha fissato. */
function reachedTarget(row: Pick<SummaryRow, 'current_price' | 'target_price'>): boolean {
  const current = toNumber(row.current_price)
  const target = toNumber(row.target_price)
  return current !== null && target !== null && current <= target
}

export default function Dashboard() {
  const { user } = useAuth()
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)

  useEffect(() => {
    try {
      localStorage.setItem('viewMode', viewMode)
    } catch {
      // Preferenza solo per questa sessione.
    }
  }, [viewMode])

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null)

  // Context from Layout for refresh trigger
  const outlet = useOutletContext<LayoutContext | undefined>()
  const refreshTrigger = outlet?.refreshTrigger ?? 0

  // Filter & Sort State
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStore, setSelectedStore] = useState('all')
  const [sortBy, setSortBy] = useState<SortKey>('date-desc')

  // Pagination State
  const [page, setPage] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)

  useEffect(() => {
    // Reset page when filters change
    setPage(1)
  }, [searchTerm, selectedStore, sortBy])

  const fetchProducts = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })

      if (searchTerm) query = query.ilike('name', `%${searchTerm}%`)
      if (selectedStore !== 'all') query = query.eq('store', selectedStore)

      switch (sortBy) {
        case 'date-desc': query = query.order('created_at', { ascending: false }); break
        case 'date-asc': query = query.order('created_at', { ascending: true }); break
        case 'price-asc': query = query.order('current_price', { ascending: true }); break
        case 'price-desc': query = query.order('current_price', { ascending: false }); break
        case 'name-asc': query = query.order('name', { ascending: true }); break
        default: query = query.order('created_at', { ascending: false })
      }

      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data, error, count } = await query.range(from, to)

      if (error) throw error
      setProducts((data as Product[]) || [])
      setTotalProducts(count || 0)
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [user, page, searchTerm, selectedStore, sortBy])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts, refreshTrigger])

  // Una sola lettura leggera di tutti i prodotti: da qui escono sia l'elenco
  // dei negozi per il filtro (come prima) sia i quattro numeri in alto.
  const [liveVersion, setLiveVersion] = useState(0)
  useLiveRefresh('products', () => { void fetchProducts(); setLiveVersion(v => v + 1) })
  const [summary, setSummary] = useState<SummaryRow[]>([])
  useEffect(() => {
    const fetchSummary = async () => {
      const { data } = await supabase
        .from('products')
        .select('id, store, current_price, target_price, tracking_health')
      setSummary((data as SummaryRow[]) || [])
    }
    fetchSummary()
  }, [refreshTrigger, liveVersion]) // Background checks refresh totals too

  const uniqueStores = useMemo(
    () => [...new Set(summary.map((p) => p.store).filter((s): s is string => Boolean(s)))],
    [summary],
  )

  const stats = useMemo(() => ({
    tracked: summary.length,
    atTarget: summary.filter(reachedTarget).length,
    attention: summary.filter((row) => needsAttention(row.tracking_health)).length,
    stores: uniqueStores.length,
  }), [summary, uniqueStores])

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (!error) {
      setProducts((prev) => prev.filter((p) => p.id !== id))
      setSummary((prev) => prev.filter((p) => p.id !== id))
      setTotalProducts((prev) => Math.max(0, prev - 1))
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE))
  const isFiltered = searchTerm !== '' || selectedStore !== 'all'

  // Il titolo dice il punto, ed è vero per i dati che ha sotto.
  const headline = stats.tracked === 0
    ? 'Inizia a monitorare un prodotto'
    : stats.attention > 0
      ? 'Alcuni prodotti non si leggono bene'
      : stats.atTarget > 0
        ? 'Alcuni prezzi hanno raggiunto il tuo obiettivo'
        : 'I tuoi prezzi sono sotto controllo'

  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div>
      <BlurFade>
        <p className="border-b border-border pb-3 text-label text-muted-foreground">
          Prodotti monitorati · {user?.email} · {today}
        </p>
        <h1 className="mt-5 font-serif text-title">{headline}</h1>
      </BlurFade>

      {/* I quattro numeri che contano, in alto. */}
      <BlurFade delay={0.05}>
        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Prodotti monitorati" value={stats.tracked} />
          <StatTile label="Al prezzo obiettivo" value={stats.atTarget} tone={stats.atTarget > 0 ? 'good' : undefined} />
          <StatTile label="Da verificare" value={stats.attention} tone={stats.attention > 0 ? 'watch' : undefined} />
          <StatTile label="Negozi" value={stats.stores} />
        </dl>
      </BlurFade>

      {/* Ricerca, filtri e vista. */}
      <BlurFade delay={0.1}>
        <Card className="mt-6 flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between md:gap-3">
          <div className="flex w-full gap-2 md:max-w-xs">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" size={18} aria-hidden="true" />
              <Input
                type="search"
                placeholder="Cerca un prodotto"
                aria-label="Cerca un prodotto"
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <ViewToggle id="mobile" viewMode={viewMode} setViewMode={setViewMode} className="md:hidden" />
          </div>

          <div className="grid grid-cols-2 gap-2 md:flex">
            <SelectField icon={<Store size={16} aria-hidden="true" />} className="min-w-0 md:w-44">
              <Select aria-label="Negozio" value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="pl-9">
                <option value="all">Tutti i negozi</option>
                {uniqueStores.map((store) => (
                  <option key={store} value={store}>{store}</option>
                ))}
              </Select>
            </SelectField>

            <SelectField icon={<ArrowUpDown size={16} aria-hidden="true" />} className="min-w-0 md:w-52">
              <Select aria-label="Ordina per" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className="pl-9">
                <option value="date-desc">Più recenti</option>
                <option value="date-asc">Meno recenti</option>
                <option value="price-asc">Prezzo crescente</option>
                <option value="price-desc">Prezzo decrescente</option>
                <option value="name-asc">Nome A-Z</option>
              </Select>
            </SelectField>

            <ViewToggle id="desktop" viewMode={viewMode} setViewMode={setViewMode} className="hidden md:flex" />
          </div>
        </Card>
      </BlurFade>

      {/* Prodotti */}
      <div
        className={cn(
          'mt-6 grid gap-4 transition-opacity duration-200',
          viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1',
          loading && loadedOnce && 'opacity-60',
        )}
        aria-busy={loading}
      >
        {!loadedOnce ? (
          Array.from({ length: 6 }, (_, i) => <ProductSkeleton key={i} viewMode={viewMode} />)
        ) : products.length === 0 ? (
          <Card className="col-span-full flex flex-col items-center px-6 py-14 text-center">
            {isFiltered ? (
              <>
                <h2 className="font-serif text-heading">Nessun prodotto corrisponde ai filtri</h2>
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => {
                    setSearchTerm('')
                    setSelectedStore('all')
                  }}
                >
                  Togli i filtri
                </Button>
              </>
            ) : (
              <>
                <h2 className="font-serif text-heading">Non stai ancora monitorando nessun prodotto</h2>
                <p className="mt-2 max-w-md text-muted-foreground">
                  Incolla il link di una pagina prodotto: il prezzo viene controllato in automatico.
                </p>
                <Button variant="main" className="mt-5" onClick={() => outlet?.openAddProduct()}>
                  <Plus size={18} aria-hidden="true" />
                  Aggiungi il primo prodotto
                </Button>
              </>
            )}
          </Card>
        ) : (
          products.map((product, index) => (
            <BlurFade key={product.id} delay={0.12 + Math.min(index, 8) * 0.04}>
              <ProductCard product={product} viewMode={viewMode} onDelete={() => setDeleteProductId(product.id)} />
            </BlurFade>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      {totalProducts > 0 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagine">
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            Precedente
          </Button>
          <span className="px-2 text-label text-muted-foreground tabular-nums">
            Pagina {page} di {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={page * PAGE_SIZE >= totalProducts || loading}
          >
            Successiva
          </Button>
        </nav>
      )}

      <ConfirmationModal
        isOpen={deleteProductId !== null}
        onClose={() => setDeleteProductId(null)}
        onConfirm={() => {
          if (deleteProductId) handleDelete(deleteProductId)
          setDeleteProductId(null)
        }}
        title="Eliminare il prodotto?"
        message="Il prodotto esce dall'elenco e il suo storico prezzi viene cancellato."
        confirmText="Elimina"
        isDanger
      />
    </div>
  )
}

/* ------------------------------------------------------------------------ */

function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'watch' }) {
  return (
    <Card className="px-5 py-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className={cn('mt-2 text-num font-medium', tone === 'good' && 'text-good', tone === 'watch' && 'text-watch')}>
        <NumberTicker value={value} />
      </dd>
    </Card>
  )
}

function SelectField({ icon, className, children }: { icon: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle">{icon}</span>
      {children}
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-subtle" size={16} aria-hidden="true" />
    </div>
  )
}

function ViewToggle({ id, viewMode, setViewMode, className }: { id: string; viewMode: ViewMode; setViewMode: (mode: ViewMode) => void; className?: string }) {
  return (
    <div className={cn('flex shrink-0 rounded-[10px] border border-border bg-soft p-1', className)} role="group" aria-label="Vista">
      <ViewButton active={viewMode === 'grid'} onClick={() => setViewMode('grid')} label="Griglia" layoutId={`view-mode-${id}`}>
        <LayoutGrid size={18} aria-hidden="true" />
      </ViewButton>
      <ViewButton active={viewMode === 'list'} onClick={() => setViewMode('list')} label="Elenco" layoutId={`view-mode-${id}`}>
        <List size={18} aria-hidden="true" />
      </ViewButton>
    </div>
  )
}

function ViewButton({ active, onClick, label, layoutId, children }: { active: boolean; onClick: () => void; label: string; layoutId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'pressable relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-[7px] transition-colors duration-150',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-0 rounded-[7px] border border-border bg-card shadow-card"
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        />
      )}
      <span className="relative">{children}</span>
    </button>
  )
}

function ProductImage({ product, className }: { product: Product; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden', product.image && !failed ? 'bg-white' : 'bg-soft', className)}>
      {product.image && !failed ? (
        <img
          src={product.image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-3 mix-blend-multiply"
        />
      ) : (
        <span className="flex flex-col items-center gap-1 text-label text-subtle">
          <ImageOff size={20} aria-hidden="true" />
          Nessuna immagine
        </span>
      )}
    </div>
  )
}

function ProductCard({ product, viewMode, onDelete }: { product: Product; viewMode: ViewMode; onDelete: () => void }) {
  const isList = viewMode === 'list'
  const currency = product.currency ?? ''
  const hasTarget = toNumber(product.target_price) !== null
  const atTarget = reachedTarget(product)
  const showHealth = product.tracking_health && product.tracking_health !== 'healthy'

  const remove = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDelete()
  }

  return (
    <Card
      className={cn(
        'group relative h-full overflow-hidden transition-[border-color,box-shadow] duration-150 ease-out',
        'hover:border-[color-mix(in_srgb,var(--clay)_45%,var(--line))] focus-within:border-[color-mix(in_srgb,var(--clay)_45%,var(--line))]',
      )}
    >
      <Link
        to={`/product/${product.id}`}
        className={cn('flex h-full rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-clay', isList ? 'flex-row items-stretch' : 'flex-col')}
      >
        <ProductImage
          product={product}
          className={cn(isList ? 'w-28 shrink-0 border-r border-border sm:w-36' : 'aspect-video border-b border-border')}
        />

        <div className={cn('flex min-w-0 flex-1 flex-col p-4', isList && 'sm:flex-row sm:items-center sm:gap-6')}>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-1.5 pr-8">
              <Badge tone="neutral" className="uppercase tracking-wide">
                <span className="truncate">{product.store || 'Negozio sconosciuto'}</span>
              </Badge>
              {showHealth && <TrackingHealthBadge health={product.tracking_health} compact />}
              {atTarget && (
                <Badge tone="good">
                  <Target size={13} aria-hidden="true" />
                  Obiettivo raggiunto
                </Badge>
              )}
            </div>
            <h3 className="line-clamp-2 font-sans text-body font-medium" title={product.name ?? undefined}>
              {product.name || 'Prodotto senza nome'}
            </h3>
          </div>

          <div className={cn('mt-4 flex flex-wrap items-end gap-x-6 gap-y-2', isList && 'sm:mt-0 sm:shrink-0')}>
            <div>
              <p className="text-label text-muted-foreground">Prezzo attuale</p>
              <p className="text-heading font-medium tabular-nums whitespace-nowrap">
                {currency} {priceText(product.current_price)}
              </p>
            </div>
            {hasTarget && (
              <div>
                <p className="text-label text-muted-foreground">Obiettivo</p>
                <p className={cn('text-heading tabular-nums whitespace-nowrap', atTarget ? 'text-good' : 'text-muted-foreground')}>
                  {currency} {priceText(product.target_price)}
                </p>
              </div>
            )}
          </div>

          {(product.last_checked_at || product.monitoring_until) && (
            <p className={cn('mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-label text-subtle', isList && 'sm:hidden')}>
              {product.last_checked_at && <span>Ultimo controllo: {formatDate(product.last_checked_at)}</span>}
              {product.monitoring_until && <span>Fino al: {formatDate(product.monitoring_until)}</span>}
            </p>
          )}
          {isList && (product.last_checked_at || product.monitoring_until) && (
            <p className="hidden shrink-0 flex-col gap-1 text-label text-subtle sm:flex">
              {product.last_checked_at && <span>Ultimo controllo: {formatDate(product.last_checked_at)}</span>}
              {product.monitoring_until && <span>Fino al: {formatDate(product.monitoring_until)}</span>}
            </p>
          )}
        </div>
      </Link>

      <Button
        variant="outline"
        size="icon-sm"
        onClick={remove}
        aria-label={`Elimina ${product.name || 'prodotto'}`}
        title="Elimina"
        className={cn(
          'absolute top-3 right-3 z-10 text-muted-foreground hover:border-bad hover:text-bad',
          // Su desktop compare al passaggio; sul touch resta sempre visibile.
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100',
          'transition-[opacity,transform,color,border-color] duration-150',
          isList && 'top-auto bottom-3',
        )}
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
    </Card>
  )
}

function ProductSkeleton({ viewMode }: { viewMode: ViewMode }) {
  const isList = viewMode === 'list'
  return (
    <Card className={cn('overflow-hidden', isList && 'flex')} aria-hidden="true">
      <div className={cn('animate-pulse bg-soft', isList ? 'h-28 w-36' : 'aspect-video')} />
      <div className="flex-1 space-y-3 p-4">
        <div className="h-5 w-24 animate-pulse rounded-full bg-soft" />
        <div className="h-4 w-full animate-pulse rounded bg-soft" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-soft" />
        <div className="h-7 w-28 animate-pulse rounded bg-soft" />
      </div>
    </Card>
  )
}
