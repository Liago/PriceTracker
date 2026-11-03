import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Ultima difesa: se un componente esplode, si mostra cosa è successo e un
 * modo per ripartire, nello stesso look del resto dell'app. Non usa
 * componenti dell'app, così funziona anche se è proprio uno di quelli a rompersi.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  handleReset = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md rounded-[14px] border border-border bg-card p-6 shadow-card">
            <h1 className="font-serif text-title">Qualcosa si è rotto</h1>
            <p className="mt-3 text-muted-foreground">Ricarica la pagina: i tuoi prodotti sono al sicuro.</p>
            {this.state.error && (
              <pre className="mt-4 max-h-40 overflow-auto rounded-[10px] bg-soft p-3 text-label whitespace-pre-wrap text-bad">
                {this.state.error.toString()}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="pressable mt-5 h-11 cursor-pointer rounded-[10px] bg-primary px-4 font-medium text-primary-foreground"
            >
              Ricarica la pagina
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
