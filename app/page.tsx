import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JournalPage } from './JournalPage'
import { WorkspaceProvider } from '@/context/WorkspaceContext'
import { PropertiesProvider } from '@/context/PropertiesContext'
import { DateFormatProvider } from '@/context/DateFormatContext'
import { ActionHistoryProvider } from '@/context/ActionHistoryContext'

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
          <ActionHistoryProvider>
            <div className="flex h-screen overflow-x-hidden bg-[#FFFEF7] font-[family-name:var(--font-geist-sans)]">
              <JournalPage userId={user.id} email={email} displayName={displayName} />
            </div>
          </ActionHistoryProvider>
        </DateFormatProvider>
      </PropertiesProvider>
    </WorkspaceProvider>
  )
}
