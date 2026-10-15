// In-memory badge registry (phase 44 t2): two features in one plugin share a count without a file.
// The module is reached by dynamic import, per ADR-018.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'mods', 'astro-mods', 'hooks', 'lib', 'badges.js')
const mod = () => import('../mods/astro-mods/hooks/lib/badges.js')

test('setBadge then badges() lists texts in insertion order', async () => {
  const b = await mod()
  b.resetBadges()
  b.setBadge('a', 'one')
  b.setBadge('b', 'two')
  assert.deepEqual(b.badges(), ['one', 'two'])
  b.resetBadges()
})

test('setBadge(name, undefined) removes the entry', async () => {
  const b = await mod()
  b.resetBadges()
  b.setBadge('a', 'one')
  b.setBadge('a', undefined)
  assert.deepEqual(b.badges(), [])
})

test('claimBadges makes badgesClaimed true; resetBadges clears both', async () => {
  const b = await mod()
  b.resetBadges()
  assert.equal(b.badgesClaimed(), false)
  b.claimBadges()
  assert.equal(b.badgesClaimed(), true)
  b.setBadge('a', 'x')
  b.resetBadges()
  assert.equal(b.badgesClaimed(), false)
  assert.deepEqual(b.badges(), [])
})

test('the module is pure: no $ and no import', () => {
  const src = readFileSync(FILE, 'utf8')
  assert.ok(!/\$\./.test(src), 'no $ call')
  assert.ok(!/^\s*import\s/m.test(src), 'imports no file')
})
