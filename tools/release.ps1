# Lança uma versão: testes e tipos, grava versão/manifesto no module.json e package.json,
# faz commit, cria a tag vX.Y.Z e envia. A GitHub Action (.github/workflows/release.yml)
# compila, empacota e publica a release instalável.
#
# Uso: .\tools\release.ps1 0.3.0
# Antes: escreva a seção "## [0.3.0] - AAAA-MM-DD" no CHANGELOG.md.
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versão inválida: use X.Y.Z" }
  if (-not (Select-String -Path CHANGELOG.md -Pattern "## \[$([regex]::Escape($Version))\]" -Quiet)) {
    throw "Falta a seção '## [$Version]' no CHANGELOG.md"
  }
  if (git tag --list "v$Version") { throw "A tag v$Version já existe" }
  if (git status --porcelain) { throw "Há mudanças não commitadas; faça o commit antes de lançar." }

  if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund | Out-Null }
  npm run --silent test
  if ($LASTEXITCODE -ne 0) { throw "Testes falharam; lançamento cancelado." }
  npm run --silent typecheck
  if ($LASTEXITCODE -ne 0) { throw "Erros de tipo; lançamento cancelado." }

  node tools/release-prep.mjs $Version
  Remove-Item release-notes.md -ErrorAction SilentlyContinue
  git add module.json package.json
  if (git diff --cached --name-only) { git commit -q -m "Versão $Version" }
  git tag -a "v$Version" -m "Versão $Version"
  git push origin main
  git push origin "v$Version"
  Write-Host "Tag v$Version enviada. Acompanhe a release em: https://github.com/Lorian2/Apoteose/actions"
}
finally { Pop-Location }
