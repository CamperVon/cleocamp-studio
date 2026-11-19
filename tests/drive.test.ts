import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDriveUrl, driveKind, driveSearchUrl, sectionName } from '../lib/drive'
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
