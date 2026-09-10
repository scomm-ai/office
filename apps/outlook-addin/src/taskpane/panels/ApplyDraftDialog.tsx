import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import { Button, Text, Textarea, tokens, usePaneStyles } from "../ui/layout";

export function ApplyDraftDialog({
  open,
  currentBody,
  proposedBody,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  currentBody: string;
  proposedBody: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const styles = usePaneStyles();
  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onCancel() : undefined)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Replace draft body?</DialogTitle>
          <DialogContent className={styles.stack}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Current draft
            </Text>
            <Textarea className={styles.code} readOnly value={currentBody || "(empty)"} rows={5} resize="vertical" />
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Proposed replacement
            </Text>
            <Textarea className={styles.code} readOnly value={proposedBody} rows={5} resize="vertical" />
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={onConfirm}>
              Replace draft
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
