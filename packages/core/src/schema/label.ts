/** A label-type row. */
export interface LabelType {
  id: string;
  projectId: string;
  key: string;
  name: string;
  linkTemplate: string | null;
  color: string | null;
  createdAt: string;
}

/** A build-label row. */
export interface BuildLabel {
  id: string;
  projectId: string;
  buildId: string;
  typeKey: string;
  value: string;
  createdAt: string;
}
