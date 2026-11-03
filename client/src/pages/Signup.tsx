import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../lib/api'
import AuthShell from './AuthShell'
import { Button } from '../components/ui/button'
import { Input, Label } from '../components/ui/input'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Le due password non coincidono')
      return
    }
    try {
      setError('')
      setLoading(true)
      const { error } = await signUp({ email, password })
      if (error) throw error
      navigate('/')
    } catch (error) {
      setError(errorMessage(error, 'Registrazione non riuscita'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Crea un account"
      error={error}
      footer={
        <>
          Hai già un account?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline dark:text-clay">
            Accedi
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="tu@esempio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="confirm-password">Conferma password</Label>
          <Input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <Button type="submit" variant="main" disabled={loading} className="w-full justify-center">
          {loading && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          {loading ? 'Creazione in corso…' : 'Registrati'}
        </Button>
      </form>
    </AuthShell>
  )
}
