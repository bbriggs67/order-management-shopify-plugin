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

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    newPickupDate: string,
    newTimeSlot: string,
    reason: string
  ) => Promise<void>;
  loading: boolean;
  availableTimeSlots: AvailableTimeSlot[];
}

export function RescheduleModal({
  open,
  onClose,
  onConfirm,
  loading,
  availableTimeSlots,
}: Props) {
  const [pickupDate, setPickupDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [reason, setReason] = useState("");

  if (!open) return null;

  // Generate next 4 weeks of dates for selection
  const dateOptions: { label: string; value: string }[] = [];
  const today = new Date();
  for (let i = 3; i <= 28; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const display = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    // Use T12:00:00 to avoid timezone date shift
    const isoDate = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}-${String(date.getDate()).padStart(
      2,
      "0"
    )}T12:00:00`;
    dateOptions.push({ label: display, value: isoDate });
  }

  const timeSlotOptions = availableTimeSlots.map((ts) => ({
    label: ts.label,
    value: ts.label,
  }));

  const canSubmit = pickupDate && timeSlot;

  return (
    <Modal
      title="Reschedule Next Pickup"
      open={open}
      onClose={onClose}
      primaryAction={
        <Button
          kind="primary"
          onPress={() => onConfirm(pickupDate, timeSlot, reason)}
          disabled={loading || !canSubmit}
          loading={loading}
        >
          Reschedule
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
          Choose a new date and time for your next pickup only. After this
          pickup, your regular schedule will resume.
        </Text>
        <Select
          label="New Pickup Date"
          value={pickupDate}
          onChange={setPickupDate}
          options={[
            { label: "Select a date...", value: "" },
            ...dateOptions,
          ]}
        />
        <Select
          label="Time Slot"
          value={timeSlot}
          onChange={setTimeSlot}
          options={[
            { label: "Select a time...", value: "" },
            ...timeSlotOptions,
          ]}
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
