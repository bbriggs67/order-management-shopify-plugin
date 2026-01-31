/**
 * Customer Subscription Portal - App Proxy Route
 *
 * This route is accessed via the Shopify App Proxy at:
 * https://yourstore.myshopify.com/apps/my-subscription
 *
 * Shopify automatically passes customer information via query parameters
 * when the customer is logged in.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import {
  getCustomerSubscriptions,
  customerPauseSubscription,
  customerResumeSubscription,
  customerCancelSubscription,
  customerOneTimeReschedule,
  customerClearOneTimeReschedule,
  customerPermanentReschedule,
  getAvailablePickupDays,
  getAvailableTimeSlots,
} from "../services/customer-subscription.server";
import { formatDatePacific } from "../utils/timezone.server";
import { getDayName, isValidFrequency, isValidDayOfWeek } from "../utils/constants.server";
import { escapeHtml } from "../utils/html.server";
import {
  checkRateLimit,
  getCustomerPortalRateLimitKey,
  getFormSubmissionRateLimitKey,
  RATE_LIMITS,
} from "../utils/rate-limiter.server";

// ============================================
// App Proxy Signature Verification
// ============================================

function verifyAppProxySignature(query: URLSearchParams): boolean {
  const signature = query.get("signature");
  if (!signature) return false;

  // Build the query string without signature for verification
  const params: string[] = [];
  query.forEach((value, key) => {
    if (key !== "signature") {
      params.push(`${key}=${value}`);
    }
  });
  params.sort();
  const queryString = params.join("");

  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiSecret) {
    console.error("SHOPIFY_API_SECRET not configured");
    return false;
  }

  const calculatedSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(calculatedSignature)
  );
}

// ============================================
// HTML Templates
// ============================================

function renderPage(content: string, title: string = "My Subscription"): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Susie's Sourdough</title>
  <style>
    :root {
      --primary-color: #8B4513;
      --primary-hover: #A0522D;
      --success-color: #228B22;
      --warning-color: #DAA520;
      --danger-color: #DC143C;
      --bg-color: #FFF8F0;
      --card-bg: #FFFFFF;
      --text-color: #333333;
      --text-muted: #666666;
      --border-color: #E5D5C5;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color);
      line-height: 1.6;
      padding: 20px;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
    }

    h1 {
      color: var(--primary-color);
      font-size: 1.75rem;
      margin-bottom: 1.5rem;
      text-align: center;
    }

    .card {
      background: var(--card-bg);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid var(--border-color);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border-color);
    }

    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--primary-color);
    }

    .status-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 500;
    }

    .status-active {
      background: #E8F5E9;
      color: var(--success-color);
    }

    .status-paused {
      background: #FFF8E1;
      color: var(--warning-color);
    }

    .status-cancelled {
      background: #FFEBEE;
      color: var(--danger-color);
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
    }

    .info-label {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .info-value {
      font-weight: 500;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color);
    }

    .btn {
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      text-align: center;
    }

    .btn-primary {
      background: var(--primary-color);
      color: white;
    }

    .btn-primary:hover {
      background: var(--primary-hover);
    }

    .btn-warning {
      background: var(--warning-color);
      color: white;
    }

    .btn-danger {
      background: transparent;
      color: var(--danger-color);
      border: 1px solid var(--danger-color);
    }

    .btn-danger:hover {
      background: #FFEBEE;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    .form-label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
      font-size: 0.9rem;
    }

    .form-textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 1rem;
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }

    .form-textarea:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .message {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
    }

    .message-success {
      background: #E8F5E9;
      color: var(--success-color);
      border: 1px solid #C8E6C9;
    }

    .message-error {
      background: #FFEBEE;
      color: var(--danger-color);
      border: 1px solid #FFCDD2;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
    }

    .empty-state h2 {
      font-size: 1.25rem;
      margin-bottom: 0.5rem;
      color: var(--text-color);
    }

    .login-prompt {
      text-align: center;
      padding: 2rem;
    }

    .login-prompt a {
      color: var(--primary-color);
      text-decoration: underline;
    }

    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal {
      background: white;
      border-radius: 12px;
      max-width: 400px;
      width: 100%;
      padding: 1.5rem;
    }

    .modal h2 {
      margin-bottom: 1rem;
      color: var(--primary-color);
    }

    .modal-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .modal-actions .btn {
      flex: 1;
    }

    .btn-secondary {
      background: #f5f5f5;
      color: var(--text-color);
    }

    .form-input,
    .form-select {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 1rem;
      font-family: inherit;
    }

    .form-input:focus,
    .form-select:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .info-banner {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }

    .info-banner-blue {
      background: #E3F2FD;
      border: 1px solid #90CAF9;
      color: #1565C0;
    }
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>

  <script>
    function showModal(modalId) {
      document.getElementById(modalId).classList.add('active');
    }

    function hideModal(modalId) {
      document.getElementById(modalId).classList.remove('active');
    }

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });
  </script>
</body>
</html>
  `.trim();
}

function renderSubscriptionCard(
  subscription: {
    id: string;
    status: string;
    frequency: string;
    preferredDay: number;
    preferredTimeSlot: string;
    discountPercent: number;
    nextPickupDate: Date | null;
    pausedUntil: Date | null;
    oneTimeRescheduleDate: Date | null;
    oneTimeRescheduleTimeSlot: string | null;
    oneTimeRescheduleReason: string | null;
  },
  baseUrl: string,
  subscriptionIndex: number,
  totalSubscriptions: number,
  availableDays: number[],
  availableTimeSlots: Array<{ label: string; startTime: string }>
): string {
  const statusClass = subscription.status.toLowerCase();
  const dayName = getDayName(subscription.preferredDay);
  const frequencyLabel = subscription.frequency === "WEEKLY" ? "Weekly" : "Bi-weekly";

  // Create a descriptive title that includes the pickup day
  // This helps customers distinguish between multiple subscriptions (e.g., Tuesday vs Friday pickup)
  const cardTitle = totalSubscriptions > 1
    ? `${dayName} Pickup (${frequencyLabel})`
    : `${frequencyLabel} Subscription`;

  const nextPickup = subscription.nextPickupDate
    ? formatDatePacific(subscription.nextPickupDate)
    : "Not scheduled";

  const pausedUntilDate = subscription.pausedUntil
    ? formatDatePacific(subscription.pausedUntil)
    : null;

  let actionsHtml = "";

  // Generate time slot options HTML
  const timeSlotOptions = availableTimeSlots
    .map((ts) => `<option value="${ts.label}">${ts.label}</option>`)
    .join("");

  // Generate day options HTML
  const dayOptions = availableDays
    .map((day) => `<option value="${day}">${getDayName(day)}</option>`)
    .join("");

  // One-time reschedule info banner (escape user-controllable data)
  const rescheduleInfoHtml = subscription.oneTimeRescheduleDate ? `
    <div class="info-banner info-banner-blue">
      <strong>One-Time Reschedule Active:</strong> Next pickup changed to
      ${escapeHtml(formatDatePacific(subscription.oneTimeRescheduleDate))} at ${escapeHtml(subscription.oneTimeRescheduleTimeSlot || subscription.preferredTimeSlot)}.
      ${subscription.oneTimeRescheduleReason ? `<br><em>Reason: ${escapeHtml(subscription.oneTimeRescheduleReason)}</em>` : ""}
      <br><small>After this pickup, your subscription will return to ${escapeHtml(dayName)}s at ${escapeHtml(subscription.preferredTimeSlot)}.</small>
      <form method="POST" action="${escapeHtml(baseUrl)}" style="margin-top: 8px;">
        <input type="hidden" name="action" value="clearReschedule">
        <input type="hidden" name="subscriptionId" value="${escapeHtml(subscription.id)}">
        <button type="submit" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">
          Revert to Regular Schedule
        </button>
      </form>
    </div>
  ` : "";

  // Escape IDs and URLs for use in HTML attributes
  const safeSubId = escapeHtml(subscription.id);
  const safeBaseUrl = escapeHtml(baseUrl);
  const safeDayName = escapeHtml(dayName);
  const safeDayNameLower = escapeHtml(dayName.toLowerCase());
  const safeTimeSlot = escapeHtml(subscription.preferredTimeSlot);

  if (subscription.status === "ACTIVE") {
    actionsHtml = `
      ${rescheduleInfoHtml}
      <div class="actions">
        <button class="btn btn-primary" onclick="showModal('reschedule-modal-${safeSubId}')">
          Reschedule Next Pickup
        </button>
        <button class="btn btn-secondary" onclick="showModal('change-schedule-modal-${safeSubId}')">
          Change Regular Schedule
        </button>
        <button class="btn btn-warning" onclick="showModal('pause-modal-${safeSubId}')">
          Pause Subscription
        </button>
        <button class="btn btn-danger" onclick="showModal('cancel-modal-${safeSubId}')">
          Cancel Subscription
        </button>
      </div>

      <!-- One-Time Reschedule Modal -->
      <div class="modal-overlay" id="reschedule-modal-${safeSubId}">
        <div class="modal">
          <h2>Reschedule Next Pickup</h2>
          <p>This is a one-time change. After this pickup, your subscription will return to its regular schedule (${safeDayName}s at ${safeTimeSlot}).</p>
          <form method="POST" action="${safeBaseUrl}">
            <input type="hidden" name="action" value="oneTimeReschedule">
            <input type="hidden" name="subscriptionId" value="${safeSubId}">
            <div class="form-group">
              <label class="form-label">New Pickup Date</label>
              <input type="date" name="newPickupDate" class="form-input" required min="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label class="form-label">Time Slot</label>
              <select name="newTimeSlot" class="form-select" required>
                ${timeSlotOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Reason (optional)</label>
              <textarea name="reason" class="form-textarea" placeholder="e.g., Out of town that day"></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal('reschedule-modal-${safeSubId}')">Cancel</button>
              <button type="submit" class="btn btn-primary">Reschedule</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Permanent Schedule Change Modal -->
      <div class="modal-overlay" id="change-schedule-modal-${safeSubId}">
        <div class="modal">
          <h2>Change Regular Schedule</h2>
          <p>This will permanently change your pickup day and time slot for all future pickups.</p>
          <form method="POST" action="${safeBaseUrl}">
            <input type="hidden" name="action" value="permanentReschedule">
            <input type="hidden" name="subscriptionId" value="${safeSubId}">
            <div class="form-group">
              <label class="form-label">Pickup Day</label>
              <select name="newPreferredDay" class="form-select" required>
                ${dayOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Time Slot</label>
              <select name="newTimeSlot" class="form-select" required>
                ${timeSlotOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Reason (optional)</label>
              <textarea name="reason" class="form-textarea" placeholder="e.g., New work schedule"></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal('change-schedule-modal-${safeSubId}')">Cancel</button>
              <button type="submit" class="btn btn-primary">Update Schedule</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Pause Modal -->
      <div class="modal-overlay" id="pause-modal-${safeSubId}">
        <div class="modal">
          <h2>Pause ${safeDayName} Pickup</h2>
          <p>You can resume your ${safeDayNameLower} subscription anytime.</p>
          <form method="POST" action="${safeBaseUrl}">
            <input type="hidden" name="action" value="pause">
            <input type="hidden" name="subscriptionId" value="${safeSubId}">
            <div class="form-group">
              <label class="form-label">Leave a comment (optional)</label>
              <textarea name="comment" class="form-textarea" placeholder="Let us know why you're pausing..."></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal('pause-modal-${safeSubId}')">Cancel</button>
              <button type="submit" class="btn btn-warning">Pause</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Cancel Modal -->
      <div class="modal-overlay" id="cancel-modal-${safeSubId}">
        <div class="modal">
          <h2>Cancel ${safeDayName} Pickup</h2>
          <p>Are you sure you want to cancel your ${safeDayNameLower} subscription? This cannot be undone from this portal.</p>
          <form method="POST" action="${safeBaseUrl}">
            <input type="hidden" name="action" value="cancel">
            <input type="hidden" name="subscriptionId" value="${safeSubId}">
            <div class="form-group">
              <label class="form-label">Please let us know why (optional)</label>
              <textarea name="comment" class="form-textarea" placeholder="Your feedback helps us improve..."></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal('cancel-modal-${safeSubId}')">Keep Subscription</button>
              <button type="submit" class="btn btn-danger">Cancel Subscription</button>
            </div>
          </form>
        </div>
      </div>
    `;
  } else if (subscription.status === "PAUSED") {
    actionsHtml = `
      <div class="actions">
        <button class="btn btn-primary" onclick="showModal('resume-modal-${safeSubId}')">
          Resume This Subscription
        </button>
        <button class="btn btn-danger" onclick="showModal('cancel-modal-${safeSubId}')">
          Cancel This Subscription
        </button>
      </div>

      <!-- Resume Modal -->
      <div class="modal-overlay" id="resume-modal-${safeSubId}">
        <div class="modal">
          <h2>Resume ${safeDayName} Pickup</h2>
          <p>Your next ${safeDayNameLower} pickup will be scheduled based on your preferences.</p>
          <form method="POST" action="${safeBaseUrl}">
            <input type="hidden" name="action" value="resume">
            <input type="hidden" name="subscriptionId" value="${safeSubId}">
            <div class="form-group">
              <label class="form-label">Any comments? (optional)</label>
              <textarea name="comment" class="form-textarea" placeholder="Excited to have you back!"></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal('resume-modal-${safeSubId}')">Cancel</button>
              <button type="submit" class="btn btn-primary">Resume</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Cancel Modal -->
      <div class="modal-overlay" id="cancel-modal-${safeSubId}">
        <div class="modal">
          <h2>Cancel ${safeDayName} Pickup</h2>
          <p>Are you sure you want to cancel your ${safeDayNameLower} subscription? This cannot be undone from this portal.</p>
          <form method="POST" action="${safeBaseUrl}">
            <input type="hidden" name="action" value="cancel">
            <input type="hidden" name="subscriptionId" value="${safeSubId}">
            <div class="form-group">
              <label class="form-label">Please let us know why (optional)</label>
              <textarea name="comment" class="form-textarea" placeholder="Your feedback helps us improve..."></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal('cancel-modal-${safeSubId}')">Keep Subscription</button>
              <button type="submit" class="btn btn-danger">Cancel Subscription</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${escapeHtml(cardTitle)}</span>
        <span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(subscription.status)}</span>
      </div>

      <div class="info-row">
        <span class="info-label">Pickup Day</span>
        <span class="info-value">${escapeHtml(dayName)}s</span>
      </div>

      <div class="info-row">
        <span class="info-label">Time Slot</span>
        <span class="info-value">${escapeHtml(subscription.preferredTimeSlot)}</span>
      </div>

      <div class="info-row">
        <span class="info-label">Frequency</span>
        <span class="info-value">${escapeHtml(frequencyLabel)}</span>
      </div>

      <div class="info-row">
        <span class="info-label">Discount</span>
        <span class="info-value">${escapeHtml(String(subscription.discountPercent))}% off</span>
      </div>

      ${subscription.status === "ACTIVE" ? `
        <div class="info-row">
          <span class="info-label">Next Pickup</span>
          <span class="info-value">${escapeHtml(nextPickup)}</span>
        </div>
      ` : ""}

      ${pausedUntilDate ? `
        <div class="info-row">
          <span class="info-label">Paused Until</span>
          <span class="info-value">${escapeHtml(pausedUntilDate)}</span>
        </div>
      ` : ""}

      ${actionsHtml}
    </div>
  `;
}

// ============================================
// Loader (GET requests)
// ============================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const query = url.searchParams;

  // Verify signature from Shopify
  if (!verifyAppProxySignature(query)) {
    console.error("Invalid app proxy signature");
    const content = `
      <h1>My Subscription</h1>
      <div class="message message-error">
        Unable to verify your request. Please try again from your store.
      </div>
    `;
    return new Response(renderPage(content), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const shop = query.get("shop");
  const customerEmail = query.get("logged_in_customer_email");
  const message = query.get("message");
  const messageType = query.get("type");

  if (!shop) {
    const content = `
      <h1>My Subscription</h1>
      <div class="message message-error">
        Unable to identify your store. Please try again.
      </div>
    `;
    return new Response(renderPage(content), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Check if customer is logged in
  if (!customerEmail) {
    const content = `
      <h1>My Subscription</h1>
      <div class="login-prompt card">
        <h2>Please Log In</h2>
        <p>You need to be logged in to manage your subscription.</p>
        <p style="margin-top: 1rem;">
          <a href="/account/login">Log in to your account</a>
        </p>
      </div>
    `;
    return new Response(renderPage(content), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Get customer's subscriptions
  const subscriptions = await getCustomerSubscriptions(shop, customerEmail);

  // Get available pickup days and time slots for reschedule options
  const availableDays = await getAvailablePickupDays(shop);
  const availableTimeSlots = await getAvailableTimeSlots(shop);

  let messageHtml = "";
  if (message) {
    const msgClass = messageType === "error" ? "message-error" : "message-success";
    messageHtml = `<div class="message ${msgClass}">${escapeHtml(message)}</div>`;
  }

  if (subscriptions.length === 0) {
    const content = `
      <h1>My Subscription</h1>
      ${messageHtml}
      <div class="empty-state card">
        <h2>No Active Subscriptions</h2>
        <p>You don't have any active subscriptions yet.</p>
        <p style="margin-top: 1rem;">
          Browse our products to start a Subscribe & Save plan!
        </p>
      </div>
    `;
    return new Response(renderPage(content), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Build the base URL for form submissions (preserving signature params)
  const baseUrl = url.pathname + "?" + query.toString();

  const totalSubscriptions = subscriptions.length;
  const subscriptionCards = subscriptions
    .map((sub, index) => renderSubscriptionCard(sub, baseUrl, index, totalSubscriptions, availableDays, availableTimeSlots))
    .join("");

  // Use plural title if customer has multiple subscriptions
  const pageTitle = totalSubscriptions > 1 ? "My Subscriptions" : "My Subscription";

  const content = `
    <h1>${pageTitle}</h1>
    ${messageHtml}
    ${subscriptionCards}
  `;

  return new Response(renderPage(content), {
    headers: { "Content-Type": "text/html" },
  });
};

// ============================================
// Action (POST requests)
// ============================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const query = url.searchParams;

  // Verify signature
  if (!verifyAppProxySignature(query)) {
    console.error("Invalid app proxy signature on POST");
    return new Response(
      renderPage(`
        <h1>My Subscription</h1>
        <div class="message message-error">
          Unable to verify your request. Please try again.
        </div>
      `),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const shop = query.get("shop");
  const customerEmail = query.get("logged_in_customer_email");

  if (!shop || !customerEmail) {
    return new Response(
      renderPage(`
        <h1>My Subscription</h1>
        <div class="message message-error">
          Unable to process your request. Please log in and try again.
        </div>
      `),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Parse form data
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const subscriptionId = formData.get("subscriptionId") as string;
  const comment = formData.get("comment") as string | null;

  if (!action || !subscriptionId) {
    return new Response(
      renderPage(`
        <h1>My Subscription</h1>
        <div class="message message-error">
          Invalid request. Please try again.
        </div>
      `),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Rate limiting - check for form submission abuse
  const rateLimitKey = getFormSubmissionRateLimitKey(shop, customerEmail, action);
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.FORM_SUBMISSION);

  if (!rateLimitResult.allowed) {
    console.warn(`Rate limit exceeded for ${customerEmail} on action ${action}`);
    return new Response(
      renderPage(`
        <h1>My Subscription</h1>
        <div class="message message-error">
          Too many requests. Please wait ${rateLimitResult.retryAfter} seconds before trying again.
        </div>
      `),
      {
        status: 429,
        headers: {
          "Content-Type": "text/html",
          "Retry-After": rateLimitResult.retryAfter.toString(),
        },
      }
    );
  }

  let result;

  switch (action) {
    case "pause":
      result = await customerPauseSubscription(
        shop,
        subscriptionId,
        customerEmail,
        comment || undefined
      );
      break;

    case "resume":
      result = await customerResumeSubscription(
        shop,
        subscriptionId,
        customerEmail,
        comment || undefined
      );
      break;

    case "cancel":
      result = await customerCancelSubscription(
        shop,
        subscriptionId,
        customerEmail,
        comment || undefined
      );
      break;

    case "oneTimeReschedule": {
      const newPickupDateStr = formData.get("newPickupDate") as string;
      const newTimeSlot = formData.get("newTimeSlot") as string;
      const reason = formData.get("reason") as string;

      if (!newPickupDateStr || !newTimeSlot) {
        result = {
          success: false,
          message: "Please select a date and time slot.",
        };
        break;
      }

      const newPickupDate = new Date(newPickupDateStr);
      result = await customerOneTimeReschedule(
        shop,
        subscriptionId,
        customerEmail,
        newPickupDate,
        newTimeSlot,
        reason || undefined
      );
      break;
    }

    case "clearReschedule":
      result = await customerClearOneTimeReschedule(
        shop,
        subscriptionId,
        customerEmail
      );
      break;

    case "permanentReschedule": {
      const newPreferredDayStr = formData.get("newPreferredDay") as string;
      const newTimeSlot = formData.get("newTimeSlot") as string;
      const reason = formData.get("reason") as string;

      if (!newPreferredDayStr || !newTimeSlot) {
        result = {
          success: false,
          message: "Please select a day and time slot.",
        };
        break;
      }

      const newPreferredDay = parseInt(newPreferredDayStr, 10);

      // Validate day of week (0-6)
      if (!isValidDayOfWeek(newPreferredDay)) {
        result = {
          success: false,
          message: "Invalid pickup day selected. Please choose a valid day.",
        };
        break;
      }

      result = await customerPermanentReschedule(
        shop,
        subscriptionId,
        customerEmail,
        newPreferredDay,
        newTimeSlot,
        reason || undefined
      );
      break;
    }

    default:
      result = {
        success: false,
        message: "Unknown action. Please try again.",
      };
  }

  // Redirect back to the portal with a message
  const redirectUrl = new URL(request.url);
  redirectUrl.searchParams.set("message", result.message);
  redirectUrl.searchParams.set("type", result.success ? "success" : "error");

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.toString(),
    },
  });
};
