import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stylistMailReason, stylistTodoTitle, stylistMailKey, senderName } from '../lib/stylist-mail'

// 15 Nov 2026: stylist pull requests and "Cleo Camp x ___" emails went
// unanswered too long; each now raises an urgent to-do on arrival.

const m = (from: string, subject: string | null, text: string | null = '') => ({ from, subject, text })

test('a "Cleo Camp x ___" subject is stylist mail', () => {
  assert.equal(stylistMailReason(m('Ana Ruiz <ana@agency.com>', 'Cleo Camp x Vogue Italia')), 'collab')
  assert.equal(stylistMailReason(m('ana@agency.com', 'Re: CLEO CAMP X W Magazine')), 'collab')
  assert.equal(stylistMailReason(m('ana@agency.com', 'Cleo Camp × Ssense')), 'collab')
})

test('a pull request is stylist mail, by subject or the opening lines', () => {
  assert.equal(stylistMailReason(m('ana@agency.com', 'Pull request – Harper’s Bazaar shoot')), 'pull')
  assert.equal(stylistMailReason(m('ana@agency.com', 'Hello!', 'Hi Cleo, I am requesting a pull for a cover shoot next week.')), 'pull')
  assert.equal(stylistMailReason(m('info@styleagency.com', 'Editorial', 'Would love to do a pull of the 5to7 Skirt.')), 'pull')
})

test('ordinary mail, machines and our own replies are not', () => {
  assert.equal(stylistMailReason(m('ana@agency.com', 'Invoice 1042', 'Please find attached')), null)
  assert.equal(stylistMailReason(m('ana@agency.com', 'Pullover sizing')), null)
  assert.equal(stylistMailReason(m('noreply@shopify.com', 'Cleo Camp x Shop Pay')), null)
  assert.equal(stylistMailReason(m('Cleo <cleo@cleocamp.com>', 'Re: Cleo Camp x Vogue')), null)
  // A forward from the team is the request, passed on.
  assert.equal(stylistMailReason(m('Cleo <cleo@cleocamp.com>', 'Fwd: Cleo Camp x Vogue')), 'collab')
  // A pull mentioned only far down a quoted thread does not count.
  assert.equal(stylistMailReason(m('ana@agency.com', 'Thanks', 'x'.repeat(2000) + ' pull request')), null)
})

test('the to-do quotes the subject and sender, and one thread is one key', () => {
  assert.equal(stylistTodoTitle(m('"Ana Ruiz" <ana@agency.com>', 'Cleo Camp x Vogue'), 'collab'), 'Answer the stylist email "Cleo Camp x Vogue" from Ana Ruiz')
  assert.equal(stylistTodoTitle(m('ana@agency.com', null), 'pull'), 'Answer the stylist pull request "(no subject)" from ana@agency.com')
  assert.equal(stylistMailKey('Re: Fwd: Cleo Camp x Vogue'), stylistMailKey('Cleo Camp x Vogue'))
  assert.equal(senderName('<ana@agency.com>'), 'ana@agency.com')
})
