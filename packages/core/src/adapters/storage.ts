export interface StorageAdapter {
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
