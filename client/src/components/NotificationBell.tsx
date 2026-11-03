import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Check, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { NotificationRow } from '../lib/types'
import { formatDate } from '../lib/format'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

/**
 * Campanella con le ultime 5 notifiche.
 *
 * Il pannello si apre dall'angolo in alto a destra, cioè dal bottone
 * (transform-origin legato al trigger), in 150 ms; si chiude più in fretta.
 * Il conteggio dei non letti è in clay: è l'unica cosa da guardare qui.
 */
export default function NotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const fetchNotifications = useCallback(async (isCancelled: () => boolean = () => false) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5)

    if (!error && data && !isCancelled()) {
      setNotifications(data as NotificationRow[])
      // Ideally count unread only, simplified here or fetch count separately
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false)
      if (!isCancelled()) setUnreadCount(count || 0)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    // Il primo caricamento parte dopo il commit, non dentro il render.
    const initial = setTimeout(() => fetchNotifications(() => cancelled), 0)

    // Subscribe to realtime changes
    const channel = supabase
      .channel('public:notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setNotifications((prev) => [payload.new as NotificationRow, ...prev])
        setUnreadCount((prev) => prev + 1)
      })
      .subscribe()

    return () => {
      cancelled = true
      clearTimeout(initial)
      supabase.removeChannel(channel)
    }
  }, [userId, fetchNotifications])

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: globalThis.MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  const markAsRead = async (id: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)

    if (!error) {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }
  }

  const deleteNotification = async (id: string, e: MouseEvent) => {
    e.stopPropagation()
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id)

    if (!error) {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }
  }

  const handleReadAll = async () => {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)

    setUnreadCount(0)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const label = unreadCount > 0 ? `Notifiche, ${unreadCount} da leggere` : 'Notifiche'

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={cn('relative', isOpen && 'bg-soft text-foreground')}
      >
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-label leading-none font-semibold text-primary-foreground tabular-nums ring-2 ring-background">
            {unreadCount}
          </span>
        )}
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            style={{ transformOrigin: 'top right' }}
            className="fixed top-16 right-3 left-3 z-50 overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_16px_40px_rgba(0,0,0,0.14)] sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-96"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="font-serif text-heading">Notifiche</h3>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={handleReadAll}>
                  <Check size={14} aria-hidden="true" />
                  Segna tutte come lette
                </Button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-muted-foreground">Nessuna notifica, per ora.</p>
              ) : (
                <ul>
                  {notifications.map((notif) => (
                    <li
                      key={notif.id}
                      className={cn(
                        'flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0',
                        !notif.read && 'bg-soft',
                      )}
                    >
                      <span
                        className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', notif.read ? 'bg-transparent' : 'bg-clay')}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        {notif.type === 'price_drop' && (
                          <Badge tone="good" className="mb-1">Calo di prezzo</Badge>
                        )}
                        <p className="text-body">
                          Da <span className="tabular-nums text-muted-foreground">€{notif.old_price}</span> a{' '}
                          <strong className="font-semibold tabular-nums">€{notif.new_price}</strong>
                        </p>
                        <span className="text-label text-subtle">{formatDate(notif.created_at)}</span>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        {!notif.read && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => markAsRead(notif.id)}
                            title="Segna come letta"
                            aria-label="Segna come letta"
                          >
                            <Check size={15} aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => deleteNotification(notif.id, e)}
                          title="Elimina"
                          aria-label="Elimina notifica"
                          className="hover:text-bad"
                        >
                          <X size={15} aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center text-primary dark:text-clay"
                onClick={() => {
                  setIsOpen(false)
                  navigate('/notifications')
                }}
              >
                Vedi tutte le notifiche
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
