/** Content ref row for deduplicated assets. */
export interface ContentRef {
  hash: string;
  refCount: number;
  lastSeenAt: string;
  createdAt: string;
}
