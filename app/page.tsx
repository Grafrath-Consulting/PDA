import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const navItems = [
  {
    href: '/journal',
    label: 'Journal',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    href: '/people',
    label: 'People',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
]

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const displayName = user.user_metadata?.full_name ?? user.email

  return (
    <div className="flex h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <span className="text-lg font-semibold text-gray-900 tracking-tight">PDA</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <span className="text-gray-400">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-indigo-700">
                {(user.user_metadata?.full_name ?? user.email ?? '?')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{displayName}</p>
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-6">
          <h1 className="text-sm font-medium text-gray-900">Good to have you back, {displayName?.split(' ')[0] ?? 'there'}.</h1>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
            {/* Welcome card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Welcome to PDA</h2>
              <p className="text-sm text-gray-500">
                Your personal productivity assistant. Use the sidebar to navigate to your journal, projects, tasks, and contacts.
              </p>
            </div>

            {/* Quick links grid */}
            <div className="grid grid-cols-2 gap-4">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:border-indigo-200 hover:shadow-md transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-gray-50 group-hover:bg-indigo-50 flex items-center justify-center mb-3 transition-colors">
                    <span className="text-gray-400 group-hover:text-indigo-500 transition-colors">{item.icon}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-800">{item.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Coming soon</p>
                </Link>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
