import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

/**
 * Lo storico prezzi, leggibile.
 *
 * Il grafico precedente disegnava l'intera serie in trecento pixel, con un
 * pallino su ogni punto: dopo qualche mese di controlli ogni due ore, il
 * risultato non era un grafico ma una siepe. Nessuna delle informazioni che
 * uno storico prezzi dovrebbe dare - quando è cambiato, di quanto, quanto è
 * durato - era ancora leggibile.
 *
 * Due difetti, uno di forma e uno più profondo.
 *
 * Il primo: l'asse X usava la data GIÀ FORMATTATA come stringa, quindi per
 * Recharts era una categoria. Due letture a cinque minuti di distanza
 * occupavano lo stesso spazio di due a una settimana, e la forma della curva
 * mentiva sui tempi. Qui l'asse è temporale davvero (`type="number"`,
 * `scale="time"`), così la distanza orizzontale è tempo.
 *
 * Il secondo: non c'era modo di guardare un pezzo. La finestra è ora uno stato
 * esplicito, che si sposta con i pulsanti, le frecce della tastiera, il
 * trascinamento e la rotella. L'ampiezza si sceglie dai preset.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Le ampiezze che si scelgono davvero. `null` significa tutto lo storico. */
const PRESETS = [
  { id: '7d', label: '7 giorni', span: 7 * DAY_MS },
  { id: '30d', label: '30 giorni', span: 30 * DAY_MS },
  { id: '90d', label: '90 giorni', span: 90 * DAY_MS },
  { id: 'all', label: 'Tutto', span: null },
]

/**
 * Oltre questa densità i pallini smettono di essere marcatori e diventano
 * rumore - è quello che rendeva illeggibile il grafico precedente, che li
 * disegnava sempre.
 *
 * La soglia è tarata sul ritmo reale dei controlli: ogni due ore fanno 84
 * letture a settimana, e su una finestra di sette giorni i punti vanno visti.
 */
const DOTS_MAX_POINTS = 100

/** Quanto si sposta la finestra a ogni passo: mezza schermata, come uno scroll. */
const PAN_FRACTION = 0.5

const SURFACE = '#1F2937'
const SERIES = '#3B82F6'
const AXIS_INK = '#9CA3AF'
const GRID = '#374151'

/**
 * Il formato dell'asse deve avere la risoluzione dell'INTERVALLO FRA I TICCHI,
 * non quella della finestra.
 *
 * Sembra la stessa cosa e non lo e': su sette giorni ci stanno una decina di
 * tacche, cioe' piu' di una al giorno, e un formato "giorno e mese" le rende
 * come «Sep 3, Sep 3, Sep 4» - etichette diverse che dicono la stessa cosa.
 * Le fasce qui sotto sono scelte perche' a ciascuna corrisponda un'etichetta
 * che cambia a ogni tacca.
 */
function makeTickFormatter(span) {
  const options = span <= 2 * DAY_MS
    ? { hour: '2-digit', minute: '2-digit' }
    : span <= 14 * DAY_MS
      ? { day: 'numeric', month: 'short', hour: '2-digit' }
      : span <= 400 * DAY_MS
        ? { day: 'numeric', month: 'short' }
        : { month: 'short', year: '2-digit' }

  const format = new Intl.DateTimeFormat(undefined, options)
  return (value) => format.format(new Date(value))
}

const fullDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

/** Riporta una finestra dentro i limiti dei dati senza cambiarne l'ampiezza. */
function clampWindow({ start, end }, bounds) {
  const span = end - start
  const available = bounds.end - bounds.start

  if (span >= available) return { start: bounds.start, end: bounds.end }
  if (start < bounds.start) return { start: bounds.start, end: bounds.start + span }
  if (end > bounds.end) return { start: bounds.end - span, end: bounds.end }
  return { start, end }
}

/**
 * @param {object} props
 * @param {Array<{price: number, timestamp: number}>} props.history - ordinato per tempo
 * @param {string} [props.currency]
 */
export default function PriceHistoryChart({ history = [], currency = '' }) {
  const [presetId, setPresetId] = useState('30d')
  // La finestra esplicita esiste solo DOPO che il lettore l'ha spostata.
  // Finché è null, quella mostrata si ricava dal preset: è un valore derivato,
  // e tenerlo in stato sincronizzato da un effetto significherebbe due sorgenti
  // di verità per la stessa cosa, più un render in più a ogni cambio di dati.
  const [panned, setPanned] = useState(null)
  const frameRef = useRef(null)

  const bounds = useMemo(() => {
    if (history.length === 0) return null
    return { start: history[0].timestamp, end: history[history.length - 1].timestamp }
  }, [history])

  // Il preset fissa l'ampiezza e ancora la finestra alla fine: chi apre la
  // pagina vuole vedere gli ultimi prezzi, non i primi.
  const defaultWindow = useMemo(() => {
    if (!bounds) return null
    const span = PRESETS.find((preset) => preset.id === presetId)?.span
    if (!span || bounds.end - bounds.start <= span) return { start: bounds.start, end: bounds.end }
    return clampWindow({ start: bounds.end - span, end: bounds.end }, bounds)
  }, [presetId, bounds])

  // Il clamp si riapplica anche qui: i dati possono essere cambiati sotto una
  // finestra spostata, per esempio dopo un aggiornamento manuale del prezzo.
  const view = useMemo(() => {
    if (!bounds) return null
    return panned ? clampWindow(panned, bounds) : defaultWindow
  }, [panned, defaultWindow, bounds])

  const span = view ? view.end - view.start : 0

  const choosePreset = (id) => {
    setPresetId(id)
    setPanned(null)
  }

  const visible = useMemo(() => {
    if (!view) return []
    return history.filter((point) => point.timestamp >= view.start && point.timestamp <= view.end)
  }, [history, view])

  const atStart = !view || !bounds || view.start <= bounds.start
  const atEnd = !view || !bounds || view.end >= bounds.end
  const canPan = Boolean(bounds) && span < bounds.end - bounds.start

  const pan = useCallback((direction) => {
    if (!bounds || !view) return
    const step = Math.max((view.end - view.start) * PAN_FRACTION, 1)
    setPanned(clampWindow({
      start: view.start + direction * step,
      end: view.end + direction * step,
    }, bounds))
  }, [bounds, view])

  /** Trascinamento e rotella: lo scorrimento che ci si aspetta da un grafico. */
  useEffect(() => {
    const node = frameRef.current
    if (!node || !canPan || !view || !bounds) return

    // Il listener è registrato a mano perché serve non passivo: senza
    // preventDefault la rotella orizzontale scorrerebbe anche la pagina.
    const onWheel = (event) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (!horizontal && !event.shiftKey) return

      event.preventDefault()
      const delta = horizontal ? event.deltaX : event.deltaY
      const step = (view.end - view.start) * (delta / node.clientWidth)
      setPanned(clampWindow({ start: view.start + step, end: view.end + step }, bounds))
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [canPan, view, bounds])

  const dragRef = useRef(null)

  const onPointerDown = (event) => {
    if (!canPan || !view) return
    dragRef.current = { x: event.clientX, start: view.start, end: view.end }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || !bounds || !frameRef.current) return

    // Si trascina il contenuto, non la finestra: spostando il dito a destra si
    // va indietro nel tempo, come su una mappa.
    const ratio = (event.clientX - drag.x) / frameRef.current.clientWidth
    const step = (drag.end - drag.start) * ratio
    setPanned(clampWindow({ start: drag.start - step, end: drag.end - step }, bounds))
  }

  const endDrag = (event) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event) => {
    if (!canPan) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); pan(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); pan(1) }
    if (event.key === 'Home') { event.preventDefault(); setPanned(clampWindow({ start: bounds.start, end: bounds.start + span }, bounds)) }
    if (event.key === 'End') { event.preventDefault(); setPanned(clampWindow({ start: bounds.end - span, end: bounds.end }, bounds)) }
  }

  const tickFormatter = useMemo(() => makeTickFormatter(span), [span])

  const stats = useMemo(() => {
    if (visible.length === 0) return null
    const prices = visible.map((p) => p.price)
    return { min: Math.min(...prices), max: Math.max(...prices), count: visible.length }
  }, [visible])

  /**
   * L'asse verticale si stringe sui dati della finestra.
   *
   * Con `domain={['auto', 'auto']}` Recharts arrotondava fino a zero, e una
   * serie che oscilla fra 89 e 130 finiva schiacciata nel decimo inferiore del
   * grafico: tecnicamente corretta, praticamente una riga piatta. Un margine
   * del 5% sopra e sotto tiene la curva staccata dai bordi senza inventare
   * spazio vuoto.
   */
  const priceDomain = useMemo(() => {
    if (!stats) return ['auto', 'auto']
    const padding = Math.max((stats.max - stats.min) * 0.05, 1)
    return [Math.max(stats.min - padding, 0), stats.max + padding]
  }, [stats])

  if (history.length === 0) {
    return (
      <div className="h-[340px] flex items-center justify-center text-gray-500">
        Nessuno storico prezzi, per ora.
      </div>
    )
  }

  const showDots = visible.length <= DOTS_MAX_POINTS

  return (
    <div>
      {/* I controlli stanno sopra il grafico, in una riga sola. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 bg-gray-900/60 p-1 rounded-lg" role="group" aria-label="Intervallo">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => choosePreset(preset.id)}
              aria-pressed={presetId === preset.id}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                presetId === preset.id
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/60'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pan(-1)}
            disabled={!canPan || atStart}
            aria-label="Periodo precedente"
            className="p-2 rounded-lg text-gray-300 bg-gray-900/60 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => pan(1)}
            disabled={!canPan || atEnd}
            aria-label="Periodo successivo"
            className="p-2 rounded-lg text-gray-300 bg-gray-900/60 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Che cosa si sta guardando: senza, una finestra scorrevole disorienta. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 mb-3 text-sm">
        <span className="text-gray-400 tabular-nums">
          {view ? `${fullDate.format(new Date(view.start))} – ${fullDate.format(new Date(view.end))}` : ''}
        </span>
        {stats && (
          <span className="text-gray-500 tabular-nums">
            {stats.count} letture · min {currency} {stats.min.toFixed(2)} · max {currency} {stats.max.toFixed(2)}
          </span>
        )}
      </div>

      <div
        ref={frameRef}
        tabIndex={0}
        role="group"
        aria-label="Grafico dello storico prezzi. Frecce sinistra e destra per scorrere."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`h-[300px] w-full touch-pan-y select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          canPan ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            Nessuna lettura in questo periodo.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visible} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={[view.start, view.end]}
                allowDataOverflow
                tickFormatter={tickFormatter}
                stroke={AXIS_INK}
                tick={{ fill: AXIS_INK, fontSize: 12 }}
                tickMargin={10}
                minTickGap={72}
              />
              <YAxis
                stroke={AXIS_INK}
                tick={{ fill: AXIS_INK, fontSize: 12 }}
                width={56}
                domain={priceDomain}
                // Solo il numero: la valuta e' gia' scritta sopra il grafico e
                // nel tooltip. Ripeterla su ogni tacca allarga l'asse, manda a
                // capo l'etichetta e non aggiunge nulla - l'unita' di una scala
                // si dichiara una volta.
                tickFormatter={(value) => Math.round(value).toLocaleString()}
              />
              <Tooltip
                cursor={{ stroke: AXIS_INK, strokeWidth: 1 }}
                labelFormatter={(value) => fullDate.format(new Date(value))}
                formatter={(value) => [`${currency} ${Number(value).toFixed(2)}`, 'Prezzo']}
                contentStyle={{
                  backgroundColor: SURFACE,
                  border: `1px solid ${GRID}`,
                  borderRadius: '0.5rem',
                  color: '#fff',
                }}
                labelStyle={{ color: AXIS_INK, fontSize: 12, marginBottom: 4 }}
                itemStyle={{ color: '#fff', fontWeight: 600 }}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive={false}
                dot={showDots ? { r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 2 } : false}
                activeDot={{ r: 6, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {canPan && (
        <p className="mt-3 text-xs text-gray-500">
          Trascina il grafico per scorrere, o usa le frecce della tastiera dopo averlo selezionato.
        </p>
      )}
    </div>
  )
}
