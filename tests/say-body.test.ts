import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The body shapes a Siri shortcut can send, depending on which Request Body
 * option somebody taps. All three have to mean the same thing, because the
 * wrong guess is otherwise a silent failure nobody can diagnose on a phone.
 * This mirrors the parsing in app/api/say/route.ts.
 */
function extract(raw: string): string {
  let text = raw
  if (raw.trimStart().startsWith('{')) {
    try {
      const body = JSON.parse(raw) as { text?: string; message?: string }
      text = body.text ?? body.message ?? ''
    } catch { /* not JSON after all */ }
  } else if (/^[^=&\s]+=/.test(raw)) {
    const form = new URLSearchParams(raw)
    text = form.get('text') ?? form.get('message') ?? raw
  }
  return text.trim()
}

test('JSON, the shape the page and step 7 send', () => {
  assert.equal(extract('{"text":"the cotton arrived"}'), 'the cotton arrived')
  assert.equal(extract('{"message":"the cotton arrived"}'), 'the cotton arrived')
})

test('form-encoded, if Form was easier to reach than JSON', () => {
  assert.equal(extract('text=the+cotton+arrived'), 'the cotton arrived')
  assert.equal(extract('text=Antonio%27s%20has%20it'), "Antonio's has it")
})

test('raw text, if they picked File', () => {
  assert.equal(extract('the cotton arrived'), 'the cotton arrived')
})

test('a sentence is never mangled into looking like a field', () => {
  // Bare prose with an equals sign in it must stay prose.
  assert.equal(extract('the cost = 3.50 a piece'), 'the cost = 3.50 a piece')
  assert.equal(extract('{not really json'), '{not really json')
})
