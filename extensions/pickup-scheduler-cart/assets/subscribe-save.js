/**
 * Subscribe and Save Widget - App Embed Version
 * Auto-injects subscription options on product pages
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'susie_subscription_selection';

  class SubscribeSaveWidget {
    constructor(options) {
      this.weeklyDiscount = options.weeklyDiscount || 10;
      this.biweeklyDiscount = options.biweeklyDiscount || 5;
      this.productId = this.getProductId();
      this.container = null;

      if (this.isProductPage()) {
        this.injectWidget();
      }
    }

    isProductPage() {
      // Check if we're on a product page
      return window.location.pathname.includes('/products/');
    }

    getProductId() {
      // Try to get product ID from various sources
      if (window.ShopifyAnalytics?.meta?.product?.id) {
        return window.ShopifyAnalytics.meta.product.id;
      }
      // Try meta tag
      const metaTag = document.querySelector('meta[property="og:type"][content="product"]');
      if (metaTag) {
        const productIdMeta = document.querySelector('meta[name="product-id"]');
        if (productIdMeta) return productIdMeta.content;
      }
      // Extract from URL as fallback
      const match = window.location.pathname.match(/\/products\/([^/?]+)/);
      return match ? match[1] : null;
    }

    injectWidget() {
      // Find the best insertion point - look for add to cart form or buy buttons
      const targets = [
        'form[action*="/cart/add"] button[type="submit"]',
        'form[action*="/cart/add"] [name="add"]',
        'form[action*="/cart/add"] .product-form__submit',
        '.product-form__buttons',
        '.product__info-container .product-form',
        '[data-product-form]',
        'form[action*="/cart/add"]'
      ];

      let insertionPoint = null;
      for (const selector of targets) {
        const element = document.querySelector(selector);
        if (element) {
          // Find the form or a good container to insert before
          insertionPoint = element.closest('.product-form__buttons') ||
                          element.closest('.product-form__quantity') ||
                          element.parentElement;
          break;
        }
      }

      if (!insertionPoint) {
        console.warn('Subscribe & Save: Could not find insertion point on product page');
        return;
      }

      // Create the widget HTML
      this.container = this.createWidgetElement();

      // Insert before the buttons/form
      insertionPoint.parentNode.insertBefore(this.container, insertionPoint);

      // Initialize functionality
      this.bindEvents();
      this.restoreSelection();
      this.interceptAddToCart();
    }

    createWidgetElement() {
      const widget = document.createElement('div');
      widget.id = 'subscribe-save-widget';
      widget.className = 'subscribe-save-widget';
      widget.dataset.productId = this.productId;
      widget.dataset.weeklyDiscount = this.weeklyDiscount;
      widget.dataset.biweeklyDiscount = this.biweeklyDiscount;

      widget.innerHTML = `
        <div class="subscribe-save-options">
          <!-- One-time purchase option -->
          <label class="subscribe-save-option subscribe-save-option--onetime">
            <input type="radio" name="purchase_option" value="onetime" checked>
            <span class="subscribe-save-option__radio"></span>
            <span class="subscribe-save-option__content">
              <span class="subscribe-save-option__title">One-time purchase</span>
            </span>
          </label>

          <!-- Subscription options -->
          <div class="subscribe-save-option subscribe-save-option--subscription">
            <div class="subscribe-save-option__header">
              <span class="subscribe-save-option__title">Subscribe and Save (Porch Pick-up Only)</span>
            </div>
            <div class="subscribe-save-option__choices">
              <label class="subscribe-save-choice">
                <input type="radio" name="purchase_option" value="weekly" data-frequency="WEEKLY" data-discount="${this.weeklyDiscount}">
                <span class="subscribe-save-choice__radio"></span>
                <span class="subscribe-save-choice__text">Deliver every week, <strong>${this.weeklyDiscount}% off</strong></span>
              </label>
              <label class="subscribe-save-choice">
                <input type="radio" name="purchase_option" value="biweekly" data-frequency="BIWEEKLY" data-discount="${this.biweeklyDiscount}">
                <span class="subscribe-save-choice__radio"></span>
                <span class="subscribe-save-choice__text">Deliver every 2 weeks, <strong>${this.biweeklyDiscount}% off</strong></span>
              </label>
            </div>
          </div>
        </div>

        <p class="subscribe-save-note">Auto-renews, skip or cancel anytime.</p>
      `;

      return widget;
    }

    bindEvents() {
      const radios = this.container.querySelectorAll('input[type="radio"]');
      radios.forEach(radio => {
        radio.addEventListener('change', (e) => this.handleSelectionChange(e));
      });
    }

    handleSelectionChange(e) {
      const value = e.target.value;
      const subscriptionSection = this.container.querySelector('.subscribe-save-option--subscription');

      // Update visual state
      if (value === 'weekly' || value === 'biweekly') {
        subscriptionSection.classList.add('has-selection');
      } else if (value === 'onetime') {
        subscriptionSection.classList.remove('has-selection');
      }

      // Store selection
      this.saveSelection(value);

      // Dispatch custom event for other scripts to listen to
      this.container.dispatchEvent(new CustomEvent('subscription:change', {
        bubbles: true,
        detail: {
          type: value,
          frequency: e.target.dataset.frequency || null,
          discount: e.target.dataset.discount || 0,
          productId: this.productId
        }
      }));
    }

    saveSelection(value) {
      const data = {
        type: value,
        productId: this.productId,
        timestamp: Date.now()
      };

      if (value === 'weekly') {
        data.frequency = 'WEEKLY';
        data.discount = this.weeklyDiscount;
      } else if (value === 'biweekly') {
        data.frequency = 'BIWEEKLY';
        data.discount = this.biweeklyDiscount;
      }

      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn('Could not save subscription selection:', e);
      }
    }

    restoreSelection() {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          // Only restore if it's for the same product and within 30 minutes
          if (data.productId === this.productId && (Date.now() - data.timestamp) < 30 * 60 * 1000) {
            const radio = this.container.querySelector(`input[value="${data.type}"]`);
            if (radio) {
              radio.checked = true;
              radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
      } catch (e) {
        console.warn('Could not restore subscription selection:', e);
      }
    }

    interceptAddToCart() {
      // Find the product form on the page
      const form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return;

      form.addEventListener('submit', (e) => {
        const selection = this.getSelection();
        if (selection && selection.type !== 'onetime') {
          // Add subscription data as hidden fields or line item properties
          this.addSubscriptionData(form, selection);
        }
      });
    }

    addSubscriptionData(form, selection) {
      // Remove any existing subscription fields
      form.querySelectorAll('.subscription-property').forEach(el => el.remove());

      if (selection.type === 'onetime') return;

      // Add line item properties for subscription
      const properties = [
        { name: 'properties[Subscription]', value: 'Yes' },
        { name: 'properties[Frequency]', value: selection.frequency },
        { name: 'properties[Discount]', value: `${selection.discount}%` }
      ];

      properties.forEach(prop => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = prop.name;
        input.value = prop.value;
        input.className = 'subscription-property';
        form.appendChild(input);
      });
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

    // Create the widget
    new SubscribeSaveWidget({
      weeklyDiscount,
      biweeklyDiscount
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
