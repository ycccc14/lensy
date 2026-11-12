# Publishes Lensy to GitHub Pages (https://ycccc14.github.io/lensy/) and the push server (server/, Apps Script).
# Runs every test first and publishes nothing if one fails.
#   .\deploy.ps1 "What changed"
# Remember to bump VERSION in sw.js (and js/app.js): phones check for a new sw.js every time Lensy opens.
param([string]$Description = 'Update')
$ErrorActionPreference = 'Stop'
$env:Path = "C:\Program Files\nodejs;C:\Program Files\GitHub CLI;$env:APPDATA\npm;$env:Path"
Set-Location $PSScriptRoot

node test/logic.test.js
if ($LASTEXITCODE -ne 0) { throw 'Logic tests failed - nothing was published.' }
node test/push-server.test.js
if ($LASTEXITCODE -ne 0) { throw 'Push server tests failed - nothing was published.' }
node test/ui-test.js
if ($LASTEXITCODE -ne 0) { throw 'UI test failed - nothing was published.' }
node test/layout-test.js
if ($LASTEXITCODE -ne 0) { throw 'Layout test failed - nothing was published.' }

$ErrorActionPreference = 'Continue' # git and clasp write harmless warnings to stderr; check exit codes instead
# Push server: update the code and the existing web-app deployment (same URL).
clasp push --force
if ($LASTEXITCODE -ne 0) { throw 'Pushing the server code failed.' }
clasp update-deployment AKfycbz1QL4_ebLslhwKmMIM-nitPbaG-_PUaUEKzP7_bKw1SWa488V5TVDLuU15v0cHn0w8 --description $Description
if ($LASTEXITCODE -ne 0) { throw 'Updating the server deployment failed.' }

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m $Description -m 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
}
git push -q -u origin main
if ($LASTEXITCODE -ne 0) { throw 'Publishing to GitHub failed.' }
Write-Host "Done: $Description  ->  https://ycccc14.github.io/lensy/"
