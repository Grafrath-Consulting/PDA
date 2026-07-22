const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const versionFile = path.join(__dirname, '..', 'lib', 'version.ts')
let content = fs.readFileSync(versionFile, 'utf8')

let commitCount, commitDate
try {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  commitCount = execSync('git rev-list --count HEAD', opts).trim()
  commitDate = execSync('git log -1 --format=%cI', opts).trim()
} catch {
  // No .git directory or no git binary (zip download, Docker build, some CI):
  // keep the last-known build info instead of failing the build.
  console.warn('bump-build: git history unavailable; keeping existing build info in lib/version.ts')
  process.exit(0)
}

content = content.replace(/build:\s*\d+/, `build: ${commitCount}`)
content = content.replace(/buildDate:\s*'[^']*'/, `buildDate: '${commitDate}'`)

fs.writeFileSync(versionFile, content, 'utf8')
console.log(`Build ${commitCount} (${commitDate})`)
