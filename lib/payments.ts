import { laDay } from '@/lib/dates'

export type PaymentStage = { label: string; amountCents: number; due: string; overdue: boolean; paid?: boolean }

/**
 * Work out what falls due and when, from the terms on a purchase order.
 *
 * Two shapes so far. RichLine take 50% on the lurex stripe up front and the
 * rest on delivery; the rib is net 60 from delivery. Where a delivery date is
 * unconfirmed the date is unknown rather than guessed — an invented due date is
 * worse than an admitted gap, because someone will plan around it.
 *
 * The deposit stage checks depositPaidAt — recorded correctly by chat
 * (update_purchase_order) the moment Cleo confirms a wire went out, but
 * never read back here before this, so a paid deposit still showed as due
 * and overdue forever. Found because the underlying data was already right
 * and the screen still wasn't — the write worked, nothing downstream looked
 * at it.
 */
export function paymentStages(po: {
  depositPercent: number | null
  depositPaidAt: Date | null
  netDaysAfterDelivery: number | null
  orderedAt: Date | null
  expectedAt: Date | null
  receivedAt: Date | null
  status: string
}, totalCents: number): PaymentStage[] {
  const stages: PaymentStage[] = []
  const now = Date.now()
  const delivered = po.receivedAt ?? po.expectedAt

  if (po.depositPercent) {
    const deposit = Math.round((totalCents * po.depositPercent) / 100)
    const due = po.orderedAt
    stages.push(
      po.depositPaidAt
        ? {
            label: `${po.depositPercent}% on order`,
            amountCents: deposit,
            due: `paid ${laDay(po.depositPaidAt)}`,
            overdue: false,
            paid: true,
          }
        : {
            label: `${po.depositPercent}% on order`,
            amountCents: deposit,
            due: due ? laDay(due) : 'unknown',
            overdue: !!due && due.getTime() < now && po.status !== 'RECEIVED',
          },
    )
    stages.push({
      label: 'Balance on delivery',
      amountCents: totalCents - deposit,
      due: delivered ? laDay(delivered) : 'on delivery, date unconfirmed',
      overdue: !!po.receivedAt && po.receivedAt.getTime() < now,
    })
    return stages
  }

  if (po.netDaysAfterDelivery) {
    const from = delivered
    const due = from ? new Date(from.getTime() + po.netDaysAfterDelivery * 864e5) : null
    stages.push({
      label: `Net ${po.netDaysAfterDelivery} from delivery`,
      amountCents: totalCents,
      due: due ? laDay(due) : 'delivery date unconfirmed',
      overdue: !!due && due.getTime() < now,
    })
    return stages
  }

  stages.push({
    label: 'Terms not recorded',
    amountCents: totalCents,
    due: 'unknown',
    overdue: false,
  })
  return stages
}
