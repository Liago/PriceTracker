import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Trash2, Check, Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { NotificationRow } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { NumberTicker } from '../components/ui/number-ticker'
import { BlurFade } from '../components/ui/blur-fade'
import { cn } from '../lib/utils'

type Filter = 'all' | 'unread'

export default function Notifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all') // 'all', 'unread'

  const fetchNotifications = useCallback(async () => {
    if (!user) return
    let query = supabase
      .from('notifications')
      .select('*, products(name, image, url)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (filter === 'unread') {
      query = query.eq('read', false)
    }

    const { data, error } = await query

    if (!error) {
      setNotifications((data as NotificationRow[]) || [])
    }
    setLoading(false)
  }, [user, filter])

  useEffect(() => {
    const timer = setTimeout(fetchNotifications, 0)
    return () => clearTimeout(timer)
  }, [fetchNotifications])

  const chooseFilter = (value: Filter) => {
    if (value === filter) return
    setLoading(true)
    setFilter(value)
  }

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const deleteNotification = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  const markAllRead = async () => {
    if (!user) return
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const deleteAllRead = async () => {
    if (!user) return
    // Delete all read notifications
    await supabase
      .from('notifications')
      .delete()
      .eq('user_id', user.id)
      .eq('read', true)

    setLoading(true)
    fetchNotifications()
  }

  if (!user) return <p className="p-8 text-center">Accedi per vedere le notifiche.</p>

  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="mx-auto max-w-3xl">
      <BlurFade>
        <p className="border-b border-border pb-3 text-label text-muted-foreground">
          Notifiche · {user.email}
        </p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-serif text-title">
            {filter === 'unread' ? 'Notifiche da leggere' : 'Tutte le notifiche'}
          </h1>
          {!loading && (
            <p className="text-label text-muted-foreground">
              <span className="text-heading font-medium text-foreground"><NumberTicker value={unread} /></span> da leggere
            </p>
          )}
        </div>
      </BlurFade>

      <BlurFade delay={0.05}>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-fit rounded-[10px] border border-border bg-soft p-1" role="group" aria-label="Filtro">
            {(['all', 'unread'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  'pressable relative cursor-pointer rounded-[7px] px-4 py-1.5 text-label font-medium transition-colors duration-150',
                  filter === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter === value && (
                  <motion.span
                    layoutId="notif-filter"
                    className="absolute inset-0 rounded-[7px] border border-border bg-card shadow-card"
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  />
                )}
                <span className="relative">{value === 'all' ? 'Tutte' : 'Da leggere'}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <Check size={15} aria-hidden="true" />
              Segna tutte come lette
            </Button>
            <Button variant="outline" size="sm" onClick={deleteAllRead} className="hover:border-bad hover:text-bad">
              <Trash2 size={15} aria-hidden="true" />
              Elimina le lette
            </Button>
          </div>
        </div>
      </BlurFade>

      <div className="mt-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[14px] bg-soft" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <Card className="flex flex-col items-center px-6 py-14 text-center">
            <Bell size={28} className="text-subtle" aria-hidden="true" />
            <h2 className="mt-3 font-serif text-heading">Nessuna notifica</h2>
            <p className="mt-2 max-w-sm text-muted-foreground">
              Ti avvisiamo qui quando il prezzo di un prodotto monitorato scende.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {notifications.map((notif, index) => (
                <motion.li
                  key={notif.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.25, delay: Math.min(index, 8) * 0.03, ease: [0.23, 1, 0.32, 1] } }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                >
                  <Card className={cn('group flex items-start gap-4 p-4', !notif.read && 'border-[color-mix(in_srgb,var(--clay)_40%,var(--line))]')}>
                    {notif.products?.image && (
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[10px] border border-border bg-white p-1">
                        <img src={notif.products.image} alt="" className="h-full w-full object-contain mix-blend-multiply" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="good">Calo di prezzo</Badge>
                        {!notif.read && <Badge tone="clay">Nuova</Badge>}
                      </div>
                      <Link
                        to={notif.products ? `/product/${notif.product_id}` : '#'}
                        className="mt-1.5 block rounded-md font-medium underline-offset-4 hover:underline"
                      >
                        {notif.products ? notif.products.name : 'Prodotto sconosciuto'}
                      </Link>
                      {notif.old_price && notif.new_price && (
                        <p className="mt-1 tabular-nums">
                          Da <span className="text-muted-foreground line-through">€{notif.old_price}</span> a{' '}
                          <strong className="text-heading font-medium">€{notif.new_price}</strong>
                        </p>
                      )}
                      <p className="mt-1 text-label text-subtle">{formatDateTime(notif.created_at)}</p>
                    </div>

                    <div className="flex shrink-0 flex-col gap-1.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 transition-opacity duration-150">
                      {!notif.read && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => markAsRead(notif.id)}
                          title="Segna come letta"
                          aria-label="Segna come letta"
                        >
                          <Check size={15} aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => deleteNotification(notif.id)}
                        title="Elimina"
                        aria-label="Elimina notifica"
                        className="hover:border-bad hover:text-bad"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </div>
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  )
}
