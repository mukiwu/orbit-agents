
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import screenshot from '../assets/screenshot.png'
import screenshotLog from '../assets/screenshot-log.png'

import pkg from '../../../../package.json'

const LATEST_VERSION = pkg.version
const MAC_DOWNLOAD_URL = `https://github.com/mukiwu/orbit-agents/releases/download/v${LATEST_VERSION}/Orbit-Agents-${LATEST_VERSION}-arm64.dmg`
const WIN_DOWNLOAD_URL = `https://github.com/mukiwu/orbit-agents/releases/download/v${LATEST_VERSION}/Orbit-Agents-Setup-${LATEST_VERSION}.exe`
const WIN_ZIP_DOWNLOAD_URL = `https://github.com/mukiwu/orbit-agents/releases/download/v${LATEST_VERSION}/Orbit-Agents-${LATEST_VERSION}-x64-win.zip`
const GITHUB_URL = 'https://github.com/mukiwu/orbit-agents'

function detectPlatform(): 'mac' | 'windows' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('win')) return 'windows'
  return 'unknown'
}

const SLIDE_SOURCES = [
  { src: screenshot, altKey: 'welcome.slides.alt0' },
  { src: screenshotLog, altKey: 'welcome.slides.alt1' },
]

const STEP_META = [
  {
    number: '1',
    key: 'pickAI',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
    color: 'from-purple-500 to-indigo-500',
    bgColor: 'bg-purple-50',
    textColor: 'text-purple-600',
  },
  {
    number: '2',
    key: 'writePrompt',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-600',
  },
  {
    number: '3',
    key: 'setSchedule',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'from-emerald-500 to-teal-500',
    bgColor: 'bg-emerald-50',
    textColor: 'text-emerald-600',
  },
]

const FEATURE_META = [
  {
    key: 'smartScheduling',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    key: 'deepAI',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    key: 'executionLogs',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    key: 'emailNotifications',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    color: 'text-orange-600',
    bg: 'bg-orange-50',
  },
  {
    key: 'crossPlatform',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
  },
  {
    key: 'autoRetry',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
    color: 'text-red-600',
    bg: 'bg-red-50',
  },
]

const COMPARISON_KEYS = [
  'cost',
  'setup',
  'aiIntegration',
  'data',
  'platform',
  'sourceCode',
] as const

function ScreenshotSlider() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => setCurrent((i) => (i + 1) % SLIDE_SOURCES.length), [])
  const prev = useCallback(() => setCurrent((i) => (i - 1 + SLIDE_SOURCES.length) % SLIDE_SOURCES.length), [])

  // Auto-advance every 5 seconds
  useEffect(() => {
    const timer = setInterval(next, 5000)
    return () => clearInterval(timer)
  }, [next])

  return (
    <div className="mt-16 w-full max-w-5xl mx-auto">
      <div className="relative group">
        {/* Image container — fixed aspect ratio prevents layout shift */}
        <div className="rounded-xl overflow-hidden shadow-2xl ring-1 ring-gray-900/10 relative aspect-[16/10] bg-white">
          {SLIDE_SOURCES.map((slide, i) => (
            <img
              key={i}
              src={slide.src}
              alt={t(slide.altKey)}
              className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-500 ${
                i === current ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ))}
        </div>

        {/* Prev / Next arrows */}
        <button
          onClick={prev}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm shadow-lg ring-1 ring-black/5 flex items-center justify-center text-gray-600 hover:text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={t('welcome.screenshots.prev')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={next}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm shadow-lg ring-1 ring-black/5 flex items-center justify-center text-gray-600 hover:text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={t('welcome.screenshots.next')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2 mt-4">
        {SLIDE_SOURCES.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === current ? 'bg-blue-600 w-6' : 'bg-gray-300 hover:bg-gray-400'
            }`}
            aria-label={t('welcome.screenshots.goTo', { index: i + 1 })}
          />
        ))}
      </div>
    </div>
  )
}

export default function WelcomePage() {
  const { t } = useTranslation()
  const platform = useMemo(() => detectPlatform(), [])
  const primaryDownloadUrl = platform === 'windows' ? WIN_DOWNLOAD_URL : MAC_DOWNLOAD_URL

  const steps = useMemo(
    () =>
      STEP_META.map((s) => ({
        ...s,
        title: t(`welcome.steps.${s.key}.title`),
        description: t(`welcome.steps.${s.key}.desc`),
      })),
    [t]
  )

  const features = useMemo(
    () =>
      FEATURE_META.map((f) => ({
        ...f,
        title: t(`welcome.features.${f.key}.title`),
        description: t(`welcome.features.${f.key}.desc`),
      })),
    [t]
  )

  const comparison = useMemo(
    () =>
      COMPARISON_KEYS.map((key) => ({
        label: t(`welcome.comparison.${key}.label`),
        others: t(`welcome.comparison.${key}.others`),
        orbit: t(`welcome.comparison.${key}.orbit`),
      })),
    [t]
  )

  return (
    <div className="min-h-screen bg-[#F8F7F6] flex flex-col relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(#4b5563 1px, transparent 1px), linear-gradient(90deg, #4b5563 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }}
        />
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-cyan-200/20 rounded-full blur-[120px]" />
      </div>

      {/* ====== Header ====== */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-lg border-b border-gray-200/50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo + Name */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-white rounded-xl shadow-sm ring-1 ring-black/5">
              <svg className="w-7 h-7 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="3" className="fill-blue-600 stroke-none" />
                <path strokeWidth="1.5" strokeLinecap="round" className="opacity-80" d="M12 21c-4.97 0-9-4.03-9-9s4.03-9 9-9c4.97 0 9 4.03 9 9" />
                <path strokeWidth="1.5" className="text-cyan-400" d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12" transform="rotate(-45 12 12)" />
              </svg>
            </div>
            <span className="text-lg font-bold text-gray-900 font-display">Orbit Agents</span>
          </div>

          {/* Nav Right */}
          <div className="flex items-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-500 hover:text-gray-900 transition-colors"
              aria-label="GitHub"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
            </a>
            <a
              href={primaryDownloadUrl}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
            >
              {t('welcome.nav.download')}
            </a>
          </div>
        </div>
      </header>

      {/* ====== Hero Section ====== */}
      <section className="relative z-10 pt-20 pb-16 text-center">
        <div className="max-w-4xl mx-auto px-6">
          {/* Product Hunt Badge + Open Source Badge — stacked vertically */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-blue-500 motion-safe:animate-pulse" />
              {t('welcome.hero.badge')}
            </div>
            <a
              href="https://www.producthunt.com/products/orbit-agents?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-orbit-agents"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1105023&theme=light&t=1774350166676"
                alt="Orbit Agents - Your AI tasks, on autopilot | Product Hunt"
                width="250"
                height="54"
              />
            </a>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold font-display text-gray-900 tracking-tight mb-6 leading-[1.1]">
            {t('welcome.hero.title')}{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-cyan-600">
              {t('welcome.hero.titleHighlight')}
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed font-display">
            {t('welcome.hero.subtitle')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start justify-center gap-4">
            <a
              href={MAC_DOWNLOAD_URL}
              className="px-8 py-4 bg-gradient-to-r from-gray-800 to-gray-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex items-center gap-2 text-lg"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 19.349c-.854 1.25-1.764 2.495-3.13 2.52-1.353.025-1.788-.804-3.34-.804-1.536 0-2.004.78-3.296.828-1.304.049-2.296-1.325-3.125-2.524C2.378 16.63 1.01 12.062 2.72 8.996c.884-1.556 2.464-2.537 4.195-2.564 1.305-.022 2.535.877 3.333.877.785 0 2.256-1.085 3.826-.917.653.027 2.49.255 3.655 1.964-.093.058-2.186 1.275-2.164 3.81.025 3.012 2.67 4.025 2.697 4.036-.026.069-.418 1.436-1.365 2.809l-.248.34zM12.984 3.52c.732-.888 1.225-2.122 1.09-3.267-1.056.042-2.336.78-3.087 1.635-.678.756-1.27 1.96-1.096 3.12 1.183.091 2.39-.63 3.093-1.488z" />
              </svg>
              {t('welcome.hero.downloadMac')}
            </a>

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 flex items-center gap-2 text-lg"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              {t('welcome.hero.viewGitHub')}
            </a>
          </div>

          {/* Secondary download links */}
          <div className="flex items-center justify-center gap-3 mt-4">
            <a href={WIN_DOWNLOAD_URL} className="text-sm text-gray-500 hover:text-blue-600 font-medium transition-colors flex items-center gap-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M0 3.449L9.75 2.1v9.451H0m9.75 9.413L0 19.488V12h9.75m2.25-10.413L24 0v11.458H12M24 24l-12-1.583v-9.967H24"/>
              </svg>
              {t('welcome.hero.downloadWindows')}
            </a>
            <span className="text-gray-300">|</span>
            <a href={WIN_ZIP_DOWNLOAD_URL} className="text-sm text-gray-500 hover:text-blue-600 font-medium transition-colors">
              {t('welcome.hero.downloadPortable')}
            </a>
          </div>

          {/* Screenshot Slider */}
          <ScreenshotSlider />
        </div>
      </section>

      {/* ====== 3-Step Section ====== */}
      <section className="relative z-10 py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-4 font-display">
            {t('welcome.steps.sectionTitle')}
          </h2>
          <p className="text-lg text-gray-500 text-center mb-16 max-w-xl mx-auto">
            {t('welcome.steps.sectionSubtitle')}
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step) => (
              <div
                key={step.number}
                className="relative bg-white rounded-2xl p-8 shadow-sm ring-1 ring-gray-900/5 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                {/* Step number */}
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} text-white flex items-center justify-center text-lg font-bold mb-6 shadow-lg`}>
                  {step.number}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3 font-display">{step.title}</h3>
                <p className="text-gray-600 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== Why Orbit Section (Comparison Table) ====== */}
      <section className="relative z-10 py-24 bg-white/50">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-4 font-display">
            {t('welcome.comparison.sectionTitle')}
          </h2>
          <p className="text-lg text-gray-500 text-center mb-16 max-w-xl mx-auto">
            {t('welcome.comparison.sectionSubtitle')}
          </p>

          <div className="overflow-x-auto rounded-2xl ring-1 ring-gray-900/5 shadow-sm">
            <table className="w-full min-w-[500px] text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th scope="col" aria-label="Feature" className="px-6 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wider w-1/4" />
                  <th scope="col" className="px-6 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wider">{t('welcome.comparison.othersHeader')}</th>
                  <th scope="col" className="px-6 py-4 text-sm font-semibold text-blue-600 uppercase tracking-wider bg-blue-50/50">
                    Orbit Agents
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-700">{row.label}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{row.others}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 bg-blue-50/30">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        {row.orbit}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ====== Features Section ====== */}
      <section className="relative z-10 py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-4 font-display">
            {t('welcome.features.sectionTitle')}
          </h2>
          <p className="text-lg text-gray-500 text-center mb-16 max-w-xl mx-auto">
            {t('welcome.features.sectionSubtitle')}
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.key}
                className="bg-white rounded-2xl p-6 shadow-sm ring-1 ring-gray-900/5 hover:shadow-md transition-shadow duration-300"
              >
                <div className={`w-11 h-11 ${feature.bg} rounded-xl flex items-center justify-center ${feature.color} mb-4`}>
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2 font-display">{feature.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== Installation Note ====== */}
      <section className="relative z-10 py-24 bg-white/50">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-4 font-display">
            {t('welcome.installation.sectionTitle')}
          </h2>
          <p className="text-lg text-gray-500 text-center mb-12 max-w-xl mx-auto">
            {t('welcome.installation.sectionSubtitle')}
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {/* macOS */}
            <div className="bg-white rounded-2xl p-8 ring-1 ring-gray-900/5 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 bg-gray-100 rounded-xl flex items-center justify-center text-gray-700">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.05 19.349c-.854 1.25-1.764 2.495-3.13 2.52-1.353.025-1.788-.804-3.34-.804-1.536 0-2.004.78-3.296.828-1.304.049-2.296-1.325-3.125-2.524C2.378 16.63 1.01 12.062 2.72 8.996c.884-1.556 2.464-2.537 4.195-2.564 1.305-.022 2.535.877 3.333.877.785 0 2.256-1.085 3.826-.917.653.027 2.49.255 3.655 1.964-.093.058-2.186 1.275-2.164 3.81.025 3.012 2.67 4.025 2.697 4.036-.026.069-.418 1.436-1.365 2.809l-.248.34zM12.984 3.52c.732-.888 1.225-2.122 1.09-3.267-1.056.042-2.336.78-3.087 1.635-.678.756-1.27 1.96-1.096 3.12 1.183.091 2.39-.63 3.093-1.488z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 font-display">{t('welcome.installation.macos.title')}</h3>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                {t('welcome.installation.macos.desc')}
              </p>

              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">{t('welcome.installation.macos.option1Title')}</p>
                  <code className="block bg-gray-50 rounded-lg px-4 py-3 text-xs font-mono text-gray-800 border border-gray-100">
                    xattr -cr /Applications/Orbit\ Agents.app
                  </code>
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">{t('welcome.installation.macos.option2Title')}</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                    <li>{t('welcome.installation.macos.option2Step1')}</li>
                    <li>{t('welcome.installation.macos.option2Step2')}</li>
                    <li>{t('welcome.installation.macos.option2Step3')}</li>
                  </ol>
                </div>

                <p className="text-xs text-gray-400 pt-1">
                  {t('welcome.installation.macos.note')}
                </p>
              </div>
            </div>

            {/* Windows */}
            <div className="bg-white rounded-2xl p-8 ring-1 ring-gray-900/5 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M0 3.449L9.75 2.1v9.451H0m9.75 9.413L0 19.488V12h9.75m2.25-10.413L24 0v11.458H12M24 24l-12-1.583v-9.967H24"/>
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 font-display">{t('welcome.installation.windows.title')}</h3>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                {t('welcome.installation.windows.desc')}
              </p>

              <div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                  <li>{t('welcome.installation.windows.step1')}</li>
                  <li>{t('welcome.installation.windows.step2')}</li>
                </ol>

                <p className="text-xs text-gray-400 pt-4">
                  {t('welcome.installation.windows.note')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== Bottom CTA ====== */}
      <section className="relative z-10 py-20 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 font-display">
            {t('welcome.cta.title')}
          </h2>
          <p className="text-lg text-gray-500 mb-10">
            {t('welcome.cta.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={MAC_DOWNLOAD_URL}
              className="px-8 py-4 bg-gradient-to-r from-gray-800 to-gray-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex items-center gap-2 text-lg"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 19.349c-.854 1.25-1.764 2.495-3.13 2.52-1.353.025-1.788-.804-3.34-.804-1.536 0-2.004.78-3.296.828-1.304.049-2.296-1.325-3.125-2.524C2.378 16.63 1.01 12.062 2.72 8.996c.884-1.556 2.464-2.537 4.195-2.564 1.305-.022 2.535.877 3.333.877.785 0 2.256-1.085 3.826-.917.653.027 2.49.255 3.655 1.964-.093.058-2.186 1.275-2.164 3.81.025 3.012 2.67 4.025 2.697 4.036-.026.069-.418 1.436-1.365 2.809l-.248.34zM12.984 3.52c.732-.888 1.225-2.122 1.09-3.267-1.056.042-2.336.78-3.087 1.635-.678.756-1.27 1.96-1.096 3.12 1.183.091 2.39-.63 3.093-1.488z" />
              </svg>
              {t('welcome.cta.downloadMac')}
            </a>
            <a
              href={WIN_DOWNLOAD_URL}
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-semibold shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 hover:-translate-y-0.5 transition-all duration-300 flex items-center gap-2 text-lg"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M0 3.449L9.75 2.1v9.451H0m9.75 9.413L0 19.488V12h9.75m2.25-10.413L24 0v11.458H12M24 24l-12-1.583v-9.967H24"/>
              </svg>
              {t('welcome.cta.downloadWindows')}
            </a>
          </div>
        </div>
      </section>

      {/* ====== Footer ====== */}
      <footer className="relative z-10 py-8 border-t border-gray-200/40 bg-white/30 backdrop-blur-sm mt-auto">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-gray-500">
            {t('welcome.footer.creditPre')}{' '}
            <a href="https://www.facebook.com/mukispace" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors">
              Muki Wu
            </a>
            {t('welcome.footer.creditPost')}
          </div>

          <div className="flex items-center gap-6">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-gray-900 transition-colors duration-300"
              aria-label="GitHub"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
            </a>

            <a
              href="https://discord.gg/NCSWFkzf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-[#5865F2] transition-colors duration-300"
              aria-label="Discord"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
            </a>

            <a
              href={primaryDownloadUrl}
              className="text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors"
            >
              {t('welcome.footer.download')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
