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
  Button,
  Badge,
  Modal,
  FormLayout,
  DataTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const locations = await prisma.pickupLocation.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });

  return json({ locations });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "create") {
    const name = formData.get("name") as string;
    const address = formData.get("address") as string;
    const isDefault = formData.get("isDefault") === "true";

    // If this is set as default, unset other defaults
    if (isDefault) {
      await prisma.pickupLocation.updateMany({
        where: { shop },
        data: { isDefault: false },
      });
    }

    await prisma.pickupLocation.create({
      data: {
        shop,
        name,
        address,
        isActive: true,
        isDefault,
      },
    });
  } else if (action === "toggle") {
    const id = formData.get("id") as string;
    const location = await prisma.pickupLocation.findUnique({ where: { id } });
    if (location) {
      await prisma.pickupLocation.update({
        where: { id },
        data: { isActive: !location.isActive },
      });
    }
  } else if (action === "setDefault") {
    const id = formData.get("id") as string;
    // Unset all defaults first
    await prisma.pickupLocation.updateMany({
      where: { shop },
      data: { isDefault: false },
    });
    // Set the new default
    await prisma.pickupLocation.update({
      where: { id },
      data: { isDefault: true },
    });
  } else if (action === "delete") {
    const id = formData.get("id") as string;
    await prisma.pickupLocation.delete({ where: { id } });
  }

  return json({ success: true });
};

export default function LocationsSettings() {
  const { locations } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [modalOpen, setModalOpen] = useState(false);
  const [newLocation, setNewLocation] = useState({
    name: "",
    address: "",
    isDefault: false,
  });

  const handleCreate = useCallback(() => {
    if (!newLocation.name || !newLocation.address) return;

    const formData = new FormData();
    formData.append("_action", "create");
    formData.append("name", newLocation.name);
    formData.append("address", newLocation.address);
    formData.append("isDefault", (newLocation.isDefault || locations.length === 0).toString());
    submit(formData, { method: "post" });
    setModalOpen(false);
    setNewLocation({ name: "", address: "", isDefault: false });
  }, [newLocation, locations.length, submit]);

  const handleToggle = useCallback((id: string) => {
    const formData = new FormData();
    formData.append("_action", "toggle");
    formData.append("id", id);
    submit(formData, { method: "post" });
  }, [submit]);

  const handleSetDefault = useCallback((id: string) => {
    const formData = new FormData();
    formData.append("_action", "setDefault");
    formData.append("id", id);
    submit(formData, { method: "post" });
  }, [submit]);

  const handleDelete = useCallback((id: string) => {
    if (confirm("Are you sure you want to delete this location?")) {
      const formData = new FormData();
      formData.append("_action", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    }
  }, [submit]);

  const tableRows = locations.map((location) => [
    <BlockStack key={`name-${location.id}`} gap="100">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {location.name}
        </Text>
        {location.isDefault && <Badge tone="info">Default</Badge>}
      </InlineStack>
    </BlockStack>,
    location.address,
    location.isActive ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge tone="critical">Inactive</Badge>
    ),
    <InlineStack key={location.id} gap="200">
      <Button size="slim" onClick={() => handleToggle(location.id)}>
        {location.isActive ? "Disable" : "Enable"}
      </Button>
      {!location.isDefault && (
        <Button size="slim" onClick={() => handleSetDefault(location.id)}>
          Set Default
        </Button>
      )}
      <Button size="slim" tone="critical" onClick={() => handleDelete(location.id)}>
        Delete
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Pickup Locations"
      primaryAction={{
        content: "Add location",
        onAction: () => setModalOpen(true),
      }}
    >
      <TitleBar title="Pickup Locations" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodySm" tone="subdued">
                Manage your pickup locations. The default location will be shown to customers at checkout.
              </Text>

              {locations.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Location Name", "Address", "Status", "Actions"]}
                  rows={tableRows}
                />
              ) : (
                <EmptyState
                  heading="No pickup locations configured"
                  action={{
                    content: "Add location",
                    onAction: () => setModalOpen(true),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Add at least one pickup location for customers.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                About Locations
              </Text>
              <Text as="p" variant="bodySm">
                Pickup locations are displayed to customers during checkout. They'll see the location name and address.
              </Text>
              <Text as="p" variant="bodySm">
                The <Badge tone="info">Default</Badge> location is automatically selected for customers.
              </Text>
              <Text as="p" variant="bodySm">
                You can disable locations temporarily without deleting them.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Pickup Location"
        primaryAction={{
          content: "Add",
          onAction: handleCreate,
          loading: isLoading,
          disabled: !newLocation.name || !newLocation.address,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Location name"
              value={newLocation.name}
              onChange={(v) => setNewLocation({ ...newLocation, name: v })}
              placeholder="e.g., Olivenhain Porch Pick-up"
              autoComplete="off"
            />
            <TextField
              label="Address"
              value={newLocation.address}
              onChange={(v) => setNewLocation({ ...newLocation, address: v })}
              placeholder="e.g., 3637 Copper Crest Road, Encinitas, 92024"
              autoComplete="off"
              multiline={2}
            />
            {locations.length > 0 && (
              <InlineStack gap="200" blockAlign="center">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={newLocation.isDefault}
                  onChange={(e) =>
                    setNewLocation({ ...newLocation, isDefault: e.target.checked })
                  }
                />
                <label htmlFor="isDefault">
                  <Text as="span" variant="bodySm">
                    Set as default location
                  </Text>
                </label>
              </InlineStack>
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
