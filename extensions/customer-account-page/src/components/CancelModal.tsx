import {
  BlockStack,
  Button,
  Text,
  TextField,
  Banner,
  Modal,
} from "@shopify/ui-extensions-react/customer-account";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
  loading: boolean;
}

export function CancelModal({ open, onClose, onConfirm, loading }: Props) {
  const [comment, setComment] = useState("");

  if (!open) return null;

  return (
    <Modal
      title="Cancel Subscription"
      open={open}
      onClose={onClose}
      primaryAction={
        <Button
          kind="critical"
          onPress={() => onConfirm(comment)}
          disabled={loading}
          loading={loading}
        >
          Cancel Subscription
        </Button>
      }
      secondaryAction={
        <Button kind="plain" onPress={onClose} disabled={loading}>
          Go Back
        </Button>
      }
    >
      <BlockStack spacing="base">
        <Banner status="warning">
          This action cannot be undone. Your subscription will be permanently
          cancelled.
        </Banner>
        <Text>
          We're sorry to see you go! If there's anything we can improve,
          please let us know below.
        </Text>
        <TextField
          label="Feedback (optional)"
          value={comment}
          onChange={setComment}
          multiline={3}
        />
      </BlockStack>
    </Modal>
  );
}
