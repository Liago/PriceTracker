import { useState } from 'react'
import { Flag, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { reportField } from '../lib/api'

/**
 * "Questo prezzo non è corretto".
 *
 * È il meccanismo di recupero per i casi che l'euristica sbaglia. Il valore
 * che l'utente indica non serve solo a correggere questo prodotto: mette in
 * dubbio la configurazione usata per l'intero dominio, che torna in fase di
 * scoperta invece di ripetere lo stesso errore.
 */
export default function PriceFeedbackButton({ productId, currentPrice }) {
  const [open, setOpen] = useState(false)
  const [expected, setExpected] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSending(true)
    try {
      await reportField({
        productId,
        field: 'price',
        reported: 'wrong',
        expectedValue: expected.trim() || null,
      })
      toast.success('Segnalazione inviata. Il prossimo controllo rianalizzerà la pagina.')
      setOpen(false)
      setExpected('')
    } catch (error) {
      toast.error(error.message || 'Invio della segnalazione fallito')
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <Flag size={12} aria-hidden="true" />
        Il prezzo non è corretto
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mt-2">
      <label className="text-xs text-gray-400" htmlFor="prezzo-corretto">
        Prezzo corretto
      </label>
      <input
        id="prezzo-corretto"
        type="text"
        inputMode="decimal"
        value={expected}
        onChange={(event) => setExpected(event.target.value)}
        placeholder={currentPrice ? String(currentPrice) : '249,90'}
        className="w-28 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
      />
      <button
        type="submit"
        disabled={sending}
        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {sending && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
        Invia
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 py-1 text-sm text-gray-400 hover:text-gray-200"
      >
        Annulla
      </button>
    </form>
  )
}
