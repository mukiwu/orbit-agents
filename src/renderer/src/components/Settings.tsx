import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings, useAiProvider } from '../hooks/useApi'
import { applyLanguagePreference } from '../i18n'
import type { LanguagePreference } from '../../../shared/i18n/resolveLocale'
import type { ProviderTestResult, UpdateStatus } from '../../../shared/types'
import { Settings2, Terminal, Mail, Cpu, Box, Check, Loader2, AlertCircle, Download, RefreshCw } from 'lucide-react'

type SettingsTab = 'general' | 'claude' | 'codex' | 'antigravity' | 'email'

interface SettingsProps {}

export default function Settings({}: SettingsProps) {
  const { t } = useTranslation()
  const { settings, loading, updateSettings, testEmail } = useSettings()
  const { test: testAiProvider } = useAiProvider()

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [language, setLanguage] = useState<LanguagePreference>('system')

  // Local state for the entire form
  const [formData, setFormData] = useState({
    email_smtp_host: '',
    email_smtp_port: '587',
    email_smtp_user: '',
    email_smtp_pass: '',
    email_from: '',
    claude_cli_path: '',
    codex_cli_path: '',
    antigravity_cli_path: '',
    auto_launch: 'true',
    auto_update: 'true'
  })

  // Auto-update state
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  // Track if initial load is done to avoid overwriting user edits with stale data
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Test states
  const [testingClaude, setTestingClaude] = useState(false)
  const [claudeResult, setClaudeResult] = useState<ProviderTestResult | null>(null)

  const [testingCodex, setTestingCodex] = useState(false)
  const [codexResult, setCodexResult] = useState<ProviderTestResult | null>(null)

  const [testingAntigravity, setTestingAntigravity] = useState(false)
  const [antigravityResult, setAntigravityResult] = useState<ProviderTestResult | null>(null)

  const [testingEmail, setTestingEmail] = useState(false)
  const [emailResult, setEmailResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testEmailAddress, setTestEmailAddress] = useState('')

  // Load settings on mount
  useEffect(() => {
    if (!loading && settings && !isLoaded) {
      setFormData({
        email_smtp_host: settings.email_smtp_host || '',
        email_smtp_port: settings.email_smtp_port || '587',
        email_smtp_user: settings.email_smtp_user || '',
        email_smtp_pass: settings.email_smtp_pass || '',
        email_from: settings.email_from || '',
        claude_cli_path: settings.claude_cli_path || '',
        codex_cli_path: settings.codex_cli_path || '',
        antigravity_cli_path: settings.antigravity_cli_path || '',
        auto_launch: settings.auto_launch ?? 'true',
        auto_update: settings.auto_update ?? 'true'
      })
      setLanguage(settings.language ?? 'system')
      setIsLoaded(true)
    }
  }, [loading, settings, isLoaded])

  // Check for updates handler
  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true)
    try {
      const status = await window.electronApi.invoke('updater:check' as any)
      setUpdateStatus(status)
    } catch (err) {
      setUpdateStatus({
        checking: false,
        available: false,
        downloaded: false,
        downloading: false,
        progress: 0,
        version: null,
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setCheckingUpdate(false)
    }
  }

  // Download update handler
  const handleDownloadUpdate = async () => {
    try {
      await window.electronApi.invoke('updater:download' as any)
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  // Install update handler
  const handleInstallUpdate = async () => {
    try {
      await window.electronApi.invoke('updater:install' as any)
    } catch (err) {
      console.error('Install failed:', err)
    }
  }

  // Listen for update status changes
  useEffect(() => {
    const handleUpdateStatus = (status: UpdateStatus) => {
      setUpdateStatus(status)
      setCheckingUpdate(status.checking)
    }

    window.electronApi.on('updater:status', handleUpdateStatus as any)

    return () => {
      window.electronApi.off('updater:status', handleUpdateStatus as any)
    }
  }, [])

  // --- Auto-Save Logic ---
  // We use a ref to keep track of the timeout ID so we can clear it
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // We use a ref to store the current form data for the save function to access
  // without being in the dependency array (to avoid infinite loops or stale closures)
  const formDataRef = useRef(formData)

  // Update ref whenever formData changes
  useEffect(() => {
    formDataRef.current = formData
  }, [formData])

  // The actual save function
  const performSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await updateSettings(formDataRef.current)
      setLastSaved(new Date())
    } catch (err) {
      console.error('Auto-save failed:', err)
    } finally {
      setIsSaving(false)
    }
  }, [updateSettings])

  // Trigger auto-save on form change with debounce
  useEffect(() => {
    if (!isLoaded) return

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout (debounce 1000ms)
    saveTimeoutRef.current = setTimeout(() => {
      performSave()
    }, 1000)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [formData, isLoaded, performSave])


  // --- Event Handlers ---

  const handleTestClaude = async () => {
    setTestingClaude(true)
    setClaudeResult(null)
    try {
      const result = await testAiProvider('claude')
      setClaudeResult(result)
    } catch (err) {
      setClaudeResult({
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setTestingClaude(false)
    }
  }

  const handleTestCodex = async () => {
    setTestingCodex(true)
    setCodexResult(null)
    try {
      const result = await testAiProvider('codex')
      setCodexResult(result)
    } catch (err) {
      setCodexResult({
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setTestingCodex(false)
    }
  }

  const handleTestAntigravity = async () => {
    setTestingAntigravity(true)
    setAntigravityResult(null)
    try {
      const result = await testAiProvider('antigravity')
      setAntigravityResult(result)
    } catch (err) {
      setAntigravityResult({
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setTestingAntigravity(false)
    }
  }

  const handleTestEmail = async () => {
    if (!testEmailAddress) {
      setEmailResult({ success: false, message: t('settings.email.missingAddress') })
      return
    }

    setTestingEmail(true)
    setEmailResult(null)
    try {
      await testEmail(testEmailAddress)
      setEmailResult({ success: true, message: t('settings.email.testSuccess') })
    } catch (err) {
      setEmailResult({
        success: false,
        message: err instanceof Error ? err.message : t('settings.email.testFailed')
      })
    } finally {
      setTestingEmail(false)
    }
  }

  const handleLanguageChange = async (newLang: LanguagePreference) => {
    setLanguage(newLang)
    applyLanguagePreference(newLang)
    await updateSettings({ language: newLang })
  }

  if (loading && !isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  function NavButton({ tab, icon: Icon, label, desc }: { tab: SettingsTab, icon: any, label: string, desc: string }) {
    const isActive = activeTab === tab
    return (
      <button
        onClick={() => setActiveTab(tab)}
        className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-start gap-3 group ${
          isActive
            ? 'bg-white shadow-sm ring-1 ring-gray-200'
            : 'hover:bg-white/50'
        }`}
      >
        <div className={`p-2 rounded-lg transition-colors ${
          isActive ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500 group-hover:bg-white group-hover:text-gray-600'
        }`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className={`font-semibold text-sm ${isActive ? 'text-gray-900' : 'text-gray-600'}`}>
            {label}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 font-normal">
            {desc}
          </div>
        </div>
      </button>
    )
  }

  return (
    <div className="flex h-full gap-8">
      {/* Left Sidebar - Navigation */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-1">
        <div className="mb-6 px-2">
          <h2 className="text-lg font-bold text-gray-900">{t('settings.title')}</h2>
          <p className="text-xs text-gray-400 mt-1">{t('settings.subtitle')}</p>
        </div>

        <div className="space-y-1">
          <NavButton
            tab="general"
            icon={Settings2}
            label={t('settings.nav.general.label')}
            desc={t('settings.nav.general.desc')}
          />
          <NavButton
            tab="claude"
            icon={Cpu}
            label={t('settings.nav.claude.label')}
            desc={t('settings.nav.claude.desc')}
          />
          <NavButton
            tab="codex"
            icon={Terminal}
            label={t('settings.nav.codex.label')}
            desc={t('settings.nav.codex.desc')}
          />
          <NavButton
            tab="antigravity"
            icon={Box}
            label={t('settings.nav.antigravity.label')}
            desc={t('settings.nav.antigravity.desc')}
          />

          <NavButton
            tab="email"
            icon={Mail}
            label={t('settings.nav.email.label')}
            desc={t('settings.nav.email.desc')}
          />
        </div>

        {/* Status Indicator */}
        <div className="mt-auto px-4 py-4">
          <div className="flex items-center gap-2 text-xs">
            {isSaving ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                <span className="text-gray-500">{t('settings.status.saving')}</span>
              </>
            ) : lastSaved ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-gray-400">{t('settings.status.synced', { time: lastSaved.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) })}</span>
              </>
            ) : (
              <span className="text-gray-400">{t('settings.status.upToDate')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Content */}
      <div className="flex-1 bg-gray-50/50 rounded-2xl border border-gray-100 p-8 overflow-y-auto">

        {/* General Settings */}
        {activeTab === 'general' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('settings.general.title')}</h3>
              <p className="text-sm text-gray-500">{t('settings.general.description')}</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              {/* Launch at Login */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900 block">{t('settings.general.launchAtLogin.label')}</label>
                  <p className="text-xs text-gray-500 mt-1">{t('settings.general.launchAtLogin.description')}</p>
                </div>
                <button
                  onClick={() => setFormData(prev => ({ ...prev, auto_launch: prev.auto_launch === 'true' ? 'false' : 'true' }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    formData.auto_launch === 'true' ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.auto_launch === 'true' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* Auto Update */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900 block">{t('settings.general.autoUpdate.label')}</label>
                  <p className="text-xs text-gray-500 mt-1">{t('settings.general.autoUpdate.description')}</p>
                </div>
                <button
                  onClick={() => setFormData(prev => ({ ...prev, auto_update: prev.auto_update === 'true' ? 'false' : 'true' }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    formData.auto_update === 'true' ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.auto_update === 'true' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* Language Selector */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900 block">{t('settings.language.label')}</label>
                  <p className="text-xs text-gray-500 mt-1">{t('settings.language.description')}</p>
                </div>
                <select
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value as LanguagePreference)}
                  className="px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                >
                  <option value="system">{t('settings.language.system')}</option>
                  <option value="en">{t('settings.language.en')}</option>
                  <option value="zh-TW">{t('settings.language.zhTW')}</option>
                </select>
              </div>

              {/* Check for Updates */}
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <label className="text-sm font-medium text-gray-900 block">{t('settings.general.softwareUpdate.label')}</label>
                    <p className="text-xs text-gray-500 mt-1">{t('settings.general.softwareUpdate.description')}</p>
                  </div>
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={checkingUpdate || updateStatus?.downloading}
                    className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {checkingUpdate ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {t('settings.general.checkForUpdates')}
                  </button>
                </div>

                {/* Update Status Display */}
                {updateStatus && (
                  <div className="space-y-3">
                    {/* Error */}
                    {updateStatus.error && (
                      <div className="flex items-start gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-xs">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{updateStatus.error}</span>
                      </div>
                    )}

                    {/* No Updates Available */}
                    {!updateStatus.checking && !updateStatus.available && !updateStatus.error && (
                      <div className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-xs">
                        <Check className="w-4 h-4" />
                        <span>{t('settings.update.upToDate')}</span>
                      </div>
                    )}

                    {/* Update Available */}
                    {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-blue-900">{t('settings.update.available', { version: updateStatus.version })}</p>
                            <p className="text-xs text-blue-700 mt-1">
                              {updateStatus.updateMethod === 'asar'
                                ? t('settings.update.methodAsar')
                                : t('settings.update.methodFull')}
                            </p>
                          </div>
                          {updateStatus.releaseUrl ? (
                            <a
                              href={updateStatus.releaseUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors no-underline"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {t('settings.update.manualDownload')}
                            </a>
                          ) : (
                            <button
                              onClick={handleDownloadUpdate}
                              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {t('settings.update.download')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Downloading */}
                    {updateStatus.downloading && (
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                          <span className="text-sm font-medium text-blue-900">{t('settings.update.downloading')}</span>
                        </div>
                        <div className="w-full bg-blue-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${updateStatus.progress}%` }}
                          />
                        </div>
                        <p className="text-xs text-blue-700 mt-2">{t('settings.update.progress', { percent: Math.round(updateStatus.progress) })}</p>
                      </div>
                    )}

                    {/* Downloaded, Ready to Install */}
                    {updateStatus.downloaded && (
                      <div className="p-4 bg-emerald-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-emerald-900">{t('settings.update.downloaded')}</p>
                            <p className="text-xs text-emerald-700 mt-1">{t('settings.update.restartNote')}</p>
                          </div>
                          <button
                            onClick={handleInstallUpdate}
                            className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 flex items-center gap-2 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            {t('settings.update.restartInstall')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Claude CLI */}
        {activeTab === 'claude' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('settings.claude.title')}</h3>
              <p className="text-sm text-gray-500">{t('settings.claude.description')}</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.cli.pathLabel')}</label>
                <input
                  type="text"
                  value={formData.claude_cli_path}
                  onChange={(e) => setFormData(prev => ({ ...prev, claude_cli_path: e.target.value }))}
                  placeholder="~/.local/bin/claude"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">
                  {t('settings.claude.pathNotePrefix')} <code className="bg-gray-100 px-1 rounded">claude</code> {t('settings.claude.pathNoteSuffix')}
                </p>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center gap-4">
                <button
                  onClick={handleTestClaude}
                  disabled={testingClaude}
                  className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
                  {testingClaude ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5" />
                  )}
                  {t('settings.cli.testConnection')}
                </button>

                {claudeResult && (
                  <div className={`flex items-center gap-2 text-xs font-medium ${claudeResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {claudeResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {claudeResult.success ? t('settings.cli.connectionSuccessful') : t('settings.cli.connectionFailed')}
                  </div>
                )}
              </div>

              {claudeResult && !claudeResult.success && claudeResult.error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-mono break-all">
                  {claudeResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Codex CLI */}
        {activeTab === 'codex' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('settings.codex.title')}</h3>
              <p className="text-sm text-gray-500">{t('settings.codex.description')}</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.cli.pathLabel')}</label>
                <input
                  type="text"
                  value={formData.codex_cli_path}
                  onChange={(e) => setFormData(prev => ({ ...prev, codex_cli_path: e.target.value }))}
                  placeholder={t('settings.codex.placeholder')}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">{t('settings.cli.defaultPathNote')}</p>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center gap-4">
                <button
                  onClick={handleTestCodex}
                  disabled={testingCodex}
                  className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
                  {testingCodex ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5" />
                  )}
                  {t('settings.cli.testConnection')}
                </button>

                {codexResult && (
                  <div className={`flex items-center gap-2 text-xs font-medium ${codexResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {codexResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {codexResult.success ? t('settings.cli.connectionSuccessful') : t('settings.cli.connectionFailed')}
                  </div>
                )}
              </div>

              {codexResult && !codexResult.success && codexResult.error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-mono break-all">
                  {codexResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Antigravity CLI */}
        {activeTab === 'antigravity' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('settings.antigravity.title')}</h3>
              <p className="text-sm text-gray-500">{t('settings.antigravity.description')}</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.cli.pathLabel')}</label>
                <input
                  type="text"
                  value={formData.antigravity_cli_path}
                  onChange={(e) => setFormData(prev => ({ ...prev, antigravity_cli_path: e.target.value }))}
                  placeholder={t('settings.antigravity.placeholder')}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">{t('settings.cli.defaultPathNote')}</p>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center gap-4">
                <button
                  onClick={handleTestAntigravity}
                  disabled={testingAntigravity}
                  className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
                  {testingAntigravity ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5" />
                  )}
                  {t('settings.cli.testConnection')}
                </button>

                {antigravityResult && (
                  <div className={`flex items-center gap-2 text-xs font-medium ${antigravityResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {antigravityResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {antigravityResult.success ? t('settings.cli.connectionSuccessful') : t('settings.cli.connectionFailed')}
                  </div>
                )}
              </div>

              {antigravityResult && !antigravityResult.success && antigravityResult.error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-mono break-all">
                  {antigravityResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Email Settings */}
        {activeTab === 'email' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('settings.email.title')}</h3>
              <p className="text-sm text-gray-500">{t('settings.email.description')}</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.email.smtpHost')}</label>
                  <input
                    type="text"
                    value={formData.email_smtp_host}
                    onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_host: e.target.value }))}
                    placeholder="smtp.gmail.com"
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.email.port')}</label>
                  <input
                    type="text"
                    value={formData.email_smtp_port}
                    onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_port: e.target.value }))}
                    placeholder="587"
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.email.username')}</label>
                <input
                  type="text"
                  value={formData.email_smtp_user}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_user: e.target.value }))}
                  placeholder="your-email@gmail.com"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.email.password')}</label>
                <input
                  type="password"
                  value={formData.email_smtp_pass}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_pass: e.target.value }))}
                  placeholder={t('settings.email.passwordPlaceholder')}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('settings.email.fromAddress')}</label>
                <input
                  type="email"
                  value={formData.email_from}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_from: e.target.value }))}
                  placeholder="noreply@yourdomain.com"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">{t('settings.email.fromNote')}</p>
              </div>

              <div className="pt-4 border-t border-gray-100">
                 <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings.email.testConfig')}</label>
                 <div className="flex gap-2">
                    <input
                      type="email"
                      value={testEmailAddress}
                      onChange={(e) => setTestEmailAddress(e.target.value)}
                      placeholder="recipient@example.com"
                      className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                    />
                    <button
                      onClick={handleTestEmail}
                      disabled={testingEmail}
                      className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                      {testingEmail ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Mail className="w-3.5 h-3.5" />
                      )}
                      {t('settings.email.sendTest')}
                    </button>
                 </div>
                 {emailResult && (
                  <p className={`mt-2 text-xs font-medium ${emailResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {emailResult.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
