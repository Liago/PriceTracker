import { useState, type FormEvent } from 'react'
import { Plus, Loader2, AlertCircle } from 'lucide-react'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import { Input, Label } from './ui/input'
import { errorMessage } from '../lib/api'

interface Props {
  isOpen: boolean
  onClose: () => void
  onAdd: (url: string) => Promise<void>
}

export default function AddProductModal({ isOpen, onClose, onAdd }: Props) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const close = () => {
    if (loading) return
    setError('')
    onClose()
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      await onAdd(url)
      setUrl('')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Aggiunta del prodotto fallita'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onClose={close} title="Monitora un nuovo prodotto" size="lg">
      <form onSubmit={handleSubmit} className="p-5">
        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-[10px] bg-bad-bg px-3 py-2.5 text-label text-bad">
            <AlertCircle size={16} className="mt-px shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <Label htmlFor="product-url">Link della pagina prodotto</Label>
        <Input
          id="product-url"
          type="url"
          required
          placeholder="https://amazon.com/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={loading}>
            Annulla
          </Button>
          <Button type="submit" variant="main" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            {loading ? 'Analisi in corso…' : 'Monitora prodotto'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
