import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

/** Refresh also on focus and once a minute if realtime isn't enabled. */
export function useLiveRefresh(table: string, refresh: () => void, filter?: string) {
  const current = useRef(refresh)
  useEffect(() => { current.current = refresh }, [refresh])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      if (document.visibilityState === 'hidden') return
      clearTimeout(timer)
      timer = setTimeout(() => current.current(), 200)
    }
    const channel = supabase.channel(`live:${table}:${filter ?? 'all'}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, update).subscribe()
    const interval = setInterval(update, 60000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearTimeout(timer); clearInterval(interval)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
      void supabase.removeChannel(channel)
    }
  }, [table, filter])
}
