/**
 * A capture-path baseline promotion was refused because its build is `cancelled` (terminal) or
 * was superseded by a retry (a newer capture generation): late work never moves a baseline.
 */
export class BaselinePromotionRefused extends Error {
  override readonly name = "BaselinePromotionRefused";
}
