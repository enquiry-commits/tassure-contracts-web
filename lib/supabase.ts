import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Override setAll to strip maxAge — makes cookies session-only
        // (survive page refresh, cleared when browser closes)
        set(name, value, options) {
          const { maxAge: _, expires: __, ...rest } = options ?? {}
          document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax${rest.secure ? '; Secure' : ''}`
        },
      },
    }
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
