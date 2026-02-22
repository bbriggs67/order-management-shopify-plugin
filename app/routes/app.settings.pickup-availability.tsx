import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Tabs,
  RadioButton,
  Checkbox,
  TextField,
  Select,
  Button,
  Box,
  Divider,
  Popover,
  ActionList,
  Banner,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import {
  getPickupAvailabilityData,
  updateAvailabilityMode,
  toggleDayEnabled,
  updateDayMaxOrders,
  addTimeSlot,
  updateTimeSlot,
  removeTimeSlot,
  copyTimeSlotsFromDay,
  consolidateTimeSlotsToAllDays,
  expandTimeSlotsToAllDays,
  generateTimeOptions,
  type AvailabilityMode,
} from "../services/pickup-availability.server";
import { DAY_NAMES } from "../utils/constants";
const DAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const data = await getPickupAvailabilityData(shop);
  const timeOptions = generateTimeOptions(30);

  return json({ ...data, timeOptions });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  try {
    switch (actionType) {
      case "UPDATE_AVAILABILITY_MODE": {
        const mode = formData.get("availabilityMode") as AvailabilityMode;
        await updateAvailabilityMode(shop, mode);
        // Handle mode transition
        if (mode === "same_for_all") {
          await consolidateTimeSlotsToAllDays(shop);
        } else {
          await expandTimeSlotsToAllDays(shop);
        }
        return json({ success: true });
      }

      case "TOGGLE_DAY": {
        const dayOfWeek = parseInt(formData.get("dayOfWeek") as string);
        const isEnabled = formData.get("isEnabled") === "true";
        await toggleDayEnabled(shop, dayOfWeek, isEnabled);
        return json({ success: true });
      }

      case "UPDATE_DAY_MAX_ORDERS": {
        const dayOfWeek = parseInt(formData.get("dayOfWeek") as string);
        const maxOrdersStr = formData.get("maxOrders") as string;
        const maxOrders = maxOrdersStr ? parseInt(maxOrdersStr) : null;
        await updateDayMaxOrders(shop, dayOfWeek, maxOrders);
        return json({ success: true });
      }

      case "ADD_TIME_SLOT": {
        const dayOfWeekStr = formData.get("dayOfWeek") as string;
        const dayOfWeek = dayOfWeekStr === "null" ? null : parseInt(dayOfWeekStr);
        const startTime = formData.get("startTime") as string;
        const endTime = formData.get("endTime") as string;
        const maxOrdersStr = formData.get("maxOrders") as string;
        const maxOrders = maxOrdersStr ? parseInt(maxOrdersStr) : null;
        await addTimeSlot(shop, { dayOfWeek, startTime, endTime, maxOrders });
        return json({ success: true });
      }

      case "UPDATE_TIME_SLOT": {
        const slotId = formData.get("slotId") as string;
        const startTime = formData.get("startTime") as string;
        const endTime = formData.get("endTime") as string;
        const maxOrdersStr = formData.get("maxOrders") as string;
        const maxOrders = maxOrdersStr === "" ? null : parseInt(maxOrdersStr);
        await updateTimeSlot(shop, slotId, { startTime, endTime, maxOrders });
        return json({ success: true });
      }

      case "REMOVE_TIME_SLOT": {
        const slotId = formData.get("slotId") as string;
        await removeTimeSlot(shop, slotId);
        return json({ success: true });
      }

      case "COPY_FROM_DAY": {
        const sourceDay = parseInt(formData.get("sourceDay") as string);
        const targetDay = parseInt(formData.get("targetDay") as string);
        await copyTimeSlotsFromDay(shop, sourceDay, targetDay);
        return json({ success: true });
      }

      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: "An error occurred" }, { status: 500 });
  }
};

export default function PickupAvailabilitySettings() {
  const { pickupConfig, dayConfigs, timeSlots, timeOptions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [selectedDayIndex, setSelectedDayIndex] = useState(6); // Start on Saturday
  const [copyFromActive, setCopyFromActive] = useState(false);

  // Local state for optimistic UI
  const [localAvailabilityMode, setLocalAvailabilityMode] = useState(pickupConfig.availabilityMode);
  const [localDayConfigs, setLocalDayConfigs] = useState(dayConfigs);
  const [localTimeSlots, setLocalTimeSlots] = useState(timeSlots);

  // Sync with server data when it changes
  useEffect(() => {
    setLocalAvailabilityMode(pickupConfig.availabilityMode);
    setLocalDayConfigs(dayConfigs);
    setLocalTimeSlots(timeSlots);
  }, [pickupConfig, dayConfigs, timeSlots]);

  const isCustomizeByDay = localAvailabilityMode === "customize_by_day";
  const currentDayConfig = localDayConfigs.find((d) => d.dayOfWeek === selectedDayIndex);
  const currentDaySlots = isCustomizeByDay
    ? localTimeSlots.filter((slot) => slot.dayOfWeek === selectedDayIndex)
    : localTimeSlots.filter((slot) => slot.dayOfWeek === null);

  const dayTabs = DAY_ABBREVIATIONS.map((day, index) => ({
    id: `day-${index}`,
    content: day,
    accessibilityLabel: `${DAY_NAMES[index]} settings`,
    panelID: `day-panel-${index}`,
  }));

  // Handlers
  const handleAvailabilityModeChange = useCallback(
    (mode: string) => {
      setLocalAvailabilityMode(mode);
      fetcher.submit(
        { _action: "UPDATE_AVAILABILITY_MODE", availabilityMode: mode },
        { method: "post" }
      );
    },
    [fetcher]
  );

  const handleToggleDay = useCallback(
    (dayOfWeek: number, checked: boolean) => {
      setLocalDayConfigs((prev) =>
        prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, isEnabled: checked } : d))
      );
      fetcher.submit(
        { _action: "TOGGLE_DAY", dayOfWeek: dayOfWeek.toString(), isEnabled: checked.toString() },
        { method: "post" }
      );
    },
    [fetcher]
  );

  const handleDayMaxOrdersChange = useCallback(
    (dayOfWeek: number, value: string) => {
      const maxOrders = value === "" ? null : parseInt(value);
      setLocalDayConfigs((prev) =>
        prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, maxOrders } : d))
      );
    },
    []
  );

  const handleDayMaxOrdersBlur = useCallback(
    (dayOfWeek: number) => {
      const config = localDayConfigs.find((d) => d.dayOfWeek === dayOfWeek);
      fetcher.submit(
        {
          _action: "UPDATE_DAY_MAX_ORDERS",
          dayOfWeek: dayOfWeek.toString(),
          maxOrders: config?.maxOrders?.toString() ?? "",
        },
        { method: "post" }
      );
    },
    [fetcher, localDayConfigs]
  );

  const handleAddSlot = useCallback(() => {
    const dayOfWeek = isCustomizeByDay ? selectedDayIndex : null;
    fetcher.submit(
      {
        _action: "ADD_TIME_SLOT",
        dayOfWeek: dayOfWeek === null ? "null" : dayOfWeek.toString(),
        startTime: "12:00",
        endTime: "14:00",
        maxOrders: "",
      },
      { method: "post" }
    );
  }, [fetcher, isCustomizeByDay, selectedDayIndex]);

  const handleUpdateSlot = useCallback(
    (slotId: string, field: string, value: string) => {
      setLocalTimeSlots((prev) =>
        prev.map((slot) => {
          if (slot.id === slotId) {
            if (field === "maxOrders") {
              return { ...slot, maxOrders: value === "" ? null : parseInt(value) };
            }
            return { ...slot, [field]: value };
          }
          return slot;
        })
      );
    },
    []
  );

  const handleSlotBlur = useCallback(
    (slotId: string) => {
      const slot = localTimeSlots.find((s) => s.id === slotId);
      if (slot) {
        fetcher.submit(
          {
            _action: "UPDATE_TIME_SLOT",
            slotId,
            startTime: slot.startTime,
            endTime: slot.endTime,
            maxOrders: slot.maxOrders?.toString() ?? "",
          },
          { method: "post" }
        );
      }
    },
    [fetcher, localTimeSlots]
  );

  const handleRemoveSlot = useCallback(
    (slotId: string) => {
      setLocalTimeSlots((prev) => prev.filter((s) => s.id !== slotId));
      fetcher.submit({ _action: "REMOVE_TIME_SLOT", slotId }, { method: "post" });
    },
    [fetcher]
  );

  const handleCopyFrom = useCallback(
    (sourceDay: number) => {
      fetcher.submit(
        {
          _action: "COPY_FROM_DAY",
          sourceDay: sourceDay.toString(),
          targetDay: selectedDayIndex.toString(),
        },
        { method: "post" }
      );
      setCopyFromActive(false);
    },
    [fetcher, selectedDayIndex]
  );

  const copyFromOptions = DAY_NAMES.filter((_, index) => index !== selectedDayIndex).map(
    (day, originalIndex) => {
      // Adjust index since we filtered out current day
      const actualIndex = originalIndex >= selectedDayIndex ? originalIndex + 1 : originalIndex;
      return {
        content: day,
        onAction: () => handleCopyFrom(actualIndex),
      };
    }
  );

  // Fix: Recalculate the actual indices correctly
  const copyFromItems = DAY_NAMES.map((day, index) => ({
    content: day,
    onAction: () => handleCopyFrom(index),
    disabled: index === selectedDayIndex,
  })).filter((item) => !item.disabled);

  const isLoading = fetcher.state !== "idle";

  return (
    <Page backAction={{ content: "Settings", url: "/app/settings" }} title="Pickup Availability">
      <TitleBar title="Pickup Availability" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Availability Mode Selection */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Availability Mode
                </Text>
                <RadioButton
                  label="Customize Availability by Day"
                  helpText="Configure different time slots for each day of the week"
                  checked={localAvailabilityMode === "customize_by_day"}
                  id="customize_by_day"
                  name="availabilityMode"
                  onChange={() => handleAvailabilityModeChange("customize_by_day")}
                />
                <RadioButton
                  label="Same Availability for All Days"
                  helpText="Use the same time slots for all days"
                  checked={localAvailabilityMode === "same_for_all"}
                  id="same_for_all"
                  name="availabilityMode"
                  onChange={() => handleAvailabilityModeChange("same_for_all")}
                />
              </BlockStack>
            </Card>

            {/* Day Tabs (only show in customize mode) */}
            {isCustomizeByDay && (
              <Card padding="0">
                <Tabs
                  tabs={dayTabs}
                  selected={selectedDayIndex}
                  onSelect={setSelectedDayIndex}
                  fitted
                />
                <Box padding="400">
                  <BlockStack gap="400">
                    {/* Day Enable/Disable + Max Orders */}
                    <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
                      <Checkbox
                        label={`Enable Pick Up for ${DAY_NAMES[selectedDayIndex]}`}
                        checked={currentDayConfig?.isEnabled ?? false}
                        onChange={(checked) => handleToggleDay(selectedDayIndex, checked)}
                      />
                      <Box minWidth="150px">
                        <TextField
                          label={`Max orders on ${DAY_NAMES[selectedDayIndex]}`}
                          labelHidden
                          type="number"
                          value={currentDayConfig?.maxOrders?.toString() ?? ""}
                          onChange={(value) => handleDayMaxOrdersChange(selectedDayIndex, value)}
                          onBlur={() => handleDayMaxOrdersBlur(selectedDayIndex)}
                          placeholder="Max orders"
                          helpText="Optional"
                          autoComplete="off"
                        />
                      </Box>
                    </InlineStack>

                    <Divider />

                    {/* Time Slots for this day */}
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        Time Slots
                      </Text>

                      {currentDaySlots.length === 0 ? (
                        <Banner tone="info">
                          No time slots configured for {DAY_NAMES[selectedDayIndex]}. Add a slot or
                          copy from another day.
                        </Banner>
                      ) : (
                        <BlockStack gap="200">
                          {currentDaySlots.map((slot) => (
                            <TimeSlotRow
                              key={slot.id}
                              slot={slot}
                              timeOptions={timeOptions}
                              onUpdate={handleUpdateSlot}
                              onBlur={handleSlotBlur}
                              onRemove={handleRemoveSlot}
                            />
                          ))}
                        </BlockStack>
                      )}

                      <InlineStack gap="200">
                        <Button onClick={handleAddSlot} loading={isLoading}>
                          Add Slot
                        </Button>
                        <Popover
                          active={copyFromActive}
                          activator={
                            <Button onClick={() => setCopyFromActive(!copyFromActive)} disclosure>
                              Copy from
                            </Button>
                          }
                          onClose={() => setCopyFromActive(false)}
                        >
                          <ActionList items={copyFromItems} />
                        </Popover>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Box>
              </Card>
            )}

            {/* Same for all days mode */}
            {!isCustomizeByDay && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Time Slots (All Days)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    These time slots will be available on all enabled pickup days.
                  </Text>

                  {currentDaySlots.length === 0 ? (
                    <Banner tone="info">
                      No time slots configured. Add a slot to get started.
                    </Banner>
                  ) : (
                    <BlockStack gap="200">
                      {currentDaySlots.map((slot) => (
                        <TimeSlotRow
                          key={slot.id}
                          slot={slot}
                          timeOptions={timeOptions}
                          onUpdate={handleUpdateSlot}
                          onBlur={handleSlotBlur}
                          onRemove={handleRemoveSlot}
                        />
                      ))}
                    </BlockStack>
                  )}

                  <Button onClick={handleAddSlot} loading={isLoading}>
                    Add Slot
                  </Button>

                  <Divider />

                  {/* Day toggles in same-for-all mode */}
                  <Text as="h3" variant="headingMd">
                    Enabled Days
                  </Text>
                  <InlineStack gap="400" wrap>
                    {localDayConfigs.map((dayConfig) => (
                      <Checkbox
                        key={dayConfig.dayOfWeek}
                        label={DAY_ABBREVIATIONS[dayConfig.dayOfWeek]}
                        checked={dayConfig.isEnabled}
                        onChange={(checked) => handleToggleDay(dayConfig.dayOfWeek, checked)}
                      />
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Tips
              </Text>
              <Text as="p" variant="bodySm">
                <strong>Customize by Day:</strong> Set different time slots for each day. Great if
                you have varying availability throughout the week.
              </Text>
              <Text as="p" variant="bodySm">
                <strong>Same for All Days:</strong> Use the same time slots every day. Simpler to
                manage if your schedule is consistent.
              </Text>
              <Text as="p" variant="bodySm">
                <strong>Max Orders:</strong> Optionally limit the number of pickups per day or per
                time slot to manage capacity.
              </Text>
              <Text as="p" variant="bodySm">
                <strong>Copy From:</strong> Quickly copy time slots from one day to another.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// Time Slot Row Component
interface TimeSlotRowProps {
  slot: {
    id: string;
    startTime: string;
    endTime: string;
    maxOrders: number | null;
  };
  timeOptions: { value: string; label: string }[];
  onUpdate: (slotId: string, field: string, value: string) => void;
  onBlur: (slotId: string) => void;
  onRemove: (slotId: string) => void;
}

function TimeSlotRow({ slot, timeOptions, onUpdate, onBlur, onRemove }: TimeSlotRowProps) {
  return (
    <InlineStack gap="200" align="start" blockAlign="center" wrap={false}>
      <Box minWidth="120px">
        <Select
          label="Start time"
          labelHidden
          options={timeOptions}
          value={slot.startTime}
          onChange={(value) => onUpdate(slot.id, "startTime", value)}
          onBlur={() => onBlur(slot.id)}
        />
      </Box>
      <Box minWidth="120px">
        <Select
          label="End time"
          labelHidden
          options={timeOptions}
          value={slot.endTime}
          onChange={(value) => onUpdate(slot.id, "endTime", value)}
          onBlur={() => onBlur(slot.id)}
        />
      </Box>
      <Box minWidth="100px">
        <TextField
          label="Max orders"
          labelHidden
          type="number"
          value={slot.maxOrders?.toString() ?? ""}
          onChange={(value) => onUpdate(slot.id, "maxOrders", value)}
          onBlur={() => onBlur(slot.id)}
          placeholder="Max orders"
          autoComplete="off"
        />
      </Box>
      <Button icon={DeleteIcon} tone="critical" onClick={() => onRemove(slot.id)} accessibilityLabel="Remove time slot" />
    </InlineStack>
  );
}
