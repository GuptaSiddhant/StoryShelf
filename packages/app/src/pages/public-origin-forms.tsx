import type { StoredPublicOrigin } from "@storyshelf/core/models";
import type { FC } from "hono/jsx";
import { Field } from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

/** Dialog id of the public-origin form. */
export const EDIT_ORIGIN_DIALOG = "edit-origin";

/** Confirm the detected origin, replace it, or enter one when none was reported. */
export const OriginForm: FC<{ stored: StoredPublicOrigin | null; standalone: boolean }> = ({
  stored,
  standalone,
}) => {
  const confirm = stored !== null && !stored.confirmed;
  return (
    <DialogForm
      dialog={EDIT_ORIGIN_DIALOG}
      action="/admin/public-origin"
      submitLabel={confirm ? "Confirm" : "Save"}
      standalone={standalone}
      backHref="/admin"
    >
      <Field
        label={stored === null ? "Origin" : "Stored origin"}
        name="origin"
        value={stored?.origin ?? ""}
        placeholder="https://shelf.example.com"
        hint={
          stored === null
            ? "The address people use to reach this server."
            : stored.confirmed
              ? "Confirmed. Change it if this is not the address people use."
              : "Detected from your browser. Confirm it, or enter the address people use."
        }
      />
    </DialogForm>
  );
};
