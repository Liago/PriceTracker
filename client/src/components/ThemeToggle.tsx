import { AnimatePresence, motion } from 'motion/react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { Button } from './ui/button'

/**
 * Switch chiaro/scuro nell'angolo. L'icona ruota e sfuma in 200 ms; con
 * "riduci movimento" resta solo la dissolvenza (MotionConfig in App).
 */
export default function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const isDark = resolved === 'dark'
  const label = isDark ? 'Passa al tema chiaro' : 'Passa al tema scuro'

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label} className="relative overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={resolved}
          className="flex"
          initial={{ opacity: 0, rotate: -45, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 45, scale: 0.8 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {isDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}
