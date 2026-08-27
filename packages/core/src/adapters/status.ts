export type CheckStatus = "pending" | "success" | "failure";

export interface StatusAdapter {
  setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void>;
}
