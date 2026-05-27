import { NextResponse, type NextRequest } from 'next/server'

// Auth is handled client-side via sessionStorage (per-tab sessions)
export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
