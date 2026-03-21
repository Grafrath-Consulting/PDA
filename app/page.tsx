import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/Sidebar'
import { JournalPage } from './JournalPage'
import { WorkspaceProvider } from '@/context/WorkspaceContext'
import { PropertiesProvider } from '@/context/PropertiesContext'
import { DateFormatProvider } from '@/context/DateFormatContext'

export default async function Journal() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const displayName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? ''
  const email = user.email ?? ''

  return (
    <WorkspaceProvider userId={user.id}>
      <PropertiesProvider userId={user.id}>
        <DateFormatProvider userId={user.id}>
          <div className="flex h-screen bg-[#FFFEF7] font-[family-name:var(--font-geist-sans)]">
            <Sidebar email={email} displayName={displayName} userId={user.id} />
            <JournalPage userId={user.id} />
          </div>
        </DateFormatProvider>
      </PropertiesProvider>
    </WorkspaceProvider>
  )
}
