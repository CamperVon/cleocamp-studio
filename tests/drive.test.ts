import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDriveUrl, driveKind, driveSearchUrl, sectionName, pickRecent, cleanDriveUrl, recentQuery, CLEO_DRIVE_FOLDER } from '../lib/drive'
import { recordHref } from '../lib/files'

// 19 Nov 2026: a Drive page of the team's Google Drive links.

test('only Google Drive and Docs addresses count', () => {
  assert.equal(isDriveUrl('https://drive.google.com/drive/folders/abc'), true)
  assert.equal(isDriveUrl('https://docs.google.com/document/d/abc/edit'), true)
  assert.equal(isDriveUrl('https://drive.google.com.evil.com/x'), false)
  assert.equal(isDriveUrl('https://dropbox.com/x'), false)
  assert.equal(isDriveUrl('not a link'), false)
})

test('each link is labelled by what it opens', () => {
  assert.equal(driveKind('https://drive.google.com/drive/folders/abc'), 'Folder')
  assert.equal(driveKind('https://drive.google.com/file/d/abc/view'), 'File')
  assert.equal(driveKind('https://docs.google.com/document/d/abc/edit'), 'Doc')
  assert.equal(driveKind('https://docs.google.com/spreadsheets/d/abc'), 'Sheet')
  assert.equal(driveKind('https://docs.google.com/presentation/d/abc'), 'Slides')
  assert.equal(driveKind('https://docs.google.com/forms/d/abc'), 'Form')
})

test('search opens Google Drive search with the words', () => {
  assert.equal(driveSearchUrl(' line sheet & photos '), 'https://drive.google.com/drive/search?q=line%20sheet%20%26%20photos')
})

test('sections are tidied, and a pinned link points at the Drive page', () => {
  assert.equal(sectionName('  newsletter '), 'Newsletter')
  assert.equal(sectionName(''), 'General')
  assert.equal(recordHref('drive', 'Newsletter'), '/drive')
  assert.equal(recordHref('product', 'p1'), '/products#rec-p1')
})

// 19 Nov 2026: the five most recently edited Cleo Camp files.

test('the newest five files are kept, folders and trash left out, links cleaned', () => {
  const f = (id: string, t: string, extra: Record<string, unknown> = {}) => ({ id, title: id, viewUrl: `https://docs.google.com/document/d/${id}/edit?usp=drivesdk&ouid=1`, modifiedTime: t, mimeType: 'application/vnd.google-apps.document', lastModifyingUserName: 'Studio', ...extra })
  const r = pickRecent([
    f('a', '2026-11-19T10:00:00Z'), f('b', '2026-11-19T12:00:00Z'), f('folder', '2026-11-19T23:00:00Z', { mimeType: 'application/vnd.google-apps.folder' }),
    f('gone', '2026-11-19T22:00:00Z', { trashed: true }), f('c', '2026-11-18T00:00:00Z'), f('d', '2026-11-17T00:00:00Z'), f('e', '2026-11-16T00:00:00Z'), f('f', '2026-11-15T00:00:00Z'),
  ])
  assert.deepEqual(r.map((x) => x.fileId), ['b', 'a', 'c', 'd', 'e'])
  assert.equal(r[0].url, 'https://docs.google.com/document/d/b/edit')
  assert.equal(r[0].position, 0)
  assert.equal(r[0].modifiedBy, 'Studio')
})

test('only the Cleo folder and cleocamp.com owners are searched', () => {
  assert.match(recentQuery(), new RegExp(`'${CLEO_DRIVE_FOLDER}' in ancestors`))
  assert.match(recentQuery(), /owner = 'studio@cleocamp\.com'/)
  assert.match(recentQuery(), /mimeType != 'application\/vnd\.google-apps\.folder'$/)
  assert.equal(cleanDriveUrl('https://drive.google.com/file/d/x/view?usp=drivesdk'), 'https://drive.google.com/file/d/x/view')
})
