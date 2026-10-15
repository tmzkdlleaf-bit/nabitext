# 나비글쓰기 — Windows에서 더블클릭(build-installer.bat / run-app.bat)으로 부르는 스크립트.
# PowerShell 5.1(Windows 기본)에서 돌도록 새 문법(??, 삼항 연산자, &&)은 쓰지 않는다.
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Say($msg) { Write-Host (' ' + $msg) }
function Fail($msg) {
  Write-Host ''
  Write-Host (' [!] ' + $msg) -ForegroundColor Red
  Write-Host ' 이 창의 글자(특히 마지막 몇 줄)를 그대로 복사해 보내 주십시오.'
  exit 1
}
function NeedNode {
  $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  if (-not $node) {
    Say '[!] Node.js가 설치되어 있지 않습니다.'
    Say '    열리는 페이지에서 LTS 버전을 받아 설치한 뒤, 다시 더블클릭하십시오.'
    Start-Process 'https://nodejs.org/ko'
    exit 1
  }
  $v = (& node -v) -replace '^v', ''
  $major = 0
  [void][int]::TryParse(($v -split '\.')[0], [ref]$major)
  if ($major -lt 22) {
    Say ('[!] Node.js 버전이 낮습니다(지금 ' + $v + ', 22 이상 필요).')
    Say '    열리는 페이지에서 LTS 버전을 다시 설치하십시오.'
    Start-Process 'https://nodejs.org/ko'
    exit 1
  }
}
# npm은 npm.cmd로 부른다(npm.ps1은 실행 정책에 막힐 수 있음)
function Invoke-Npm {
  $cmd = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { $cmd = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if (-not $cmd) { Fail 'npm을 찾지 못했습니다. Node.js를 다시 설치하십시오.' }
  $global:LASTEXITCODE = 1
  try { & $cmd.Path @args | Out-Host } catch { Write-Host $_ -ForegroundColor Red; return 1 }   # 출력은 화면으로만(함수 결과에 섞이지 않게)
  return $LASTEXITCODE
}

$Host.UI.RawUI.WindowTitle = '나비글쓰기 바로 실행'
NeedNode
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\electron'))) {
  Say '처음 한 번 필요한 도구를 받는 중입니다. 몇 분 걸립니다...'
  if ((Invoke-Npm install) -ne 0) { Fail '도구를 받지 못했습니다.' }
}
if ((Invoke-Npm start) -ne 0) { Fail '앱을 실행하지 못했습니다.' }
exit 0
