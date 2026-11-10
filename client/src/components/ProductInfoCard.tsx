import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, Star } from 'lucide-react'
import type { Product, ProductRating, ProductSpec } from '../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

type Section = 'description' | 'features' | 'specs'

const SECTION_LABELS: Record<Section, string> = {
  description: 'Descrizione',
  features: 'Caratteristiche',
  specs: 'Specifiche',
}

/** Oltre questa lunghezza la descrizione si apre a richiesta. */
const DESCRIPTION_PREVIEW = 700
/** Specifiche visibili prima di "Mostra tutte". */
const SPECS_PREVIEW = 12

/** Le condizioni di schema.org, in italiano. */
const CONDITIONS: Record<string, string> = {
  NewCondition: 'Nuovo',
  RefurbishedCondition: 'Ricondizionato',
  UsedCondition: 'Usato',
  DamagedCondition: 'Danneggiato',
}

interface Fact {
  label: string
  value: string
}

/** I dati identificativi del prodotto: pochi, brevi, sempre in vista. */
function factsOf(product: Product): Fact[] {
  const details = product.details ?? {}
  const facts: Array<Fact | null> = [
    product.brand ? { label: 'Marca', value: product.brand } : null,
    product.sku ? { label: 'Codice articolo', value: product.sku } : null,
    product.gtin ? { label: 'EAN / GTIN', value: product.gtin } : null,
    details.seller ? { label: 'Venditore', value: details.seller } : null,
    details.condition ? { label: 'Condizione', value: CONDITIONS[details.condition] ?? details.condition } : null,
  ]
  return facts.filter((fact): fact is Fact => fact !== null)
}

/** Le specifiche raggruppate, nell'ordine in cui arrivano dalla pagina. */
function groupSpecs(specs: ProductSpec[]): Array<{ group: string | null; items: ProductSpec[] }> {
  const groups: Array<{ group: string | null; items: ProductSpec[] }> = []
  for (const spec of specs) {
    const group = spec.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.group === group) last.items.push(spec)
    else groups.push({ group, items: [spec] })
  }
  return groups
}

function formatCount(count: number): string {
  return new Intl.NumberFormat('it-IT').format(count)
}

function RatingStars({ rating }: { rating: ProductRating }) {
  const best = rating.best && rating.best > 0 ? rating.best : 5
  // Le valutazioni su scale diverse (10, 100) si riportano a cinque stelle.
  const outOfFive = Math.max(0, Math.min(5, (rating.value / best) * 5))
  const label = `${rating.value.toLocaleString('it-IT')} su ${best}`

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="relative inline-flex" role="img" aria-label={`Valutazione ${label}`}>
        <span className="flex gap-0.5 text-border" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <Star key={i} size={16} fill="currentColor" strokeWidth={0} />)}
        </span>
        <span
          className="absolute inset-y-0 left-0 flex gap-0.5 overflow-hidden text-clay"
          style={{ width: `${(outOfFive / 5) * 100}%` }}
          aria-hidden="true"
        >
          {Array.from({ length: 5 }, (_, i) => <Star key={i} size={16} fill="currentColor" strokeWidth={0} className="shrink-0" />)}
        </span>
      </span>
      <span className="font-medium tabular-nums">{label}</span>
      {rating.count != null && rating.count > 0 && (
        <span className="text-label text-muted-foreground tabular-nums">
          ({formatCount(rating.count)} {rating.count === 1 ? 'valutazione' : 'valutazioni'})
        </span>
      )}
    </span>
  )
}

function SectionPlaceholder() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-4 w-1/3 animate-pulse rounded bg-soft" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-5 w-full animate-pulse rounded bg-soft" />
      ))}
    </div>
  )
}

/**
 * Scheda prodotto: identificativi, valutazione, descrizione, caratteristiche
 * e specifiche tecniche.
 *
 * Mostra solo cio' che il negozio espone: se una sezione non c'e', la sua
 * linguetta non compare, e senza alcuna informazione la card non viene
 * disegnata affatto.
 */
export default function ProductInfoCard({ product, refreshing = false }: { product: Product; refreshing?: boolean }) {
  const details = product.details ?? {}
  const description = product.description?.trim() ?? ''
  const features = useMemo(() => details.features ?? [], [details.features])
  const specs = useMemo(() => details.specs ?? [], [details.specs])
  const breadcrumbs = details.breadcrumbs ?? []
  const rating = details.rating && Number.isFinite(details.rating.value) ? details.rating : null
  const facts = factsOf(product)

  const sections = useMemo(() => {
    const available: Section[] = []
    if (description) available.push('description')
    if (features.length > 0) available.push('features')
    if (specs.length > 0) available.push('specs')
    return available
  }, [description, features.length, specs.length])

  const [chosen, setChosen] = useState<Section | null>(null)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [allSpecs, setAllSpecs] = useState(false)

  // La sezione scelta puo' sparire dopo un aggiornamento: si torna alla prima.
  const active: Section | null = chosen && sections.includes(chosen) ? chosen : sections[0] ?? null

  const hasAnything = sections.length > 0 || facts.length > 0 || rating !== null || breadcrumbs.length > 0
  if (!hasAnything && !refreshing) return null

  const longDescription = description.length > DESCRIPTION_PREVIEW
  const visibleDescription = longDescription && !descriptionOpen
    ? `${description.slice(0, DESCRIPTION_PREVIEW).replace(/\s+\S*$/, '').replace(/[\s.,;:!?…-]+$/, '')}…`
    : description
  const visibleSpecs = allSpecs ? specs : specs.slice(0, SPECS_PREVIEW)

  return (
    <Card className="mt-6">
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Scheda prodotto</CardTitle>
        {breadcrumbs.length > 0 && (
          <nav aria-label="Categoria nel negozio" className="text-label text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-x-1.5">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 && <span aria-hidden="true" className="text-subtle">›</span>}
                  <span className={cn(index === breadcrumbs.length - 1 && 'text-foreground')}>{crumb}</span>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </CardHeader>

      <CardContent>
        {refreshing ? (
          <SectionPlaceholder />
        ) : (
          <>
            {(facts.length > 0 || rating) && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border pb-5 lg:grid-cols-3 lg:gap-x-8">
                {rating && (
                  <div className="col-span-2 lg:col-span-3">
                    <dt className="text-label text-muted-foreground">Valutazione dei clienti</dt>
                    <dd className="mt-1"><RatingStars rating={rating} /></dd>
                  </div>
                )}
                {facts.map((fact) => (
                  <div key={fact.label} className="min-w-0">
                    <dt className="text-label text-muted-foreground">{fact.label}</dt>
                    <dd className="mt-0.5 truncate font-medium" title={fact.value}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {sections.length > 0 && active && (
              <div className={cn((facts.length > 0 || rating) && 'pt-5')}>
                {sections.length > 1 && (
                  <div className="mb-5 flex w-full rounded-[10px] sm:w-fit border border-border bg-soft p-1" role="tablist" aria-label="Sezioni della scheda">
                    {sections.map((section) => (
                      <button
                        key={section}
                        type="button"
                        role="tab"
                        id={`product-tab-${section}`}
                        aria-selected={active === section}
                        aria-controls={`product-panel-${section}`}
                        onClick={() => setChosen(section)}
                        className={cn(
                          'pressable relative flex-1 cursor-pointer rounded-[7px] px-2 py-1.5 text-label font-medium whitespace-nowrap transition-colors duration-150 sm:flex-none sm:px-4',
                          active === section ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {active === section && (
                          <motion.span
                            layoutId="product-info-tab"
                            className="absolute inset-0 rounded-[7px] border border-border bg-card shadow-card"
                            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                          />
                        )}
                        <span className="relative">
                          {SECTION_LABELS[section]}
                          {section === 'features' && <span className="ml-1 hidden text-subtle tabular-nums min-[420px]:inline">{features.length}</span>}
                          {section === 'specs' && <span className="ml-1 hidden text-subtle tabular-nums min-[420px]:inline">{specs.length}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div
                  role={sections.length > 1 ? 'tabpanel' : undefined}
                  id={`product-panel-${active}`}
                  aria-labelledby={sections.length > 1 ? `product-tab-${active}` : undefined}
                >
                  {sections.length === 1 && (
                    <h3 className="mb-3 text-label font-medium text-muted-foreground">{SECTION_LABELS[active]}</h3>
                  )}

                  {active === 'description' && (
                    <div>
                      <p className="w-full leading-relaxed break-words whitespace-pre-line">{visibleDescription}</p>
                      {longDescription && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 -ml-2 text-primary dark:text-clay"
                          onClick={() => setDescriptionOpen((open) => !open)}
                          aria-expanded={descriptionOpen}
                        >
                          {descriptionOpen ? 'Mostra meno' : 'Leggi tutto'}
                          <ChevronDown size={15} aria-hidden="true" className={cn('transition-transform duration-150', descriptionOpen && 'rotate-180')} />
                        </Button>
                      )}
                    </div>
                  )}

                  {active === 'features' && (
                    <ul className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
                      {features.map((feature, index) => (
                        <li key={index} className="flex gap-3 leading-relaxed">
                          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" aria-hidden="true" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {active === 'specs' && (
                    <div>
                      {groupSpecs(visibleSpecs).map(({ group, items }, groupIndex) => (
                        <div key={`${group ?? 'specs'}-${groupIndex}`} className={cn(groupIndex > 0 && 'mt-5')}>
                          {group && <h4 className="mb-2 text-label font-medium text-muted-foreground">{group}</h4>}
                          <dl className="overflow-hidden rounded-[10px] border border-border">
                            {items.map((spec, index) => (
                              <div
                                key={`${spec.name}-${index}`}
                                className={cn(
                                  'grid grid-cols-1 gap-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6',
                                  index % 2 === 0 ? 'bg-soft' : 'bg-card',
                                )}
                              >
                                <dt className="text-label text-muted-foreground sm:text-body">{spec.name}</dt>
                                <dd className="font-medium break-words">{spec.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                      {specs.length > SPECS_PREVIEW && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-3 -ml-2 text-primary dark:text-clay"
                          onClick={() => setAllSpecs((open) => !open)}
                          aria-expanded={allSpecs}
                        >
                          {allSpecs ? 'Mostra meno' : `Mostra tutte (${specs.length})`}
                          <ChevronDown size={15} aria-hidden="true" className={cn('transition-transform duration-150', allSpecs && 'rotate-180')} />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {sections.length === 0 && facts.length === 0 && !rating && (
              <p className="text-muted-foreground">
                Il negozio non espone altri dettagli. Usa «Aggiorna ora» per riprovare a leggerli.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
