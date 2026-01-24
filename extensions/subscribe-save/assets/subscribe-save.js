/**
 * Subscribe and Save Widget
 * Handles subscription selection on product pages
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'susie_subscription_selection';

  class SubscribeSaveWidget {
    constructor(container) {
      this.container = container;
      this.productId = container.dataset.productId;
      this.weeklyDiscount = parseInt(container.dataset.weeklyDiscount) || 10;
      this.biweeklyDiscount = parseInt(container.dataset.biweeklyDiscount) || 5;

      this.init();
    }

    init() {
      this.bindEvents();
      this.restoreSelection();
    }

    bindEvents() {
      const radios = this.container.querySelectorAll('input[type="radio"]');
      radios.forEach(radio => {
        radio.addEventListener('change', (e) => this.handleSelectionChange(e));
      });

      // Also intercept the add to cart form
      this.interceptAddToCart();
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
    const widgets = document.querySelectorAll('#subscribe-save-widget');
    widgets.forEach(widget => {
      if (!widget.dataset.initialized) {
        new SubscribeSaveWidget(widget);
        widget.dataset.initialized = 'true';
      }
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
