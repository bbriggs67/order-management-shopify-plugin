import {
  BlockStack,
  Button,
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

export function ResumeModal({ open, onClose, onConfirm, loading }: Props) {
  const [comment, setComment] = useState("");

  if (!open) return null;

  return (
    <Modal
      title="Resume Subscription"
      open={open}
      onClose={onClose}
      primaryAction={
        <Button
          kind="primary"
          onPress={() => onConfirm(comment)}
          disabled={loading}
          loading={loading}
        >
          Resume Subscription
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
          Your subscription will be reactivated and your next pickup will be
          scheduled automatically based on your preferred day.
        </Text>
        <TextField
          label="Comment (optional)"
          value={comment}
          onChange={setComment}
          multiline={3}
        />
      </BlockStack>
    </Modal>
  );
}
