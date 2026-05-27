import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return document.cookie.split('; ').filter(Boolean).map(c => {
            const [name, ...rest] = c.split('=')
            return { name, value: decodeURIComponent(rest.join('=')) }
          })
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const { maxAge: _, expires: __, ...rest } = options ?? {}
            const secure = (rest as { secure?: boolean }).secure ? '; Secure' : ''
            document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax${secure}`
          })
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
