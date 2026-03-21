'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DateFormatOption, TimeFormatOption } from '@/lib/date-format'

interface DateFormatContextValue {
  dateFormat: DateFormatOption
  timeFormat: TimeFormatOption
  setDateFormat: (fmt: DateFormatOption) => void
  setTimeFormat: (fmt: TimeFormatOption) => void
}

const DateFormatContext = createContext<DateFormatContextValue>({
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  setDateFormat: () => {},
  setTimeFormat: () => {},
})

export function useDateFormat() {
  return useContext(DateFormatContext)
}

export function DateFormatProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [dateFormat, setDateFormatState] = useState<DateFormatOption>('MM/DD/YYYY')
  const [timeFormat, setTimeFormatState] = useState<TimeFormatOption>('12h')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('date_format, time_format')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.date_format) setDateFormatState(data.date_format as DateFormatOption)
        if (data?.time_format) setTimeFormatState(data.time_format as TimeFormatOption)
      })
  }, [userId])

  const setDateFormat = useCallback((fmt: DateFormatOption) => {
    setDateFormatState(fmt)
    const supabase = createClient()
    supabase.from('profiles').update({ date_format: fmt }).eq('id', userId).then(() => {})
  }, [userId])

  const setTimeFormat = useCallback((fmt: TimeFormatOption) => {
    setTimeFormatState(fmt)
    const supabase = createClient()
    supabase.from('profiles').update({ time_format: fmt }).eq('id', userId).then(() => {})
  }, [userId])

  return (
    <DateFormatContext.Provider value={{ dateFormat, timeFormat, setDateFormat, setTimeFormat }}>
      {children}
    </DateFormatContext.Provider>
  )
}
