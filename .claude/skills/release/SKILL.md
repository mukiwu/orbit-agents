---
name: release
description: Build Electron app, bump version, and create GitHub release with all update artifacts
invocation: release
examples:
  - release
  - build and release
  - 發佈
  - 發佈新版本
---

# Release — Orbit Agents 發佈流程

## 執行流程

### Step 1：確認版號

讀取 `package.json` 中的當前版號，詢問用戶要發佈的新版號（預設為 patch +1）。

更新以下兩處的版號：
- `package.json` 的 `version` 欄位
- `src/renderer/src/App.tsx` 左下角的版號顯示文字

### Step 2：Commit 版號變更

```bash
git add package.json src/renderer/src/App.tsx
git commit -m "chore: bump version to <VERSION>"
```

### Step 3：Build

> ⚠️ 一定要用 `npm run build:mac` / `npm run build:win`，不要直接呼叫 `npx electron-builder`
>
> `build:mac` 會在打包前先用 `rebuild:native` 把 better-sqlite3 強制重編成 arm64。直接跑 `electron-builder` 會跳過這步，跨平台共用的 `node_modules` native binary 可能是錯的架構（例如剛 build 完 Windows 留下的 x64 binary），打出來的 mac App 會無聲開不了視窗，這就是 issue #3

```bash
# macOS（會自動 rebuild:native → arm64，再打包）
npm run build:mac

# Windows（electron-builder 打包時會自動抓 better-sqlite3 的 Windows 預編版）
npm run build:win
```

等待 build 完成，確認 `dist/` 下產生：
- macOS: `Orbit-Agents-<VERSION>-arm64.dmg`, `Orbit-Agents-<VERSION>-arm64.zip`
- Windows: `Orbit-Agents-Setup-<VERSION>.exe`, `Orbit-Agents-<VERSION>-x64-win.zip`

打包後務必驗證 mac 的 native binary 架構，避免 issue #3 重演：

```bash
file "dist/mac-arm64/Orbit Agents.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
# 預期輸出要包含：Mach-O 64-bit bundle arm64
```

### Step 4：產生更新檔案

#### 4a. asar 輕量更新包（gzip 壓縮）

使用專用 script 產生壓縮的 asar：

```bash
bun run prepare-asar
```

這會自動產生：
- `dist/app-asar-v<VERSION>.gz` — gzip 壓縮的 asar 更新包

#### 4b. latest-mac.yml

計算 zip 和 dmg 的 sha512（base64 編碼），產生 YAML：

```bash
ZIP_SHA512=$(shasum -a 512 dist/Orbit-Agents-<VERSION>-arm64.zip | awk '{print $1}' | xxd -r -p | base64)
ZIP_SIZE=$(stat -f%z dist/Orbit-Agents-<VERSION>-arm64.zip)
DMG_SHA512=$(shasum -a 512 dist/Orbit-Agents-<VERSION>-arm64.dmg | awk '{print $1}' | xxd -r -p | base64)
DMG_SIZE=$(stat -f%z dist/Orbit-Agents-<VERSION>-arm64.dmg)
RELEASE_DATE=$(date -u "+%Y-%m-%dT%H:%M:%S.000Z")
```

格式：
```yaml
version: <VERSION>
files:
  - url: Orbit-Agents-<VERSION>-arm64.zip
    sha512: <ZIP_SHA512>
    size: <ZIP_SIZE>
  - url: Orbit-Agents-<VERSION>-arm64.dmg
    sha512: <DMG_SHA512>
    size: <DMG_SIZE>
path: Orbit-Agents-<VERSION>-arm64.zip
sha512: <ZIP_SHA512>
releaseDate: '<RELEASE_DATE>'
```

#### 4c. latest.yml (Windows)

計算 exe 的 sha512（base64 編碼），產生 YAML：

```bash
EXE_SHA512=$(shasum -a 512 dist/Orbit-Agents-Setup-<VERSION>.exe | awk '{print $1}' | xxd -r -p | base64)
EXE_SIZE=$(stat -f%z dist/Orbit-Agents-Setup-<VERSION>.exe)
RELEASE_DATE=$(date -u "+%Y-%m-%dT%H:%M:%S.000Z")
```

格式：
```yaml
version: <VERSION>
files:
  - url: Orbit-Agents-Setup-<VERSION>.exe
    sha512: <EXE_SHA512>
    size: <EXE_SIZE>
path: Orbit-Agents-Setup-<VERSION>.exe
sha512: <EXE_SHA512>
releaseDate: '<RELEASE_DATE>'
```

### Step 5：Push 並建立 GitHub Release

```bash
git push origin main
```

建立 release 並上傳所有檔案（共 7 個）：

```bash
gh release create v<VERSION> \
  dist/Orbit-Agents-<VERSION>-arm64.dmg \
  dist/Orbit-Agents-<VERSION>-arm64.zip \
  dist/Orbit-Agents-<VERSION>-x64-win.zip \
  dist/Orbit-Agents-Setup-<VERSION>.exe \
  dist/app-asar-v<VERSION>.gz \
  dist/latest-mac.yml \
  dist/latest.yml \
  --title "v<VERSION>" \
  --notes "<RELEASE_NOTES>"
```

### Step 6：撰寫 Release Notes

Release notes 使用英文，格式參考：

```markdown
## What's New

### Feature Category Name
- Description of change 1
- Description of change 2

### Another Category
- Description of change
```

撰寫原則：
- 從上次 release tag 到現在的 commit 歷史中歸納改動
- 用 `git log <PREV_TAG>..HEAD --oneline` 取得 commit 列表
- 按功能分類（如 UI、Fixes、Performance 等）
- 每條描述簡潔明瞭，說明改了什麼和為什麼
- 不需要列出 chore/版號變更等瑣碎 commit

### Step 7：完成確認

輸出：
- Release URL
- 上傳的檔案清單與大小（共應有 7 個檔案）

## Release 檔案清單

每個 release 應包含以下 7 個檔案：

| 檔案 | 用途 |
|---|---|
| `Orbit-Agents-<VERSION>-arm64.dmg` | macOS 安裝檔 |
| `Orbit-Agents-<VERSION>-arm64.zip` | macOS zip |
| `Orbit-Agents-<VERSION>-x64-win.zip` | Windows zip |
| `Orbit-Agents-Setup-<VERSION>.exe` | Windows 安裝檔 |
| `app-asar-v<VERSION>.gz` | gzip 壓縮的輕量更新包 |
| `latest-mac.yml` | macOS auto-updater 資訊 |
| `latest.yml` | Windows auto-updater 資訊 |
