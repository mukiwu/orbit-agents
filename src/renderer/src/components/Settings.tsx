import { useState, useEffect, useCallback, useRef } from 'react'
import { useSettings, useClaudeCli, useGeminiCli, useCodexCli } from '../hooks/useApi'
import type { ClaudeCliResult, GeminiCliResult, CodexCliResult, UpdateStatus } from '../../../shared/types'
import { Settings2, Terminal, Mail, Cpu, Box, Check, Loader2, AlertCircle, Download, RefreshCw } from 'lucide-react'

type SettingsTab = 'general' | 'claude' | 'gemini' | 'codex' | 'email'

interface SettingsProps {}

export default function Settings({}: SettingsProps) {
  const { settings, loading, updateSettings, testEmail } = useSettings()
  const { testConnection: testClaude } = useClaudeCli()
  const { testConnection: testGemini } = useGeminiCli()
  const { testConnection: testCodex } = useCodexCli()
  
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  // Local state for the entire form
  const [formData, setFormData] = useState({
    email_smtp_host: '',
    email_smtp_port: '587',
    email_smtp_user: '',
    email_smtp_pass: '',
    email_from: '',
    claude_cli_path: '',
    claude_session_token: '',
    gemini_cli_path: '',
    gemini_api_key: '',
    codex_cli_path: '',
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
  const [claudeResult, setClaudeResult] = useState<ClaudeCliResult | null>(null)
  
  const [testingGemini, setTestingGemini] = useState(false)
  const [geminiResult, setGeminiResult] = useState<GeminiCliResult | null>(null)

  const [testingCodex, setTestingCodex] = useState(false)
  const [codexResult, setCodexResult] = useState<CodexCliResult | null>(null)

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
        claude_session_token: settings.claude_session_token || '',
        gemini_cli_path: settings.gemini_cli_path || '',
        gemini_api_key: settings.gemini_api_key || '',
        codex_cli_path: settings.codex_cli_path || '',
        auto_launch: settings.auto_launch ?? 'true',
        auto_update: settings.auto_update ?? 'true'
      })
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
      const result = await testClaude()
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

  const handleTestGemini = async () => {
    setTestingGemini(true)
    setGeminiResult(null)
    try {
      const result = await testGemini()
      setGeminiResult(result)
    } catch (err) {
      setGeminiResult({
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setTestingGemini(false)
    }
  }

  const handleTestCodex = async () => {
    setTestingCodex(true)
    setCodexResult(null)
    try {
      const result = await testCodex()
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


  const handleTestEmail = async () => {
    if (!testEmailAddress) {
      setEmailResult({ success: false, message: 'Please enter an email address' })
      return
    }

    setTestingEmail(true)
    setEmailResult(null)
    try {
      await testEmail(testEmailAddress)
      setEmailResult({ success: true, message: 'Test email sent successfully!' })
    } catch (err) {
      setEmailResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to send test email'
      })
    } finally {
      setTestingEmail(false)
    }
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
          <h2 className="text-lg font-bold text-gray-900">Settings</h2>
          <p className="text-xs text-gray-400 mt-1">Manage app preferences and connections</p>
        </div>

        <div className="space-y-1">
          <NavButton 
            tab="general" 
            icon={Settings2} 
            label="General" 
            desc="App behavior & startup"
          />
          <NavButton 
            tab="claude" 
            icon={Cpu} 
            label="Claude CLI" 
            desc="Anthropic Claude configuration"
          />
          <NavButton 
            tab="gemini" 
            icon={Box} 
            label="Gemini CLI" 
            desc="Google Gemini configuration"
          />
          <NavButton
            tab="codex"
            icon={Terminal}
            label="Codex CLI"
            desc="OpenAI Codex configuration"
          />

          <NavButton 
            tab="email" 
            icon={Mail} 
            label="Email (SMTP)" 
            desc="Notification settings"
          />
        </div>

        {/* Status Indicator */}
        <div className="mt-auto px-4 py-4">
          <div className="flex items-center gap-2 text-xs">
            {isSaving ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                <span className="text-gray-500">Saving changes...</span>
              </>
            ) : lastSaved ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-gray-400">Synced {lastSaved.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </>
            ) : (
              <span className="text-gray-400">Up to date</span>
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
              <h3 className="text-lg font-semibold text-gray-900 mb-1">General Settings</h3>
              <p className="text-sm text-gray-500">Configure how Orbit Agents behaves on your system.</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              {/* Launch at Login */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900 block">Launch at Login</label>
                  <p className="text-xs text-gray-500 mt-1">Automatically start the application when you log in.</p>
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
                  <label className="text-sm font-medium text-gray-900 block">Auto Update</label>
                  <p className="text-xs text-gray-500 mt-1">Automatically check for and notify about updates.</p>
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

              {/* Check for Updates */}
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <label className="text-sm font-medium text-gray-900 block">Software Update</label>
                    <p className="text-xs text-gray-500 mt-1">Check if a new version is available.</p>
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
                    Check for Updates
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
                        <span>You're running the latest version!</span>
                      </div>
                    )}

                    {/* Update Available */}
                    {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-blue-900">Version {updateStatus.version} is available!</p>
                            <p className="text-xs text-blue-700 mt-1">
                              {updateStatus.updateMethod === 'asar'
                                ? 'A lightweight update is ready for quick download.'
                                : 'A new version can be downloaded and installed.'}
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
                              Manual Download
                            </a>
                          ) : (
                            <button
                              onClick={handleDownloadUpdate}
                              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download Update
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
                          <span className="text-sm font-medium text-blue-900">Downloading update...</span>
                        </div>
                        <div className="w-full bg-blue-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${updateStatus.progress}%` }}
                          />
                        </div>
                        <p className="text-xs text-blue-700 mt-2">{Math.round(updateStatus.progress)}% complete</p>
                      </div>
                    )}

                    {/* Downloaded, Ready to Install */}
                    {updateStatus.downloaded && (
                      <div className="p-4 bg-emerald-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-emerald-900">Update downloaded!</p>
                            <p className="text-xs text-emerald-700 mt-1">The app will restart to install the update.</p>
                          </div>
                          <button
                            onClick={handleInstallUpdate}
                            className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 flex items-center gap-2 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Restart & Install
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
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Claude CLI</h3>
              <p className="text-sm text-gray-500">Configure the connection to Anthropic's Claude command line tool.</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">CLI Path</label>
                <input
                  type="text"
                  value={formData.claude_cli_path}
                  onChange={(e) => setFormData(prev => ({ ...prev, claude_cli_path: e.target.value }))}
                  placeholder="~/.local/bin/claude"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">Leave empty to use the default system path.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Session Token</label>
                <div className="relative">
                  <input
                    type="password"
                    value={formData.claude_session_token}
                    onChange={(e) => setFormData(prev => ({ ...prev, claude_session_token: e.target.value }))}
                    placeholder="CLAUDE_CODE_SESSION_ACCESS_TOKEN"
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors font-mono"
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-400">Required for file uploads. You can find this in your browser cookies on claude.ai.</p>
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
                  Test Connection
                </button>
                
                {claudeResult && (
                  <div className={`flex items-center gap-2 text-xs font-medium ${claudeResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {claudeResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {claudeResult.success ? 'Connection successful' : 'Connection failed'}
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

        {/* Gemini CLI */}
        {activeTab === 'gemini' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Gemini CLI</h3>
              <p className="text-sm text-gray-500">Configure the connection to Google's Gemini command line tool.</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">CLI Path</label>
                <input
                  type="text"
                  value={formData.gemini_cli_path}
                  onChange={(e) => setFormData(prev => ({ ...prev, gemini_cli_path: e.target.value }))}
                  placeholder="Use default path"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">API Key</label>
                <input
                  type="password"
                  value={formData.gemini_api_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, gemini_api_key: e.target.value }))}
                  placeholder="GEMINI_API_KEY"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors font-mono"
                />
                <p className="mt-1.5 text-xs text-gray-400">Optional if configured in system environment variables.</p>
              </div>

               <div className="pt-4 border-t border-gray-100 flex items-center gap-4">
                <button
                  onClick={handleTestGemini}
                  disabled={testingGemini}
                  className="px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
                  {testingGemini ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5" />
                  )}
                  Test Connection
                </button>
                
                {geminiResult && (
                  <div className={`flex items-center gap-2 text-xs font-medium ${geminiResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {geminiResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {geminiResult.success ? 'Connection successful' : 'Connection failed'}
                  </div>
                )}
              </div>

              {geminiResult && !geminiResult.success && geminiResult.error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-mono break-all">
                  {geminiResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Codex CLI */}
        {activeTab === 'codex' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Codex CLI</h3>
              <p className="text-sm text-gray-500">Configure the connection to OpenAI&apos;s Codex command line tool.</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">CLI Path</label>
                <input
                  type="text"
                  value={formData.codex_cli_path}
                  onChange={(e) => setFormData(prev => ({ ...prev, codex_cli_path: e.target.value }))}
                  placeholder="codex"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">Leave empty to use the default `codex` binary on your PATH.</p>
              </div>

              <div className="rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                Authenticate Codex separately with <code className="bg-sky-100 px-1 rounded">codex login</code>. Orbit Agents reuses your existing Codex CLI session and MCP configuration.
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
                  Test Connection
                </button>

                {codexResult && (
                  <div className={`flex items-center gap-2 text-xs font-medium ${codexResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {codexResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {codexResult.success ? 'Connection successful' : 'Connection failed'}
                  </div>
                )}
              </div>

              {codexResult && (
                <div className={`p-3 rounded-lg text-xs font-mono break-all ${codexResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {codexResult.success ? codexResult.output : codexResult.error}
                </div>
              )}
            </div>
          </div>
        )}


        {/* Email Settings */}
        {activeTab === 'email' && (
          <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Email (SMTP)</h3>
              <p className="text-sm text-gray-500">Configure email settings for sending task notifications.</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">SMTP Host</label>
                  <input
                    type="text"
                    value={formData.email_smtp_host}
                    onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_host: e.target.value }))}
                    placeholder="smtp.gmail.com"
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Port</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
                <input
                  type="text"
                  value={formData.email_smtp_user}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_user: e.target.value }))}
                  placeholder="your-email@gmail.com"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <input
                  type="password"
                  value={formData.email_smtp_pass}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_smtp_pass: e.target.value }))}
                  placeholder="App password"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">From Address</label>
                <input
                  type="email"
                  value={formData.email_from}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_from: e.target.value }))}
                  placeholder="noreply@yourdomain.com"
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">Optional. Default depends on your SMTP provider.</p>
              </div>

              <div className="pt-4 border-t border-gray-100">
                 <label className="block text-sm font-medium text-gray-700 mb-2">Test Configuration</label>
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
                      Send Test
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
