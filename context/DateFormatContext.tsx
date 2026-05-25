'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DateFormatOption, TimeFormatOption } from '@/lib/date-format'

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  } catch {
    return 'America/Chicago'
  }
}

interface DateFormatContextValue {
  dateFormat: DateFormatOption
  timeFormat: TimeFormatOption
  timezone: string
  autoDetectTimezone: boolean
  setDateFormat: (fmt: DateFormatOption) => void
  setTimeFormat: (fmt: TimeFormatOption) => void
  setTimezone: (tz: string) => void
  setAutoDetectTimezone: (auto: boolean) => void
  /** Set when auto-detect just changed the saved zone; null when nothing to show. */
  tzNotice: string | null
  dismissTzNotice: () => void
}

const DateFormatContext = createContext<DateFormatContextValue>({
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  timezone: 'America/Chicago',
  autoDetectTimezone: true,
  setDateFormat: () => {},
  setTimeFormat: () => {},
  setTimezone: () => {},
  setAutoDetectTimezone: () => {},
  tzNotice: null,
  dismissTzNotice: () => {},
})

export function useDateFormat() {
  return useContext(DateFormatContext)
}

export function DateFormatProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [dateFormat, setDateFormatState] = useState<DateFormatOption>('MM/DD/YYYY')
  const [timeFormat, setTimeFormatState] = useState<TimeFormatOption>('12h')
  // Default to the browser's zone so formatting is sensible before the profile loads.
  const [timezone, setTimezoneState] = useState<string>(detectBrowserTimezone)
  const [autoDetectTimezone, setAutoDetectState] = useState<boolean>(true)
  const [tzNotice, setTzNotice] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('date_format, time_format, timezone, timezone_auto_detect')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.date_format) setDateFormatState(data.date_format as DateFormatOption)
        if (data?.time_format) setTimeFormatState(data.time_format as TimeFormatOption)

        const savedAuto = data?.timezone_auto_detect ?? true
        const savedTz = data?.timezone as string | undefined
        setAutoDetectState(savedAuto)

        if (savedAuto) {
          const detected = detectBrowserTimezone()
          setTimezoneState(detected)
          // If the detected zone differs from what's stored, persist it and notify.
          if (detected !== savedTz) {
            setTzNotice(detected)
            supabase.from('profiles').update({ timezone: detected }).eq('id', userId).then(() => {})
          }
        } else if (savedTz) {
          setTimezoneState(savedTz)
        }
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

  const setTimezone = useCallback((tz: string) => {
    setTimezoneState(tz)
    const supabase = createClient()
    supabase.from('profiles').update({ timezone: tz }).eq('id', userId).then(() => {})
  }, [userId])

  const setAutoDetectTimezone = useCallback((auto: boolean) => {
    setAutoDetectState(auto)
    const supabase = createClient()
    if (auto) {
      // Turning auto-detect on immediately adopts the browser's zone.
      const detected = detectBrowserTimezone()
      setTimezoneState(detected)
      supabase.from('profiles').update({ timezone_auto_detect: true, timezone: detected }).eq('id', userId).then(() => {})
    } else {
      supabase.from('profiles').update({ timezone_auto_detect: false }).eq('id', userId).then(() => {})
    }
  }, [userId])

  const dismissTzNotice = useCallback(() => setTzNotice(null), [])

  return (
    <DateFormatContext.Provider value={{
      dateFormat, timeFormat, timezone, autoDetectTimezone,
      setDateFormat, setTimeFormat, setTimezone, setAutoDetectTimezone,
      tzNotice, dismissTzNotice,
    }}>
      {children}
    </DateFormatContext.Provider>
  )
}
