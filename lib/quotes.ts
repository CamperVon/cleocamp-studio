/**
 * One quote a day, rotating by the date so it is stable within a day and does
 * not change on every render.
 *
 * These are widely documented attributions. A great many fashion quotes in
 * circulation are misattributed, so nothing goes in here that isn't solidly
 * associated with the person named — better a shorter list than a wrong one.
 * Lines whose authorship is commonly disputed ("Simplicity is the ultimate
 * sophistication", "Every day is a fashion show") were left out on purpose.
 *
 * Brandon, 2 Oct 2026: "we need more fashion quotes. we are recycling too
 * quickly." Fourteen came round every two weeks; there are now enough for
 * about three months, each shown once before any repeats.
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
  { text: 'Pink is the navy blue of India.', who: 'Diana Vreeland' },
  { text: 'Life is a party. Dress like it.', who: 'Lilly Pulitzer' },
  { text: 'Fashion is architecture: it is a matter of proportions.', who: 'Coco Chanel' },
  { text: 'In order to be irreplaceable one must always be different.', who: 'Coco Chanel' },
  { text: 'Dress shabbily and they remember the dress; dress impeccably and they remember the woman.', who: 'Coco Chanel' },
  { text: 'Luxury must be comfortable, otherwise it is not luxury.', who: 'Coco Chanel' },
  { text: 'The best color in the whole world is the one that looks good on you.', who: 'Coco Chanel' },
  { text: 'Elegance is when the inside is as beautiful as the outside.', who: 'Coco Chanel' },
  { text: 'Elegance is not standing out, but being remembered.', who: 'Giorgio Armani' },
  { text: 'The difference between style and fashion is quality.', who: 'Giorgio Armani' },
  { text: 'Clothes mean nothing until someone lives in them.', who: 'Marc Jacobs' },
  { text: 'I always find beauty in things that are odd and imperfect. They are much more interesting.', who: 'Marc Jacobs' },
  { text: "I don't design clothes. I design dreams.", who: 'Ralph Lauren' },
  { text: "Fashion is not necessarily about labels. It's not about brands. It's about something else that comes from within you.", who: 'Ralph Lauren' },
  { text: 'Style is something each of us already has. All we need to do is find it.', who: 'Diane von Furstenberg' },
  { text: 'Feel like a woman, wear a dress.', who: 'Diane von Furstenberg' },
  { text: "Fashion is about dressing according to what's fashionable. Style is more about being yourself.", who: 'Oscar de la Renta' },
  { text: 'Walk like you have three men walking behind you.', who: 'Oscar de la Renta' },
  { text: 'The joy of dressing is an art.', who: 'John Galliano' },
  { text: "Fashion is what you're offered four times a year by designers. And style is what you choose.", who: 'Lauren Hutton' },
  { text: 'You can have anything you want in life if you dress for it.', who: 'Edith Head' },
  { text: 'Fashion you can buy, but style you possess.', who: 'Edith Head' },
  { text: 'Over the years I have learned that what is important in a dress is the woman who is wearing it.', who: 'Yves Saint Laurent' },
  { text: 'We must never confuse elegance with snobbery.', who: 'Yves Saint Laurent' },
  { text: 'Dressing is a way of life.', who: 'Yves Saint Laurent' },
  { text: 'Fashion is very important. It is life-enhancing and, like everything that gives pleasure, it is worth doing well.', who: 'Vivienne Westwood' },
  { text: 'One is never over-dressed or under-dressed with a little black dress.', who: 'Karl Lagerfeld' },
  { text: 'Sweatpants are a sign of defeat.', who: 'Karl Lagerfeld' },
  { text: 'Fashion is part of the daily air and it changes all the time, with all the events.', who: 'Diana Vreeland' },
  { text: 'You gotta have style. It helps you get down the stairs.', who: 'Diana Vreeland' },
  { text: 'When in doubt, wear red.', who: 'Bill Blass' },
  { text: 'Style is primarily a matter of instinct.', who: 'Bill Blass' },
  { text: "Don't be into trends. Don't make fashion own you, but you decide what you are.", who: 'Gianni Versace' },
  { text: "Clothes aren't going to change the world. The women who wear them will.", who: 'Anne Klein' },
  { text: 'Fashion should be a form of escapism, and not a form of imprisonment.', who: 'Alexander McQueen' },
  { text: 'I want people to be afraid of the women I dress.', who: 'Alexander McQueen' },
  { text: 'Fashion is instant language.', who: 'Miuccia Prada' },
  { text: 'Black is modest and arrogant at the same time.', who: 'Yohji Yamamoto' },
  { text: "Design is not for philosophy, it's for life.", who: 'Issey Miyake' },
  { text: "Fashion is like eating. You shouldn't stick to the same menu.", who: 'Kenzo Takada' },
  { text: 'Clothes are inevitable. They are nothing less than the furniture of the mind made visible.', who: 'James Laver' },
  { text: 'A dress is like a barbed-wire fence. It serves its purpose without obstructing the view.', who: 'Sophia Loren' },
  { text: 'Style is a simple way of saying complicated things.', who: 'Jean Cocteau' },
  { text: 'Fashion is a form of ugliness so intolerable that we have to alter it every six months.', who: 'Oscar Wilde' },
  { text: 'You can never be overdressed or overeducated.', who: 'Oscar Wilde' },
  { text: 'One should either be a work of art, or wear a work of art.', who: 'Oscar Wilde' },
  { text: 'Know, first, who you are, and then adorn yourself accordingly.', who: 'Epictetus' },
  { text: 'Clothes make the man. Naked people have little or no influence on society.', who: 'Mark Twain' },
  { text: 'A man should look as if he had bought his clothes with intelligence, put them on with care, and then forgotten all about them.', who: 'Hardy Amies' },
  { text: "Real style is never right or wrong. It's a matter of being yourself on purpose.", who: 'G. Bruce Boyer' },
  { text: 'I make clothes, women make fashion.', who: 'Azzedine Alaïa' },
  { text: 'The dress must follow the body of a woman, not the body following the shape of the dress.', who: 'Hubert de Givenchy' },
  { text: 'Good taste is death, vulgarity is life.', who: 'Mary Quant' },
  { text: 'In difficult times, fashion is always outrageous.', who: 'Elsa Schiaparelli' },
  { text: 'Never fit the dress to the customer, but the customer to the dress.', who: 'Elsa Schiaparelli' },
  { text: 'I dress for the image. Not for myself, not for the public, not for fashion, not for men.', who: 'Marlene Dietrich' },
  { text: 'I firmly believe that with the right footwear one can rule the world.', who: 'Bette Midler' },
  { text: "I'm just trying to change the world, one sequin at a time.", who: 'Lady Gaga' },
  { text: "Fashion has to reflect who you are, what you feel at the moment and where you're going.", who: 'Pharrell Williams' },
  { text: 'Fashion is the most powerful art there is. It\'s movement, design and architecture all in one.', who: 'Blake Lively' },
  { text: 'Style is a way to say who you are without having to speak.', who: 'Rachel Zoe' },
  { text: 'Anyone can get dressed up and glamorous, but it is how people dress in their days off that are the most intriguing.', who: 'Alexander Wang' },
  { text: "I base my fashion taste on what doesn't itch.", who: 'Gilda Radner' },
  { text: "If you can't be better than your competition, just dress better.", who: 'Anna Wintour' },
  { text: 'Create your own style. Let it be unique for yourself and yet identifiable for others.', who: 'Anna Wintour' },
  { text: 'People will stare. Make it worth their while.', who: 'Harry Winston' },
  { text: 'Fashion is the mirror of history.', who: 'Louis XIV' },
  { text: 'I like my money right where I can see it: hanging in my closet.', who: 'Carrie Bradshaw, Sex and the City' },
]

/** Days since 1 Jan 1970 for the date in Los Angeles. Pure. */
function laDayNumber(d: Date): number {
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, day) / 864e5)
}

/**
 * Today's quote. By day count, not by the digits of the date: the old
 * YYYYMMDD-mod-length skipped and repeated at month ends (31 Oct and 1 Nov
 * landed on the same quote). Now every quote shows once before any repeats.
 */
export function quoteOfTheDay(d = new Date()) {
  return QUOTES[laDayNumber(d) % QUOTES.length]
}
