import { describe, it, expect } from 'vitest'
import { getScheduleDescription } from './cron'

// Stub translator: returns key if no vars, or "key:JSON" if vars provided
const t = (key: string, vars?: Record<string, string | number>): string =>
  vars ? `${key}:${JSON.stringify(vars)}` : key

describe('getScheduleDescription', () => {
  it('interval minutes branch returns everyN key with value and unit', () => {
    const result = getScheduleDescription('interval', 30, 'minutes', '09:00', [], 1, 1, t)
    expect(result).toBe('schedule.desc.everyN:{"value":30,"unit":"schedule.unit.minutes"}')
  })

  it('interval hours branch returns everyN key with hours unit', () => {
    const result = getScheduleDescription('interval', 2, 'hours', '09:00', [], 1, 1, t)
    expect(result).toBe('schedule.desc.everyN:{"value":2,"unit":"schedule.unit.hours"}')
  })

  it('daily branch returns dailyAt key with time', () => {
    const result = getScheduleDescription('daily', 30, 'minutes', '09:00', [], 1, 1, t)
    expect(result).toBe('schedule.desc.dailyAt:{"time":"09:00"}')
  })

  it('weekly branch with weekInterval 1 returns weekly key with day names and time', () => {
    const result = getScheduleDescription('weekly', 30, 'minutes', '09:00', [1, 3], 1, 1, t)
    // value 1 = Mon -> labelKey 'schedule.weekday.short.mon'
    // value 3 = Wed -> labelKey 'schedule.weekday.short.wed'
    const days = 'schedule.weekday.short.mon, schedule.weekday.short.wed'
    expect(result).toBe(`schedule.desc.weekly:${JSON.stringify({ days, time: '09:00' })}`)
  })

  it('weekly branch with weekInterval > 1 returns weeklyEveryN key', () => {
    const result = getScheduleDescription('weekly', 30, 'minutes', '09:00', [1], 2, 1, t)
    expect(result).toBe(
      `schedule.desc.weeklyEveryN:${JSON.stringify({ n: 2, days: 'schedule.weekday.short.mon', time: '09:00' })}`
    )
  })

  it('monthly branch returns monthly key with day and time', () => {
    const result = getScheduleDescription('monthly', 30, 'minutes', '09:00', [], 1, 15, t)
    expect(result).toBe('schedule.desc.monthly:{"day":15,"time":"09:00"}')
  })
})
