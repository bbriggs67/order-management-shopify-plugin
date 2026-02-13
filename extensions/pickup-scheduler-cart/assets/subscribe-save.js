/**
 * Subscribe and Save Widget - App Embed Version
 * Auto-injects subscription options on product pages
 *
 * This widget integrates with Shopify's native selling plans system.
 * It fetches actual selling plan IDs from the app's API and uses them
 * to properly create subscription contracts when customers add to cart.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'susie_subscription_selection';

  class SubscribeSaveWidget {
    constructor(options) {
      this.appUrl = options.appUrl;
      this.shopDomain = options.shopDomain || window.Shopify?.shop || this.getShopDomain();
      this.weeklyDiscount = options.weeklyDiscount || 10;
      this.biweeklyDiscount = options.biweeklyDiscount || 5;
      this.triweeklyDiscount = options.triweeklyDiscount || 0;
      this.productId = this.getProductId();
      this.container = null;
      this.sellingPlans = []; // Will be populated from API
      this.sellingPlanGroupId = null;

      if (this.isProductPage()) {
        this.init();
      }
    }

    async init() {
      // Fetch selling plan IDs from the app's API
      await this.fetchSellingPlans();

      // Inject widget (works with or without selling plans)
      this.injectWidget();
    }

    async fetchSellingPlans() {
      if (!this.appUrl || !this.shopDomain) {
        console.warn('Subscribe & Save: Missing appUrl or shopDomain, using fallback');
        return;
      }

      try {
        const apiUrl = this.appUrl + '/api/selling-plans?shop=' + encodeURIComponent(this.shopDomain);
        console.log('Subscribe & Save: Fetching selling plans from', apiUrl);
        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error('API returned ' + response.status);
        }

        const data = await response.json();
        console.log('Subscribe & Save: Received selling plans data', data);

        if (data.enabled && data.plans) {
          this.sellingPlans = data.plans;
          this.sellingPlanGroupId = data.groupId;

          // Update discounts from API data
          const weeklyPlan = data.plans.find(function(p) { return p.frequency === 'WEEKLY'; });
          const biweeklyPlan = data.plans.find(function(p) { return p.frequency === 'BIWEEKLY'; });
          const triweeklyPlan = data.plans.find(function(p) { return p.frequency === 'TRIWEEKLY'; });

          if (weeklyPlan) this.weeklyDiscount = weeklyPlan.discount;
          if (biweeklyPlan) this.biweeklyDiscount = biweeklyPlan.discount;
          if (triweeklyPlan) this.triweeklyDiscount = triweeklyPlan.discount;
        }
      } catch (error) {
        console.error('Subscribe & Save: Failed to fetch selling plans:', error);
      }
    }

    getShopDomain() {
      if (window.Shopify && window.Shopify.shop) return window.Shopify.shop;
      var hostname = window.location.hostname;
      if (hostname.includes('.myshopify.com')) {
        return hostname;
      }
      var shopMeta = document.querySelector('meta[name="shopify-shop"]');
      if (shopMeta) return shopMeta.content;
      return null;
    }

    isProductPage() {
      return window.location.pathname.includes('/products/');
    }

    getProductId() {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
        return window.ShopifyAnalytics.meta.product.id;
      }
      var metaTag = document.querySelector('meta[property="og:type"][content="product"]');
      if (metaTag) {
        var productIdMeta = document.querySelector('meta[name="product-id"]');
        if (productIdMeta) return productIdMeta.content;
      }
      var match = window.location.pathname.match(/\/products\/([^/?]+)/);
      return match ? match[1] : null;
    }

    getSellingPlanId(frequency) {
      var plan = this.sellingPlans.find(function(p) { return p.frequency === frequency; });
      return plan ? plan.id : null;
    }

    extractNumericId(gid) {
      if (!gid) return null;
      var match = gid.match(/\/(\d+)$/);
      return match ? match[1] : gid;
    }

    injectWidget() {
      var targets = [
        'form[action*="/cart/add"] button[type="submit"]',
        'form[action*="/cart/add"] [name="add"]',
        'form[action*="/cart/add"] .product-form__submit',
        '.product-form__buttons',
        '.product__info-container .product-form',
        '[data-product-form]',
        'form[action*="/cart/add"]'
      ];

      var insertionPoint = null;
      for (var i = 0; i < targets.length; i++) {
        var element = document.querySelector(targets[i]);
        if (element) {
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

      this.container = this.createWidgetElement();
      insertionPoint.parentNode.insertBefore(this.container, insertionPoint);

      this.bindEvents();
      this.restoreSelection();
      this.interceptAddToCart();
    }

    createWidgetElement() {
      var widget = document.createElement('div');
      widget.id = 'subscribe-save-widget';
      widget.className = 'subscribe-save-widget';
      widget.dataset.productId = this.productId;

      var self = this;
      var weeklyPlan = this.sellingPlans.find(function(p) { return p.frequency === 'WEEKLY'; });
      var biweeklyPlan = this.sellingPlans.find(function(p) { return p.frequency === 'BIWEEKLY'; });
      var triweeklyPlan = this.sellingPlans.find(function(p) { return p.frequency === 'TRIWEEKLY'; });

      var weeklyDiscount = weeklyPlan ? weeklyPlan.discount : this.weeklyDiscount;
      var biweeklyDiscount = biweeklyPlan ? biweeklyPlan.discount : this.biweeklyDiscount;
      var triweeklyDiscount = triweeklyPlan ? triweeklyPlan.discount : this.triweeklyDiscount;

      var html = '<div class="subscribe-save-options">' +
        '<label class="subscribe-save-option subscribe-save-option--onetime">' +
          '<input type="radio" name="purchase_option" value="onetime" checked>' +
          '<span class="subscribe-save-option__radio"></span>' +
          '<span class="subscribe-save-option__content">' +
            '<span class="subscribe-save-option__title">One-time purchase</span>' +
          '</span>' +
        '</label>' +
        '<div class="subscribe-save-option subscribe-save-option--subscription">' +
          '<div class="subscribe-save-option__header">' +
            '<span class="subscribe-save-option__title">Subscribe and Save (Porch Pick-up Only)</span>' +
          '</div>' +
          '<div class="subscribe-save-option__choices">' +
            '<label class="subscribe-save-choice">' +
              '<input type="radio" name="purchase_option" value="weekly" ' +
                'data-frequency="WEEKLY" ' +
                'data-discount="' + weeklyDiscount + '" ' +
                'data-selling-plan-id="' + (weeklyPlan ? weeklyPlan.id : '') + '">' +
              '<span class="subscribe-save-choice__radio"></span>' +
              '<span class="subscribe-save-choice__text">Deliver every week, <strong>' + weeklyDiscount + '% off</strong></span>' +
            '</label>' +
            '<label class="subscribe-save-choice">' +
              '<input type="radio" name="purchase_option" value="biweekly" ' +
                'data-frequency="BIWEEKLY" ' +
                'data-discount="' + biweeklyDiscount + '" ' +
                'data-selling-plan-id="' + (biweeklyPlan ? biweeklyPlan.id : '') + '">' +
              '<span class="subscribe-save-choice__radio"></span>' +
              '<span class="subscribe-save-choice__text">Deliver every 2 weeks, <strong>' + biweeklyDiscount + '% off</strong></span>' +
            '</label>';

      if (triweeklyDiscount > 0) {
        html += '<label class="subscribe-save-choice">' +
              '<input type="radio" name="purchase_option" value="triweekly" ' +
                'data-frequency="TRIWEEKLY" ' +
                'data-discount="' + triweeklyDiscount + '" ' +
                'data-selling-plan-id="' + (triweeklyPlan ? triweeklyPlan.id : '') + '">' +
              '<span class="subscribe-save-choice__radio"></span>' +
              '<span class="subscribe-save-choice__text">Deliver every 3 weeks, <strong>' + triweeklyDiscount + '% off</strong></span>' +
            '</label>';
      }

      html += '</div></div></div>' +
        '<p class="subscribe-save-note">Auto-renews, skip or cancel anytime.</p>';

      widget.innerHTML = html;
      return widget;
    }

    bindEvents() {
      var self = this;
      var radios = this.container.querySelectorAll('input[type="radio"]');
      radios.forEach(function(radio) {
        radio.addEventListener('change', function(e) { self.handleSelectionChange(e); });
      });
    }

    handleSelectionChange(e) {
      var value = e.target.value;
      var subscriptionSection = this.container.querySelector('.subscribe-save-option--subscription');

      if (value === 'weekly' || value === 'biweekly' || value === 'triweekly') {
        subscriptionSection.classList.add('has-selection');
      } else if (value === 'onetime') {
        subscriptionSection.classList.remove('has-selection');
      }

      this.saveSelection(value, e.target.dataset.sellingPlanId);

      this.container.dispatchEvent(new CustomEvent('subscription:change', {
        bubbles: true,
        detail: {
          type: value,
          frequency: e.target.dataset.frequency || null,
          discount: e.target.dataset.discount || 0,
          sellingPlanId: e.target.dataset.sellingPlanId || null,
          productId: this.productId
        }
      }));
    }

    saveSelection(value, sellingPlanId) {
      var data = {
        type: value,
        productId: this.productId,
        timestamp: Date.now(),
        sellingPlanId: sellingPlanId || null
      };

      if (value === 'weekly') {
        data.frequency = 'WEEKLY';
        data.discount = this.weeklyDiscount;
      } else if (value === 'biweekly') {
        data.frequency = 'BIWEEKLY';
        data.discount = this.biweeklyDiscount;
      } else if (value === 'triweekly') {
        data.frequency = 'TRIWEEKLY';
        data.discount = this.triweeklyDiscount;
      }

      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn('Could not save subscription selection:', e);
      }
    }

    restoreSelection() {
      try {
        var saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          var data = JSON.parse(saved);
          if (data.productId === this.productId && (Date.now() - data.timestamp) < 30 * 60 * 1000) {
            var radio = this.container.querySelector('input[value="' + data.type + '"]');
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
      var self = this;
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return;

      form.addEventListener('submit', function(e) {
        var selection = self.getSelection();
        if (selection && selection.type !== 'onetime') {
          self.addSubscriptionData(form, selection);
        } else {
          self.removeSubscriptionData(form);
        }
      });
    }

    addSubscriptionData(form, selection) {
      this.removeSubscriptionData(form);

      if (selection.type === 'onetime') return;

      // If we have a selling plan ID, add it (this triggers proper Shopify subscriptions)
      if (selection.sellingPlanId) {
        var numericId = this.extractNumericId(selection.sellingPlanId);

        // Add the selling_plan field - THIS IS THE KEY FIELD that triggers Shopify subscriptions
        var sellingPlanInput = document.createElement('input');
        sellingPlanInput.type = 'hidden';
        sellingPlanInput.name = 'selling_plan';
        sellingPlanInput.value = numericId;
        sellingPlanInput.className = 'subscription-property';
        form.appendChild(sellingPlanInput);

        console.log('Subscribe & Save: Added selling plan', numericId, 'for', selection.frequency);
      } else {
        console.warn('Subscribe & Save: No selling plan ID available, subscription may not work properly');
      }

      // Also add line item properties for display/tracking purposes
      var properties = [
        { name: 'properties[Subscription]', value: 'Yes' },
        { name: 'properties[Frequency]', value: selection.frequency },
        { name: 'properties[Discount]', value: selection.discount + '%' }
      ];

      properties.forEach(function(prop) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = prop.name;
        input.value = prop.value;
        input.className = 'subscription-property';
        form.appendChild(input);
      });
    }

    removeSubscriptionData(form) {
      form.querySelectorAll('.subscription-property').forEach(function(el) { el.remove(); });
    }

    getSelection() {
      var checked = this.container.querySelector('input[type="radio"]:checked');
      if (!checked) return null;

      return {
        type: checked.value,
        frequency: checked.dataset.frequency || null,
        discount: parseInt(checked.dataset.discount) || 0,
        sellingPlanId: checked.dataset.sellingPlanId || null
      };
    }
  }

  function init() {
    var embed = document.getElementById('subscribe-save-embed');
    if (!embed || embed.dataset.enabled !== 'true') {
      return;
    }

    if (document.getElementById('subscribe-save-widget')) {
      return;
    }

    var appUrl = embed.dataset.appUrl;
    var shopDomain = embed.dataset.shopDomain || (window.Shopify && window.Shopify.shop);
    var weeklyDiscount = parseInt(embed.dataset.weeklyDiscount) || 10;
    var biweeklyDiscount = parseInt(embed.dataset.biweeklyDiscount) || 5;
    var triweeklyDiscount = parseInt(embed.dataset.triweeklyDiscount) || 0;

    new SubscribeSaveWidget({
      appUrl: appUrl,
      shopDomain: shopDomain,
      weeklyDiscount: weeklyDiscount,
      biweeklyDiscount: biweeklyDiscount,
      triweeklyDiscount: triweeklyDiscount
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', init);
  window.SubscribeSaveWidget = SubscribeSaveWidget;
})();
