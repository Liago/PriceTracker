import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'
import { Card } from '../components/ui/card'
import { BlurFade } from '../components/ui/blur-fade'
import logo from '../assets/logo.png'

/** La cornice comune di accesso e registrazione. */
export default function AuthShell({ title, error, children, footer }: {
  title: string
  error: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <BlurFade className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <img src={logo} alt="" className="h-9 w-9 object-contain" />
          <span className="font-serif text-heading">PriceTracker</span>
        </div>
        <Card className="p-6">
          <h1 className="font-serif text-title">{title}</h1>
          {error && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-[10px] bg-bad-bg px-3 py-2.5 text-label text-bad">
              <AlertCircle size={16} className="mt-px shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          <div className="mt-6">{children}</div>
        </Card>
        <p className="mt-6 text-center text-muted-foreground">{footer}</p>
      </BlurFade>
    </div>
  )
}
