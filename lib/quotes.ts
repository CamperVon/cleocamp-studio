/**
 * One quote a day, rotating by the date so it is stable within a day and does
 * not change on every render.
 *
 * These are widely documented attributions. A great many fashion quotes in
 * circulation are misattributed, so nothing goes in here that isn't solidly
 * associated with the person named — better a shorter list than a wrong one.
 */
export const QUOTES: Array<{ text: string; who: string }> = [
  { text: 'Fashion changes, but style endures.', who: 'Coco Chanel' },
  { text: 'Fashions fade, style is eternal.', who: 'Yves Saint Laurent' },
  { text: 'Buy less, choose well, make it last.', who: 'Vivienne Westwood' },
  { text: 'More is more and less is a bore.', who: 'Iris Apfel' },
  { text: 'The eye has to travel.', who: 'Diana Vreeland' },
  { text: 'Fashion is the armor to survive the reality of everyday life.', who: 'Bill Cunningham' },
  { text: 'What you wear is how you present yourself to the world.', who: 'Miuccia Prada' },
  { text: 'I think perfection is ugly.', who: 'Yohji Yamamoto' },
  { text: 'Zest is the secret of all beauty.', who: 'Christian Dior' },
  { text: 'Trendy is the last stage before tacky.', who: 'Karl Lagerfeld' },
  { text: 'Give me time and I will give you a revolution.', who: 'Alexander McQueen' },
  { text: 'Elegance is refusal.', who: 'Diana Vreeland' },
  { text: 'Simplicity is the keynote of all true elegance.', who: 'Coco Chanel' },
  { text: 'You have to know the rules to break them.', who: 'Christian Dior' },
]

export function quoteOfTheDay(d = new Date()) {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  const n = Number(key.replace(/-/g, '')) // e.g. 20260901
  return QUOTES[n % QUOTES.length]
}
