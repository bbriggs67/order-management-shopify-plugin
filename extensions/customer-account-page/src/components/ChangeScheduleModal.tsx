import {
  BlockStack,
  Button,
  Text,
  TextField,
  Select,
  Modal,
} from "@shopify/ui-extensions-react/customer-account";
import { useState } from "react";
import type { AvailableTimeSlot } from "../types";
import { DAY_NAMES } from "../utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    newPreferredDay: number,
    newTimeSlot: string,
    reason: string
  ) => Promise<void>;
  loading: boolean;
  availableDays: number[];
  availableTimeSlots: AvailableTimeSlot[];
  currentDay: number;
  currentTimeSlot: string;
}

export function ChangeScheduleModal({
  open,
  onClose,
  onConfirm,
  loading,
  availableDays,
  availableTimeSlots,
  currentDay,
  currentTimeSlot,
}: Props) {
  const [preferredDay, setPreferredDay] = useState(String(currentDay));
  const [timeSlot, setTimeSlot] = useState(currentTimeSlot);
  const [reason, setReason] = useState("");

  if (!open) return null;

  const dayOptions = availableDays.map((d) => ({
    label: DAY_NAMES[d] || `Day ${d}`,
    value: String(d),
  }));

  const timeSlotOptions = availableTimeSlots.map((ts) => ({
    label: ts.label,
    value: ts.label,
  }));

  const hasChanged =
    parseInt(preferredDay) !== currentDay || timeSlot !== currentTimeSlot;

  return (
    <Modal
      title="Change Regular Schedule"
      open={open}
      onClose={onClose}
      primaryAction={
        <Button
          kind="primary"
          onPress={() =>
            onConfirm(parseInt(preferredDay), timeSlot, reason)
          }
          disabled={loading || !hasChanged}
          loading={loading}
        >
          Update Schedule
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
          This will permanently change your regular pickup day and time. All
          future pickups will follow the new schedule.
        </Text>
        <Select
          label="Preferred Day"
          value={preferredDay}
          onChange={setPreferredDay}
          options={dayOptions}
        />
        <Select
          label="Time Slot"
          value={timeSlot}
          onChange={setTimeSlot}
          options={timeSlotOptions}
        />
        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={setReason}
          multiline={2}
        />
      </BlockStack>
    </Modal>
  );
}
