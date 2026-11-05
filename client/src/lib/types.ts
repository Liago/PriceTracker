/** Le righe di Supabase che il client legge davvero. */

export type TrackingHealth = 'healthy' | 'degraded' | 'broken' | 'blocked' | 'unknown'

export type Availability =
  | 'in_stock'
  | 'out_of_stock'
  | 'discontinued'
  | 'preorder'
  | 'backorder'
  | 'unknown'

export interface ProductDetails {
  features?: string[]
  variant?: Record<string, string>
  [key: string]: unknown
}

export interface Product {
  id: string
  user_id?: string
  url: string
  name: string | null
  image: string | null
  description?: string | null
  store: string | null
  currency: string | null
  current_price: number | string | null
  target_price: number | string | null
  monitoring_until: string | null
  last_checked_at: string | null
  last_success_at?: string | null
  created_at: string | null
  tracking_health: TrackingHealth | null
  availability: Availability | null
  details: ProductDetails | null
}

export interface PriceHistoryRow {
  id: string
  product_id: string
  price: number | string
  recorded_at: string
}

export interface PricePoint {
  price: number
  timestamp: number
  originalDate: string
}

export interface NotificationRow {
  id: string
  user_id: string
  product_id: string
  type: 'price_drop' | 'price_increase' | string
  old_price: number | string | null
  new_price: number | string | null
  read: boolean
  created_at: string
  products?: { name: string | null; image: string | null; url: string | null; currency?: string | null } | null
}

export interface UserSettings {
  price_check_interval: number | string
  scrape_delay: number | string
  max_retries: number | string
  email_notifications: boolean
}

export interface SupportedDomain {
  id: string
  domain: string
}
