import { defaultReservationMicroPoints } from "../usage-metering/rates"
import { toVisiblePoints } from "./service"

export type PointsBalanceStatus = "low" | "depleted"

/** "Low" = at most this share of the period's plan allowance… */
const LOW_SHARE_OF_ALLOWANCE = 0.2
/** …but never below this many points, so a small plan still gets a warning. */
const LOW_FLOOR_POINTS = 250

/**
 * Where a wallet stands, shared by the dashboard banner and the owner email so
 * the two never disagree. Below one reply's reservation the agent cannot
 * answer at all ("depleted").
 */
export function classifyPointsBalance(balance: {
  totalAvailablePoints: number
  monthlyGrantedPoints: number
}): PointsBalanceStatus | null {
  const depletedBelow = toVisiblePoints(
    defaultReservationMicroPoints("language"),
  )
  if (balance.totalAvailablePoints < depletedBelow) {
    return "depleted"
  }
  const lowThreshold = Math.max(
    LOW_FLOOR_POINTS,
    balance.monthlyGrantedPoints * LOW_SHARE_OF_ALLOWANCE,
  )
  return balance.totalAvailablePoints <= lowThreshold ? "low" : null
}

export type PointsNoticeStatus = PointsBalanceStatus | "grace"

/**
 * What the owner should be told. While enforcement is only scheduled
 * (`graceActive`), nobody is short of anything yet, so only an owner who would
 * be stopped on the day gets the advance "grace" warning.
 */
export function pointsNoticeStatus(
  balance: { totalAvailablePoints: number; monthlyGrantedPoints: number },
  options: { graceActive: boolean },
): PointsNoticeStatus | null {
  const status = classifyPointsBalance(balance)
  if (!options.graceActive) {
    return status
  }
  return status === "depleted" ? "grace" : null
}
