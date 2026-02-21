import prisma from "../db.server";

// Default templates
const DEFAULT_SMS_TEMPLATE =
  "Hi {name}! Your Susie's Sourdough order #{number} is ready for pickup at {location}. Time slot: {time_slot}";
const DEFAULT_EMAIL_SUBJECT = "Your Susie's Sourdough Order is Ready!";
const DEFAULT_EMAIL_TEMPLATE = `<p>Hi {name},</p>
<p>Great news! Your order <strong>#{number}</strong> is ready for pickup.</p>
<p><strong>Pickup Details:</strong></p>
<ul>
  <li>Location: {location}</li>
  <li>Date: {date}</li>
  <li>Time Slot: {time_slot}</li>
</ul>
<p>We look forward to seeing you!</p>
<p>- Susie's Sourdough</p>`;

interface TemplateVariables {
  name: string;
  number: string;
  location: string;
  date: string;
  time_slot: string;
}

/**
 * Replace template variables with actual values
 */
function replaceTemplateVariables(template: string, variables: TemplateVariables): string {
  return template
    .replace(/{name}/g, variables.name)
    .replace(/{number}/g, variables.number)
    .replace(/{location}/g, variables.location)
    .replace(/{date}/g, variables.date)
    .replace(/{time_slot}/g, variables.time_slot);
}

/**
 * Send SMS via Twilio
 */
export async function sendSMS(to: string, message: string): Promise<{ success: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log("Twilio not configured, skipping SMS");
    return { success: false, error: "Twilio not configured" };
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: message,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Twilio error:", errorData);
      return { success: false, error: errorData.message || "Failed to send SMS" };
    }

    return { success: true };
  } catch (error) {
    console.error("SMS send error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Send Email via SendGrid
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    console.log("SendGrid not configured, skipping email");
    return { success: false, error: "SendGrid not configured" };
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: "Susie's Sourdough" },
        subject,
        content: [{ type: "text/html", value: htmlContent }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("SendGrid error:", errorText);
      return { success: false, error: "Failed to send email" };
    }

    return { success: true };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Send "Order Ready" notification to customer
 * Prefers SMS if phone is available, falls back to email
 */
export async function sendReadyNotification(
  pickupScheduleId: string,
  shop: string
): Promise<{ success: boolean; method?: string; error?: string }> {
  // Fetch the pickup schedule with location
  const pickup = await prisma.pickupSchedule.findUnique({
    where: { id: pickupScheduleId },
    include: { pickupLocation: true },
  });

  if (!pickup) {
    return { success: false, error: "Pickup schedule not found" };
  }

  // Fetch notification settings
  const settings = await prisma.notificationSettings.findUnique({
    where: { shop },
  });

  // Prepare template variables
  const pickupDate = new Date(pickup.pickupDate);
  const variables: TemplateVariables = {
    name: pickup.customerName.split(" ")[0], // First name
    number: pickup.shopifyOrderNumber.replace("#", ""),
    location: pickup.pickupLocation
      ? `${pickup.pickupLocation.name} - ${pickup.pickupLocation.address}`
      : "Our pickup location",
    date: pickupDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    time_slot: pickup.pickupTimeSlot,
  };

  // Determine if SMS or email should be used
  const smsEnabled = settings?.smsEnabled ?? true;
  const emailEnabled = settings?.emailEnabled ?? true;

  let result: { success: boolean; method?: string; error?: string } = {
    success: false,
    error: "No contact method available",
  };

  // Try SMS first if customer has phone and SMS is enabled
  if (pickup.customerPhone && smsEnabled) {
    const smsTemplate = settings?.smsTemplate || DEFAULT_SMS_TEMPLATE;
    const smsMessage = replaceTemplateVariables(smsTemplate, variables);
    const smsResult = await sendSMS(pickup.customerPhone, smsMessage);

    // Log the attempt
    await prisma.notificationLog.create({
      data: {
        shop,
        pickupScheduleId,
        type: "SMS",
        recipient: pickup.customerPhone,
        status: smsResult.success ? "SENT" : "FAILED",
        sentAt: smsResult.success ? new Date() : null,
        errorMessage: smsResult.error || null,
      },
    });

    if (smsResult.success) {
      return { success: true, method: "SMS" };
    }

    result = { success: false, method: "SMS", error: smsResult.error };
  }

  // Try email if customer has email and email is enabled
  if (pickup.customerEmail && emailEnabled) {
    const emailSubject = settings?.emailSubject || DEFAULT_EMAIL_SUBJECT;
    const emailTemplate = settings?.emailTemplate || DEFAULT_EMAIL_TEMPLATE;
    const emailContent = replaceTemplateVariables(emailTemplate, variables);
    const emailResult = await sendEmail(pickup.customerEmail, emailSubject, emailContent);

    // Log the attempt
    await prisma.notificationLog.create({
      data: {
        shop,
        pickupScheduleId,
        type: "EMAIL",
        recipient: pickup.customerEmail,
        status: emailResult.success ? "SENT" : "FAILED",
        sentAt: emailResult.success ? new Date() : null,
        errorMessage: emailResult.error || null,
      },
    });

    if (emailResult.success) {
      return { success: true, method: "EMAIL" };
    }

    result = { success: false, method: "EMAIL", error: emailResult.error };
  }

  // If neither method worked but we logged attempts, that's still useful
  if (!pickup.customerPhone && !pickup.customerEmail) {
    // Log that no contact info was available
    await prisma.notificationLog.create({
      data: {
        shop,
        pickupScheduleId,
        type: "NONE",
        recipient: "N/A",
        status: "FAILED",
        errorMessage: "No customer contact information available",
      },
    });
  }

  return result;
}

/**
 * Check if notification services are configured
 */
export function getNotificationStatus(): {
  sms: boolean;
  email: boolean;
} {
  return {
    sms: !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    ),
    email: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
  };
}
