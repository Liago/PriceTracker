import { Link, NavLink } from 'react-router-dom'
import { LogOut, Settings, Plus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import NotificationBell from './NotificationBell'
import ThemeToggle from './ThemeToggle'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import logo from '../assets/logo.png'

interface HeaderProps {
  onAddProduct: () => void
}

/**
 * Barra in alto: marchio a sinistra, una sola azione principale in clay
 * ("Aggiungi prodotto"), poi le icone di servizio. L'email resta visibile da
 * tablet in su, così una schermata condivisa dice di chi è.
 */
export default function Header({ onAddProduct }: HeaderProps) {
  const { user, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-[10px]" aria-label="PriceTracker, vai ai prodotti">
          <img className="h-8 w-8 shrink-0 object-contain" src={logo} alt="" />
          <span className="hidden font-serif text-heading sm:block">PriceTracker</span>
        </Link>

        {user && (
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="mr-2 hidden max-w-[220px] truncate text-label text-muted-foreground lg:inline">{user.email}</span>

            <Button variant="main" size="md" onClick={onAddProduct} className="hidden md:inline-flex">
              <Plus size={18} aria-hidden="true" />
              Aggiungi prodotto
            </Button>
            <Button variant="main" size="icon" onClick={onAddProduct} className="md:hidden" aria-label="Aggiungi prodotto">
              <Plus size={20} aria-hidden="true" />
            </Button>

            <NotificationBell userId={user.id} />

            <NavLink
              to="/settings"
              title="Impostazioni"
              aria-label="Impostazioni"
              className={({ isActive }) =>
                cn(
                  'pressable inline-flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors duration-150',
                  isActive ? 'bg-soft text-foreground' : 'text-muted-foreground hover:bg-soft hover:text-foreground',
                )
              }
            >
              <Settings size={20} aria-hidden="true" />
            </NavLink>

            <ThemeToggle />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut()}
              title="Esci"
              aria-label="Esci"
              className="hover:text-bad"
            >
              <LogOut size={20} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
