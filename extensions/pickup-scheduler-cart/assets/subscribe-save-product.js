/**
 * Subscribe and Save Widget - Product Page Version
 *
 * SSMA-controlled subscription options on the product page.
 * Intercepts the Add to Cart form submission when a subscription is selected,
 * adds the product via /cart/add.js, sets SSMA cart attributes via
 * /cart/update.js, applies the discount code, and navigates to /cart.
 *
 * One-time purchases submit the form normally (no interception).
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'susie_subscription_selection';

  class SubscribeSaveProductWidget {
    constructor(options) {
      this.shopDomain = options.shopDomain || '';
      this.productId = options.productId || '';
      this.container = null;
      this.productForm = null;
      this.plans = [];
      this.selectedPlan = null; // null = one-time purchase

      if (this.isProductPage() && this.productId) {
        this.init();
      }
    }

    isProductPage() {
      return window.location.pathname.includes('/products/');
    }

    async init() {
      // Fetch plans from API
      const apiPlans = await this.fetchPlans();

      if (!apiPlans || apiPlans.length === 0) {
        console.log('Subscribe & Save Product: No plans available');
        return;
      }

      // Check product eligibility — if group has productIds, product must match
      const eligiblePlans = this.filterEligiblePlans(apiPlans);

      if (eligiblePlans.length === 0) {
        console.log('Subscribe & Save Product: Product not eligible for any plans');
        return;
      }

      this.plans = eligiblePlans;

      // Find the product form
      this.productForm = this.findProductForm();
      if (!this.productForm) {
        console.warn('Subscribe & Save Product: Could not find product form');
        return;
      }

      this.injectWidget();
    }

    async fetchPlans() {
      try {
        let apiUrl = `/apps/my-subscription/selling-plans?shop=${encodeURIComponent(this.shopDomain)}`;
        console.log('Subscribe & Save Product: Fetching plans from', apiUrl);

        let response = await fetch(apiUrl);

        // If proxy fails, try the dev tunnel URL (for development)
        if (!response.ok) {
          console.log('Subscribe & Save Product: App proxy failed, status:', response.status);
          const devUrl = document.querySelector('meta[name="subscribe-save-dev-url"]')?.content;
          if (devUrl) {
            apiUrl = `${devUrl}/api/selling-plans?shop=${encodeURIComponent(this.shopDomain)}`;
            console.log('Subscribe & Save Product: Trying dev URL', apiUrl);
            response = await fetch(apiUrl);
          }
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        }

        const data = await response.json();
        console.log('Subscribe & Save Product: Received data from API', data);

        if (data && data.enabled) {
          // Return the structured groups so we can check product eligibility
          if (Array.isArray(data.groups)) {
            return data.groups;
          }
          // Fallback to flat plans list
          if (Array.isArray(data.plans)) {
            return [{ id: 'default', name: 'Subscribe & Save', frequencies: data.plans, productIds: [] }];
          }
        }

        return null;
      } catch (e) {
        console.warn('Subscribe & Save Product: Could not fetch plans from API:', e);
        return null;
      }
    }

    filterEligiblePlans(groups) {
      const eligible = [];

      // Shopify product IDs from Liquid are numeric; API returns GIDs
      // Convert numeric product ID to GID format for comparison
      const productGid = `gid://shopify/Product/${this.productId}`;

      for (const group of groups) {
        const productIds = group.productIds || [];

        // If no product IDs, this group applies to all products
        if (productIds.length === 0) {
          eligible.push(group);
          continue;
        }

        // Check if current product is in the group
        const isMatch = productIds.some(pid => {
          // Handle both GID and numeric formats
          if (pid === productGid) return true;
          if (pid === this.productId) return true;
          // Extract numeric ID from GID for comparison
          const numericId = pid.replace('gid://shopify/Product/', '');
          if (numericId === String(this.productId)) return true;
          return false;
        });

        if (isMatch) {
          eligible.push(group);
        }
      }

      return eligible;
    }

    findProductForm() {
      // Look for product form by common selectors (Dawn and other themes)
      // Some themes have multiple forms matching these selectors (e.g. a hidden
      // form and the real product form). Prefer the form that contains a submit button.
      const selectors = [
        'form[action*="/cart/add"]',
        'form.product-form',
        'form.shopify-product-form',
        'product-form form',
        '.product-form__form',
      ];

      for (const sel of selectors) {
        const forms = document.querySelectorAll(sel);
        if (forms.length === 0) continue;
        // If multiple forms match, prefer the one with a submit button
        if (forms.length > 1) {
          for (const form of forms) {
            if (form.querySelector('[type="submit"], button[name="add"], .product-form__submit')) {
              return form;
            }
          }
        }
        return forms[0];
      }

      return null;
    }

    injectWidget() {
      // Find the submit button to insert before
      const submitBtn =
        this.productForm.querySelector('[type="submit"]') ||
        this.productForm.querySelector('button[name="add"]') ||
        this.productForm.querySelector('.product-form__submit');

      if (!submitBtn) {
        console.warn('Subscribe & Save Product: Could not find submit button');
        return;
      }

      // Hide Shopify's native selling plan selector — SSMA replaces it
      this.hideNativeSellingPlanSelector();

      // Create widget
      this.container = this.createWidgetElement();

      // Insert before the submit button
      submitBtn.parentNode.insertBefore(this.container, submitBtn);

      // Bind events
      this.bindEvents();

      // Restore any previous selection
      this.restoreSelection();

      console.log('Subscribe & Save Product: Widget injected successfully');
    }

    /**
     * Hide Shopify's native selling plan selector.
     * The native selector appears automatically when selling plans are attached
     * to a product. We hide it so only the SSMA widget shows.
     * Uses multiple strategies to find and hide it across different themes.
     */
    hideNativeSellingPlanSelector() {
      const selectors = [
        // Dawn theme and common themes
        '.product-form__input[data-selling-plan-group]',
        '.selling-plan-group',
        'selling-plan-widget',
        '.selling_plan_theme_integration',
        // Fieldset containing selling plan radios
        'fieldset:has(input[name*="selling_plan"])',
        'fieldset:has(input[data-selling-plan-id])',
        'fieldset:has([data-radio-type="selling_plan"])',
        // Container with selling plan hidden input
        '.product-form__selling-plan',
        // Generic: any element with selling-plan in data attributes
        '[data-selling-plan-group]',
      ];

      let hidden = 0;

      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            // Don't hide our own widget
            if (el.id === 'subscribe-save-product-widget' || el.closest('#subscribe-save-product-widget')) return;
            el.classList.add('ssma-native-selling-plan-hidden');
            hidden++;
          });
        } catch (e) {
          // :has() not supported in older browsers — skip that selector
        }
      }

      // Fallback: find any fieldset/div in the product form that contains
      // "One-time purchase" text and selling plan options but is NOT our widget
      if (hidden === 0 && this.productForm) {
        const allFieldsets = this.productForm.querySelectorAll('fieldset, .product-form__input');
        allFieldsets.forEach(el => {
          if (el.id === 'subscribe-save-product-widget' || el.closest('#subscribe-save-product-widget')) return;

          const text = el.textContent || '';
          // Check if this element contains selling plan related text
          if (
            (text.includes('One-time purchase') || text.includes('Subscribe')) &&
            (el.querySelector('input[name*="selling_plan"]') ||
             el.querySelector('[data-selling-plan-id]') ||
             el.querySelector('[data-radio-type]'))
          ) {
            el.classList.add('ssma-native-selling-plan-hidden');
            hidden++;
          }
        });
      }

      // Last resort: hide by looking for the selling plan hidden input and its parent container
      if (hidden === 0) {
        const sellingPlanInput = this.productForm?.querySelector('input[name="selling_plan"]');
        if (sellingPlanInput) {
          // Walk up to find the visible container
          let parent = sellingPlanInput.parentElement;
          while (parent && parent !== this.productForm) {
            // Check if this parent looks like a selling plan container
            const text = parent.textContent || '';
            if (
              (text.includes('One-time purchase') || text.includes('Subscribe')) &&
              parent.querySelector('input[type="radio"]')
            ) {
              parent.classList.add('ssma-native-selling-plan-hidden');
              hidden++;
              break;
            }
            parent = parent.parentElement;
          }
        }
      }

      if (hidden > 0) {
        console.log(`Subscribe & Save Product: Hidden ${hidden} native selling plan element(s)`);
      } else {
        console.log('Subscribe & Save Product: No native selling plan selector found to hide');
      }
    }

    createWidgetElement() {
      const widget = document.createElement('div');
      widget.id = 'subscribe-save-product-widget';
      widget.className = 'ssma-product-widget';

      // Build subscription choices from all eligible groups
      let choicesHTML = '';
      for (const group of this.plans) {
        const frequencies = group.frequencies || [];
        for (const freq of frequencies) {
          const value = freq.frequency ? freq.frequency.toLowerCase() : freq.id;
          choicesHTML += `
            <label class="ssma-product-widget__choice">
              <input type="radio" name="ssma_purchase_option" value="${value}"
                data-frequency="${freq.frequency || ''}"
                data-discount="${freq.discountPercent || 0}"
                data-selling-plan-id="${freq.sellingPlanId || ''}"
                data-group-name="${group.name || ''}">
              <span class="ssma-product-widget__radio"></span>
              <span class="ssma-product-widget__choice-text">
                ${freq.name}${freq.discountPercent > 0 ? `, <strong>${freq.discountPercent}% off</strong>` : ''}
              </span>
            </label>`;
        }
      }

      widget.innerHTML = `
        <div class="ssma-product-widget__options">
          <!-- One-time purchase -->
          <label class="ssma-product-widget__option ssma-product-widget__option--onetime">
            <input type="radio" name="ssma_purchase_option" value="onetime" checked>
            <span class="ssma-product-widget__radio"></span>
            <span class="ssma-product-widget__option-content">
              <span class="ssma-product-widget__option-title">One-time purchase</span>
            </span>
          </label>

          <!-- Subscribe & Save -->
          <div class="ssma-product-widget__option ssma-product-widget__option--subscribe">
            <div class="ssma-product-widget__option-header">
              <span class="ssma-product-widget__option-title">Subscribe & Save (Porch Pick-up Only)</span>
            </div>
            <div class="ssma-product-widget__choices">
              ${choicesHTML}
            </div>
          </div>
        </div>
        <p class="ssma-product-widget__note">Auto-renews, skip or cancel anytime. Discount applied at checkout.</p>
        <div class="ssma-product-widget__status" style="display: none;"></div>
      `;

      return widget;
    }

    bindEvents() {
      // Radio button changes
      const radios = this.container.querySelectorAll('input[type="radio"]');
      radios.forEach(radio => {
        radio.addEventListener('change', (e) => this.handleSelectionChange(e));
      });

      // Intercept form submission — use capturing phase to fire BEFORE
      // Dawn theme's <product-form> custom element handler.
      // Safari doesn't always respect stopPropagation on submit events
      // when the Dawn theme also has its own fetch-based add-to-cart.
      this.productForm.addEventListener('submit', (e) => this.handleFormSubmit(e), true);

      // Also intercept clicks on the submit button directly.
      // Dawn's <product-form> may listen for button clicks and trigger
      // its own /cart/add.js fetch, bypassing the form submit event.
      const submitBtn =
        this.productForm.querySelector('[type="submit"]') ||
        this.productForm.querySelector('button[name="add"]') ||
        this.productForm.querySelector('.product-form__submit');
      if (submitBtn) {
        submitBtn.addEventListener('click', (e) => {
          if (this.selectedPlan) {
            // Prevent the click from reaching Dawn's handler
            e.preventDefault();
            e.stopImmediatePropagation();
            // Manually trigger our submission logic
            this.handleFormSubmit(e);
          }
        }, true); // Capture phase — fire first
      }
    }

    handleSelectionChange(e) {
      const value = e.target.value;
      const subscriptionSection = this.container.querySelector('.ssma-product-widget__option--subscribe');

      if (value === 'onetime') {
        this.selectedPlan = null;
        subscriptionSection.classList.remove('has-selection');
        // Clear the native selling plan hidden input so Dawn doesn't submit
        // a stale selling plan if it handles the form on its own.
        this.setNativeSellingPlanInput('');
      } else {
        this.selectedPlan = {
          value,
          frequency: e.target.dataset.frequency,
          discount: e.target.dataset.discount,
          sellingPlanId: e.target.dataset.sellingPlanId,
          groupName: e.target.dataset.groupName,
        };
        subscriptionSection.classList.add('has-selection');
        // Set the native selling plan hidden input as a fallback.
        // If Dawn's <product-form> handler fires despite our interception
        // (Safari bug), at least the correct selling plan will be included.
        this.setNativeSellingPlanInput(this.selectedPlan.sellingPlanId || '');
      }

      this.saveSelection(value);
    }

    /**
     * Set the native hidden input[name="selling_plan"] value in the product form.
     * This ensures that even if Dawn's native form handler fires (e.g. in Safari),
     * the correct selling plan is submitted.
     */
    setNativeSellingPlanInput(value) {
      if (!this.productForm) return;
      let input = this.productForm.querySelector('input[name="selling_plan"]');
      if (!input) {
        // Create the hidden input if it doesn't exist
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'selling_plan';
        this.productForm.appendChild(input);
      }
      input.value = value;
    }

    async handleFormSubmit(e) {
      // If one-time purchase, let the form submit normally
      if (!this.selectedPlan) {
        // Clear any previous subscription attributes
        this.clearSubscriptionAttributesQuietly();
        return; // Normal form submission continues
      }

      // Guard against double execution (button click + form submit both fire)
      if (this._submitting) return;
      this._submitting = true;

      // Subscription selected — intercept the form submission.
      // Use stopImmediatePropagation to prevent Dawn theme's <product-form>
      // custom element from also handling this event (causes duplicate cart items in Safari).
      e.preventDefault();
      e.stopImmediatePropagation();

      const statusEl = this.container.querySelector('.ssma-product-widget__status');
      statusEl.style.display = 'block';
      statusEl.textContent = 'Adding to cart with subscription...';
      statusEl.className = 'ssma-product-widget__status ssma-product-widget__status--loading';

      try {
        // 1. Get variant ID and quantity from the form
        const formData = new FormData(this.productForm);
        const variantId = formData.get('id');
        const quantity = formData.get('quantity') || 1;

        if (!variantId) {
          throw new Error('No variant selected');
        }

        // 2. Add product to cart via /cart/add.js
        // Include selling_plan if available so Shopify applies the native
        // selling plan pricing discount automatically at checkout.
        const addPayload = {
          id: variantId,
          quantity: parseInt(quantity, 10),
        };
        if (this.selectedPlan.sellingPlanId) {
          addPayload.selling_plan = this.selectedPlan.sellingPlanId;
          console.log('Subscribe & Save Product: Adding with selling_plan:', this.selectedPlan.sellingPlanId);
        }
        const addResponse = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addPayload),
        });

        if (!addResponse.ok) {
          const errorData = await addResponse.json().catch(() => ({}));
          throw new Error(errorData.description || 'Failed to add to cart');
        }

        // 3. Set SSMA cart attributes via /cart/update.js
        // These attributes are used by SSMA's webhook handler to create a
        // subscription record when the order is placed. The discount is handled
        // natively by the Shopify selling plan pricing policy — no discount
        // codes needed.
        //
        // IMPORTANT: /cart/update.js REPLACES all attributes (does not merge).
        // We must first read the existing cart attributes (e.g. Pickup Date,
        // Pickup Time Slot) and merge them to avoid overwriting other data.
        const cartResponse = await fetch('/cart.js');
        const cartData = await cartResponse.json();
        const mergedAttributes = Object.assign({}, cartData.attributes || {}, {
          'Subscription Enabled': 'true',
          'Subscription Frequency': this.selectedPlan.frequency,
          'Subscription Discount': this.selectedPlan.discount,
        });

        await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: mergedAttributes }),
        });

        // 5. Save selection to sessionStorage
        this.saveSelection(this.selectedPlan.value);

        statusEl.textContent = 'Redirecting to cart...';

        // 6. Navigate to cart page
        // Safety: reset _submitting after 10s in case navigation fails
        // (popup blocker, URL intercepted, etc.) so user isn't locked out.
        setTimeout(() => { this._submitting = false; }, 10000);
        window.location.href = '/cart';
      } catch (error) {
        console.error('Subscribe & Save Product: Error during add to cart:', error);
        statusEl.textContent = error.message || 'Error adding to cart. Please try again.';
        statusEl.className = 'ssma-product-widget__status ssma-product-widget__status--error';
        this._submitting = false; // Allow retry on error
      }
    }

    /**
     * Silently clear subscription attributes if user switches back to one-time.
     * Non-blocking — fire and forget.
     * IMPORTANT: Merges with existing attributes to avoid overwriting pickup data.
     */
    clearSubscriptionAttributesQuietly() {
      fetch('/cart.js')
        .then(r => r.json())
        .then(cartData => {
          const merged = Object.assign({}, cartData.attributes || {}, {
            'Subscription Enabled': '',
            'Subscription Frequency': '',
            'Subscription Discount': '',
          });
          return fetch('/cart/update.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attributes: merged }),
          });
        })
        .catch(() => { /* ignore */ });
    }

    saveSelection(value) {
      const data = {
        type: value,
        timestamp: Date.now(),
      };

      if (this.selectedPlan) {
        data.frequency = this.selectedPlan.frequency;
        data.discount = this.selectedPlan.discount;
      }

      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        // Ignore storage errors
      }
    }

    restoreSelection() {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (!saved) return;

        const data = JSON.parse(saved);
        // Only restore if within 30 minutes
        if (Date.now() - data.timestamp > 30 * 60 * 1000) return;

        if (data.type && data.type !== 'onetime' && data.frequency) {
          const radio = this.container.querySelector(
            `input[data-frequency="${data.frequency}"]`
          );
          if (radio) {
            radio.checked = true;
            this.selectedPlan = {
              value: data.type,
              frequency: data.frequency,
              discount: data.discount,
              sellingPlanId: radio.dataset.sellingPlanId || '',
              groupName: radio.dataset.groupName || '',
            };
            const subscriptionSection = this.container.querySelector(
              '.ssma-product-widget__option--subscribe'
            );
            subscriptionSection.classList.add('has-selection');
          }
        }
      } catch (e) {
        // Ignore restore errors
      }
    }
  }

  // =========================================================
  // Initialize
  // =========================================================

  function init() {
    const embed = document.getElementById('subscribe-save-product-embed');
    if (!embed || embed.dataset.enabled !== 'true') return;

    // Avoid duplicate injection
    if (document.getElementById('subscribe-save-product-widget')) return;

    const shopDomain = embed.dataset.shop || window.Shopify?.shop || '';
    const productId = embed.dataset.productId || '';

    if (!productId) {
      console.log('Subscribe & Save Product: No product ID, skipping');
      return;
    }

    new SubscribeSaveProductWidget({ shopDomain, productId });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme editor support
  document.addEventListener('shopify:section:load', init);

  // Expose for external use
  window.SubscribeSaveProductWidget = SubscribeSaveProductWidget;
})();
