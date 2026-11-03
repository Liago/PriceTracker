import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Flag, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reportField } from '../lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'

/**
 * "Questo prezzo non è corretto".
 *
 * È il meccanismo di recupero per i casi che l'euristica sbaglia. Il valore
 * che l'utente indica non serve solo a correggere questo prodotto: mette in
 * dubbio la configurazione usata per l'intero dominio, che torna in fase di
 * scoperta invece di ripetere lo stesso errore.
 */
interface Props {
  productId: string
  currentPrice: number | string | null
}

export default function PriceFeedbackButton({ productId, currentPrice }: Props) {
  const [open, setOpen] = useState(false)
  const [expected, setExpected] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
      toast.error(errorMessage(error, 'Invio della segnalazione fallito'))
    } finally {
      setSending(false)
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!open ? (
        <motion.button
          key="trigger"
          type="button"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-label text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
        >
          <Flag size={13} aria-hidden="true" />
          Il prezzo non è corretto
        </motion.button>
      ) : (
        <motion.form
          key="form"
          onSubmit={submit}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="flex flex-wrap items-center gap-2"
        >
          <label className="text-label text-muted-foreground" htmlFor="prezzo-corretto">
            Prezzo corretto
          </label>
          <Input
            id="prezzo-corretto"
            type="text"
            inputMode="decimal"
            autoFocus
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            placeholder={currentPrice ? String(currentPrice) : '249,90'}
            className="h-9 w-28 tabular-nums"
          />
          <Button type="submit" variant="main" size="sm" disabled={sending}>
            {sending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            Invia
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Annulla
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  )
}
