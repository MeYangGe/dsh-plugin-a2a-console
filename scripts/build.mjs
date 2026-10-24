/**
 * 构建脚本：本插件直接以可读的 ES2022 源码分发（无打包变换），
 * build 只做语法自检（node --check 对 ESM 同样生效）——保持与
 * dsh 插件生态「scripts.build / scripts.check 必须存在」的约定兼容。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')
const files = readdirSync(lib).filter(name => name.endsWith('.js'))
let failed = false
for (const name of files) {
  const result = spawnSync(process.execPath, ['--check', join(lib, name)], { encoding: 'utf8' })
  if (result.status !== 0) {
    failed = true
    console.error(`[build] ✗ ${name}\n${result.stderr}`)
  } else {
    console.log(`[build] ✓ ${name}`)
  }
}
if (failed) process.exit(1)
