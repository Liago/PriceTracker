import { AlertTriangle } from 'lucide-react'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'

interface Props {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDanger?: boolean
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Conferma',
  cancelText = 'Annulla',
  isDanger = false,
}: Props) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={
        <>
          {isDanger && <AlertTriangle className="shrink-0 text-bad" size={22} aria-hidden="true" />}
          {title}
        </>
      }
    >
      <div className="p-5">
        <p className="text-muted-foreground">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {cancelText}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'main'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
