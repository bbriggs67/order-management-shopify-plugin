import {
  BlockStack,
  Button,
  InlineStack,
  Text,
  TextField,
  Modal,
} from "@shopify/ui-extensions-react/customer-account";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
  loading: boolean;
}

export function PauseModal({ open, onClose, onConfirm, loading }: Props) {
  const [comment, setComment] = useState("");

  if (!open) return null;

  return (
    <Modal
      title="Pause Subscription"
      open={open}
      onClose={onClose}
      primaryAction={
        <Button
          kind="primary"
          onPress={() => onConfirm(comment)}
          disabled={loading}
          loading={loading}
        >
          Pause Subscription
        </Button>
      }
      secondaryAction={
        <Button kind="plain" onPress={onClose} disabled={loading}>
          Cancel
        </Button>
      }
    >
      <BlockStack spacing="base">
        <Text>
          Your subscription will be paused and no pickups will be scheduled
          until you resume. You can resume at any time.
        </Text>
        <TextField
          label="Reason (optional)"
          value={comment}
          onChange={setComment}
          multiline={3}
        />
      </BlockStack>
    </Modal>
  );
}
