import {
  reactExtension,
  useApi,
  useApplyAttributeChange,
  useAttributeValues,
  useBuyerJourneyIntercept,
  useSettings,
  BlockStack,
  InlineStack,
  Text,
  Heading,
  Divider,
  Select,
  Banner,
  Spinner,
  Button,
  View,
  Grid,
  BlockSpacer,
  Pressable,
} from "@shopify/ui-extensions-react/checkout";
import { useState, useEffect, useCallback } from "react";

// Types
interface TimeSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
}

interface AvailableDate {
  date: string; // ISO format YYYY-MM-DD
  dayOfWeek: number;
  dayName: string;
  displayDate: string; // Formatted for display
  timeSlots: TimeSlot[];
}

interface PickupLocation {
  id: string;
  name: string;
  address: string;
  isDefault: boolean;
}

interface AvailabilityResponse {
  availableDates: AvailableDate[];
  locations: PickupLocation[];
  defaultLocationId: string | null;
}

// Attribute keys for storing pickup info
const ATTR_PICKUP_DATE = "Pickup Date";
const ATTR_PICKUP_TIME = "Pickup Time Slot";
const ATTR_PICKUP_LOCATION_ID = "Pickup Location ID";
const ATTR_PICKUP_LOCATION_NAME = "Pickup Location";

// Subscription attribute keys (set by cart page widget)
const ATTR_SUBSCRIPTION_ENABLED = "Subscription Enabled";
const ATTR_SUBSCRIPTION_FREQUENCY = "Subscription Frequency";
const ATTR_SUBSCRIPTION_PREFERRED_DAY = "Subscription Preferred Day";
const ATTR_SUBSCRIPTION_DISCOUNT_CODE = "Subscription Discount Code";

// Day of week options for subscription preferred day
const DAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

// Main extension - renders after contact information section
// Using this target instead of delivery-address because products with
// requires_shipping=false may skip the delivery address section entirely
export default reactExtension("purchase.checkout.contact.render-after", () => (
  <PickupScheduler />
));

function PickupScheduler() {
  const { shop, extension } = useApi();
  const settings = useSettings();
  const applyAttributeChange = useApplyAttributeChange();

  // Read existing attribute values
  const [existingDate, existingTime, existingLocationId, subscriptionEnabled, subscriptionFrequency, existingPreferredDay, subscriptionDiscountCode] = useAttributeValues([
    ATTR_PICKUP_DATE,
    ATTR_PICKUP_TIME,
    ATTR_PICKUP_LOCATION_ID,
    ATTR_SUBSCRIPTION_ENABLED,
    ATTR_SUBSCRIPTION_FREQUENCY,
    ATTR_SUBSCRIPTION_PREFERRED_DAY,
    ATTR_SUBSCRIPTION_DISCOUNT_CODE,
  ]);

  // Check if this is a subscription order
  const isSubscription = subscriptionEnabled === "true";

  // NOTE: Discount codes are applied via URL parameter (/checkout?discount=CODE)
  // from the cart page pickup-scheduler.js widget. We intentionally do NOT use
  // useApplyDiscountCodeChange or useDiscountCodes here because importing those
  // hooks causes Shopify to show the discount code input field on checkout.

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    existingDate || null
  );
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(
    existingTime || null
  );
  const [selectedLocation, setSelectedLocation] = useState<string | null>(
    existingLocationId || null
  );
  const [currentWeekStart, setCurrentWeekStart] = useState(0);
  const [preferredDay, setPreferredDay] = useState<string>(
    existingPreferredDay || "2" // Default to Tuesday
  );

  // Settings with defaults
  const title = (settings.title as string) || "Select Pickup Date & Time";
  const subtitle =
    (settings.subtitle as string) ||
    "Choose when you'd like to pick up your order";

  // Block checkout progress if pickup date/time not selected
  useBuyerJourneyIntercept(({ canBlockProgress }) => {
    if (!canBlockProgress) {
      return { behavior: "allow" as const };
    }

    if (!selectedDate) {
      return {
        behavior: "block" as const,
        reason: "Pickup date is required",
        errors: [
          {
            message:
              "Please select a pickup date before proceeding to checkout.",
          },
        ],
      };
    }

    if (!selectedTimeSlot) {
      return {
        behavior: "block" as const,
        reason: "Pickup time slot is required",
        errors: [
          {
            message:
              "Please select a time slot before proceeding to checkout.",
          },
        ],
      };
    }

    return { behavior: "allow" as const };
  });

  // Fetch availability data
  useEffect(() => {
    async function fetchAvailability() {
      try {
        setLoading(true);
        setError(null);

        const shopDomain = shop.myshopifyDomain;
        // Use the extension's app URL for API calls
        const appUrl = extension.appUrl;

        if (!appUrl) {
          console.error("No app URL available from extension context");
          setError("Configuration error: App URL not available.");
          setLoading(false);
          return;
        }

        const apiUrl = `${appUrl}/api/pickup-availability?shop=${encodeURIComponent(shopDomain)}`;
        console.log("Fetching availability from:", apiUrl);

        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        console.log("Response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API error response:", errorText);
          throw new Error(`API returned ${response.status}: ${errorText}`);
        }

        const data: AvailabilityResponse = await response.json();
        console.log("Received data:", data);
        setAvailableDates(data.availableDates);
        setLocations(data.locations);

        // Set default location if not already selected
        if (!selectedLocation && data.defaultLocationId) {
          setSelectedLocation(data.defaultLocationId);
          // Save default location
          const defaultLoc = data.locations.find(
            (l) => l.id === data.defaultLocationId
          );
          if (defaultLoc) {
            await applyAttributeChange({
              type: "updateAttribute",
              key: ATTR_PICKUP_LOCATION_ID,
              value: defaultLoc.id,
            });
            await applyAttributeChange({
              type: "updateAttribute",
              key: ATTR_PICKUP_LOCATION_NAME,
              value: `${defaultLoc.name} - ${defaultLoc.address}`,
            });
          }
        }
      } catch (err) {
        console.error("Error fetching availability:", err);
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setError(`Unable to load pickup times: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    }

    fetchAvailability();
  }, [shop.myshopifyDomain, extension.appUrl]);

  // Save date selection
  const handleDateSelect = useCallback(
    async (date: string) => {
      setSelectedDate(date);
      setSelectedTimeSlot(null); // Reset time slot when date changes

      const dateData = availableDates.find((d) => d.date === date);
      await applyAttributeChange({
        type: "updateAttribute",
        key: ATTR_PICKUP_DATE,
        value: dateData ? `${dateData.displayDate} (${date})` : date,
      });

      // Clear time slot since date changed
      await applyAttributeChange({
        type: "updateAttribute",
        key: ATTR_PICKUP_TIME,
        value: "",
      });
    },
    [availableDates, applyAttributeChange]
  );

  // Save time slot selection
  const handleTimeSlotSelect = useCallback(
    async (timeSlot: string) => {
      setSelectedTimeSlot(timeSlot);

      await applyAttributeChange({
        type: "updateAttribute",
        key: ATTR_PICKUP_TIME,
        value: timeSlot,
      });
    },
    [applyAttributeChange]
  );

  // Save location selection
  const handleLocationSelect = useCallback(
    async (locationId: string) => {
      setSelectedLocation(locationId);

      const location = locations.find((l) => l.id === locationId);
      await applyAttributeChange({
        type: "updateAttribute",
        key: ATTR_PICKUP_LOCATION_ID,
        value: locationId,
      });
      await applyAttributeChange({
        type: "updateAttribute",
        key: ATTR_PICKUP_LOCATION_NAME,
        value: location ? `${location.name} - ${location.address}` : "",
      });
    },
    [locations, applyAttributeChange]
  );

  // Save subscription preferred day
  const handlePreferredDaySelect = useCallback(
    async (day: string) => {
      setPreferredDay(day);

      await applyAttributeChange({
        type: "updateAttribute",
        key: ATTR_SUBSCRIPTION_PREFERRED_DAY,
        value: day,
      });
    },
    [applyAttributeChange]
  );

  // Get visible dates (show 7 at a time)
  const visibleDates = availableDates.slice(
    currentWeekStart,
    currentWeekStart + 7
  );

  // Get time slots for selected date
  const selectedDateData = availableDates.find((d) => d.date === selectedDate);
  const availableTimeSlots = selectedDateData?.timeSlots || [];

  // Navigation handlers
  const canGoPrev = currentWeekStart > 0;
  const canGoNext = currentWeekStart + 7 < availableDates.length;

  const goToPrev = () => {
    if (canGoPrev) {
      setCurrentWeekStart(Math.max(0, currentWeekStart - 7));
    }
  };

  const goToNext = () => {
    if (canGoNext) {
      setCurrentWeekStart(currentWeekStart + 7);
    }
  };

  // Loading state
  if (loading) {
    return (
      <BlockStack spacing="base" padding="base">
        <Heading level={2}>{title}</Heading>
        <InlineStack spacing="base" blockAlignment="center">
          <Spinner />
          <Text>Loading pickup times...</Text>
        </InlineStack>
      </BlockStack>
    );
  }

  // Error state
  if (error) {
    return (
      <BlockStack spacing="base" padding="base">
        <Heading level={2}>{title}</Heading>
        <Banner status="critical">{error}</Banner>
      </BlockStack>
    );
  }

  // No dates available
  if (availableDates.length === 0) {
    return (
      <BlockStack spacing="base" padding="base">
        <Heading level={2}>{title}</Heading>
        <Banner status="warning">
          No pickup dates are currently available. Please contact us for
          assistance.
        </Banner>
      </BlockStack>
    );
  }

  return (
    <BlockStack spacing="base" padding="base">
      <Heading level={2}>{title}</Heading>
      <Text appearance="subdued">{subtitle}</Text>

      {/* Subscription indicator and preferred day selector */}
      {isSubscription && (
        <>
          <Banner status="info">
            <BlockStack spacing="extraTight">
              <Text emphasis="bold">🔄 Subscription Order</Text>
              <Text>
                This is a {subscriptionFrequency?.toLowerCase()} subscription. Your first pickup will be based on the date you select below. Future pickups will be scheduled automatically on your preferred day.
              </Text>
            </BlockStack>
          </Banner>

          <BlockStack spacing="tight">
            <Text emphasis="bold">Preferred Pickup Day (for future orders)</Text>
            <Select
              label="Select your preferred day"
              value={preferredDay}
              onChange={handlePreferredDaySelect}
              options={DAY_OPTIONS}
            />
            <Text appearance="subdued" size="small">
              Future subscription pickups will be scheduled on this day.
            </Text>
          </BlockStack>

          <BlockSpacer spacing="base" />
        </>
      )}

      <Divider />

      {/* Location selector (if multiple locations) */}
      {locations.length > 1 && (
        <BlockStack spacing="tight">
          <Text emphasis="bold">Pickup Location</Text>
          <Select
            label="Select location"
            value={selectedLocation || ""}
            onChange={handleLocationSelect}
            options={locations.map((loc) => ({
              value: loc.id,
              label: `${loc.name} - ${loc.address}`,
            }))}
          />
          <BlockSpacer spacing="base" />
        </BlockStack>
      )}

      {/* Single location display */}
      {locations.length === 1 && (
        <BlockStack spacing="tight">
          <Text emphasis="bold">Pickup Location</Text>
          <Text>{locations[0].name}</Text>
          <Text appearance="subdued" size="small">
            {locations[0].address}
          </Text>
          <BlockSpacer spacing="base" />
        </BlockStack>
      )}

      {/* Date picker */}
      <BlockStack spacing="tight">
        <InlineStack spacing="base" blockAlignment="center">
          <Text emphasis="bold">Select Date</Text>
          <View inlineAlignment="end">
            <InlineStack spacing="tight">
              <Button
                kind="plain"
                disabled={!canGoPrev}
                onPress={goToPrev}
                accessibilityLabel="Previous week"
              >
                Prev
              </Button>
              <Button
                kind="plain"
                disabled={!canGoNext}
                onPress={goToNext}
                accessibilityLabel="Next week"
              >
                Next
              </Button>
            </InlineStack>
          </View>
        </InlineStack>

        <Grid
          columns={["fill", "fill", "fill", "fill", "fill", "fill", "fill"]}
          spacing="tight"
        >
          {visibleDates.map((dateInfo) => (
            <DateButton
              key={dateInfo.date}
              dateInfo={dateInfo}
              isSelected={selectedDate === dateInfo.date}
              onSelect={() => handleDateSelect(dateInfo.date)}
            />
          ))}
        </Grid>
      </BlockStack>

      <BlockSpacer spacing="base" />

      {/* Time slot selector */}
      {selectedDate && (
        <BlockStack spacing="tight">
          <Text emphasis="bold">Select Time Slot</Text>
          {availableTimeSlots.length > 0 ? (
            <Select
              label="Select time"
              value={selectedTimeSlot || ""}
              onChange={handleTimeSlotSelect}
              options={[
                { value: "", label: "Choose a time slot..." },
                ...availableTimeSlots.map((slot) => ({
                  value: slot.label,
                  label: slot.label,
                })),
              ]}
            />
          ) : (
            <Banner status="warning">
              No time slots available for this date.
            </Banner>
          )}
        </BlockStack>
      )}

      {/* Selection summary */}
      {selectedDate && selectedTimeSlot && (
        <>
          <BlockSpacer spacing="base" />
          <Banner status="success">
            <BlockStack spacing="extraTight">
              <Text emphasis="bold">Pickup scheduled:</Text>
              <Text>
                {selectedDateData?.displayDate} at {selectedTimeSlot}
              </Text>
              {locations.length > 0 && selectedLocation && (
                <Text appearance="subdued">
                  {locations.find((l) => l.id === selectedLocation)?.name}
                </Text>
              )}
            </BlockStack>
          </Banner>
        </>
      )}

      {/* Validation message */}
      {!selectedDate && (
        <Banner status="info">Please select a pickup date to continue.</Banner>
      )}
      {selectedDate && !selectedTimeSlot && (
        <Banner status="info">Please select a time slot to continue.</Banner>
      )}
    </BlockStack>
  );
}

// Date button component
interface DateButtonProps {
  dateInfo: AvailableDate;
  isSelected: boolean;
  onSelect: () => void;
}

function DateButton({ dateInfo, isSelected, onSelect }: DateButtonProps) {
  const date = new Date(dateInfo.date + "T12:00:00");
  const dayNum = date.getDate();
  const dayName = dateInfo.dayName.substring(0, 3); // Mon, Tue, etc.

  return (
    <Pressable onPress={onSelect}>
      <View
        border={isSelected ? "base" : "none"}
        borderWidth="medium"
        borderRadius="base"
        padding="tight"
        background={isSelected ? "subdued" : "transparent"}
      >
        <BlockStack spacing="extraTight" inlineAlignment="center">
          <Text size="small" appearance={isSelected ? "accent" : "subdued"}>
            {dayName}
          </Text>
          <Text size="medium" emphasis={isSelected ? "bold" : undefined}>
            {dayNum}
          </Text>
        </BlockStack>
      </View>
    </Pressable>
  );
}
