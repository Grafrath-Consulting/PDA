const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const versionFile = path.join(__dirname, '..', 'lib', 'version.ts')
let content = fs.readFileSync(versionFile, 'utf8')

const commitCount = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
const commitDate = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim()

content = content.replace(/build:\s*\d+/, `build: ${commitCount}`)
content = content.replace(/buildDate:\s*'[^']*'/, `buildDate: '${commitDate}'`)

fs.writeFileSync(versionFile, content, 'utf8')
console.log(`Build ${commitCount} (${commitDate})`)
