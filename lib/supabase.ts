import { createClient } from '@supabase/supabase-js'

// sessionStorage-backed client: session lives only for this tab
// closing tab = logged out; refreshing tab = stays logged in
export function createSupabaseBrowserClient() {
  const storage = typeof window !== 'undefined' ? {
    getItem: (key: string) => window.sessionStorage.getItem(key),
    setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
    removeItem: (key: string) => window.sessionStorage.removeItem(key),
  } : undefined

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { storage: storage as Storage, persistSession: true, autoRefreshToken: true } }
  )
}

// Server-side admin client (service role) — API routes only
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
