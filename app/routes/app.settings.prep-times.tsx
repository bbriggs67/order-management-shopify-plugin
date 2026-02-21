import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Checkbox,
  Button,
  Banner,
  Divider,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let config = await prisma.prepTimeConfig.findUnique({
    where: { shop },
  });

  // Create default config if none exists
  if (!config) {
    config = await prisma.prepTimeConfig.create({
      data: {
        shop,
        isEnabled: true,
        cutOffTime: "12:00",
        leadTimeBefore: 3,
        leadTimeAfter: 4,
        maxBookingDays: 14,
        customByDay: false,
      },
    });
  }

  return json({ config });
};

// Helper to safely parse integer with validation
function parseLeadTime(value: unknown, min = 1, max = 7): number | null {
  if (!value || value === "") return null;
  const num = parseInt(String(value), 10);
  if (isNaN(num) || num < min || num > max) return null;
  return num;
}

// Helper to validate time format (HH:MM)
function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const formData = await request.formData();
    const data = Object.fromEntries(formData);

    // Validate required fields
    const cutOffTime = String(data.cutOffTime || "12:00");
    if (!isValidTimeFormat(cutOffTime)) {
      return json({ success: false, error: "Invalid cut-off time format" }, { status: 400 });
    }

    const leadTimeBefore = parseLeadTime(data.leadTimeBefore, 1, 7) ?? 3;
    const leadTimeAfter = parseLeadTime(data.leadTimeAfter, 1, 7) ?? 4;
    const maxBookingDaysRaw = parseInt(String(data.maxBookingDays || "14"), 10);
    const maxBookingDays = isNaN(maxBookingDaysRaw) || maxBookingDaysRaw < 7 || maxBookingDaysRaw > 60
      ? 14
      : maxBookingDaysRaw;

    await prisma.prepTimeConfig.upsert({
      where: { shop },
      create: {
        shop,
        isEnabled: data.isEnabled === "true",
        cutOffTime,
        leadTimeBefore,
        leadTimeAfter,
        maxBookingDays,
        customByDay: data.customByDay === "true",
        // Day-specific settings (validated)
        mondayBefore: parseLeadTime(data.mondayBefore),
        mondayAfter: parseLeadTime(data.mondayAfter),
        tuesdayBefore: parseLeadTime(data.tuesdayBefore),
        tuesdayAfter: parseLeadTime(data.tuesdayAfter),
        wednesdayBefore: parseLeadTime(data.wednesdayBefore),
        wednesdayAfter: parseLeadTime(data.wednesdayAfter),
        thursdayBefore: parseLeadTime(data.thursdayBefore),
        thursdayAfter: parseLeadTime(data.thursdayAfter),
        fridayBefore: parseLeadTime(data.fridayBefore),
        fridayAfter: parseLeadTime(data.fridayAfter),
        saturdayBefore: parseLeadTime(data.saturdayBefore),
        saturdayAfter: parseLeadTime(data.saturdayAfter),
        sundayBefore: parseLeadTime(data.sundayBefore),
        sundayAfter: parseLeadTime(data.sundayAfter),
      },
      update: {
        isEnabled: data.isEnabled === "true",
        cutOffTime,
        leadTimeBefore,
        leadTimeAfter,
        maxBookingDays,
        customByDay: data.customByDay === "true",
        // Day-specific settings (validated)
        mondayBefore: parseLeadTime(data.mondayBefore),
        mondayAfter: parseLeadTime(data.mondayAfter),
        tuesdayBefore: parseLeadTime(data.tuesdayBefore),
        tuesdayAfter: parseLeadTime(data.tuesdayAfter),
        wednesdayBefore: parseLeadTime(data.wednesdayBefore),
        wednesdayAfter: parseLeadTime(data.wednesdayAfter),
        thursdayBefore: parseLeadTime(data.thursdayBefore),
        thursdayAfter: parseLeadTime(data.thursdayAfter),
        fridayBefore: parseLeadTime(data.fridayBefore),
        fridayAfter: parseLeadTime(data.fridayAfter),
        saturdayBefore: parseLeadTime(data.saturdayBefore),
        saturdayAfter: parseLeadTime(data.saturdayAfter),
        sundayBefore: parseLeadTime(data.sundayBefore),
        sundayAfter: parseLeadTime(data.sundayAfter),
      },
    });

    return json({ success: true });
  } catch (error) {
    console.error("Error saving prep time config:", error);
    return json({ success: false, error: "Failed to save configuration" }, { status: 500 });
  }
};

export default function PrepTimesSettings() {
  const { config } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [cutOffTime, setCutOffTime] = useState(config.cutOffTime);
  const [leadTimeBefore, setLeadTimeBefore] = useState(config.leadTimeBefore.toString());
  const [leadTimeAfter, setLeadTimeAfter] = useState(config.leadTimeAfter.toString());
  const [maxBookingDays, setMaxBookingDays] = useState(config.maxBookingDays.toString());
  const [customByDay, setCustomByDay] = useState(config.customByDay);

  // Day-specific settings
  const [daySettings, setDaySettings] = useState({
    monday: { before: config.mondayBefore?.toString() || "", after: config.mondayAfter?.toString() || "" },
    tuesday: { before: config.tuesdayBefore?.toString() || "", after: config.tuesdayAfter?.toString() || "" },
    wednesday: { before: config.wednesdayBefore?.toString() || "", after: config.wednesdayAfter?.toString() || "" },
    thursday: { before: config.thursdayBefore?.toString() || "", after: config.thursdayAfter?.toString() || "" },
    friday: { before: config.fridayBefore?.toString() || "", after: config.fridayAfter?.toString() || "" },
    saturday: { before: config.saturdayBefore?.toString() || "", after: config.saturdayAfter?.toString() || "" },
    sunday: { before: config.sundayBefore?.toString() || "", after: config.sundayAfter?.toString() || "" },
  });

  const timeOptions = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += 30) {
      const time = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
      const displayHour = hour % 12 || 12;
      const ampm = hour < 12 ? "AM" : "PM";
      const label = `${displayHour}:${min.toString().padStart(2, "0")} ${ampm}`;
      timeOptions.push({ label, value: time });
    }
  }

  const leadDayOptions = [
    { label: "1 day", value: "1" },
    { label: "2 days", value: "2" },
    { label: "3 days", value: "3" },
    { label: "4 days", value: "4" },
    { label: "5 days", value: "5" },
    { label: "6 days", value: "6" },
    { label: "7 days", value: "7" },
  ];

  const maxDaysOptions = [
    { label: "7 days", value: "7" },
    { label: "14 days", value: "14" },
    { label: "21 days", value: "21" },
    { label: "30 days", value: "30" },
  ];

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("isEnabled", isEnabled.toString());
    formData.append("cutOffTime", cutOffTime);
    formData.append("leadTimeBefore", leadTimeBefore);
    formData.append("leadTimeAfter", leadTimeAfter);
    formData.append("maxBookingDays", maxBookingDays);
    formData.append("customByDay", customByDay.toString());

    if (customByDay) {
      Object.entries(daySettings).forEach(([day, settings]) => {
        if (settings.before) formData.append(`${day}Before`, settings.before);
        if (settings.after) formData.append(`${day}After`, settings.after);
      });
    }

    submit(formData, { method: "post" });
  }, [isEnabled, cutOffTime, leadTimeBefore, leadTimeAfter, maxBookingDays, customByDay, daySettings, submit]);

  const updateDaySetting = (day: string, field: "before" | "after", value: string) => {
    setDaySettings((prev) => ({
      ...prev,
      [day]: { ...prev[day as keyof typeof prev], [field]: value },
    }));
  };

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayLabels: Record<string, string> = {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday",
  };

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Preparation Times"
    >
      <TitleBar title="Preparation Times" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Enable preparation time requirements"
                  checked={isEnabled}
                  onChange={setIsEnabled}
                  helpText="When enabled, customers must order in advance based on these settings"
                />

                {isEnabled && (
                  <>
                    <Divider />

                    <Text as="h3" variant="headingMd">
                      Cut-off Time
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Orders placed before this time will have shorter lead time than orders placed after.
                    </Text>

                    <Select
                      label="Daily cut-off time"
                      options={timeOptions}
                      value={cutOffTime}
                      onChange={setCutOffTime}
                    />

                    <Divider />

                    <Checkbox
                      label="Same preparation time for all days"
                      checked={!customByDay}
                      onChange={(checked) => setCustomByDay(!checked)}
                    />

                    {!customByDay ? (
                      <InlineStack gap="400">
                        <Box minWidth="200px">
                          <Select
                            label="Orders BEFORE cut-off"
                            options={leadDayOptions}
                            value={leadTimeBefore}
                            onChange={setLeadTimeBefore}
                            helpText="Lead time in days"
                          />
                        </Box>
                        <Box minWidth="200px">
                          <Select
                            label="Orders AFTER cut-off"
                            options={leadDayOptions}
                            value={leadTimeAfter}
                            onChange={setLeadTimeAfter}
                            helpText="Lead time in days"
                          />
                        </Box>
                      </InlineStack>
                    ) : (
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">
                          Customize by Day
                        </Text>
                        {days.map((day) => (
                          <InlineStack key={day} gap="400" blockAlign="center">
                            <Box minWidth="100px">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {dayLabels[day]}
                              </Text>
                            </Box>
                            <Box minWidth="150px">
                              <Select
                                label="Before cut-off"
                                labelHidden
                                options={[{ label: "Use default", value: "" }, ...leadDayOptions]}
                                value={daySettings[day as keyof typeof daySettings].before}
                                onChange={(v) => updateDaySetting(day, "before", v)}
                              />
                            </Box>
                            <Box minWidth="150px">
                              <Select
                                label="After cut-off"
                                labelHidden
                                options={[{ label: "Use default", value: "" }, ...leadDayOptions]}
                                value={daySettings[day as keyof typeof daySettings].after}
                                onChange={(v) => updateDaySetting(day, "after", v)}
                              />
                            </Box>
                          </InlineStack>
                        ))}
                        <Banner tone="info">
                          Days with "Use default" will use {leadTimeBefore} days before cut-off and {leadTimeAfter} days after.
                        </Banner>
                      </BlockStack>
                    )}

                    <Divider />

                    <Select
                      label="Maximum booking window"
                      options={maxDaysOptions}
                      value={maxBookingDays}
                      onChange={setMaxBookingDays}
                      helpText="How far in advance customers can select a pickup date"
                    />
                  </>
                )}
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button variant="primary" onClick={handleSave} loading={isLoading}>
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                How it works
              </Text>
              <Text as="p" variant="bodySm">
                Preparation time determines the earliest date a customer can select for pickup.
              </Text>
              <Text as="p" variant="bodySm">
                <strong>Example:</strong> If the cut-off is 12:00 PM with 3 days before and 4 days after:
              </Text>
              <Text as="p" variant="bodySm">
                • Order at 10:00 AM Monday → Earliest pickup: Thursday (3 days)
              </Text>
              <Text as="p" variant="bodySm">
                • Order at 2:00 PM Monday → Earliest pickup: Friday (4 days)
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
