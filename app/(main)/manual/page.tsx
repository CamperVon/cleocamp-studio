import type { ReactNode } from 'react'
import { Page, Card, Fold } from '@/app/ui/primitives'

/**
 * The Mouse Manual: how to use the app, for Jane and Cleo. Brandon, 29 Sept
 * 2026, before training them: "a Mouse Manual tab that can be instructions
 * and reminders." Written and kept up to date in code (he did not want them
 * adding to it). Every "Try it" opens the example in Practice, where Mouse
 * answers from the real records but changes nothing.
 *
 * Keep it true: when a feature changes, change the section that describes it.
 */

function Try({ say }: { say: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-ink">&ldquo;{say}&rdquo;</span>
      <a href={`/?practice=1&try=${encodeURIComponent(say)}`} className="shrink-0 text-xs text-accent underline">
        Try it
      </a>
    </li>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Fold summary={<span className="font-medium">{title}</span>}>
      <div className="flex flex-col gap-3 px-4 pb-4 text-sm leading-relaxed text-muted sm:px-5 [&_b]:font-medium [&_b]:text-ink">
        {children}
      </div>
    </Fold>
  )
}

export default function Manual() {
  return (
    <Page title="Mouse Manual" lede="How to use Studio Mouse and the app. Tap a section to open it. Every “Try it” opens in Practice, so nothing is saved.">
      <Card>
        <div className="divide-y divide-line">
          <Section title="Talking to Mouse">
            <p>
              Type or dictate the way you&rsquo;d text a colleague. Say what happened, with the
              numbers: what, how many, which size and colour, from or to whom, and the PO number if
              there is one. One message can hold several updates.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="How many Cleo Tees in Black size 1 do we have?" />
              <Try say="Picked up 8 Black Petite bean bags from Lorena today, PO 2371" />
              <Try say="Add to todo: order more Boy Belts in Small" />
              <Try say="What does Staples still owe on PO 2362?" />
              <Try say="What's running low?" />
            </ul>
            <p>
              <b>Attach a photo or PDF</b> with the paperclip (an invoice, a packing slip, an old PO)
              and Mouse reads it.
            </p>
          </Section>

          <Section title="Practice mode">
            <p>
              Tap <b>Practice</b> above the Mouse chat on Home. A yellow bar shows while it&rsquo;s
              on. Mouse looks at the real stock, orders and POs, so its answers are real, but anything
              that would change something is stopped. Mouse tells you what it <i>would</i> have done
              instead.
            </p>
            <p>
              Nothing goes to Shopify, no emails go out, and practice chats never count as news.
              Tap <b>Stop practice</b> to go back to real.
            </p>
            <p>
              <b>Practice covers the Mouse chat only.</b> Buttons elsewhere, like Send and Refund on
              Support, are real.
            </p>
          </Section>

          <Section title="When Mouse asks you something">
            <p>
              Mouse would rather ask than guess. A wrong number in stock is worse than a question.
              When it asks which size, which PO or how many, just answer. If you don&rsquo;t know,
              say so and it will leave it open rather than make it up.
            </p>
            <p>
              <b>Mouse checks for repeats.</b> If something looks like it was already logged, maybe
              by someone else, it tells you who logged it and when, and asks whether this is the
              same delivery or a second one.
            </p>
          </Section>

          <Section title="Stock">
            <p>
              <b>Shopify holds the real count.</b> When you tell Mouse about a delivery, a sale or a
              count, it updates Shopify too. Negative numbers on a size just mean pre-orders are
              waiting for it.
            </p>
            <p>
              <b>A delivery:</b> say what came in and give the PO number. That ticks it off on the PO,
              so the PO shows what&rsquo;s still owed.
            </p>
            <p>
              <b>A count:</b> say &ldquo;counted&rdquo;. A count replaces the number. It
              doesn&rsquo;t add to it.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="Counted 12 Cleo Tee Black size 1 in the studio" />
              <Try say="The pickup I told you about yesterday didn't happen" />
            </ul>
            <p>
              <b>New product on Shopify?</b> Mouse doesn&rsquo;t know it until it&rsquo;s brought in.
              Tell Mouse its name or paste its cleocamp.com link, and say yes when it asks to bring it
              in. Then it can be invoiced, counted and put on the line sheet.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="Find Sardine on Shopify" />
            </ul>
            <p>
              <b>Something didn&rsquo;t happen after all?</b> Tell Mouse and it takes it back out of
              stock and off the PO.
            </p>
          </Section>

          <Section title="Support">
            <p>
              Customer emails to support@ land on the <b>Support</b> tab as cases. Mouse sorts
              them, finds the order and drafts a reply. <b>Nothing goes to a customer until you tap
              Send.</b>
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><b>Read the draft</b>, change anything you like, then tap Send.</li>
              <li>
                <b>Tell Mouse</b> (the box under the messages): say what to do, like &ldquo;refund
                her in full and say sorry&rdquo;. Mouse rewrites the reply to do it.
              </li>
              <li>
                <b>Money buttons do the money first.</b> &ldquo;Cancel order, refund &amp; send&rdquo;
                and &ldquo;Refund in full &amp; send&rdquo; make the change in Shopify, then send. The
                refund button shows Shopify&rsquo;s amount on the first tap and refunds on the second.
                &ldquo;Send reply only&rdquo; refunds nothing.
              </li>
              <li>
                <b>Our mistake</b> (wrong item, damaged or faulty): we pay the return postage and keep
                no restocking fee. Otherwise refunds keep a 10% restocking fee.
              </li>
              <li><b>Look up an order</b> at the top: type any order number to see where it stands.</li>
              <li>
                <b>A return arrived</b>: type the order number, tick what came back, and pick Refund,
                Refund (our mistake) or Exchange. The customer is emailed that it arrived.
              </li>
              <li>
                <b>Email for review</b>: tick Jane, Cleo or Brandon under a note to send them the case.
              </li>
              <li>
                <b>Mouse got this wrong</b>: flags the case for Brandon and Claude when the fix belongs
                in how Mouse works, not just in one reply.
              </li>
              <li>
                <b>The support@ inbox itself</b> is a Google group. To read it there, sign in at{' '}
                <a href="https://groups.google.com/" target="_blank" rel="noreferrer" className="text-accent underline">groups.google.com</a>.
              </li>
            </ul>
          </Section>

          <Section title="Invoices: wholesale and live sales">
            <p>
              Ask Mouse to invoice a wholesale account or a live sale. It sets up the invoice as a
              draft in Shopify and gives you a link to check it. Tell it to send when it&rsquo;s
              right.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Wholesale prices come from the price list on the Wholesale tab. Name a different price and it applies to that invoice only.</li>
              <li>Shipped wholesale orders get $25 shipping, waived over $2,500.</li>
              <li>Friends and Family is 20% off, and Shopify works it out. Just say &ldquo;friends and family&rdquo;.</li>
              <li>Say who else should get a copy and Mouse emails them the PDF.</li>
            </ul>
            <ul className="flex flex-col gap-2">
              <Try say="Invoice Grandpa LA for 2 Cleo Tee Shell size 1, shipped" />
              <Try say="Which live-sale invoices are still unpaid?" />
            </ul>
          </Section>

          <Section title="Gifts">
            <p>
              Tell Mouse who it&rsquo;s for, what, and the shipping address (or that you handed it
              over). Mouse makes a $0 order in Shopify, marked Gift: it comes off stock, nobody is
              charged or emailed, and it stays out of sales.
            </p>
            <p>
              <b>Shipped:</b> it waits in Shopify under Orders, unfulfilled. Open it and tap
              <b> Create shipping label</b>. <b>Handed over:</b> it&rsquo;s marked done. Never use a
              $0 invoice for a gift: Shopify won&rsquo;t email it and it never reaches the label queue.
            </p>
            <p>
              <b>No address?</b> Give Mouse their email and say to ask for it. Shopify emails them a
              link to add their address, with nothing to pay. When they do, it comes off stock and
              waits for a label like any other gift.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="Gift Carol Lee a Sardine, Naked, for press. Ship to 1 Main St, Los Angeles, CA 90012" />
              <Try say="I handed Sofie a Flower Hair Tie as a gift" />
              <Try say="Gift Carol Lee a Sardine, Naked, carol.lee@voxmedia.com. Email her for her address" />
            </ul>
          </Section>

          <Section title="Stylists">
            <p>
              The <b>Stylists</b> tab lists stylists, with anyone who has pieces out at the top. Tell
              Mouse when pieces go out to a stylist and when they come back. 40 Cleo Tees are kept
              aside for pulls.
            </p>
            <p>
              Each pull opens on its own. Tap <b>Returned</b> on a piece, or <b>All returned, restock</b>, when it
              returns. <b>Close out, they kept it</b> when the stylist keeps what&rsquo;s out: it stays off
              stock. <b>Remove</b> is for a pull logged by mistake: it puts the pieces back on stock
              and takes the pull off the page.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="Sofie took 3 Cleo Tees, Black size 1, for a shoot" />
            </ul>
          </Section>

          <Section title="Customers">
            <p>
              Every customer has notes. Open one and tap <b>Add notes</b>. To put someone on <b>Notable</b> yourself,
              tap <b>+ Add a customer</b> at the bottom of it; their orders then make the Daily Cheese. Give their email
              and it finds them on Shopify. Or ask Mouse, who can read their Shopify orders and fill the notes in.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="Look up Sophie Lev's orders and add what she bought to her notes" />
            </ul>
          </Section>

          <Section title="Friends of the Brand and the Cleo Crew">
            <p>
              <b>Friends of the Brand</b> is press, editors and friends. <b>Cleo Crew</b> is everyone
              working for and with Cleo: the team, then the Friends We Like to Work With
              (photographers, sample makers). Both are A to Z, with Cleo first on the crew. Tap <b>+ Add</b> on either page, or tell
              Mouse. Open someone to <b>Edit</b> them, move them to another list, or <b>Remove</b> them.
            </p>
            <ul className="flex flex-col gap-2">
              <Try say="Who is on the Cleo Crew?" />
            </ul>
          </Section>

          <Section title="Emailing Mouse">
            <p>
              Email a question to <b>mouse@send.cleocamp.com</b> from your own address and Mouse
              answers by email the next morning. It only looks things up from email. It never
              changes anything because of an email, since anyone can fake one.
            </p>
          </Section>

          <Section title="Your phone">
            <p>
              Use your own link from Brandon (the <b>Phones</b> tab). Open it on your phone in
              Safari, then Share → <b>Add to Home Screen</b>. The icon opens the full app, signed in
              as you, so Mouse knows who it&rsquo;s talking to.
            </p>
          </Section>

          <Section title="When something goes wrong">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <b>Send to Brandon</b> (above the Mouse chat): emails him the whole conversation with
                your note.
              </li>
              <li>
                <b>Mouse can&rsquo;t do this, tell Claude</b> (under a reply): files it for the
                next time the app is worked on.
              </li>
              <li>
                <b>&ldquo;The model connection failed&rdquo;</b>: Mouse couldn&rsquo;t reach its
                brain for a moment. If it says no changes were recorded, just send your message
                again.
              </li>
            </ul>
          </Section>

          <Section title="House rules">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><b>Money always needs a person&rsquo;s tap.</b> Refunds, discounts and invoices never happen on their own.</li>
              <li><b>Cleo decides how many to make or order.</b> Mouse can comment using past sales, but never picks the number.</li>
              <li><b>Shopify works out prices and discounts,</b> never Mouse.</li>
              <li><b>A PO&rsquo;s notes print on the vendor&rsquo;s copy.</b> Only put things there you&rsquo;d say to the vendor.</li>
            </ul>
          </Section>
        </div>
      </Card>
    </Page>
  )
}
