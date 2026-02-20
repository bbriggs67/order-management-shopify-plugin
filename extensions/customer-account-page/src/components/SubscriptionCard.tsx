import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Divider,
  Banner,
  Heading,
  View,
} from "@shopify/ui-extensions-react/customer-account";
import { useState } from "react";
import type {
  CustomerSubscription,
  AvailableTimeSlot,
  ActionResult,
} from "../types";
import {
  getDayName,
  FREQUENCY_LABELS,
  formatDate,
} from "../utils";
import { PauseModal } from "./PauseModal";
import { ResumeModal } from "./ResumeModal";
import { CancelModal } from "./CancelModal";
import { RescheduleModal } from "./RescheduleModal";
import { ChangeScheduleModal } from "./ChangeScheduleModal";

interface Props {
  subscription: CustomerSubscription;
  availableDays: number[];
  availableTimeSlots: AvailableTimeSlot[];
  onAction: (
    action: string,
    subscriptionId: string,
    params?: Record<string, unknown>
  ) => Promise<ActionResult>;
  onRefresh: () => Promise<void>;
}

type ModalType =
  | "pause"
  | "resume"
  | "cancel"
  | "reschedule"
  | "changeSchedule"
  | null;

export function SubscriptionCard({
  subscription: sub,
  availableDays,
  availableTimeSlots,
  onAction,
  onRefresh,
}: Props) {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    status: "success" | "critical";
  } | null>(null);

  async function handleAction(
    action: string,
    params: Record<string, unknown> = {}
  ) {
    setActionLoading(true);
    setMessage(null);
    try {
      const result = await onAction(action, sub.id, params);
      if (result.success) {
        setMessage({ text: result.message, status: "success" });
        setActiveModal(null);
        await onRefresh();
      } else {
        setMessage({ text: result.message, status: "critical" });
      }
    } catch (err) {
      setMessage({
        text: "Something went wrong. Please try again.",
        status: "critical",
      });
    } finally {
      setActionLoading(false);
    }
  }

  const title = `${getDayName(sub.preferredDay)} Pickup`;
  const frequency = FREQUENCY_LABELS[sub.frequency] || sub.frequency;
  const statusBadge =
    sub.status === "ACTIVE" ? (
      <Badge status="success">Active</Badge>
    ) : (
      <Badge status="warning">Paused</Badge>
    );

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      {/* Header */}
      <InlineStack spacing="base" blockAlignment="center">
        <Heading level={3}>{title}</Heading>
        {statusBadge}
      </InlineStack>

      {/* Status message */}
      {message && (
        <Banner status={message.status} onDismiss={() => setMessage(null)}>
          {message.text}
        </Banner>
      )}

      {/* One-time reschedule banner */}
      {sub.oneTimeRescheduleDate && (
        <Banner status="info">
          <BlockStack spacing="tight">
            <Text emphasis="bold">One-time reschedule active</Text>
            <Text>
              Next pickup: {formatDate(sub.oneTimeRescheduleDate)}
              {sub.oneTimeRescheduleTimeSlot &&
                ` at ${sub.oneTimeRescheduleTimeSlot}`}
            </Text>
            <Button
              kind="plain"
              onPress={() => handleAction("clearReschedule")}
              disabled={actionLoading}
            >
              Revert to regular schedule
            </Button>
          </BlockStack>
        </Banner>
      )}

      <Divider />

      {/* Info rows */}
      <BlockStack spacing="tight">
        <InlineStack spacing="base">
          <Text emphasis="bold">Frequency:</Text>
          <Text>{frequency}</Text>
        </InlineStack>
        <InlineStack spacing="base">
          <Text emphasis="bold">Pickup Day:</Text>
          <Text>{getDayName(sub.preferredDay)}</Text>
        </InlineStack>
        <InlineStack spacing="base">
          <Text emphasis="bold">Time Slot:</Text>
          <Text>{sub.preferredTimeSlot}</Text>
        </InlineStack>
        {sub.discountPercent > 0 && (
          <InlineStack spacing="base">
            <Text emphasis="bold">Discount:</Text>
            <Text>{sub.discountPercent}% off</Text>
          </InlineStack>
        )}
        {sub.status === "ACTIVE" && sub.nextPickupDate && (
          <InlineStack spacing="base">
            <Text emphasis="bold">Next Pickup:</Text>
            <Text>{formatDate(sub.nextPickupDate)}</Text>
          </InlineStack>
        )}
        {sub.status === "PAUSED" && sub.pausedUntil && (
          <InlineStack spacing="base">
            <Text emphasis="bold">Paused Until:</Text>
            <Text>{formatDate(sub.pausedUntil)}</Text>
          </InlineStack>
        )}
      </BlockStack>

      <Divider />

      {/* Action buttons */}
      <InlineStack spacing="base">
        {sub.status === "ACTIVE" && (
          <>
            <Button
              kind="secondary"
              onPress={() => setActiveModal("reschedule")}
            >
              Reschedule Next
            </Button>
            <Button
              kind="secondary"
              onPress={() => setActiveModal("changeSchedule")}
            >
              Change Schedule
            </Button>
            <Button
              kind="secondary"
              onPress={() => setActiveModal("pause")}
            >
              Pause
            </Button>
            <Button
              kind="plain"
              appearance="critical"
              onPress={() => setActiveModal("cancel")}
            >
              Cancel
            </Button>
          </>
        )}
        {sub.status === "PAUSED" && (
          <>
            <Button
              kind="primary"
              onPress={() => setActiveModal("resume")}
            >
              Resume
            </Button>
            <Button
              kind="plain"
              appearance="critical"
              onPress={() => setActiveModal("cancel")}
            >
              Cancel
            </Button>
          </>
        )}
      </InlineStack>

      {/* Modals */}
      <PauseModal
        open={activeModal === "pause"}
        onClose={() => setActiveModal(null)}
        onConfirm={async (comment) => {
          await handleAction("pause", { comment });
        }}
        loading={actionLoading}
      />

      <ResumeModal
        open={activeModal === "resume"}
        onClose={() => setActiveModal(null)}
        onConfirm={async (comment) => {
          await handleAction("resume", { comment });
        }}
        loading={actionLoading}
      />

      <CancelModal
        open={activeModal === "cancel"}
        onClose={() => setActiveModal(null)}
        onConfirm={async (comment) => {
          await handleAction("cancel", { comment });
        }}
        loading={actionLoading}
      />

      <RescheduleModal
        open={activeModal === "reschedule"}
        onClose={() => setActiveModal(null)}
        onConfirm={async (newPickupDate, newTimeSlot, reason) => {
          await handleAction("oneTimeReschedule", {
            newPickupDate,
            newTimeSlot,
            reason,
          });
        }}
        loading={actionLoading}
        availableTimeSlots={availableTimeSlots}
      />

      <ChangeScheduleModal
        open={activeModal === "changeSchedule"}
        onClose={() => setActiveModal(null)}
        onConfirm={async (newPreferredDay, newTimeSlot, reason) => {
          await handleAction("permanentReschedule", {
            newPreferredDay,
            newTimeSlot,
            reason,
          });
        }}
        loading={actionLoading}
        availableDays={availableDays}
        availableTimeSlots={availableTimeSlots}
        currentDay={sub.preferredDay}
        currentTimeSlot={sub.preferredTimeSlot}
      />
    </BlockStack>
  );
}
