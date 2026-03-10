import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/Sidebar'
import Link from 'next/link'

const sections = [
  { href: '/journal', label: 'Journal', description: 'Capture thoughts and extract actions', color: 'indigo' },
  { href: '/projects', label: 'Projects', description: 'Organise work into contexts', color: 'violet' },
  { href: '/tasks', label: 'Tasks', description: 'Track what needs doing', color: 'sky' },
  { href: '/people', label: 'People', description: 'Manage contacts and delegates', color: 'emerald' },
]

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const displayName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? ''
  const email = user.email ?? ''
  const firstName = displayName.split(' ')[0] || 'there'

  return (
    <div className="flex h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <Sidebar email={email} displayName={displayName} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-6">
          <h1 className="text-sm font-medium text-gray-900">Good to have you back, {firstName}.</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Welcome to PDA</h2>
              <p className="text-sm text-gray-500">
                Your personal productivity assistant. Start in the Journal to capture what&apos;s on your mind.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {sections.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:border-indigo-200 hover:shadow-md transition-all group"
                >
                  <p className="text-sm font-medium text-gray-800 mb-0.5">{s.label}</p>
                  <p className="text-xs text-gray-400">{s.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
