/**
 * Subscribe and Save Widget - Cart Page Version
 * Injects subscription options on the cart page and uses cart attributes
 * for seamless integration with SSMA (Susie's Sourdough Manager App)
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'susie_subscription_selection';

  class SubscribeSaveWidget {
    constructor(options) {
      this.weeklyDiscount = options.weeklyDiscount || 10;
      this.biweeklyDiscount = options.biweeklyDiscount || 5;
      this.triweeklyDiscount = options.triweeklyDiscount || 0;
      this.shopDomain = options.shopDomain || '';
      this.container = null;
      this.plans = [];

      if (this.isCartPage()) {
        this.init();
      }
    }

    isCartPage() {
      // Check if we're on the cart page
      return window.location.pathname === '/cart' ||
             window.location.pathname.endsWith('/cart');
    }

    async init() {
      // Check current cart state for existing subscription attributes
      await this.loadCartState();

      // If Shopify selling plans are already handling subscription on this cart
      // (customer selected subscription on product page via SSMA or native UI),
      // don't show duplicate widget. The selling plan pricing policy handles the
      // discount automatically at checkout — no discount codes needed.
      if (this.hasSellingPlanItems) {
        console.log('Subscribe & Save: Cart already has selling plan items, skipping widget');
        return;
      }

      // If SSMA subscription attributes were already set from the product page widget,
      // skip the cart subscription widget (cart page only needs date/time picker)
      if (this.currentAttributes['Subscription Enabled'] === 'true') {
        console.log('Subscribe & Save: SSMA subscription already set from product page, skipping cart widget');
        return;
      }

      // Fetch plans from API, fall back to theme settings
      const apiPlans = await this.fetchPlans();
      if (apiPlans && apiPlans.length > 0) {
        this.plans = apiPlans;
      } else {
        this.plans = this.buildFallbackPlans();
      }

      this.injectWidget();
    }

    async fetchPlans() {
      try {
        let apiUrl = `/apps/my-subscription/selling-plans?shop=${encodeURIComponent(this.shopDomain)}`;
        console.log('Subscribe & Save: Fetching plans from', apiUrl);

        let response = await fetch(apiUrl);

        // If proxy fails, try the dev tunnel URL (for development)
        if (!response.ok) {
          console.log('Subscribe & Save: App proxy failed, status:', response.status);
          const devUrl = document.querySelector('meta[name="subscribe-save-dev-url"]')?.content;
          if (devUrl) {
            apiUrl = `${devUrl}/api/selling-plans?shop=${encodeURIComponent(this.shopDomain)}`;
            console.log('Subscribe & Save: Trying dev URL', apiUrl);
            response = await fetch(apiUrl);
          }
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        }

        const data = await response.json();
        console.log('Subscribe & Save: Received plans from API', data);

        // Extract the plans array from the API response
        if (data && data.enabled && Array.isArray(data.plans)) {
          return data.plans;
        }

        return null;
      } catch (e) {
        console.warn('Subscribe & Save: Could not fetch plans from API:', e);
        return null;
      }
    }

    buildFallbackPlans() {
      const plans = [];

      if (this.weeklyDiscount > 0) {
        plans.push({
          frequency: 'WEEKLY',
          name: 'Deliver every week',
          discountPercent: this.weeklyDiscount,
          discountCode: null,
          value: 'weekly'
        });
      }

      if (this.biweeklyDiscount > 0) {
        plans.push({
          frequency: 'BIWEEKLY',
          name: 'Deliver every 2 weeks',
          discountPercent: this.biweeklyDiscount,
          discountCode: null,
          value: 'biweekly'
        });
      }

      if (this.triweeklyDiscount > 0) {
        plans.push({
          frequency: 'TRIWEEKLY',
          name: 'Deliver every 3 weeks',
          discountPercent: this.triweeklyDiscount,
          discountCode: null,
          value: 'triweekly'
        });
      }

      return plans;
    }

    async loadCartState() {
      try {
        const response = await fetch('/cart.json');
        const cart = await response.json();

        // Check if subscription is already enabled in cart attributes
        this.currentAttributes = cart.attributes || {};

        // Check if any cart items already have a Shopify selling plan
        // (customer selected subscription on product page via native UI)
        this.hasSellingPlanItems = false;
        if (cart.items && cart.items.length > 0) {
          this.hasSellingPlanItems = cart.items.some(item =>
            item.selling_plan_allocation != null
          );
        }
      } catch (e) {
        console.warn('Could not load cart state:', e);
        this.currentAttributes = {};
        this.hasSellingPlanItems = false;
      }
    }

    injectWidget() {
      // Find insertion points on cart page
      const targets = [
        '.cart__footer',
        '.cart-footer',
        '.cart__blocks',
        '.cart__ctas',
        'form[action*="/cart"] button[type="submit"]',
        'form[action*="/cart"] [name="checkout"]',
        '.cart-drawer__footer',
        'cart-drawer-items',
        '.cart-items'
      ];

      let insertionPoint = null;
      for (const selector of targets) {
        const element = document.querySelector(selector);
        if (element) {
          insertionPoint = element;
          break;
        }
      }

      if (!insertionPoint) {
        // Try to find any cart form as fallback
        const cartForm = document.querySelector('form[action*="/cart"]');
        if (cartForm) {
          insertionPoint = cartForm;
        } else {
          console.warn('Subscribe & Save: Could not find insertion point on cart page');
          return;
        }
      }

      // Create the widget HTML
      this.container = this.createWidgetElement();

      // Insert before the target element
      insertionPoint.parentNode.insertBefore(this.container, insertionPoint);

      // Initialize functionality
      this.bindEvents();
      this.restoreSelection();
    }

    createWidgetElement() {
      const widget = document.createElement('div');
      widget.id = 'subscribe-save-widget';
      widget.className = 'subscribe-save-widget';
      widget.dataset.weeklyDiscount = this.weeklyDiscount;
      widget.dataset.biweeklyDiscount = this.biweeklyDiscount;
      widget.dataset.triweeklyDiscount = this.triweeklyDiscount;

      // Build subscription choice radios dynamically from plans
      let choicesHTML = '';
      for (const plan of this.plans) {
        const value = plan.value || plan.frequency.toLowerCase();
        choicesHTML += `
              <label class="subscribe-save-choice">
                <input type="radio" name="purchase_option" value="${value}" data-frequency="${plan.frequency}" data-discount="${plan.discountPercent}">
                <span class="subscribe-save-choice__radio"></span>
                <span class="subscribe-save-choice__text">${plan.name}, <strong>${plan.discountPercent}% off</strong></span>
              </label>`;
      }

      widget.innerHTML = `
        <div class="subscribe-save-header">
          <h3 class="subscribe-save-title">Subscription Options</h3>
        </div>
        <div class="subscribe-save-options">
          <!-- One-time purchase option -->
          <label class="subscribe-save-option subscribe-save-option--onetime">
            <input type="radio" name="purchase_option" value="onetime" checked>
            <span class="subscribe-save-option__radio"></span>
            <span class="subscribe-save-option__content">
              <span class="subscribe-save-option__title">One-time purchase</span>
              <span class="subscribe-save-option__desc">No subscription</span>
            </span>
          </label>

          <!-- Subscription options -->
          <div class="subscribe-save-option subscribe-save-option--subscription">
            <div class="subscribe-save-option__header">
              <span class="subscribe-save-option__title">Subscribe and Save (Porch Pick-up Only)</span>
            </div>
            <div class="subscribe-save-option__choices">
              ${choicesHTML}
            </div>
          </div>
        </div>

        <p class="subscribe-save-note">Auto-renews, skip or cancel anytime. Discount applied at checkout.</p>
        <div class="subscribe-save-status" style="display: none;"></div>
      `;

      return widget;
    }

    bindEvents() {
      const radios = this.container.querySelectorAll('input[type="radio"]');
      radios.forEach(radio => {
        radio.addEventListener('change', (e) => this.handleSelectionChange(e));
      });
    }

    async handleSelectionChange(e) {
      const value = e.target.value;
      const subscriptionSection = this.container.querySelector('.subscribe-save-option--subscription');
      const statusEl = this.container.querySelector('.subscribe-save-status');

      // Update visual state
      if (value !== 'onetime') {
        subscriptionSection.classList.add('has-selection');
      } else {
        subscriptionSection.classList.remove('has-selection');
      }

      // Show status
      statusEl.style.display = 'block';
      statusEl.textContent = 'Updating cart...';
      statusEl.className = 'subscribe-save-status subscribe-save-status--loading';

      try {
        if (value === 'onetime') {
          // Clear subscription attributes and remove discount
          await this.clearSubscriptionAttributes();
          statusEl.textContent = 'Subscription removed';
        } else {
          // Set subscription attributes and apply discount
          const frequency = e.target.dataset.frequency;
          const discount = e.target.dataset.discount;
          await this.setSubscriptionAttributes(frequency, discount);
          statusEl.textContent = `${discount}% subscription discount applied!`;
        }

        statusEl.className = 'subscribe-save-status subscribe-save-status--success';

        // Hide status after 2 seconds
        setTimeout(() => {
          statusEl.style.display = 'none';
        }, 2000);

        // Store selection for persistence
        this.saveSelection(value);

        // Dispatch custom event
        this.container.dispatchEvent(new CustomEvent('subscription:change', {
          bubbles: true,
          detail: {
            type: value,
            frequency: e.target.dataset.frequency || null,
            discount: e.target.dataset.discount || 0
          }
        }));

        // Reload page to show updated cart
        // Note: discount is applied at checkout by the checkout extension,
        // not on the cart page
        if (value !== 'onetime') {
          setTimeout(() => {
            window.location.reload();
          }, 500);
        }

      } catch (error) {
        console.error('Failed to update subscription:', error);
        statusEl.textContent = 'Error updating cart. Please try again.';
        statusEl.className = 'subscribe-save-status subscribe-save-status--error';
      }
    }

    async setSubscriptionAttributes(frequency, discount) {
      // Set cart attributes for the Shopify Discount Function to read.
      // The Function automatically applies the discount at checkout based on
      // "Subscription Enabled" and "Subscription Discount" attributes.
      // No discount code needed — the automatic discount approach handles it.
      const attributes = {
        'Subscription Enabled': 'true',
        'Subscription Frequency': frequency,
        'Subscription Discount': discount
      };

      await this.updateCartAttributes(attributes);
    }

    async clearSubscriptionAttributes() {
      // Clear subscription attributes
      await this.updateCartAttributes({
        'Subscription Enabled': '',
        'Subscription Frequency': '',
        'Subscription Discount': ''
      });
    }

    async updateCartAttributes(attributes) {
      const response = await fetch('/cart/update.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attributes: attributes
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update cart attributes');
      }

      return await response.json();
    }

    // Note: Subscription discounts are applied automatically at checkout by the
    // Shopify Discount Function (subscription-discount). No discount codes needed.

    saveSelection(value) {
      const data = {
        type: value,
        timestamp: Date.now()
      };

      // Find the matching plan for the selected value
      const plan = this.plans.find(p => (p.value || p.frequency.toLowerCase()) === value);
      if (plan) {
        data.frequency = plan.frequency;
        data.discount = plan.discountPercent;
      }

      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn('Could not save subscription selection:', e);
      }
    }

    restoreSelection() {
      // First check cart attributes for existing subscription
      if (this.currentAttributes['Subscription Enabled'] === 'true') {
        const frequency = this.currentAttributes['Subscription Frequency'];

        if (frequency) {
          const radio = this.container.querySelector(`input[data-frequency="${frequency}"]`);
          if (radio) {
            radio.checked = true;
            const subscriptionSection = this.container.querySelector('.subscribe-save-option--subscription');
            subscriptionSection.classList.add('has-selection');
            return;
          }
        }
      }

      // Fall back to session storage
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          // Only restore if within 30 minutes
          if ((Date.now() - data.timestamp) < 30 * 60 * 1000) {
            if (data.type === 'onetime') {
              const radio = this.container.querySelector('input[value="onetime"]');
              if (radio) {
                radio.checked = true;
              }
            } else if (data.frequency) {
              const radio = this.container.querySelector(`input[data-frequency="${data.frequency}"]`);
              if (radio) {
                radio.checked = true;
                const subscriptionSection = this.container.querySelector('.subscribe-save-option--subscription');
                subscriptionSection.classList.add('has-selection');
              }
            }
          }
        }
      } catch (e) {
        console.warn('Could not restore subscription selection:', e);
      }
    }

    getSelection() {
      const checked = this.container.querySelector('input[type="radio"]:checked');
      if (!checked) return null;

      return {
        type: checked.value,
        frequency: checked.dataset.frequency || null,
        discount: parseInt(checked.dataset.discount) || 0
      };
    }
  }

  // Initialize when DOM is ready
  function init() {
    // Check if the app embed is enabled
    const embed = document.getElementById('subscribe-save-embed');
    if (!embed || embed.dataset.enabled !== 'true') {
      return;
    }

    // Check if widget already exists (avoid duplicate injection)
    if (document.getElementById('subscribe-save-widget')) {
      return;
    }

    // Get settings from the embed element
    const weeklyDiscount = parseInt(embed.dataset.weeklyDiscount) || 10;
    const biweeklyDiscount = parseInt(embed.dataset.biweeklyDiscount) || 5;
    const triweeklyDiscount = parseInt(embed.dataset.triweeklyDiscount) || 0;
    const shopDomain = embed.dataset.shop || window.Shopify?.shop || '';

    // Create the widget
    new SubscribeSaveWidget({
      weeklyDiscount,
      biweeklyDiscount,
      triweeklyDiscount,
      shopDomain
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also run on Shopify section load (for theme editor)
  document.addEventListener('shopify:section:load', init);

  // Expose for external use
  window.SubscribeSaveWidget = SubscribeSaveWidget;
})();
