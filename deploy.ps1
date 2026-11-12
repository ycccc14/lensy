# Publishes Lensy to GitHub Pages (https://ycccc14.github.io/lensy/). Runs every test first and publishes nothing if one fails.
#   .\deploy.ps1 "What changed"
# Remember to bump VERSION in sw.js (and js/app.js) so phones pick up the new files.
param([string]$Description = 'Update')
$ErrorActionPreference = 'Stop'
$env:Path = "C:\Program Files\nodejs;C:\Program Files\GitHub CLI;$env:Path"
Set-Location $PSScriptRoot

node test/logic.test.js
if ($LASTEXITCODE -ne 0) { throw 'Logic tests failed - nothing was published.' }
node test/ui-test.js
if ($LASTEXITCODE -ne 0) { throw 'UI test failed - nothing was published.' }
node test/layout-test.js
if ($LASTEXITCODE -ne 0) { throw 'Layout test failed - nothing was published.' }

$ErrorActionPreference = 'Continue' # git writes harmless warnings to stderr; check exit codes instead
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m $Description -m 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
}
git push -q -u origin main
if ($LASTEXITCODE -ne 0) { throw 'Publishing to GitHub failed.' }
Write-Host "Done: $Description  ->  https://ycccc14.github.io/lensy/"
