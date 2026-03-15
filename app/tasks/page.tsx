import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/Sidebar'

export default async function TasksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const displayName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? ''
  const email = user.email ?? ''

  return (
    <div className="flex h-screen bg-[#FFFEF7] font-[family-name:var(--font-geist-sans)]">
      <Sidebar email={email} displayName={displayName} userId={user.id} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-[#E5E0D0] flex items-center px-6 flex-shrink-0">
          <h1 className="text-sm font-medium text-gray-900">Tasks</h1>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500">Coming soon</p>
            <p className="text-xs text-gray-400 mt-1">Tasks extracted from your journal will appear here, organised by type and status.</p>
          </div>
        </main>
      </div>
    </div>
  )
}
