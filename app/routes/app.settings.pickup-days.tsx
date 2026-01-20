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
  Checkbox,
  Button,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let config = await prisma.pickupDayConfig.findUnique({
    where: { shop },
  });

  // Create default config if none exists (Tue, Wed, Fri, Sat enabled)
  if (!config) {
    config = await prisma.pickupDayConfig.create({
      data: {
        shop,
        sunday: false,
        monday: false,
        tuesday: true,
        wednesday: true,
        thursday: false,
        friday: true,
        saturday: true,
      },
    });
  }

  return json({ config });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();

  await prisma.pickupDayConfig.upsert({
    where: { shop },
    create: {
      shop,
      sunday: formData.get("sunday") === "true",
      monday: formData.get("monday") === "true",
      tuesday: formData.get("tuesday") === "true",
      wednesday: formData.get("wednesday") === "true",
      thursday: formData.get("thursday") === "true",
      friday: formData.get("friday") === "true",
      saturday: formData.get("saturday") === "true",
    },
    update: {
      sunday: formData.get("sunday") === "true",
      monday: formData.get("monday") === "true",
      tuesday: formData.get("tuesday") === "true",
      wednesday: formData.get("wednesday") === "true",
      thursday: formData.get("thursday") === "true",
      friday: formData.get("friday") === "true",
      saturday: formData.get("saturday") === "true",
    },
  });

  return json({ success: true });
};

export default function PickupDaysSettings() {
  const { config } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [days, setDays] = useState({
    sunday: config.sunday,
    monday: config.monday,
    tuesday: config.tuesday,
    wednesday: config.wednesday,
    thursday: config.thursday,
    friday: config.friday,
    saturday: config.saturday,
  });

  const handleSave = useCallback(() => {
    const formData = new FormData();
    Object.entries(days).forEach(([day, enabled]) => {
      formData.append(day, enabled.toString());
    });
    submit(formData, { method: "post" });
  }, [days, submit]);

  const toggleDay = (day: keyof typeof days) => {
    setDays((prev) => ({ ...prev, [day]: !prev[day] }));
  };

  const enabledCount = Object.values(days).filter(Boolean).length;

  const dayConfig = [
    { key: "sunday" as const, label: "Sunday", description: "Usually closed" },
    { key: "monday" as const, label: "Monday", description: "Usually closed" },
    { key: "tuesday" as const, label: "Tuesday", description: "" },
    { key: "wednesday" as const, label: "Wednesday", description: "" },
    { key: "thursday" as const, label: "Thursday", description: "" },
    { key: "friday" as const, label: "Friday", description: "" },
    { key: "saturday" as const, label: "Saturday", description: "" },
  ];

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Pickup Days"
    >
      <TitleBar title="Pickup Days" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodySm" tone="subdued">
                Select which days of the week pickups are available. Customers will only be able to select pickup dates on enabled days.
              </Text>

              <Divider />

              <BlockStack gap="300">
                {dayConfig.map(({ key, label, description }) => (
                  <Box
                    key={key}
                    padding="300"
                    background={days[key] ? "bg-surface-success-subdued" : "bg-surface"}
                    borderRadius="200"
                    borderWidth="025"
                    borderColor={days[key] ? "border-success" : "border"}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {label}
                        </Text>
                        {description && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {description}
                          </Text>
                        )}
                      </BlockStack>
                      <Checkbox
                        label=""
                        labelHidden
                        checked={days[key]}
                        onChange={() => toggleDay(key)}
                      />
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>

              <Divider />

              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodySm" tone="subdued">
                  {enabledCount} day{enabledCount !== 1 ? "s" : ""} enabled for pickups
                </Text>
                <Button variant="primary" onClick={handleSave} loading={isLoading}>
                  Save
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Tips
              </Text>
              <Text as="p" variant="bodySm">
                • Customers can only select enabled days for pickup
              </Text>
              <Text as="p" variant="bodySm">
                • Disabled days will appear greyed out in the calendar
              </Text>
              <Text as="p" variant="bodySm">
                • You can also use blackout dates for specific closures (holidays, vacations)
              </Text>
              <Text as="p" variant="bodySm">
                • Changes take effect immediately for new orders
              </Text>
            </BlockStack>
          </Card>

          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Current Schedule
                </Text>
                <Text as="p" variant="bodySm">
                  Pickups available on:
                </Text>
                <BlockStack gap="100">
                  {dayConfig
                    .filter(({ key }) => days[key])
                    .map(({ label }) => (
                      <Text key={label} as="p" variant="bodySm">
                        • {label}
                      </Text>
                    ))}
                  {enabledCount === 0 && (
                    <Text as="p" variant="bodySm" tone="critical">
                      No days enabled - customers cannot schedule pickups!
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
