import { useNavigate, useLocation } from 'react-router-dom'
import { LogOut, Settings, Plus, ShoppingBag } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import NotificationBell from './NotificationBell'
import logo from '../assets/logo.png'

export default function Header({ onAddProduct }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <header className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur shadow-md border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center cursor-pointer" onClick={() => navigate('/')}>
            <img className="h-8 w-auto mr-3" src={logo} alt="PriceTracker" />
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent hidden sm:block">
              PriceTracker
            </span>
          </div>

          {/* Actions */}
          {user && (
            <div className="flex items-center space-x-2 md:space-x-4">
              <span className="text-gray-400 text-sm hidden md:inline">{user.email}</span>
              
              <div className="border-l border-gray-700 h-6 mx-2 hidden md:block"></div>

              {/* Add Product Button (Primary Action) */}
               <button
                onClick={onAddProduct}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium shadow-lg shadow-blue-900/20"
              >
                <Plus size={16} />
                <span>Add Product</span>
              </button>

              <button
                onClick={onAddProduct}
                className="flex md:hidden items-center justify-center p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus size={20} />
              </button>

              <NotificationBell userId={user.id} />

              <button
                onClick={() => navigate('/settings')}
                className={`p-2 rounded-lg transition-colors ${location.pathname === '/settings' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                title="Settings"
              >
                <Settings size={20} />
              </button>

              <button
                onClick={() => signOut()}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
                title="Sign Out"
              >
                <LogOut size={20} />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
